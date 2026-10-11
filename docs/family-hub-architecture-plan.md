# Family Hub — Architecture & Build Plan

**Version:** 1.1
**Status:** Draft, pre-build

## 1. What we're building

A centralized family dashboard web app, built mobile-first (Android PWA first, iOS later if feasible), with two commercial editions:

- **Free edition** — no backend we operate. It's a static PWA where all shared data lives in the **admin's personal Google Drive**. Each family member signs in with their own Google account, and the admin shares Drive folders with them. Personal data stays only on the user's device.
- **Paid edition** — a traditional backend (FastAPI + AWS) where shared data lives in our own cloud (S3 + RDS Postgres), with local (non-Google) authentication, real-time features, and push notifications.

Both editions share the same React frontend and the same feature set, switched behind a `DataProvider` interface (`DriveProvider` vs `ApiProvider`).

~~We are building the **free edition first**, then the paid edition.~~

> **Update (2026-10-03):** order reversed. The full feature set is being built first as a regular web app (FastAPI + Postgres in Docker + local file storage, i.e. the paid-edition architecture run locally), so there is a working product to show. The Drive free edition and the AWS deployment follow. See the README for the current milestones.

---

## 2. Feature list

| Module | Summary |
|---|---|
| Shared documents | Folders, optional expiry date, local + cloud (Drive/S3) storage, audit log |
| Personal files | On-device only, never synced to the server or Drive |
| Shopping list | Item name, quantity, unit, checkbox. Widget-friendly |
| To-do list | Item name, due date, assignee. Widget-friendly |
| **Items purchased** *(new)* | Item name, specifications, optional link, bought date, warranty flag, warranty expiry date, supporting documents |
| Password vault | Company, account, username, password, date, email, phone — zero-knowledge encrypted, permission-gated |
| Chat | Basic family chat (polling in free edition, real-time + push in paid) |
| Admin panel | User management, custom roles, per-role permissions |

### Roles

- **Admin** — all access
- **Editor** — read and write
- **Reader** — read only
- Custom roles can be created in the paid edition (and as folder-share combinations in the free edition)

---

## 3. New feature: Items Purchased

Purpose: track what was bought, when warranties expire, and where the receipt/warranty card is — so nobody forgets a warranty window.

**Fields**

| Field | Notes |
|---|---|
| Item name | Required |
| Specifications | Free text (model, size, color, etc.) |
| Purchase link | Optional URL (where it was bought) |
| Bought date | Required |
| Has warranty/guarantee | Boolean |
| Warranty expiry date | Required only if "has warranty" is true |
| Supporting documents | One or more attachments — receipts, warranty cards. Reuses the **Shared documents** storage layer (local/Drive/S3), not a separate upload path |

**Behavior**

- Reuses the same lazy expiry-check pattern as document expiry: when an admin/editor opens the app, a sweep flags items whose warranty expires soon or has expired, and surfaces them on the dashboard.
- Dashboard widget: "Warranties expiring soon" (next 30/60/90 days — configurable later).
- Treated as **shared data** by default (family purchases), governed by the same role rules as shopping/to-dos (Reader = read only, Editor = read/write, Admin = all).
- Supporting documents inherit the Shared Documents audit log (upload/view/delete events).

**Data model (conceptual)**

```
purchased_items
  id
  item_name
  specifications (text)
  purchase_link (nullable)
  bought_date
  has_warranty (bool)
  warranty_expiry_date (nullable, required if has_warranty)
  created_by
  created_at / updated_at
  document_ids[]  -- references into the shared documents module
```

This slots in next to Shopping and To-dos in the architecture — same sync pattern, same widget-friendly API shape.

---

## 4. Architecture overview

```
FREE EDITION (no backend of ours)
 React PWA (static, hosted on S3/CloudFront)
   ├── DataProvider → DriveProvider
   ├── Local replica (IndexedDB) — offline + fast reads
   ├── Google Identity Services sign-in → Drive v3 REST API
   └── Admin's Google Drive = shared "source of truth"
         FamilyHub/
           _meta/        family config, signed member directory
           lists/         shopping + to-dos + purchased items, event logs per device
           docs/          shared documents, folder tree
           chat/          per-device daily log files
           vault/         wrapped keys + encrypted entries
           audit/         best-effort audit trail
           snapshots/     periodic compacted state

PAID EDITION (later)
 Same React PWA → ApiProvider → FastAPI
   └── RDS PostgreSQL (multi-tenant, tenant_id) + S3 + SES + Web Push + Redis/SQS
```

### Tech stack

**Frontend (both editions)**
- React + Vite + TypeScript
- TanStack Query for server/data state
- Tailwind + shadcn/ui
- Workbox (`vite-plugin-pwa`) for PWA/offline support
- Dexie (IndexedDB) for the local replica
- WebCrypto / libsodium + Argon2id (WASM) for the vault

**Free edition specifics**
- Google Identity Services for sign-in
- Drive v3 REST API for storage
- No server of our own — app is static, hosted on S3/CloudFront

**Paid edition specifics (later)**
- FastAPI + async SQLAlchemy 2.0 + Alembic
- PostgreSQL (RDS), row-level security + `tenant_id`
- S3 (per-tenant prefixes, presigned URLs)
- SES for invite/notification emails
- WebSockets + Redis pub/sub for chat
- Web Push (VAPID) for notifications
- ARQ or SQS for background jobs (expiry sweeps, warranty reminders, snapshotting)

