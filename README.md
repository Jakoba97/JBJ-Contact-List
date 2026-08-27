# JBJ Management Contact Hub

Internal contact-management tool for JBJ Management's public-relations
outreach. Flask + SQLite backend, single-page vanilla-JS frontend.

See `CHANGELOG.md` for a running history of what's changed and why.

## What it does

- **People view** — one row per contact in a table (Name, Organization,
  Title, Phone, Email), alphabetical by first name; searchable and
  filterable. Clicking a name opens the full detail view in a modal:
  contact info, assigned tag, and the outreach activity log.
- **Organizations view** — the outreach checklist grouped by category and
  organization, cross-referenced against People by organization name, so
  everyone who shares an organization shows up together. Also opens into
  the same detail modal as People.
- **Groups** — hand-picked contact lists with a name and description
  (e.g. "2026 Gala Invitees") that don't map to an organization or a tag.
  A third tab next to People/Organizations (also reachable from the
  sidebar); create a group, then search-and-add or remove contacts right
  from its detail view. Same Export options as the main toolbar (CSV,
  Word doc, copy emails), scoped to just that group's members.
- **Filters** — a popover (opened from the toolbar's Filters button, with
  a badge showing how many are active) covering Tags, Counties,
  Organization, Follow-up status, and Favorites; changes apply once you
  hit Apply, or Clear Filters to reset.
- **Outreach activity log** — per-contact and per-organization history of
  who reached out, when, and what was discussed (each entry has a date
  and a notes box), so staff can check whether someone's already been
  contacted before reaching out again.
- **"Needs Follow-up" filter** — narrow the People view to contacts never
  contacted, or not contacted in 30/60/90+ days; works with search,
  exports, and Draft Email like any other filter.
- **Favorites** — star a contact directly from the People table to flag
  it for the whole team (a shared flag, not personal/per-login); a
  "Favorites" filter narrows down to just those.
- **Analytics dashboard** (admin-only) — outreach trends, breakdowns by
  employee/channel/county, and admin activity, built from the activity
  and audit logs already being collected.
- **AI email drafting** — generates a draft outreach email (via Claude)
  scoped to whatever People/Organizations filter is currently active.
- **Flyer/post generator** — one-click social post or printed flyer:
  Claude drafts a short headline/body, OpenAI generates an on-brand
  background image, and the text is composited on top (so it's always
  crisp and correctly spelled, never garbled AI-rendered text).
- **Export** — CSV, a de-duplicated email list (for BCC), or a Word doc,
  scoped to the current filter.
- **Login** — every page and API route requires an employee login (see
  "Creating employee accounts" below). No public self-registration.
  Rate-limited (10 attempts/minute) against password guessing. No
  self-service "forgot password" (no email service configured) — an
  admin resets a forgotten password from Manage Users instead.
- **Duplicate detection** — adding a contact that matches an existing
  one by name + organization warns before saving ("Add Anyway?" to
  confirm); an exact email match (case-insensitive) is always blocked.
- **Delete contact** (admin-only) — a Delete button in the contact
  detail panel, with a confirmation prompt. Also removes that contact's
  logged outreach history and is recorded in the Audit Log.
