# Changelog

What changed, and why. Add an entry here whenever the app changes —
newest at the top. This isn't a substitute for `git log` (which has the
full diffs); it's the "what would a non-technical teammate need to know"
summary, especially for anything that affects data, security, or how
staff use the app day to day.

## 2026-08-27 — Add Organization / Add Group forms now match Add Contact

The nice form styling on "Add Contact" (bold labels, full-width rounded
inputs) turned out to be scoped to a `#contactForm`-only CSS rule, so
"Add Organization" and "Add Group" were falling back to unstyled browser
defaults. Added a shared `.modal-form` class carrying the same rules and
applied it to both, plus matched their structure to Add Contact's exactly
(`<h2>` title, `<label>Text<br><input></label>` pattern, a Save/Close
button pair, and the same amber `.flag.flag-warn` box for validation/error
messages instead of each one inventing its own).

## 2026-08-27 — Group export, sidebar reorder, "Add Group"

Added an Export dropdown (Copy Emails / Download CSV / Download Word
Doc) to each group's detail view, scoped to just that group's members --
`filtered_contacts_query` and the three `/api/export*` routes now accept
a `group_id` param the same way they already accept `tag`/`county`/etc.
While adding it, fixed a pre-existing bug in `/api/export/docx`: the
downloaded filename crashed (`AttributeError`) whenever a tag or
organization-category filter was active, because `tag`/`org_tag` are
lists (from `parse_multi_param`) but the filename code called
`.replace()` on them directly as if they were a string.

