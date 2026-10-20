"""Replace EVERY contact with the rows from a spreadsheet, in a single
transaction -- if anything fails, nothing changes. Deliberately doesn't go
through create_app(), which runs schema changes and seeding on startup.
Reads DATABASE_URL from the environment:

    $env:DATABASE_URL = "<connection string>"
    .venv\\Scripts\\python.exe replace_contacts.py --dry-run
    .venv\\Scripts\\python.exe replace_contacts.py

--dry-run performs the whole replacement inside a transaction, prints the
before/after counts, then rolls back -- so it is checked against the real
database constraints without changing anything.

Old contacts are matched to new rows by email (case-insensitive), or by
first + last name + organization when there's no email. For a matched
contact these carry over to the new row: the unsubscribed flag and its
unsubscribe link, pipeline stage, the original "added" date, activity log
entries, tasks, favorites, and group membership. Old contacts with no match
in the sheet are deleted; their activity entries and tasks are kept but no
longer linked to a person (each keeps a note of who it was about).

--keep-file names a CSV (with "Contact ID", "Email", "First Name" and
"Last Name" columns) of old contacts to leave exactly as they are instead
of deleting them -- row, activities, tasks, favorites and groups untouched.
Each listed ID is checked against that contact's email/name first, so a
keep file made from a different database can't keep the wrong people.

The Groups page's "Archived Constant Contact" section has no table of its
own: it lists every distinct name found in contacts.archived_constant_contact
(a JSON array of group names per contact). So inserting each contact with
its group names both creates the groups and links the members, inside the
same transaction as everything else.
"""
import argparse
import csv
import json
import os
import re
import sys
from datetime import datetime

import pandas as pd
from sqlalchemy import MetaData, bindparam, create_engine, func, select, text

from config import _normalize_database_url

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DEFAULT_FILE = os.path.join(BASE_DIR, 'MCDMasterList.xlsx')
DEFAULT_SHEET = '2026-07-07_official'

# Spreadsheet header -> contacts column. Every header must be present.
COLUMN_MAP = {
    'First Name': 'first_name',
    'M.I.': 'middle_initial',
    'Last Name': 'last_name',
    'Company': 'organization',
    'Role / Title': 'title',
    'Email - Work': 'email',
    'Email - Secondary': 'email_secondary',
    'Industry': 'industry',
    'Tag': 'tag',
    'County': 'county',
    # 'Email status' is deliberately not imported: it holds sales stages
    # (Qualified, Working...), not email statuses.
    'PhonePersonal': 'phone_cell',      # also copied to phone_personal, same as the app's importer
    'PhoneWork': 'phone_office',
    'Phone - Misc.': 'phone_misc',
    'Street': 'street',
    'City': 'city',
    'State': 'state',
    'Zip': 'zip_code',
    'Archived Constant Contact': 'archived_constant_contact',
    'Notes': 'notes',
    'Website': 'website',
    'DBA Name': 'dba_name',
}

# Copied from an old contact onto its matching new row.
CARRY_OVER = ('unsubscribed', 'unsubscribe_token', 'pipeline_stage', 'added')

# Tables that point at contacts and that this script re-links itself.
HANDLED_LINK_TABLES = ('activities', 'tasks', 'contact_favorites', 'groups')

EMAIL_RE = re.compile(r'^[^@\s,;|<>()]+@[^@\s,;|<>()]+\.[A-Za-z]{2,}$')
EXCEL_ERROR_RE = re.compile(r'#(REF!|ERROR!|N/A|VALUE!|NAME\?|DIV/0!|NULL!|NUM!)', re.I)


def clean_phone(value):
    """Digits only when the cell is one ordinary 10/11-digit number (like the
    app's importer); anything else -- extensions, several numbers in one
    cell -- is kept as typed instead of being mashed into one digit run."""
    if not value:
        return None
    digits = re.sub(r'\D', '', value)
    return digits if len(digits) in (10, 11) else value


