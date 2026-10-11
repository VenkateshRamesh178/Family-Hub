# Family Hub

A mobile-first family dashboard PWA: shared calendar, shopping list, to-dos, purchases with warranty tracking, shared documents, and (coming) a password vault and chat. See [docs/family-hub-architecture-plan.md](docs/family-hub-architecture-plan.md).

**Current direction:** build the full product as a regular web app first: React + a FastAPI backend, Postgres in Docker, and document files on the local disk or in S3. The Google Drive "free edition" comes later, behind the same `DataProvider` interface; its code is parked in `packages/drive-provider`.

## Status

| Milestone | Scope | State |
|---|---|---|
| 1 | Email/password accounts, families, invites, roles, shopping list, to-dos, items purchased, dashboard with warranty alerts | Built |
| 1.5 | Family calendar: events, reminders, birthdays, dates from other modules, subscription link for phone calendars | Built |
| 2 | Shared documents (local disk or S3), folders, versions, trash, expiry, audit log, purchase attachments | Built |
| 3 | Password vault | Not started |
| 4 | Chat | Not started |
| later | Google Drive free edition (Phase 0 spike: [docs/phase-0-results.md](docs/phase-0-results.md)), AWS deployment | Parked |

## Layout

```
apps/web                 React + Vite + Tailwind PWA
services/api             FastAPI + SQLAlchemy + Alembic (Python 3.12)
packages/core            Zod schemas, roles/RBAC, warranty logic, DataProvider interface
packages/api-provider    DataProvider over the HTTP API (used by the web app)
packages/drive-provider  Free edition over Google Drive (parked)
compose.yaml             Postgres for local development
```

## Getting started

### Just run it

Requires only Docker Desktop.

```sh
docker compose up --build
```

Open http://localhost:5173. This starts Postgres, the API (it applies migrations on start) and the web app, served by nginx, which proxies `/api` to the API. Data stays in Docker volumes (`db-data`, and `docs-data` for uploaded files) across restarts. After pulling changes, run it with `--build` again. If `npm run dev` is already using port 5173, use `WEB_PORT=8080 docker compose up` (or stop the dev server).

To keep document files in S3 instead, put `DOCS_S3_BUCKET=<your bucket>` in a `.env` file at the repo root (git-ignored), run `aws login` on the host, then:

```sh
docker compose -f compose.yaml -f compose.s3.yaml up --build
```

Use port 5173 for S3: the bucket only accepts browser uploads from `http://localhost:5173`.

### Develop with hot reload

Requires Node 20+, Python 3.12+ and Docker Desktop. If you used `docker compose up`, stop the app containers first (`docker compose stop api web`): the web container uses port 5173, like the dev server.

```sh
npm install
npm run api:setup      # creates services/api/.venv and installs the API
npm run db:up          # starts Postgres in Docker (port 5432)
npm run api:migrate    # creates the tables
npm run api            # API on http://localhost:8000 (docs at /docs)
npm run dev            # in a second terminal: web app on http://localhost:5173
```

Open http://localhost:5173, create an account and then a family. To try a second member, invite their email from **Admin**, then sign up with that email in another browser (or a private window). The invite is waiting on their welcome screen. No email is sent yet.

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server; proxies `/api` to `localhost:8000` |
| `npm run api` | FastAPI with auto-reload |
| `npm run api:test` | API tests (needs `npm run db:up`; uses the `familyhub_test` database) |
| `npm run api:migrate` | Apply Alembic migrations |
| `npm test` | TypeScript unit tests (core, api-provider, drive-provider) |
| `npm run typecheck` | `tsc` across all workspaces |
| `npm run build` | Production PWA build in `apps/web/dist` |
| `npm run db:down` | Stop Postgres (data is kept in the `db-data` volume) |

After changing `services/api/app/models.py`, create a migration with:

```sh
node scripts/py.mjs alembic revision --autogenerate -m "describe the change"
```

API settings (database URL, cookie flags, document storage) are read from environment variables or `services/api/.env`; see `services/api/app/config.py`.

### Storing documents in S3

By default document files go to `services/api/data/docs` (ignored by git). To use the S3 bucket instead, put this in `services/api/.env`:

