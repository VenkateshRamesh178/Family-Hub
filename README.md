# Family Hub

A mobile-first family dashboard PWA. The **free edition** stores the family's shared data in the admin's Google Drive and needs no backend. The paid edition (FastAPI + AWS) comes later. See [docs/family-hub-architecture-plan.md](docs/family-hub-architecture-plan.md).

## Status

| Phase | Scope | State |
|---|---|---|
| 0 | Monorepo, `DataProvider` interface, Drive feasibility spike | Built. Spike still to be **run** on real devices: [docs/phase-0-results.md](docs/phase-0-results.md) |
| 1 | Google sign-in, Drive folder bootstrap, invites, role → share mapping, admin panel | Built, untested against live Google APIs |
| 2–6 | Lists, documents, vault, chat, paid edition | Not started |

## Layout

```
packages/core            Zod schemas, roles/RBAC, DataProvider interface
packages/drive-provider  Free edition: GIS auth, Drive REST client, share planner, DriveProvider, spike probes
apps/web                 React + Vite + Tailwind PWA
docs/                    Plan, Google Cloud setup, Phase 0 results template
```

## Getting started

Requires Node 20+.

```sh
npm install
cp apps/web/.env.example apps/web/.env.local   # then fill it in, see docs/google-cloud-setup.md
npm run dev                                    # http://localhost:5173
```

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server |
| `npm test` | Unit tests (core + drive-provider) |
| `npm run typecheck` | `tsc` across all workspaces |
| `npm run build` | Production PWA build in `apps/web/dist` |
| `node apps/web/scripts/make-icons.mjs` | Regenerate PNG icons |

## How the free edition maps onto Drive

When the admin creates a family, the app creates this tree in the admin's Drive. Every item is tagged with `appProperties`, so the app finds items by id or tag rather than by name.

```
FamilyHub/            shared with every member as Viewer
  _meta/              family.json, members.json, roles.json (written by the admin only)
  lists/ docs/ chat/ audit/ snapshots/
```

- **Invite:** the app shares the root as **Viewer**, which sends Google's invitation email. It then adds a direct **Editor** permission on each folder the role may write (see `packages/drive-provider/src/share-plan.ts`).
- **Join:** the member signs in and selects the shared `FamilyHub` folder in the Google Picker. Under the `drive.file` scope, that selection is what grants the app access. Whether it also covers subfolders is Phase 0 question 1.
- **Built-in roles:** Editor can write lists, docs, chat, audit and snapshots. Reader can write chat and audit only. Custom roles choose View or Edit per folder.
- `writersCanShare` is turned off on every folder, so Editors cannot re-share.

### Deviations from the plan, pending Phase 0

- **Custom roles cannot hide a folder; they can only make it View or Edit.** Drive permissions inherit downward from the shared root, so a folder cannot be hidden without sharing folders one by one. Revisit once the Picker behaviour is known.
- **The vault folder is not created yet.** Phase 4 must keep it outside the inherited share (or use Drive's limited-access folders), so that vault access stays a separate, explicit grant.
- **There is one admin: the Drive owner.** The admin-transfer flow (plan §9) is still to do.