- **Case Studies library** (`/case-studies`) — a searchable/filterable
  collection of past-project writeups for staff to reference when
  prepping outreach. Entries can either be typed by hand (title/client/
  sector/challenges/solution/results) or uploaded as a PDF/Word file
  (`/case-studies/upload`, admin-only) — uploaded files are stored as-is
  and downloadable from their page, with text best-effort extracted for
  search (no AI involved). Viewing is open to everyone logged in;
  adding, editing, and deleting is admin-only. Native Google Docs must
  be exported to .docx or PDF first (Drive doesn't expose a way to read
  a native Doc's content without the Drive API).
## Setup

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

Create a `.env` file in the project root (never committed — it's
gitignored) with:

```
SECRET_KEY=<random value, signs login sessions>
ANTHROPIC_API_KEY=<only needed for the Draft Email and Create Flyer features>
OPENAI_API_KEY=<only needed for the Create Flyer feature's background image>
SENTRY_DSN=<optional -- error monitoring; app runs fine without it set>
```

Generate a `SECRET_KEY` with `python3 -c "import secrets; print(secrets.token_hex(32))"`.

Run the server:

```bash
PORT=5050 .venv/bin/python app.py
```

## Running tests

```bash
pip install -r requirements.txt -r requirements-dev.txt
pytest
```

Covers login/rate-limiting/password reset, contact CRUD and duplicate
detection, the Needs Follow-up filter, audit logging, the Analytics
dashboard's access control and drill-down, and the Case Studies
library's search/filter and admin-only edit access. Runs against a
throwaway SQLite file, never the real database. Test-only dependencies
(`requirements-dev.txt`) aren't installed in production.

## Creating employee accounts

There's no sign-up page on purpose. Create each employee's login from a
terminal so passwords never pass through chat, logs, or screen-share:

```bash
.venv/bin/python create_user.py
```

It asks for a username, display name (shown in the app and recorded on
every outreach-activity entry), and password.

Forgot a password? There's no self-service reset (no email service is
configured) — an admin resets it from **Manage Users** in the app
itself, no terminal access needed.

## Data model

- `Contact` — one row per person (`app.py`/`models.py`). `email` is
  optional but unique when present.
- `OutreachOrg` — the per-organization outreach checklist (category, org
  name, last-touched date, notes). Cross-referenced with `Contact` by
  organization name, not a foreign key — the two sheets use different
  category names for the same kind of grouping (see the comment on
  `filtered_contacts_query` in `app.py`), so a People-view tag filter and
  an Organizations-view category filter are deliberately different lists.
- `Activity` — a logged outreach touchpoint, tied to a contact or an
  organization (or both).
- `Group` — a hand-picked contact list (name, description). Membership
  (`contact_ids`) is a JSON list of contact IDs rather than a join table,
  matching how `Contact.lists` already stores per-contact email-list
  membership — fine at this scale, and keeps membership changes to a
  single-row update.
- `User` — employee logins. Passwords are hashed (Werkzeug), never stored
  in plain text.
- `CaseStudy` — a past-project writeup (title, client, sector,
  challenges/solution/results) shown on the Case Studies page. Can
  optionally hold an uploaded file directly (`file_data`/`file_name`/
  `file_mimetype`) plus its best-effort-extracted text (`extracted_text`)
  for search — see `scripts/add_case_study_file_columns.py`, which added
  those four columns after the table already existed in production.