Reordered the sidebar per request: Contacts, Organizations, Groups, then
Add Contact, Add Organization, Add Group, then the existing admin
section unchanged below. Added the "Add Group" button itself (opens the
same create-group form as the Groups tab's "New Group" button).

## 2026-08-27 — Alphabetical sort + new Groups feature

The People table (and the CSV export, to match) now sorts alphabetically
by first name instead of newest-added-first.

Added **Groups**: a new `Group` model (name, description, and a list of
member contact IDs) for hand-picked contact lists that don't map to an
organization or a tag -- e.g. "2026 Gala Invitees." Reachable two ways,
per request: a "Groups" link in the sidebar (right under Organizations)
and a third "Groups" tab next to People/Organizations on the main
Contact Management page. The Groups tab has its own "New Group" button
(name + description) and hides the Filters/Export/Trash controls, which
don't apply to it. Clicking a group opens the same shared detail modal
used for contacts/organizations, with a members list (remove button per
contact) and a live search-and-add picker to build the group out.
New endpoints: `GET/POST /api/groups`, `GET/PUT/DELETE /api/groups/<id>`,
`POST /api/groups/<id>/contacts`, `DELETE /api/groups/<id>/contacts/<id>`.

## 2026-08-26 — Contact Management redesign: table view, filter panel, detail modal

Reworked the People view from a card grid to a single-line-per-contact
table (Name/Organization/Title/Phone/Email columns, a toggleable star for
favorites) and removed the always-visible filters sidebar in favor of a
"Filters" popover (Tags/Counties/Organizations/Follow-up/Favorites, with
an Apply/Clear footer) opened from the toolbar. Added a new "Organization"
filter, backed by a new `GET /api/contact-organizations` endpoint and an
`organization` filter param on `/api/contacts` and the three export
routes. Clicking a contact's name now opens a modal with their full
detail (tags, notes, pipeline stage, tasks) and the outreach activity
log -- each entry has a date and a notes box, same as before, just now
in a modal instead of a side panel. The Organizations (grouped-by-org)
view keeps its card layout and now opens the same detail modal instead
of a side panel too. The toolbar also grew an icon-only Trash button and
two always-visible counts (Total Contacts, Total Organizations),
replacing the old view-dependent stat cards. Also removed the grid/list
layout toggle (the table is the only People-view layout now) and the
"Need Review" quick-filter stat card.

While rebuilding this, found and fixed two accidental deletions from
the "Removed Email & Event Management" change below: `bindSendCampaign`'s
deletion in `app.js` had also swallowed the neighboring Pipeline-board
functions (`loadPipelineData`, `movePipelineContact`, `pipelineStageOpts`,
`pipelineListRowHtml`, `renderPipelineList`, `pipelineStageSectionHtml`,
and the `PIPELINE_STAGES`/`_pipelineData`/`_pipelineStageFilter`
declarations), and the `campaign_send` deletion in `app.py` had swallowed
the neighboring `_task_urgency` helper the Tasks routes depend on -- both
would have thrown at runtime the moment a contact detail was viewed or a
Tasks route was hit. `/api/generate-flyer` (Create Flyer/Post) also broke
in the same change since it called a Flyer Builder helper
(`_valid_flyer_formats`) that got removed along with `flyer_render.py`;
replaced with an inline format check. Caught via an actual browser pass
(Playwright) after the fact -- worth doing that *before* declaring UI or
cross-cutting deletions done, not just linting/compiling.

## 2026-08-26 — Removed Email & Event Management entirely

Removed the whole "Email & Events" tab and everything under it: Email
Builder, Flyer Builder, Campaign History, Email Sequences, Landing Pages,
and the Meeting Scheduler -- their routes, models (`EmailTemplate`,
`FlyerTemplate`, `FlyerAsset`, `EmailSend`, `EmailEvent`, `SocialToken`,
`EmailSequence`/`EmailSequenceStep`/`EmailSequenceEnrollment`,
`LandingPage`/`LandingPageSubmission`, `AvailabilityRule`/`Booking`),
templates, and JS. Only Contact Management and Admin remain in the top
nav, per request. Also removed: the SMTP/SendGrid email-sending layer,
the LinkedIn/Facebook social-posting integration (and the "Social
Connections" section on Manage Users), the APScheduler background job
that processed email sequences, and the now-dead `SMTP_*`/`LINKEDIN_*`/
`FACEBOOK_*`/`APP_BASE_URL` config and `requests`/`APScheduler` deps.

Two Contact-Management features that happened to live under the same
permission flags were kept and re-gated: **Draft Email** (AI email
drafting scoped to the current filter) and **Create Flyer/Post** (the
one-click flyer/social-post generator) -- both now show whenever
`can_draft_email` is set, since their own "Open in Email/Flyer Builder"
buttons no longer have anywhere to go. Case Studies is unaffected and no
longer gated behind the removed `can_access_email_events` flag.

Discovered but not fixed (pre-existing, unrelated to this change): the
test suite fails on a fresh checkout because `_seed_demo_contacts()` runs
unconditionally on any empty database, including pytest's temp SQLite
db, seeding 60 fake contacts before test assertions run. Also saw
Windows-only `PermissionError: WinError 32` failures tearing down
pytest's temp db files, unrelated to any app code.

## 2026-08-26 — Removed the Proposal Manager

Removed the Proposal Manager feature entirely: the `/proposals` routes and
`Proposal` model, the "Proposal Manager" nav tab/dashboard tile across every
page, the per-user `can_access_proposals` permission (and its checkbox/column
in Manage Users), and the AI proposal-draft endpoint. Case Studies is a
separate feature and is unaffected — it's still at `/case-studies`, just no
longer gated behind the removed permission flag (it's open to everyone
logged in, per how it already behaved on the backend). Removing the flag
from the `User` model means new databases won't create that column; existing
production databases will still have an unused `proposals` table and
`can_access_proposals` column left over -- harmless, but a manual migration
would be needed to actually drop them.

## 2026-06-30 — Fixed Send failing in production with a database error

Sending worked locally but failed on Render with "Could not send" and a
Postgres "SSL connection has been closed unexpectedly" error in the
logs. Cause: the request held a database connection open for the whole
SMTP send (which can take several seconds), and Neon's connection
pooler closed it server-side while idle; the next query after (the
audit log write) then failed on that stale connection, even though the
email itself had already gone out. Fixed by releasing the connection
before the SMTP call so a fresh one gets used afterward.

## 2026-06-30 — Email builder, step 3: send to an address + attachments + visible formatting

Three fixes/additions from trying step 2: (1) the drag-and-drop block
canvas was unreliable in testing, so step 2 was reworked into a single
Gmail-style compose pane with a formatting toolbar instead -- typing and
selecting text directly rather than dragging blocks; (2) toolbar buttons
(Bold/Italic/Underline/etc.) now highlight solid maroon when the cursor
is in text using that formatting, so it's clear something is actually
applied instead of looking like plain text; (3) added a Send button --
type a recipient address and optionally attach up to 5 files (15MB
total), and it sends via SMTP (configure `SMTP_HOST`/etc, see README --
sending is disabled with a clear error until that's set up). This is a
single-recipient send/test capability, not the bulk "send to my filtered
contact list" feature -- that needs batching, an unsubscribe mechanism,
and background dispatch since it could reach hundreds of real contacts,
and isn't built yet.

## 2026-06-30 — Email builder, step 2: drag-and-drop canvas

New `/email-builder` page -- build your own email by dragging blocks
(Heading, Paragraph, Image, Button, Divider, Spacer, Logo) onto a canvas,
reorder by drag, edit each block's text inline and its style (color,
size, alignment, etc.) from a right-hand panel, toggle a desktop/mobile
preview width, and Save. Lives alongside the existing AI Draft Email tool
as a separate option (linked from the header), not a replacement for it.
Single-column blocks only for now; sending and the final email-safe HTML
rendering are still to come in later steps -- this step is build-and-save
only.

## 2026-06-30 — Email/flyer builder, step 1: data model only

First of several PRs toward a real drag-and-drop email builder and a
free-canvas flyer builder (replacing the old third-party newsletter tool
the team lost access to), with actual sending -- not just AI-drafted text
to copy elsewhere like today's Draft Email/Create Flyer. This step adds
only the database schema: `EmailTemplate`, `FlyerTemplate`, `FlyerAsset`,
`EmailSend` (all brand-new tables), plus `Contact.unsubscribed` /
`Contact.unsubscribe_token` (existing-table change -- see
`scripts/add_unsubscribe_columns.py`, must run against production before
the next step's code deploys). No UI yet, nothing user-facing changes in
this step.

## 2026-06-30 — Moved filters into a left sidebar

Manager liked a reference layout (plain radio/checkbox filter lists with
an explicit "Apply Filters" button) better than the toolbar dropdowns.
Moved Tags/Counties/Follow-up/Favorites out of the header toolbar into
an always-visible left sidebar, using plain checkboxes and radio
buttons instead of the app's pill-button styling (this is what made the
earlier sidebar attempt, below, feel off). Filter changes no longer
search automatically -- you pick filters, then click "Apply Filters"
(or the header Search button). The sidebar's filter list scrolls
internally when it's taller than the screen, but the Apply Filters
button stays pinned at the bottom so it's always reachable without
scrolling past it. No backend changes.

## 2026-06-30 — Decluttered the nav and search toolbar

Manager felt the page was cramped. Grouped the four admin-only nav
links (Sync Spreadsheet, Manage Users, Audit Log, Analytics) behind a
single "Admin" dropdown instead of four separate buttons. Split the
search toolbar into a Filters group (Tags/Counties/Follow-up/Favorites)
and an Actions group (Search/Export/AI Tools), and combined Draft Email
+ Create Flyer/Post into one "AI Tools" dropdown. (A left-sidebar
version of the filters using the toolbar's pill-button styling was also
prototyped locally but reverted -- icons lost their text labels in that
layout and it wasn't an improvement; see the sidebar entry above for
the version that was later adopted, using plain controls instead.) No
backend changes.

## 2026-06-30 — Delete contact (admin-only)

There was no way to remove a contact entirely -- only edit fields or
delete individual outreach log entries. Added a Delete button
(admin-only, with a confirmation prompt) to the contact detail panel.
Deleting a contact also deletes its own logged outreach activity (no
`ON DELETE CASCADE` on that foreign key, so the app deletes those rows
itself before deleting the contact) and is recorded in the Audit Log.
No schema change.

## 2026-06-30 — Case Studies file upload (replaces the AI-parsing version)

Manager has dozens of existing case study files (PDFs and Word docs)
in Drive that needed to get into the library without retyping each
one -- but didn't want Claude rewriting/restructuring them, just
wanted the files themselves accessible in the app. Replaced the
AI-parsing importer shipped earlier today with a plain upload:
`/case-studies/upload` (admin-only) stores each PDF/.docx as-is
(downloadable from its page) and best-effort extracts its text for
search -- no AI involved, no review step needed. Manually-typed
entries (title/client/sector/challenges/solution/results) still work
as before for anyone who wants to write one up by hand. New
`CaseStudy` columns (`file_data`/`file_name`/`file_mimetype`/
`extracted_text`) needed a migration since the table already existed
in production -- see `scripts/add_case_study_file_columns.py`.
Native Google Docs aren't readable directly (no Drive API access) --
they need to be exported to .docx or PDF first. Still depends on
`pypdf` for PDF text extraction, just no longer on the Anthropic API.

Possible follow-up, not built yet: surfacing case study content as
inspiration inside Draft Email.

## 2026-06-30 — Case Studies library

Added a `/case-studies` page so staff can browse and search past-project
writeups (challenge/solution/results, e.g. the DFW Airport contractor
support program) when prepping outreach. Anyone logged in can view and
search; adding, editing, and deleting is admin-only. New `CaseStudy`
table — no migration script needed since it's a brand-new table, not a
new column on an existing one (`db.create_all()` handles that on
deploy automatically).

## 2026-06-29 — Fix "% Complete" always showing 0%

The dashboard's % Complete stat was based on `Contact.data_complete`, a
flag nothing in the UI ever sets (only the spreadsheet import or a
direct API call could set it) -- so it was stuck at 0% for everyone.
Changed it to be derived automatically from whether a contact has an
email or phone number on file, matching the "Incomplete"/"Complete"
flag already shown in the contact detail panel, so the two never
disagree. No schema or migration involved -- this only changes how
existing columns are read.

## 2026-06-29 — Drill-down on Admin Activity too

The Analytics dashboard's click-to-drill-down covered outreach
(employee/channel/county/week) but not the Admin Activity breakdown --
added a matching `/api/analytics/audit-entries` endpoint so clicking an
admin-activity bar (e.g. "Added contact") shows the actual Audit Log
entries behind that count, same as the outreach breakdowns.

## 2026-06-29 — UI feedback round: card design, favorites, colorful tags, outreach recency

Manager collected feedback from the team on the look and feel of the
Contact Hub. Addressed all of it:

- **Click to close** — clicking a card a second time now closes the
  detail panel instead of leaving it open with no way to dismiss it.
- **Obvious selection** — the selected card gets a thicker maroon
  border, a light pink tint, and a subtle shadow (Gmail-style), so it's
  clear at a glance which one is open.
- **Less red overall** — avatars, the detail panel's photo circle, the
  per-card top accent, and several headings moved from brand maroon to
  neutral charcoal/black; maroon is now reserved for primary actions,
  the header, and the new selected-card highlight, instead of being on
  every repeated element on the page. Added three new functional accent
  colors (amber/blue/green) for status, used sparingly on the stat cards
  and the "incomplete" flag.
- **More breathing room** — increased the gap between cards and the
  padding inside each one; the team felt the grid was cramped.
- **Dashboard-style stats** — "14007 Total / 14005 Incomplete" became
  four labeled cards: Total Contacts, Need Review, Organizations, %
  Complete (backed by a small `/api/stats` addition for the org count
  and completeness percentage).
- **Colorful tags** — every tag/category pill now gets one of eight
  fixed colors based on a hash of its own text, so the same tag is
  always the same color and they're easier to tell apart at a glance,
  instead of every pill being the same shade of red.
- **Favorites** — a shared, team-wide star (not personal/per-login,
  since nothing else in the app is per-user yet) on every contact card
  and in the detail panel, plus a "Favorites" toggle in the toolbar that
  filters down to just those -- works everywhere the other filters do
  (search, exports, Draft Email). New `Contact.is_favorite` column;
  since `db.create_all()` doesn't alter existing tables, this needed a
  small one-off migration script (`scripts/add_favorite_column.py`) run
  against the database before deploying.
- **Outreach recency on cards** — each card now shows how long it's
  been since the last outreach (any channel) and, separately, since the
  last one logged as "Email" -- without opening the detail panel. Computed
  with one batched query per page of results (not per contact), so it
  doesn't add load even with 14,000+ contacts.

## 2026-06-29 — Security/reliability hardening: rate limiting, password reset, error monitoring, duplicate detection, automated tests

A batch of "make it stronger" fixes:

- **Login rate-limiting** — 10 attempts/minute against `/login`, since
  there was previously nothing stopping repeated password guessing.
- **Admin-initiated password reset** — Manage Users now has a "Reset
  Password" action per user. Previously, a forgotten password had no
  fix short of editing the database directly; there's still no
  self-service reset since no email service is configured.
- **Optional error monitoring** — set a `SENTRY_DSN` env var (free
  Sentry project) and the app reports server errors there automatically
  instead of relying on a user noticing and reporting them. Entirely
  opt-in; the app behaves exactly as before if it's left unset.
- **Duplicate detection** — fixed a real bug: email-matching during
  manual add, spreadsheet sync, and edits was case-sensitive, so
  `Jane@x.com` and `jane@x.com` were treated as different people. Also
  added a same-name+organization check on manual add (not caught by
  the email check when emails differ or are missing) that warns with
  an "Add Anyway?" option rather than silently creating a duplicate.
- **Automated test suite** (`tests/`, run with `pytest`) — 26 tests
  covering login/rate-limiting/password reset, contact CRUD and
  duplicate detection, the Needs Follow-up filter, audit logging, and
  the Analytics dashboard's access control and drill-down. Runs against
  a throwaway SQLite file. Test-only dependencies live in
  `requirements-dev.txt`, not the production `requirements.txt`.

Considered and deliberately skipped: auto-logging outreach from sent
emails (would need a Gmail/Outlook OAuth app, which needs Google/
Microsoft's app-verification process — same blocker that shelved the
OneDrive sync idea earlier). Also still outstanding: the Render web
service is still on the free plan, which undercuts the gunicorn
worker fix from June 24 (free plan spins down after 15 minutes idle) —
upgrading is a billing decision in Render's dashboard, not something
fixable from here.

## 2026-06-29 — Click-to-drill-down on the Analytics dashboard

The Analytics dashboard's breakdowns (by employee, by channel, by
county) and the weekly trend chart were summary-only -- a manager could
see *that* 12 outreach touches happened, but not which ones. Every bar
is now clickable and opens the actual outreach entries behind that
number: who logged it, which contact (name + email) or organization it
was about, the channel, the date, and the summary.

## 2026-06-29 — Analytics dashboard, and "needs follow-up" filter

Two manager-facing additions:

- **Analytics dashboard** (`/admin/analytics`, admin-only, linked next to
  Audit Log): total contacts/organizations, outreach logged (all-time
  and last 30 days), never-contacted count, data-completeness %, a
  12-week outreach trend chart, and breakdowns of outreach by employee,
  by channel, by county, and admin activity by type. Built from the
  Outreach Activity Log and Audit Log data already being collected --
  no new tracking required, just a way to see it.
- **"Needs Follow-up" filter** on the People search (a new dropdown next
  to County): Never Contacted, or No Contact in 30/60/90+ Days. Works
  everywhere the other filters do -- search, CSV/email/Word exports, and
  Draft Email, which now also adjusts its tone (acknowledges it's a
  first-ever outreach, or a re-engagement after a gap) when this filter
  is active. Only applies to the People view, since follow-up status is
  tracked per-contact, not per-organization.

## 2026-06-29 — Flyer/post generator

Team asked for a way to create posts/flyers for the business page or to
attach to emails. Added a **Create Flyer/Post** button (next to Draft
Email) that produces a finished, one-click image in two formats (social
post / printed flyer): Claude drafts a short headline and body line
scoped to whatever the user typed, OpenAI's `gpt-image-1-mini` generates
an on-brand background (explicitly prompted with no text in it -- AI
image models are unreliable at rendering legible/correctly-spelled
text), and Pillow composites the actual headline/body on top using the
app's brand fonts (Archivo Black, Inter) over a maroon-tinted band. This
guarantees crisp, correctly-spelled, on-brand text rather than risking
garbled AI-rendered text on real client-facing marketing material.
Needs a new `OPENAI_API_KEY` env var (see README) -- not yet set in
production, so the feature won't work there until that's added in
Render's dashboard.

## 2026-06-29 — Plain-text copy of each Postgres backup

The nightly Postgres backup (`scripts/fetch_postgres_backup.sh`) only
produced a binary `.dump` file, which isn't readable without
`pg_restore`. It now also writes a plain-text `.sql` copy alongside it
in the same iCloud folder, so the backup's contents can be opened and
checked directly in a text editor.

## 2026-06-25 — Automated production (Postgres) database backups

Manager asked for automated backups of the production database, on top
of the existing local SQLite backup. Production already commits every
write straight to Postgres with no caching layer, so a nightly
`pg_dump` covers every change. Added a GitHub Actions workflow
(`.github/workflows/backup-postgres.yml`) that dumps the production
database nightly and stores it as a 90-day workflow artifact, plus a
second local LaunchAgent + script (`scripts/fetch_postgres_backup.sh`,
installed via `scripts/install_postgres_backup_schedule.sh`) that pulls
the latest one down into the same iCloud Drive folder as the SQLite
backups the next morning. The GitHub Actions side runs independent of
this laptop, so the backup happens even if this Mac is off.

Also found and flagged a GitHub personal access token that had been
embedded in this repo's git remote URL (`.git/config`, not tracked by
git itself, but still a live exposed credential) -- removed it from
the remote URL and recommended revoking it on GitHub.