```sh
DOCS_STORAGE=s3
DOCS_S3_BUCKET=family-hub-documents-<account id>
DOCS_S3_REGION=ap-southeast-2
DOCS_S3_PROFILE=family-hub-dev   # role with access to families/* only; chains from `aws login`
```

The `family-hub-dev` profile assumes the `family-hub-api-dev` role using your `aws login` session, so run `aws login` first if it has expired (sessions last 12 hours and renew for up to 90 days). The bucket allows browser uploads from `http://localhost:5173` only; add the production origin to its CORS rules when deploying. On EC2, leave `DOCS_S3_PROFILE` unset so the instance role is used.

## How it fits together

- **Auth:** email + password (Argon2 hashes). Signing in sets an HttpOnly session cookie; sessions are stored hashed in Postgres and last 30 days. The Vite proxy keeps the API same-origin, so no CORS is configured.
- **Families:** whoever creates a family is its admin. The admin invites people by email with a role; the invite appears when someone signs in with that email. A user belongs to one family for now.
- **Roles:** everyone can view everything. **Editor** can change lists, documents and chat; **Reader** can only chat. Admins can create custom roles that choose View or Edit per area. The API enforces this (`services/api/app/roles.py` mirrors `packages/core/src/roles.ts`); the UI only hides buttons.
- **Lists:** shopping, to-dos and purchased items are shared by the whole family. Concurrent edits are last-write-wins per item. Other members' changes show up when the app regains focus.
- **Calendar:** events, reminders and birthdays live in `calendar_events`. Everything else with a date (to-do due dates, purchases, warranty and document expiries) is read from its own table on every request (`family_occurrences` in `services/api/app/routers/calendar.py`), so it can never drift out of sync. Recurrence follows RFC 5545: an event on the 31st skips shorter months, and a 29 February birthday only shows in leap years. Calendar editing uses the **Lists** permission.
- **Calendar sync:** each person can create a private iCalendar link (`/api/calendar/feed/<token>.ics`) and subscribe to it from Google Calendar, Apple Calendar or Outlook. It's read-only. Reminders and birthdays carry alerts (at the set time, or 9am), and warranty and document expiries alert a week before. Apple Calendar honours these alerts, but Google Calendar ignores alerts on subscribed calendars. Google also refreshes subscriptions only every few hours. The server stores only a hash of the token, so the link is shown once; making a new link disables the old one. **Calendar servers can't reach `localhost`**, so subscribing only works once the app is deployed (or exposed through an HTTPS tunnel).
- **Warranties:** the dashboard flags purchases whose warranty has expired or ends within 60 days (`WARRANTY_WINDOW_DAYS` in `packages/core/src/lists.ts`).
- **Documents:** folders, an optional expiry date (on the calendar and the dashboard), and a link to an item purchased for receipts and warranty cards. File bytes never pass through the JSON API: the browser gets an upload ticket, PUTs the file to S3 (presigned URL) or to the API (local storage), then creates the document; the API checks the stored size first. Every version is stored under its own key (`families/{familyId}/docs/{versionId}`), so replacing a file keeps the old one and it can be restored. Deleting moves a document to the trash; "Delete for good" removes every version. Uploads, edits, opens and deletes are recorded in an audit log. Only PDFs, images and plain text open in the browser; everything else downloads, so an uploaded HTML file can't run in the app. Files are limited to 25 MB (`DOCS_MAX_UPLOAD_MB`). Changing documents uses the **Documents** permission.
- **Schemas live twice:** Pydantic in `services/api/app/schemas.py` and Zod in `packages/core`. `api-provider` validates every response against the Zod schema, so drift shows up immediately as an error.

### Known gaps before real use

- Emails aren't verified, so anyone who signs up with an invited address can accept that invite.
- No password reset, rate limiting on sign-in, or "remember me" control yet.
- `cookie_secure` must be turned on once the app is served over HTTPS.
- Uploads that are never turned into a document are cleaned up lazily (on that family's next upload, after a day). With S3, also consider a lifecycle rule for `families/*/docs/` objects that no document references.
