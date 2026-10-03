# Phase 0 — Drive feasibility results

Fill this in from the in-app **Diagnostics** tab. Use **Copy report as JSON** on each device and paste the reports at the bottom.

**Setup:** Device A is signed in as the admin and creates the family. In the Admin tab, invite account B as an **Editor** (later also as a **Reader**). Device B signs in, taps **Join a family**, and picks the `FamilyHub` folder.

| | Device A | Device B |
|---|---|---|
| Phone / browser | | |
| Account | | |
| Role | Admin | |
| Scopes | `drive.file` | `drive.file` |

## Q1 — Can a second account read and write under `drive.file`?

On device B, run **Access probe**.

- [ ] Root metadata readable after the Picker step
- [ ] Root children listable (subfolders visible without picking each one)
- [ ] `_meta/members.json` and `roles.json` readable
- [ ] B can create files in `chat/` (Write heartbeat succeeds)
- [ ] A can see files that B created (A's probe counts B's heartbeats; on A, the Admin → Members list shows B as **active**)
- [ ] B can see files that A created

Notes:

**If subfolders or other members' files are not visible**, the options are:
1. Have each member pick every subfolder (Picker multi-select), or
2. Switch to the full `drive` scope (set `VITE_DRIVE_SCOPES=https://www.googleapis.com/auth/drive` and re-run the probe to confirm). `drive` is a *restricted* scope, which means Google verification plus an annual security assessment before a public launch.

Decision:

## Q2 — Do devices see each other's changes via `changes.list`?

Start polling on both devices, then turn on auto-write on one.

| Poll interval | Median latency | p90 | Drive requests / 10 min |
|---|---|---|---|
| 2s | | | |
| 5s | | | |
| 15s | | | |

Do changes made by B show up in A's `changes.list` (and vice versa)?

Decision on the adaptive polling rates:

## Q3 — Is silent token renewal reliable?

Leave each device open past token expiry (~60 min), once in the foreground and once after backgrounding the PWA.

| Scenario | Silent renewal ok? | Popup needed? | Notes |
|---|---|---|---|
| Foreground, desktop Chrome | | | |
| Foreground, Android PWA | | | |
| Background → resume, Android PWA | | | |
| Next day, cold start | | | |

Decision (keep browser-only tokens, or add a small stateless token-exchange function):

## Q4 — Does sharing behave as expected?

- [ ] B as **Reader** cannot create files in `lists/` (probe shows `canAddChildren=false`)
- [ ] B as **Editor** can create files in `lists/`
- [ ] B as **Editor** has `canShare=false` on folders (`writersCanShare=false` holds)
- [ ] Changing B's role in the Admin tab takes effect after B re-runs the probe
- [ ] Removing B revokes access (B's probe fails; B sees "not in this family")

Notes:

## Raw reports

<details><summary>Device A</summary>

```json
```

</details>

<details><summary>Device B</summary>

```json
```

</details>