def split_cc_groups(value):
    """Constant Contact group names, separated by ";" only. Unlike
    utils.split_lists, "|" and "," are left alone -- some group names
    contain them. Repeats within one cell are dropped, order kept."""
    return list(dict.fromkeys(p.strip() for p in (value or '').split(';') if p.strip()))


def cc_group_counts(lists):
    """(distinct group names, total contact-to-group links)."""
    names, links = set(), 0
    for groups in lists:
        if isinstance(groups, str):  # JSON not decoded by the driver
            groups = json.loads(groups)
        names.update(groups or [])
        links += len(groups or [])
    return len(names), links


def contact_key(email, first, last, org):
    if email:
        return email.strip().lower()
    return ('', (first or '').strip().lower(), (last or '').strip().lower(), (org or '').strip().lower())


def contact_label(first, last, email):
    return ' '.join(p for p in (first, last) if p) or email or '(no name)'


def load_sheet(path, sheet):
    """Returns (rows, issues). Each row is a dict of contacts columns plus
    '_line' (spreadsheet row number) and '_key' (match key)."""
    xl = pd.ExcelFile(path, engine='openpyxl')
    if sheet not in xl.sheet_names:
        sys.exit(f'No sheet named {sheet!r} in {path}. Sheets: {xl.sheet_names}')
    df = xl.parse(sheet, dtype=str, keep_default_na=False)
    df = df.rename(columns=lambda c: str(c).strip())
    missing = [h for h in COLUMN_MAP if h not in df.columns]
    if missing:
        sys.exit(f'Sheet {sheet!r} is missing expected column(s): {missing}')

    issues = {
        'rows_read': len(df),
        'other_sheets': [s for s in xl.sheet_names if s != sheet],
        'unmapped_columns': [c for c in df.columns if c not in COLUMN_MAP],
        'blank': [], 'no_name_or_email': [], 'duplicate': [],
        'split_email': [], 'bad_email': [],
        'excel_errors': 0, 'zip_padded': 0, 'phone_kept_as_typed': 0, 'no_company': 0,
    }
    now = datetime.utcnow()
    rows, seen = [], {}

    for i, rec in enumerate(df.to_dict(orient='records')):
        line = i + 2  # header is row 1
        v = {}
        for header, col in COLUMN_MAP.items():
            s = str(rec[header]).strip()
            if EXCEL_ERROR_RE.fullmatch(s):
                issues['excel_errors'] += 1
                s = ''
            v[col] = s or None
        if not any(v.values()):
            issues['blank'].append(line)
            continue

        # "a@x.com | b@y.com" or one-per-line cells: the first valid address
        # becomes the email, the rest go to email_secondary. Anything that
        # isn't a usable address is kept in notes rather than dropped.
        raw_email, email, extras, bad = v['email'], None, [], []
        for part in re.split(r'[|;,\s]+', raw_email or ''):
            if not part:
                continue
            if EMAIL_RE.match(part):
                if email is None:
                    email = part
                else:
                    extras.append(part)
            else:
                bad.append(part)
        if extras:
            issues['split_email'].append((line, raw_email))
            v['email_secondary'] = '; '.join(extras + ([v['email_secondary']] if v['email_secondary'] else []))
        if bad:
            issues['bad_email'].append((line, raw_email))
            note = f'Unrecognized email from import: {raw_email}'
            v['notes'] = f"{v['notes']}\n{note}" if v['notes'] else note
        v['email'] = email

        if not (v['first_name'] or v['last_name'] or email):
            issues['no_name_or_email'].append(line)
            continue

        key = contact_key(email, v['first_name'], v['last_name'], v['organization'])
        if key in seen:
            issues['duplicate'].append((line, seen[key], email or contact_label(v['first_name'], v['last_name'], None)))
            continue
        seen[key] = line

        if not v['organization']:
            issues['no_company'] += 1
        for col in ('phone_cell', 'phone_office', 'phone_misc'):
            cleaned = clean_phone(v[col])
            if cleaned and not (cleaned.isdigit() and len(cleaned) in (10, 11)):
                issues['phone_kept_as_typed'] += 1
            v[col] = cleaned
        if v['zip_code'] and re.fullmatch(r'\d{4}', v['zip_code']):
            v['zip_code'] = '0' + v['zip_code']  # Excel dropped the leading zero (e.g. 01801)
            issues['zip_padded'] += 1

        v.update({
            'phone_personal': v['phone_cell'],
            'archived_constant_contact': split_cc_groups(v['archived_constant_contact']),
            'lists': [],
            'active': None,
            'added': now,
            'unsubscribed': False,
            'unsubscribe_token': None,
            'pipeline_stage': None,
            'deleted_at': None,
            'data_complete': bool(email and (v['first_name'] or v['last_name']) and v['organization']
                                  and (v['phone_office'] or v['phone_cell'])),
            '_line': line,
            '_key': key,
        })
        rows.append(v)
    return rows, issues