Locally the database is SQLite (`contacts.db` in the project root); in
production it's Postgres (see "Deploying" below) — `DATABASE_URL` decides
which. There's no migration framework — `db.create_all()` creates missing
tables on startup (this is why adding `CaseStudy` needed no migration
script — it's a brand-new table, not a new column on an existing one),
but it will **not** alter an existing table's columns.
Schema changes to existing tables (e.g. making a column nullable) need a
manual migration; see the "email made optional" entry in `CHANGELOG.md`
for the pattern used, or `scripts/add_favorite_column.py` for a small,
self-contained example (adds the `is_favorite` column to an existing
database, safe to run more than once). Run a script like this **before**
deploying code that depends on the new column.

## Backup & recovery

**`contacts.db` is not in git** (it holds real contact PII and, as of the
login feature, password hashes — keeping it out of version control is
intentional, not an oversight).

A daily automated backup is set up via a macOS LaunchAgent
(`~/Library/LaunchAgents/com.jbjcontacts.backup.plist`, runs
`scripts/backup_db.sh` every day at 8pm while this Mac is logged in):

- Writes a timestamped copy to `backups/` (gitignored, local only) **and**
  to iCloud Drive (`~/Library/Mobile Documents/com~apple~CloudDocs/JBJContacts-Backups/`),
  so a copy exists off this machine.
- Prunes backups older than 60 days in both locations.
- Logs each run to `backups/backup.log`.

To check it's running: `launchctl list | grep jbjcontacts`. To run a
backup immediately: `launchctl start com.jbjcontacts.backup` or just
`bash scripts/backup_db.sh`.

**To restore**, stop the server, copy a backup over the live file, then
restart:

```bash
cp backups/contacts_<timestamp>.db contacts.db
```

This covers disk failure / accidental deletion on this machine, but it's
still a single Mac running a single LaunchAgent — if this machine is
retired or the user account changes, the schedule needs to be re-created
on whatever replaces it.

### Production database (Postgres) backups

The above only backs up this laptop's local SQLite file -- it has nothing
to do with the live production data, which lives in Postgres (see
"Switched production database to free external Postgres" in
`CHANGELOG.md`). Every write the app makes in production (adding a
contact, editing one, syncing the spreadsheet, etc.) commits straight to
that Postgres database with no caching layer in between, so backing it up
covers everything.

Production Postgres is backed up nightly by two pieces working together:

1. **`.github/workflows/backup-postgres.yml`** — a GitHub Actions
   workflow that runs `pg_dump` against the production database every
   night and uploads the result as a workflow artifact (kept 90 days by
   GitHub). Runs in the cloud, independent of this laptop or Render's
   plan. Requires a repository secret named `PRODUCTION_DATABASE_URL`
   (Settings → Secrets and variables → Actions on GitHub), set to the
   same connection string as Render's `DATABASE_URL` environment
   variable — add it directly on GitHub's site, never in a commit or chat.
2. **`scripts/fetch_postgres_backup.sh`**, run daily at 9am by a second
   LaunchAgent (`com.jbjcontacts.pgbackup.plist`, installed via
   `bash scripts/install_postgres_backup_schedule.sh`) — downloads that
   night's artifact via the `gh` CLI and copies it into
   `~/Library/Mobile Documents/com~apple~CloudDocs/JBJContacts-Backups/postgres/`,
   so a copy also ends up in iCloud Drive alongside the SQLite backups,
   pruned after 90 days. Requires the `gh` CLI to be installed and
   authenticated once (`gh auth login`).

If this Mac is ever off, the GitHub Actions side still runs and the
backup is safely sitting in GitHub regardless — the LaunchAgent just
catches it up into iCloud the next time it runs.

Each day's backup lands in that `postgres/` folder as **two files**:
`postgres_<timestamp>.dump` (the real backup — binary, used to restore)
and `postgres_<timestamp>.sql` (the same backup converted to plain text,
so it can be opened directly in any text editor to eyeball what's in
it, with no special tools needed). Both contain the same real contact
data and password hashes as production, so treat that folder the same
way as the database itself — it's gitignored and lives only in iCloud,
not in this repo, for the same reason `contacts.db` is kept out of git.

**To restore** a Postgres backup (from the `.dump` file, not the `.sql`):

```bash
pg_restore --no-owner --clean --dbname="$DATABASE_URL" postgres_<timestamp>.dump
```

## Deploying so coworkers can access it from anywhere

Right now the app only runs on this laptop (`python app.py`) — it's not
reachable by anyone else, and it stops working the moment this Mac sleeps
or the process is closed. The repo is set up to deploy to
[Render](https://render.com) (gunicorn as the production server,
`render.yaml` defines the service) on Render's **free** plan. Render isn't
the only option, but the project is ready for it; steps below.

**Free plan tradeoff:** free Render web services don't have a persistent
disk — anything written to local disk is wiped on every restart/redeploy
and whenever the service spins down from inactivity. That's a problem for
SQLite specifically, since it's a local file. So in production the app
talks to an external free Postgres database instead (e.g.
[Neon](https://neon.tech) or [Supabase](https://supabase.com) — both have
a free tier that doesn't expire, unlike Render's own free Postgres which
auto-deletes after 30 days). Locally, nothing changes — `python app.py`
still uses the local `contacts.db` SQLite file by default.

1. **Create a free Postgres database** at neon.tech (or supabase.com).
   Copy the connection string it gives you (looks like
   `postgresql://user:password@host/dbname`) — treat this like a
   password, don't paste it into chat or commit it anywhere.
2. **Move your existing data into it**, run from this machine (paste the
   connection string directly into your own terminal, not here):
   ```bash
   TARGET_DATABASE_URL=<your Postgres connection string> \
     .venv/bin/python scripts/migrate_sqlite_to_postgres.py
   ```
   This copies every contact, organization, activity, and any local user
   accounts into the new database. Safe to re-run only against an empty
   target — it refuses to run if the target already has rows, so it can't
   double-insert.
3. **Sign up at render.com** and connect your GitHub account.
4. **New → Blueprint**, pick the `JBJ-Contact-List` repo. Render reads
   `render.yaml` and proposes one web service on the free plan.
5. Before deploying, it'll prompt for environment variables
   (`render.yaml` deliberately leaves these blank so they're never
   committed to git):
   - `DATABASE_URL` — the same Postgres connection string from step 1.
   - `SECRET_KEY` — generate a **new** one just for production:
     `python3 -c "import secrets; print(secrets.token_hex(32))"`. Don't
     reuse your local `.env` value.
   - `ANTHROPIC_API_KEY` — same key used locally for Draft Email and
     Create Flyer, or skip it and add it later if those aren't needed yet.
   - `OPENAI_API_KEY` — needed for Create Flyer's background image (get
     one at platform.openai.com → API keys). Skip it and add it later if
     that feature isn't needed yet.
   - `SENTRY_DSN` — optional. Create a free project at sentry.io, copy its
     DSN here, and the app will start reporting server errors there
     instead of relying on someone noticing and reporting them. Skip it
     and the app runs exactly the same without it.
   - `BOOTSTRAP_ADMIN_USERNAME` / `BOOTSTRAP_ADMIN_PASSWORD` (8+
     characters) / optionally `BOOTSTRAP_ADMIN_DISPLAY_NAME` — not needed
     if you migrated existing local user accounts in step 2 (they came
     across already); otherwise, set these to create the first
     production login. Render's **Shell** tab (the obvious way to run
     `create_user.py`) needs a paid plan, so the app creates this one
     account itself on startup **only if the users table is still
     empty** — safe to leave the variables in place afterward, or delete
     them once you've logged in.