**Monorepo layout**
```
packages/core           -- shared schemas (Zod), RBAC rules, event reducers
packages/drive-provider -- free edition data layer
apps/web                -- the React PWA
services/api            -- FastAPI backend (added in paid-edition phase)
```

---

## 5. Roles & permissions

| Role | Free edition (Drive mapping) | Paid edition |
|---|---|---|
| Admin | Owner of the Drive folder tree | Full permission set, `admin:*` |
| Editor | Drive "Editor" on shared folders | `*:write` permissions |
| Reader | Drive "Viewer" on shared folders | `*:read` permissions |
| Custom roles | Folder + share-level combinations (e.g., share only `lists/` and `docs/`) | Rows in `role_permissions`, editable in admin panel |

- **Vault access is always a separate, explicit grant** — never implied by Admin — in both editions.
- Permissions in the paid edition are enforced server-side via FastAPI dependencies; the UI only hides actions for convenience.
- Permissions in the free edition are enforced by Drive's own sharing — the admin panel just manages those shares programmatically.

---

## 6. Sync model (free edition)

- Each device writes **only its own append-only event-log files** (JSONL, one per device per month/day) — avoids write conflicts entirely.
- Every device polls `changes.list` (adaptive rate: fast on active screens, slow/paused in background) and merges all logs into its local IndexedDB replica.
- Lists (shopping, to-dos, purchased items) use last-write-wins per item.
- Chat uses per-device, per-day log files.
- An Admin/Editor client periodically writes a compacted **snapshot** so new devices don't have to replay the full history.

---

## 7. Build phases

| Phase | Scope | Exit criteria |
|---|---|---|
| **0** | Drive feasibility spike, monorepo setup, `DataProvider` interface | Two Google accounts can read/write shared data via `drive.file` scope; sync latency and token-refresh behavior validated |
| **1** | Google sign-in, Drive folder creation, invites, role-to-share mapping, admin panel | Two accounts with different roles behave correctly |
| **2** | Shopping list, to-dos, **items purchased**, offline queue, dashboard widgets | Three devices converge correctly after offline edits; warranty sweep flags expiring items |
| **3** | Shared + personal documents, folders, lazy expiry, audit events | Upload/download/expiry/restore all work; purchased-item attachments work end-to-end |
| **4** | Zero-knowledge password vault, signed member directory, recovery key | A revoked member cannot read newly added entries |
| **5** | Chat (adaptive polling) | Acceptable latency; Drive API quotas respected |
| **6** | Paid edition: FastAPI, RDS, S3, local auth, real-time chat, push, billing, Drive→paid migration tool | First paying tenant onboarded end-to-end |

### Phase 0 — spike checklist (do this before anything else)

1. Using the narrow `drive.file` scope, can a **second** Google account read/write files that the admin's app created? Does it need a one-time Picker step, and does that cover subfolders?
2. Do two devices see each other's changes within an acceptable time via `changes.list` polling?
3. How often does the browser-only OAuth access token need renewal, and is silent renewal reliable enough? (If not, a small stateless token-exchange function may be needed.)
4. Does Viewer/Editor sharing behave as expected, and does disabling `writersCanShare` hold?

---

## 8. Platform notes

**Android-first PWA** — installable via Chrome's install prompt, offline support via service worker, Web Push works for installed PWAs.

**iPhone/iOS — known roadblocks (for later, if ever):**
- No automatic install prompt; users must manually "Add to Home Screen"
- Push notifications only work once installed to the home screen (iOS 16.4+)
- Safari may evict site storage after ~7 days of inactivity (installed PWAs are exempt)
- No Background Sync; offline queues only flush while the app is open
- App Store distribution needs a native wrapper, Apple review, and a $99/year developer account
- Testing requires a real iPhone + a Mac (for Safari's inspector)

Decision: **Android only for now**; keep the implementation standards-based so iOS remains possible later.

---

## 9. Top risks

- **Google dependency** — scopes, quotas (pooled across all free users), verification requirements and branding rules are outside our control and underpin the entire free edition.
- **Admin as single point of failure** — a locked Google account or a full 15GB Drive affects the whole family. Needs an admin-transfer flow.
- **Data loss from sync bugs** — mitigated by the append-only log design, multi-device tests, and periodic snapshots.
- **On-device storage eviction** — personal files and the local replica can be cleared by the browser; mitigate with `navigator.storage.persist()` and an export/backup option.
- **Vault recovery** — a lost passphrase + lost recovery key means permanently unrecoverable vault data, by design.
- **Legal/compliance** — privacy policy, Google API user-data ("Limited Use") compliance, and data-protection law (e.g., India's DPDP Act), including handling of any children's accounts.

---

## 10. Open items (defaults noted — confirm later)

- Shopping, to-dos and purchased items are **shared only** (no personal versions) — *default assumption*.
- Chat is writable by all roles including Reader — *default assumption*.
- Paid-plan limits and pricing — to be decided after Phase 2, once real storage/usage patterns are known.
- Free tier is free forever (not a time-limited trial) — *default assumption*.
- Warranty reminder window (30/60/90 days) — to be finalized during Phase 2 design.