## 2026-06-25 — Audit Log

Manager asked for a way to see who made changes -- added contacts,
edited them, synced the spreadsheet, or created a user login. Added a
new admin-only **Audit Log** page (linked from the header next to
Manage Users) that lists every one of those actions with who did it,
when, and a plain-language summary -- for edits, exactly which fields
changed and their before/after values. Records are kept even if the
user account that made the change is later renamed or removed.

## 2026-06-25 — Fixed Back link on Sync Spreadsheet / Manage Users

Both pages' Back button went to the homepage instead of returning to
the Contact Hub search view -- it was a hardcoded link to `/`. Pointed
it at `/#search` instead, which the app already treats as "show the
Contact Hub" on page load.

## 2026-06-25 — Detail panel redesign, dropdown fix

Two follow-up fixes after the multi-select Tags rollout:
- The Tag and County dropdowns could end up open at the same time,
  overlapping each other, because each one's click handler stopped the
  click from reaching the *other* dropdown's "click outside closes it"
  listener. Opening any one of Tag/County/Export now explicitly closes
  the other two first.
- The contact/organization detail panel's side-by-side layout (avatar
  next to text) only left about 196px for names, titles, emails, and
  the View/Edit buttons in the narrow sidebar — too tight, causing text
  to wrap badly or run past the edge. Moved the avatar to the top of
  the panel, centered, so the text below gets the panel's full width.