def print_issues(rows, issues):
    def show(items, limit=40):
        for item in items[:limit]:
            print(f'      {item}')
        if len(items) > limit:
            print(f'      ... and {len(items) - limit} more')

    print(f"\nSheet: {issues['rows_read']:,} rows read, {len(rows):,} contacts to insert")
    if issues['other_sheets']:
        print(f"  Ignored sheets: {issues['other_sheets']}")
    if issues['unmapped_columns']:
        print(f"  Ignored columns: {issues['unmapped_columns']}")
    print(f"  Skipped -- blank rows: {len(issues['blank'])}")
    print(f"  Skipped -- no name and no email: {len(issues['no_name_or_email'])}")
    show(issues['no_name_or_email'])
    print(f"  Skipped -- duplicate of an earlier row (same email, or same name+company): {len(issues['duplicate'])}")
    show([f'row {line} duplicates row {first}: {what}' for line, first, what in issues['duplicate']])
    print(f"  Fixed -- cells with several emails (first kept, rest -> Email - Secondary): {len(issues['split_email'])}")
    show([f'row {line}: {raw!r}' for line, raw in issues['split_email']])
    print(f"  Fixed -- unusable email text (copied into Notes): {len(issues['bad_email'])}")
    show([f'row {line}: {raw!r}' for line, raw in issues['bad_email']])
    print(f"  Fixed -- Excel error values (#REF!, #ERROR!...) blanked: {issues['excel_errors']}")
    print(f"  Fixed -- 4-digit zips given back their leading zero: {issues['zip_padded']}")
    print(f"  Note -- phones kept as typed (extensions, several numbers, too short): {issues['phone_kept_as_typed']}")
    print(f"  Note -- contacts with no Company: {issues['no_company']:,}")

    groups = [row['archived_constant_contact'] for row in rows]
    n_groups, n_links = cc_group_counts(groups)
    print(f'  Archived Constant Contact: {n_groups:,} groups, {n_links:,} contact-to-group links, '
          f'{sum(1 for g in groups if g):,} contacts in at least one group')
    piped = sorted({name for g in groups for name in g if '|' in name})
    print(f'  Archived Constant Contact group names containing "|" (kept whole): {len(piped)}')
    show(piped)


def check_fits(contacts, rows):
    """Exit before touching anything if a row wouldn't fit the table."""
    columns = {col.name for col in contacts.columns}
    missing = sorted({k for row in rows for k in row if not k.startswith('_')} - columns)
    if missing:
        sys.exit(f'This database\'s contacts table has no column(s) {missing} -- it is behind the '
                 f'app\'s schema. Nothing was changed.')
    too_long = []
    for col in contacts.columns:
        length = getattr(col.type, 'length', None)
        if not length:
            continue
        for row in rows:
            value = row.get(col.name)
            if isinstance(value, str) and len(value) > length:
                too_long.append(f"row {row['_line']}: {col.name} is {len(value)} chars, limit {length}")
    if too_long:
        print('\nThese values are too long for their columns:')
        for msg in too_long[:50]:
            print(f'  {msg}')
        sys.exit('Fix them in the sheet and retry. Nothing was changed.')