6. **Deploy.** Render builds and starts the service, connecting to the
   Postgres database from step 1.
7. Log in (using a migrated account, or the bootstrap admin account from
   step 5). Once logged in as an admin, create everyone else's account
   from the browser — no Shell needed: **Manage Users** (top right,
   admin accounts only) → fill in username/display name/password.
8. Share the `https://<your-service-name>.onrender.com` URL Render gives
   you. It has real HTTPS and works from anywhere — no dependence on this
   laptop being on.

After this, deploying a future code change is just `git push` — Render
auto-deploys on push to `main`. The Postgres database isn't touched by
code deploys. It's still worth checking whatever backup options Neon/
Supabase's free tier offers — the local LaunchAgent above only backs up
the copy on this laptop, not the production database.

## Project layout

- `app.py` — all Flask routes/API endpoints.
- `models.py` — SQLAlchemy models (`Contact`, `OutreachOrg`, `Activity`, `User`).
- `templates/index.html` — the single-page app shell.
- `templates/login.html` — login page.
- `static/js/app.js` — all frontend logic (no framework).
- `static/css/style.css` — styling, including the JBJ brand palette (see
  the `:root` variables at the top).
- `create_user.py` — CLI for creating employee logins.
- `scripts/` — one-off scripts: the original contact-spreadsheet imports,
  `backup_db.sh`, and `migrate_sqlite_to_postgres.py`.