## 2026-06-25 — Tag/category filter: multi-select, plus an overflow fix

Gave the Tags/Categories filter the same treatment as County: it's now a
multi-select checkbox dropdown (no counts) instead of a single-choice
`<select>`, so staff can pull, say, every Clergy *and* Chamber of
Commerce contact in one search. Applies in both People (`Contact.tag`)
and Organizations (`OutreachOrg.tag`) view, and everywhere a category
filter is used: search, exports, and Draft Email. Renamed the County
dropdown's CSS classes to generic shared names so County and Tags are
guaranteed to look identical (same checkbox size, same left alignment).

Also fixed two overflow bugs in the contact/organization detail panel:
long unbroken text (emails, org names) could push past the edge of the
panel because `.detail-main` was missing `min-width:0` (a classic
flexbox sizing trap). The organization detail panel's per-contact rows
had the same trap one level deeper — fixing it then exposed a second
bug, where the View/Edit buttons squeezed the name/title/email down to
nearly zero width in the narrow sidebar, making the text wrap one
character per line and balloon the row height. Fixed by letting the
buttons wrap to their own line when the row is too narrow to fit
everything side by side.

## 2026-06-25 — County filter: multi-select, one entry per county

The county dropdown was listing every distinct *combination* of counties
as its own option (e.g. "Dallas", "Dallas, Tarrant", "Dallas, Tarrant,
Collin" all showed up separately, each with a contact count) because
`Contact.county` can hold several comma-separated counties in one
field. Selecting "Dallas" also only matched that exact combination, so
contacts filed under "Dallas, Tarrant" never showed up — undercounting
real results. Replaced it with a multi-select checkbox dropdown listing
each county name exactly once (no counts), and fixed the underlying
filter so selecting Dallas and Tarrant together correctly returns every
contact tagged with *either* county, regardless of what else is in
their county field. Applies everywhere county filtering happens:
search, exports, Draft Email, and the Organizations view.

## 2026-06-25 — Spreadsheet sync, now covering Organizations too

Until the company formally approves this app, the spreadsheet stays the
source of truth and gets re-uploaded here whenever it changes. The
upload page already existed but was orphaned (no link to it anywhere)
and only handled the People side. Added a visible **Sync Spreadsheet**
link (admin-only, next to Manage Users), extended uploads to also
accept an Organizations tab in the same Excel workbook (matching the
original `OutreachListKey` sheet shape), and replaced the summary with
a plain-language message — "Synced from spreadsheet — 2 new contacts,
1 updated · 1 new organization" — instead of raw counts.

Also fixed two real bugs found while building this: rows with no email
were being silently dropped during import even though email is
supposed to be optional, and a pandas quirk where round-tripping a mix
of real values and blanks through a DataFrame silently turned the
blanks into NaN, corrupting dates and crashing the import.

Considered fully-automatic sync straight from OneDrive/SharePoint, but
that needs an Azure app registration that may require company IT
approval — shelved until after the app itself is approved.

## 2026-06-25 — Visual design pass (fonts, icons, pill buttons, avatars, toasts)

Manager asked for a more polished look and provided a design system spec
(Archivo Black + Inter type, Font Awesome icons, pill-shaped buttons/
inputs, avatars, toast notifications). Applied it across every screen:
- Added Google Fonts (Archivo Black for headings, Inter for body) and
  Font Awesome icons site-wide.
- Buttons and single-line inputs are now pill-shaped, with new outline/
  ghost button variants available; multi-field forms (contact editor,
  outreach log) use a softer rounded-rect radius instead of full pill,
  since pill didn't read well on stacked label/input grids.
- Contact and organization cards now show a circular initials avatar.
- Replaced every blocking `alert()` popup (save/delete/error feedback)
  with a non-blocking toast notification.
- Bumped card/modal corner radii to match the design system's scale.

## 2026-06-24 — Switched production database to free external Postgres

Render's free plan (which is what's actually in use) doesn't include a
persistent disk, so the `render.yaml` disk-based SQLite setup from
earlier today would have silently lost contacts and user accounts on
every restart or redeploy. Removed the disk dependency: production now
points `DATABASE_URL` at an external free Postgres database (Neon or
Supabase — both have a free tier that doesn't expire). Local development
is unaffected (still plain SQLite by default). Required dropping a
SQLite-only column type (`Contact.lists` was using
`sqlalchemy.dialects.sqlite.JSON`, which doesn't work on Postgres — moved
to the generic, dialect-agnostic `db.JSON`). Added
`scripts/migrate_sqlite_to_postgres.py` to copy existing local data
(contacts, organizations, activities, user accounts) into the new
database, and `psycopg2-binary` to `requirements.txt`. Updated `render.yaml`
and the "Deploying" section of `README.md` to match.

## 2026-06-24 — Shell-free account creation for Render

Turned out Render's Shell tab (the documented way to run `create_user.py`
in production) requires a paid plan, which blocked creating the first
login after deploying. Added two ways around it that don't need Shell on
any plan: (1) the app auto-creates one admin account on startup from
`BOOTSTRAP_ADMIN_USERNAME`/`BOOTSTRAP_ADMIN_PASSWORD` env vars if the
users table is still empty (set these for free in Render's dashboard,
under Environment), and (2) a new admin-only **Manage Users** page
(`/admin/users`, linked from the header for admins) so that first account
can create everyone else's login from the browser afterward. Updated the
"Deploying" section of `README.md` to match.

