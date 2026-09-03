import re
import json
from datetime import datetime
import pandas as pd


def normalize_phone(val):
    if pd.isna(val) or val is None:
        return None
    s = str(val)
    digits = re.sub(r"\D+", "", s)
    return digits or None


def split_lists(cell):
    if cell is None or (isinstance(cell, float) and pd.isna(cell)):
        return []
    if isinstance(cell, (list, tuple)):
        return [str(x).strip() for x in cell if str(x).strip()]
    s = str(cell)
    # split on semicolon, comma, or pipe
    parts = re.split(r"[;,|]", s)
    parts = [p.strip() for p in parts if p and p.strip()]
    return parts


def clean_dataframe(df: pd.DataFrame) -> list:
    """
    Clean an uploaded DataFrame-like object and return a list of plain
    dicts (not a DataFrame -- mixing strings and None in a column and
    then round-tripping through pd.DataFrame() lets pandas silently turn
    some of those Nones back into NaN, which breaks `.strip()` calls and
    database writes downstream).
    Rules implemented:
    - Trim whitespace and treat '#REF!' as missing
    - Drop rows with Active == 'Inactive', missing name, or missing organization
      (email is optional -- Contact.email allows NULL -- rows without one are
      kept and de-duplicated by name+organization instead of by email)
    - Normalize phones to digits only
    - Split Lists into arrays
    - Deduplicate by email (or by name+organization when email is blank),
      flag data_complete
    """
    # If df is not a DataFrame, coerce
    if not isinstance(df, pd.DataFrame):
        df = pd.DataFrame(df)

    # Normalize column names (keep original cases available via mapping)
    df = df.rename(columns=lambda c: str(c).strip())

    cols = {c.lower(): c for c in df.columns}
    def pick(*names):
        for n in names:
            if n in cols:
                return cols[n]
        # fall back to substring matching so real-world headers like
        # "Organization Name" or "Phone Office" are recognized, not just
        # bare "organization" / "phone_office"
        for n in names:
            norm = n.replace('_', ' ')
            for k, v in cols.items():
                if norm in k:
                    return v
        return None

    # Exact lowercase column names listed first so the substring fallback
    # never fires for these.  Order matters -- most-specific alias first.
    email_col           = pick('email - work', 'email work', 'email')
    email_secondary_col = pick('email - secondary', 'email secondary', 'email2', 'secondary email')
    first_col           = pick('first name', 'first_name', 'firstname', 'first')
    last_col            = pick('last name', 'last_name', 'lastname', 'last')
    salutation_col      = pick('salutation')
    mi_col              = pick('m.i.', 'mi', 'middle initial', 'middle_initial')
    suffix_col          = pick('suffix')
    active_col          = pick('active')
    email_status_col    = pick('email status', 'emailstatus')
    org_col             = pick('company', 'organization', 'org')
    industry_col        = pick('industry')
    lists_col           = pick('email lists', 'lists', 'list')
    archived_cc_col     = pick('archived constant contact', 'archived_constant_contact')
    tag_col             = pick('tag')
    county_col          = pick('county')
    title_col           = pick('role / title', 'role/title', 'title', 'position')
    # Phone columns use explicit full names BEFORE generic 'phone' so
    # PhonePersonal and PhoneWork don't get swapped by substring matching.
    phone_work_col      = pick('phonework', 'phone - work', 'phone_office', 'office_phone', 'work phone', 'workphone')
    phone_personal_col  = pick('phonepersonal', 'phone - personal', 'phone_cell', 'cell_phone', 'mobile', 'personal phone', 'personalphoone')
    phone_misc_col      = pick('phone - misc.', 'phone misc', 'phonemisc', 'phone - misc')
    notes_col           = pick('notes', 'note')
    street_col          = pick('street', 'address')
    city_col            = pick('city')
    state_col           = pick('state')
    zip_col             = pick('zip', 'postal', 'zip code')
    website_col         = pick('website', 'url', 'web')
    duns_col            = pick('duns number', 'duns')
    b2gnow_col          = pick('b2gnow vendor number', 'b2gnow', 'vendor number')
    cmbl_col            = pick('cmbl status', 'cmbl')
    cert_type_col       = pick('certification type', 'cert type', 'certtype')
    dba_col             = pick('dba name', 'dba')
    cert_agency_col     = pick('certifying agency', 'certifying')

    records = df.to_dict(orient='records')
    cleaned = []
    seen_emails = set()
    seen_nameorg = set()

    for r in records:
        def get_raw(col):
            if not col:
                return None
            v = r.get(col)
            if v is None or (isinstance(v, float) and pd.isna(v)):
                return None
            s = str(v).strip()
            if s == '' or s.upper() == '#REF!':
                return None
            return s

        email = get_raw(email_col)
        active = get_raw(active_col)
        if active and str(active).lower() == 'inactive':
            continue

        first = get_raw(first_col)
        last = get_raw(last_col)
        if not first and not last:
            continue

        org = get_raw(org_col)
        if not org:
            continue

        phone_office   = normalize_phone(get_raw(phone_work_col))     if phone_work_col     else None
        phone_cell     = normalize_phone(get_raw(phone_personal_col)) if phone_personal_col else None
        phone_misc     = normalize_phone(get_raw(phone_misc_col))     if phone_misc_col     else None
        lists          = split_lists(r.get(lists_col))                if lists_col          else []
        archived_cc    = split_lists(r.get(archived_cc_col))          if archived_cc_col    else []
        tag            = get_raw(tag_col)                              if tag_col            else ''
        county         = get_raw(county_col)                          if county_col         else None
        title          = get_raw(title_col)                           if title_col          else None
        notes          = get_raw(notes_col)                           if notes_col          else None
        salutation     = get_raw(salutation_col)                      if salutation_col     else None
        middle_initial = get_raw(mi_col)                              if mi_col             else None
        suffix         = get_raw(suffix_col)                          if suffix_col         else None
        email_secondary = get_raw(email_secondary_col)                if email_secondary_col else None
        industry       = get_raw(industry_col)                        if industry_col       else None
        email_status   = get_raw(email_status_col)                    if email_status_col   else None
        street         = get_raw(street_col)                          if street_col         else None
        city           = get_raw(city_col)                            if city_col           else None
        state          = get_raw(state_col)                           if state_col          else None
        zip_code       = get_raw(zip_col)                             if zip_col            else None
        website        = get_raw(website_col)                         if website_col        else None
        duns_number    = get_raw(duns_col)                            if duns_col           else None
        b2gnow         = get_raw(b2gnow_col)                          if b2gnow_col         else None
        cmbl_status    = get_raw(cmbl_col)                            if cmbl_col           else None
        cert_type      = get_raw(cert_type_col)                       if cert_type_col      else None
        dba_name       = get_raw(dba_col)                             if dba_col            else None
        cert_agency    = get_raw(cert_agency_col)                     if cert_agency_col    else None

        if email:
            if email in seen_emails:
                continue
            seen_emails.add(email)
        else:
            key = ((first or '').lower(), (last or '').lower(), org.lower())
            if key in seen_nameorg:
                continue
            seen_nameorg.add(key)

        cleaned.append({
            'email': email,
            'first_name': first,
            'last_name': last,
            'organization': org,
            'title': title,
            'phone_office': phone_office,
            'phone_cell': phone_cell,
            'phone_personal': phone_cell,
            'phone_misc': phone_misc,
            'active': active,
            'lists': lists,
            'archived_constant_contact': archived_cc,
            'tag': tag,
            'county': county,
            'notes': notes,
            'salutation': salutation,
            'middle_initial': middle_initial,
            'suffix': suffix,
            'email_secondary': email_secondary,
            'industry': industry,
            'email_status': email_status,
            'street': street,
            'city': city,
            'state': state,
            'zip_code': zip_code,
            'website': website,
            'duns_number': duns_number,
            'b2gnow_vendor_number': b2gnow,
            'cmbl_status': cmbl_status,
            'certification_type': cert_type,
            'dba_name': dba_name,
            'certifying_agency': cert_agency,
        })

    # compute completeness
    for rec in cleaned:
        has_name = bool(rec.get('first_name') or rec.get('last_name'))
        has_phone = bool(rec.get('phone_office') or rec.get('phone_cell'))
        has_org = bool(rec.get('organization'))
        rec['data_complete'] = bool(rec.get('email') and has_name and has_org and has_phone)

    return cleaned