def load_keep_ids(conn, contacts, path, new_keys):
    """IDs of old contacts to leave in place, after checking each against
    the database. Exits on anything that doesn't line up."""
    with open(path, newline='', encoding='utf-8-sig') as fh:
        listed = list(csv.DictReader(fh))
    for col in ('Contact ID', 'Email', 'First Name', 'Last Name'):
        if listed and col not in listed[0]:
            sys.exit(f'{path} has no {col!r} column. Nothing was changed.')
    by_id = {}
    for rec in listed:
        try:
            by_id[int(rec['Contact ID'])] = rec
        except (TypeError, ValueError):
            sys.exit(f"{path}: bad Contact ID {rec.get('Contact ID')!r}. Nothing was changed.")
    found = {r.id: r for r in conn.execute(
        select(contacts.c.id, contacts.c.email, contacts.c.first_name, contacts.c.last_name,
               contacts.c.organization).where(contacts.c.id.in_(list(by_id))))}

    def low(s):
        return (s or '').strip().lower()

    missing = sorted(set(by_id) - set(found))
    mismatched = [cid for cid, rec in by_id.items() if cid in found and (
        (low(rec['Email']), low(rec['First Name']), low(rec['Last Name']))
        != (low(found[cid].email), low(found[cid].first_name), low(found[cid].last_name)))]
    if missing or mismatched:
        print(f'\nKeep file {path} does not match this database:')
        print(f'  IDs not found: {len(missing):,} {missing[:20]}')
        print(f'  IDs whose email/name differ: {len(mismatched):,} {mismatched[:20]}')
        sys.exit('Was it made from a different database? Nothing was changed.')

    # Someone who is also in the sheet gets the sheet's row (and their old
    # links) the normal way; keeping the old row too would duplicate them.
    in_sheet = {cid for cid, r in found.items()
                if contact_key(r.email, r.first_name, r.last_name, r.organization) in new_keys}
    return set(found) - in_sheet, len(listed), len(in_sheet)


def other_contact_links(meta):
    """Foreign keys to contacts.id from tables this script doesn't handle --
    e.g. leftover tables from removed features (email_sequence_enrollments,
    landing_page_submissions) that may still exist in the database."""
    links = []
    for table in meta.tables.values():
        if table.name in HANDLED_LINK_TABLES:
            continue
        for fk in table.foreign_keys:
            if fk.column.table.name == 'contacts':
                links.append((table, fk.parent))
    return links


def count(conn, table, *where):
    return conn.execute(select(func.count()).select_from(table).where(*where)).scalar_one()


def table_counts(conn, t):
    c = t['contacts']
    out = {'contacts': count(conn, c)}
    if 'deleted_at' in c.c:
        out['  in trash (soft-deleted)'] = count(conn, c, c.c.deleted_at.isnot(None))
    if 'unsubscribed' in c.c:
        out['  unsubscribed'] = count(conn, c, c.c.unsubscribed.is_(True))
    if 'pipeline_stage' in c.c:
        out['  with a pipeline stage'] = count(conn, c, c.c.pipeline_stage.isnot(None))
    if 'archived_constant_contact' in c.c:
        # Same rows the Groups page counts: non-trashed contacts only.
        q = select(c.c.archived_constant_contact).where(c.c.archived_constant_contact.isnot(None))
        if 'deleted_at' in c.c:
            q = q.where(c.c.deleted_at.is_(None))
        n_groups, n_links = cc_group_counts(conn.execute(q).scalars().all())
        out['archived CC groups'] = n_groups
        out['archived CC group links'] = n_links
    for name in ('activities', 'tasks'):
        if name in t:
            out[f'{name} (total)'] = count(conn, t[name])
            out[f'{name} linked to a contact'] = count(conn, t[name], t[name].c.contact_id.isnot(None))
    if 'contact_favorites' in t:
        out['favorites'] = count(conn, t['contact_favorites'])
    if 'groups' in t:
        member_lists = conn.execute(select(t['groups'].c.contact_ids)).scalars().all()
        out['group memberships'] = sum(len(ids or []) for ids in member_lists)
    return out