## 2026-06-24 — Made the app deployment-ready (Render)

Until now the app only ran on one laptop via Flask's dev server, so no
one else could use it. Added a production WSGI entrypoint (`wsgi.py` +
gunicorn), a `render.yaml` Render Blueprint (web service + a **persistent
disk** so SQLite survives redeploys), and hardened session cookies for
production (`SESSION_COOKIE_SECURE` when running on Render). Did not
actually deploy or create any production accounts/secrets — that
requires the account holder's own Render sign-up, billing, and secrets,
documented step-by-step in the new "Deploying" section of `README.md`,
including how to move the existing database onto the persistent disk and
create employee logins on production.

## 2026-06-24 — Automated daily database backup

`contacts.db` was removed from git the same day (see below), which meant
it had zero backup coverage. Added `scripts/backup_db.sh`, scheduled
daily via a macOS LaunchAgent (`com.jbjcontacts.backup`), which copies a
timestamped snapshot to a local `backups/` folder and to iCloud Drive
(so a copy exists off this machine), pruning anything older than 60 days.
Verified end-to-end by triggering the LaunchAgent manually. See the
Backup & Recovery section in `README.md` for how to check it's running
or restore from a backup.

## 2026-06-24 — Repo cleanup: scrubbed contact data out of git history

`contacts.db` and the raw import staging files (`data/`, `imports/`) had
been tracked in git since the first commit — meaning every commit
contained the full contact database (names, emails, phone numbers) and,
after the login feature landed, password hashes. Rewrote git history
(`git filter-repo`) to remove these from every commit before the first
push to GitHub, and added them to `.gitignore` so they can't get
re-tracked. Local backups of the stripped files were kept outside the
repo as a safety net.