def looks_like_contacts_sheet(df) -> bool:
    """True if a sheet has person-level columns (email or a name column) --
    used to tell a People tab apart from an Organizations tab when a
    workbook has both, so each can be imported with the right cleaner."""
    cols = {str(c).strip().lower() for c in df.columns}
    return any(('email' in c) or ('first' in c) or ('last' in c) for c in cols)


def looks_like_orgs_sheet(df) -> bool:
    """True if a sheet has organization-checklist columns (organization +
    a tag/category or updated/notes column) but no person columns --
    matches the historical 'OutreachListKey' sheet shape."""
    if looks_like_contacts_sheet(df):
        return False
    cols = {str(c).strip().lower() for c in df.columns}
    has_org = any(('organization' in c) or (c == 'org') for c in cols)
    has_other = any(c in ('tag', 'category', 'column 1', 'updated', 'notes', 'note') for c in cols)
    return has_org and has_other


def clean_outreach_orgs(df: pd.DataFrame) -> list:
    """Clean an uploaded organizations/outreach-checklist sheet (tag,
    organization, last-updated date, notes) -- mirrors the column-matching
    rules in scripts/import_outreach_key.py, the original one-off import,
    so the same workbook shape works here. Returns a plain list of dicts
    rather than a DataFrame -- round-tripping a mix of `date` objects and
    `None` through pd.DataFrame() lets pandas silently turn the `None`s
    back into NaN, which then fails the SQLite/Postgres date column."""
    if not isinstance(df, pd.DataFrame):
        df = pd.DataFrame(df)
    df = df.rename(columns=lambda c: str(c).strip())
    cols = {c.lower(): c for c in df.columns}

    def pick(*names):
        for n in names:
            if n in cols:
                return cols[n]
        for n in names:
            norm = n.replace('_', ' ')
            for k, v in cols.items():
                if norm in k:
                    return v
        return None

    tag_col = pick('tag', 'category', 'column 1')
    org_col = pick('organization', 'organization name', 'org')
    updated_col = pick('updated', 'last_touched', 'last touched')
    notes_col = pick('notes', 'note')

    def parse_date(s):
        s = (s or '').strip()
        if not s:
            return None
        for fmt in ('%m/%d/%Y', '%m/%d/%y', '%Y-%m-%d'):
            try:
                return datetime.strptime(s, fmt).date()
            except ValueError:
                continue
        return None

    records = df.to_dict(orient='records')
    cleaned = []
    seen = set()
    for r in records:
        def get_raw(col):
            if not col:
                return None
            v = r.get(col)
            if v is None or (isinstance(v, float) and pd.isna(v)):
                return None
            s = str(v).strip()
            if s == '' or s.upper() == '#REF!':
                return None
            return s

        tag = get_raw(tag_col)
        org = get_raw(org_col)
        if not tag or not org:
            continue

        key = (tag, org.lower())
        if key in seen:
            continue
        seen.add(key)

        cleaned.append({
            'tag': tag,
            'organization': org,
            'updated': parse_date(get_raw(updated_col)) if updated_col else None,
            'notes': get_raw(notes_col) if notes_col else None,
        })

    return cleaned


def read_uploaded_file(file_storage):
    """Returns a dict of {sheet_name: DataFrame}. A CSV always yields one
    sheet; an Excel workbook may have several (e.g. a People tab and a
    separate Organizations tab) -- the caller classifies each sheet with
    looks_like_contacts_sheet/looks_like_orgs_sheet."""
    try:
        file_storage.seek(0)
    except Exception:
        pass
    try:
        df = pd.read_csv(file_storage, dtype=str)
        return {'Sheet1': df}
    except Exception:
        try:
            file_storage.seek(0)
        except Exception:
            pass
        try:
            sheets = pd.read_excel(file_storage, dtype=str, engine='openpyxl', sheet_name=None)
            return sheets
        except Exception as e:
            raise ValueError('Unable to parse uploaded file as CSV or Excel') from e