def replace(conn, t, rows, other_links, source_name, keep_ids=frozenset()):
    c = t['contacts']
    now = datetime.utcnow()

    if conn.dialect.name == 'postgresql':
        # Block the app from writing to these tables mid-swap (reads still
        # work); give up instead of hanging if something holds a lock.
        conn.execute(text("SET LOCAL lock_timeout = '15s'"))
        names = ', '.join(f'"{n}"' for n in ('contacts',) + HANDLED_LINK_TABLES if n in t)
        conn.execute(text(f'LOCK TABLE {names} IN EXCLUSIVE MODE'))

    # --- Old contacts, and what carries over to their replacements -------
    carry = [col for col in CARRY_OVER if col in c.c]
    old = conn.execute(select(c.c.id, c.c.email, c.c.first_name, c.c.last_name,
                              c.c.organization, *[c.c[col] for col in carry])).mappings().all()
    old_by_key, old_key_by_id, old_by_id, unsub_keys = {}, {}, {}, set()
    for r in old:
        if r['id'] in keep_ids:
            continue
        key = contact_key(r['email'], r['first_name'], r['last_name'], r['organization'])
        old_key_by_id[r['id']] = key
        old_by_id[r['id']] = r
        old_by_key.setdefault(key, r)
        if r.get('unsubscribed'):
            unsub_keys.add(key)
    carried = 0
    for row in rows:
        o = old_by_key.get(row['_key'])
        if not o:
            continue
        carried += 1
        for col in carry:
            if o[col] is not None:
                row[col] = o[col]
        if row['_key'] in unsub_keys:
            row['unsubscribed'] = True

    # --- Detach everything that points at the old contacts ---------------
    linked = {}
    for name in ('activities', 'tasks'):
        if name in t:
            tb = t[name]
            extra = [tb.c[col] for col in ('organization', 'notes') if col in tb.c]
            linked[name] = conn.execute(select(tb.c.id, tb.c.contact_id, *extra)
                                        .where(tb.c.contact_id.isnot(None))).mappings().all()
            conn.execute(tb.update().where(tb.c.contact_id.isnot(None)).values(contact_id=None))
    favorites = []
    if 'contact_favorites' in t:
        f = t['contact_favorites']
        favorites = conn.execute(select(f)).mappings().all()
        conn.execute(f.delete())
    for table, col in other_links:  # only non-empty when --clear-other-links was given
        if col.nullable:
            conn.execute(table.update().where(col.isnot(None)).values({col.name: None}))
        else:
            conn.execute(table.delete().where(col.isnot(None)))

    # --- Swap the contacts ------------------------------------------------
    delete = c.delete()
    if keep_ids:
        delete = delete.where(c.c.id.notin_(list(keep_ids)))
    conn.execute(delete)
    insert_cols = [col.name for col in c.columns if col.name != 'id']
    conn.execute(c.insert(), [{col: row.get(col) for col in insert_cols} for row in rows])
    new_id_by_key = {
        contact_key(r.email, r.first_name, r.last_name, r.organization): r.id
        for r in conn.execute(select(c.c.id, c.c.email, c.c.first_name, c.c.last_name, c.c.organization)
                              .where(c.c.id.notin_(list(keep_ids)) if keep_ids else True))
    }
    id_map = {old_id: new_id_by_key[key] for old_id, key in old_key_by_id.items() if key in new_id_by_key}
    matched = len(id_map)
    # Kept contacts map to themselves, so the re-linking below puts their
    # activities, tasks, favorites and group memberships straight back.
    id_map.update({kid: kid for kid in keep_ids})

    # --- Re-link ----------------------------------------------------------
    stats = {'old contacts matched in the sheet': matched,
             'old contacts kept as-is (--keep-file)': len(keep_ids),
             'old contacts with no match (gone)': len(old) - len(id_map),
             'new contacts that inherited old data': carried}
    for name, link_rows in linked.items():
        tb = t[name]
        relink = [{'_id': r['id'], '_cid': id_map[r['contact_id']]} for r in link_rows if r['contact_id'] in id_map]
        if relink:
            conn.execute(tb.update().where(tb.c.id == bindparam('_id')).values(contact_id=bindparam('_cid')), relink)
        orphaned = [r for r in link_rows if r['contact_id'] not in id_map]
        # Leave a trace of who the entry was about, since the link is gone.
        if orphaned and 'notes' in tb.c:
            notes = []
            for r in orphaned:
                o = old_by_id.get(r['contact_id'])
                who = contact_label(o['first_name'], o['last_name'], o['email']) if o else f"#{r['contact_id']}"
                note = f'(Was linked to {who}, who is no longer in the contact list.)'
                notes.append({'_id': r['id'], '_notes': f"{r['notes']}\n{note}" if r['notes'] else note})
            conn.execute(tb.update().where(tb.c.id == bindparam('_id')).values(notes=bindparam('_notes')), notes)
        if orphaned and 'organization' in tb.c:
            orgs = [{'_id': r['id'], '_org': old_by_id[r['contact_id']]['organization']} for r in orphaned
                    if not r['organization'] and r['contact_id'] in old_by_id and old_by_id[r['contact_id']]['organization']]
            if orgs:
                conn.execute(tb.update().where(tb.c.id == bindparam('_id')).values(organization=bindparam('_org')), orgs)
        stats[f'{name} re-linked'] = len(relink)
        stats[f'{name} left unlinked'] = len(orphaned)

    if 'contact_favorites' in t:
        kept = {}
        for fav in favorites:
            if fav['contact_id'] in id_map:
                pair = (fav['user_id'], id_map[fav['contact_id']])
                kept.setdefault(pair, {**{k: v for k, v in fav.items() if k != 'id'},
                                       'user_id': pair[0], 'contact_id': pair[1]})
        if kept:
            conn.execute(t['contact_favorites'].insert(), list(kept.values()))
        stats['favorites kept'] = len(kept)
        stats['favorites dropped'] = len(favorites) - len(kept)

    if 'groups' in t:
        g = t['groups']
        kept = dropped = 0
        for gid, member_ids in conn.execute(select(g.c.id, g.c.contact_ids)).all():
            member_ids = member_ids or []
            remapped = list(dict.fromkeys(id_map[int(i)] for i in member_ids if int(i) in id_map))
            kept += len(remapped)
            dropped += len(member_ids) - len(remapped)
            if remapped != member_ids:
                conn.execute(g.update().where(g.c.id == gid).values(contact_ids=remapped))
        stats['group memberships kept'] = kept
        stats['group memberships dropped'] = dropped

    if 'audit_log' in t:
        conn.execute(t['audit_log'].insert().values(
            user_id=None, actor_name='replace_contacts.py', action='contacts_replaced',
            entity_type='contact', entity_id=None,
            entity_label=f'Replaced {len(old):,} contacts with {len(rows):,} from {source_name}',
            details={k: v for k, v in stats.items()}, created_at=now,
        ))
    return stats