**Operational note:** this means the contact database now lives *only*
on this machine, with no automatic backup. See the Backup & Recovery
section in `README.md`.

## 2026-06-24 — Employee login

Added per-employee accounts (Flask-Login, hashed passwords). Every page
and API route requires login, checked centrally so new routes are
protected by default. No public sign-up — accounts are created via
`create_user.py` from a terminal. The outreach-activity log now records
who logged an entry from the session instead of a free-text name field,
so one person can't log activity under someone else's name.

## 2026-06-24 — Merged Contacts and Sections tabs into one People/Organizations view

The app used to have two separate tabs (Contacts and Sections) with their
own search bars, filters, and export menus — which was the root cause of
several bugs earlier in the day (filters not working, stray cards showing
up, "Add Contact" silently not refreshing). Replaced both with one screen
and a People/Organizations toggle sharing a single search bar, category
filter, county filter, export menu, and pagination bar.

Organization cards used to show only one "primary" contact even when an
org had several people at it — now every org card lists everyone there,
so coworkers who share an organization show up together.

Also applied the JBJ Management brand color palette (maroon/black
primary, rose/gray/charcoal secondary) across the whole app, replacing
the placeholder maroon theme, plus a more polished home/login screen
treatment (glass card, logo, accent line) as a step toward an eventual
dedicated login page.

## 2026-06-24 — Outreach activity tracking

Added a log of outreach touchpoints per contact and per organization
(who reached out, when, via what channel, what was discussed), with a
"Contacted N times" badge shown before staff reach out again — so two
people don't independently contact the same person without knowing it.

## 2026-06-24 — AI email drafting, county filtering, Sections card UI

- Added a Claude-powered "Draft Email" feature that generates an outreach
  email scoped to whatever filter is currently active.
- Added a county filter to the main Contacts toolbar (previously only
  available on the Sections tab).
- Reworked the Sections tab to show every organization as a card
  immediately (like Contacts does), instead of a category-count summary
  list, and fixed an N+1 query bug that made it feel slow with ~280
  organizations.
- Made `Contact.email` optional (previously required at the database
  level) — a real schema migration since SQLite can't just drop a
  `NOT NULL` constraint in place; the `contacts` table was rebuilt with
  all 14,000+ existing rows preserved.

## 2026-06-23 — Initial contact import

First commit: Flask + SQLite app with the original contact list imported
from spreadsheets (`scripts/import_*.py`).