def main():
    ap = argparse.ArgumentParser(description='Replace every contact with the rows in a spreadsheet.')
    ap.add_argument('--file', default=DEFAULT_FILE, help='spreadsheet path (default: MCDMasterList.xlsx)')
    ap.add_argument('--sheet', default=DEFAULT_SHEET, help=f'sheet to import (default: {DEFAULT_SHEET})')
    ap.add_argument('--dry-run', action='store_true', help='do everything, print counts, then roll back')
    ap.add_argument('--yes', action='store_true', help='skip the type-REPLACE confirmation')
    ap.add_argument('--clear-other-links', action='store_true',
                    help='also clear links to contacts from tables this script does not handle '
                         '(nullable links set to NULL, other rows deleted)')
    ap.add_argument('--keep-file', help='CSV of old contacts (by Contact ID) to keep instead of deleting')
    args = ap.parse_args()

    url = _normalize_database_url(os.environ.get('DATABASE_URL', '').strip())
    if not url:
        sys.exit('DATABASE_URL is not set.')

    print(f'Reading {args.file} (sheet {args.sheet!r})...')
    rows, issues = load_sheet(args.file, args.sheet)
    print_issues(rows, issues)
    if not rows:
        sys.exit('No contacts to insert. Nothing was changed.')

    engine = create_engine(url)
    print(f'\nDatabase: {engine.url.render_as_string(hide_password=True)}')
    print('Mode: DRY RUN (rolled back at the end)' if args.dry_run else 'Mode: LIVE')

    with engine.connect() as conn:
        meta = MetaData()
        meta.reflect(bind=conn)
        t = meta.tables
        if 'contacts' not in t:
            sys.exit('No contacts table in this database.')
        check_fits(t['contacts'], rows)

        keep_ids = frozenset()
        if args.keep_file:
            keep_ids, n_listed, n_in_sheet = load_keep_ids(conn, t['contacts'], args.keep_file,
                                                           {r['_key'] for r in rows})
            print(f'\nKeep file: {n_listed:,} listed, {len(keep_ids):,} will be left as they are'
                  + (f', {n_in_sheet:,} skipped because they are also in the sheet' if n_in_sheet else ''))

        other_links = [(tb, col, count(conn, tb, col.isnot(None))) for tb, col in other_contact_links(meta)]
        other_links = [(tb, col, n) for tb, col, n in other_links if n]
        if other_links:
            print('\nOther tables still link to contacts:')
            for tb, col, n in other_links:
                print(f"  {tb.name}.{col.name}: {n:,} row(s) ({'set to NULL' if col.nullable else 'deleted'} with --clear-other-links)")
            if not args.clear_other_links:
                sys.exit('Rerun with --clear-other-links to clear them. Nothing was changed.')

        before = table_counts(conn, t)
        conn.rollback()  # end the read before waiting on the prompt

        if not args.dry_run and not args.yes:
            answer = input(f"\nThis deletes {before['contacts'] - len(keep_ids):,} of the {before['contacts']:,} "
                           f'contacts in that database (keeping {len(keep_ids):,}) and inserts '
                           f'{len(rows):,}. Type REPLACE to continue: ')
            if answer.strip() != 'REPLACE':
                sys.exit('Cancelled. Nothing was changed.')

        print('\nWorking...')
        trans = conn.begin()
        try:
            stats = replace(conn, t, rows, [(tb, col) for tb, col, _ in other_links],
                            os.path.basename(args.file), keep_ids)
            after = table_counts(conn, t)
        except Exception:
            trans.rollback()
            print('\nFAILED -- rolled back, nothing was changed.')
            raise
        if args.dry_run:
            trans.rollback()
        else:
            trans.commit()

    print(f"\n{'':34} {'before':>10} {'after':>10}")
    for label in before:
        print(f'{label:34} {before[label]:>10,} {after[label]:>10,}')
    print()
    for label, n in stats.items():
        print(f'{label:42} {n:>8,}')
    print('\nDRY RUN -- rolled back, nothing was changed.' if args.dry_run else '\nDone -- committed.')


if __name__ == '__main__':
    main()
