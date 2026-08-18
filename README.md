# UAcademic

Internal academic-management platform for universities and higher education centers.

It solves one problem: **matching each teacher's contracted teaching capacity with the
teaching load that must be covered, respecting their time availability.** Calendar,
messaging, documents and the AI assistant all exist to support that.

The project rules that survive every session live in [`CLAUDE.md`](./CLAUDE.md). Read
that first — it is the contract, not a summary.

---

## Requirements

| Tool  | Version                                     |
| ----- | ------------------------------------------- |
| Node  | 22.12 or newer                              |
| pnpm  | 10.33                                       |
| MySQL | 8.0 or newer (`utf8mb4_unicode_ci`, InnoDB) |

No Docker, no Redis, no Python: the target is a shared Linux host managed with Plesk or
CloudPanel, running Nginx and PM2.

---

## Getting started

```bash
pnpm install
cp .env.example .env            # fill in DATABASE_URL at least
```

Create the database and a user for it:

```sql
CREATE DATABASE uacademic CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE DATABASE uacademic_shadow CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'uacademic'@'localhost' IDENTIFIED BY 'change-me';
GRANT ALL PRIVILEGES ON uacademic.* TO 'uacademic'@'localhost';
GRANT ALL PRIVILEGES ON uacademic_shadow.* TO 'uacademic'@'localhost';
```

The API and the Prisma CLI read `.env` from their own package, so link or copy it:

```bash
cp .env apps/api/.env
cp .env packages/db/.env
```

Then apply the schema and load the demo data:

```bash
pnpm build:packages             # shared + db must be built before the apps
pnpm db:migrate                 # creates the tables
pnpm db:seed                    # 1 university, 1 center, 8 subjects, 12 teachers, 3 spaces
pnpm dev                        # API on :3001, web on :5173
```

The seed prints the teaching load it produced, so you can see straight away that the
traffic light covers all four states.

### Signing in

Sign-in is Microsoft Entra ID: MSAL in the browser (authorization code flow with PKCE)
obtains an access token, the API validates it and returns an httpOnly session cookie.
Set `VITE_ENTRA_CLIENT_ID` and `ENTRA_CLIENT_ID` to your app registration, and register
your tenant under **Administration → Identity tenants** — a token whose `tid` is not in
that table is refused with 403, which is what keeps every other Microsoft organization
in the world out (R3).

**Break-glass access.** The platform superadmin also has a local password (argon2id)
with TOTP, so the product stays reachable when Entra ID does not. The seed creates it
with the password from `SEED_SUPERADMIN_PASSWORD` (default `Superadmin-2026-demo`) for
`ona.bertran@demo.uacademic.test`; TOTP is enrolled only when `APP_ENCRYPTION_KEY` is
set, and the seed prints the secret once. Nobody else has a password: their organization
owns it, so the profile screen shows the linked Microsoft account instead.

**Local development without Microsoft.** Setting `AUTH_MODE=mock` (API) and
`VITE_AUTH_MODE=mock` (web) brings back the phase 0 identity switcher, with one demo
account per role and an `x-mock-user: <email>` header. The API refuses this mode when
`NODE_ENV=production`.

| Role           | Email                                 |
| -------------- | ------------------------------------- |
| `SUPERADMIN`   | `ona.bertran@demo.uacademic.test`     |
| `CENTER_ADMIN` | `ferran.aymerich@demo.uacademic.test` |
| `COORDINATOR`  | `marta.puig@demo.uacademic.test`      |
| `TEACHER`      | `sergi.vila@demo.uacademic.test`      |

Roles are never read from a header or a token: they are resolved from
`user_center_roles` on every request (R3).

### Bulk import

**Administration → Imports** loads teachers or subjects from CSV or Excel in four steps:
upload, column mapping (proposed automatically, accents and three languages included),
a dry run that reports every row it would reject and why, and finally the apply step,
which writes only the rows the report approved. Re-running the same file updates
existing records instead of duplicating them.

---

## Commands

| Command                         | What it does                                                   |
| ------------------------------- | -------------------------------------------------------------- |
| `pnpm dev`                      | Builds the packages, then runs API and web in watch mode       |
| `pnpm dev:api` / `pnpm dev:web` | One app at a time                                              |
| `pnpm build`                    | Builds everything, packages first                              |
| `pnpm lint` / `pnpm format`     | ESLint / Prettier over the workspace                           |
| `pnpm typecheck`                | `tsc --noEmit` in every package                                |
| `pnpm test`                     | Vitest: domain, i18n coverage, API integration, web components |
| `pnpm test:e2e`                 | Playwright over the critical flows (needs a seeded database)   |
| `pnpm db:migrate`               | Creates and applies a migration from the schema                |
| `pnpm db:seed`                  | Reloads the demo data (idempotent)                             |
| `pnpm db:reset`                 | Drops, re-migrates and re-seeds                                |

The queue worker runs as its own process: `pnpm --filter @uacademic/api dev:worker`
in development, `pnpm --filter @uacademic/api start:worker` under PM2.

---

## Repository map

```
apps/web          React 19 SPA (PWA): design system, layout, screens
apps/api          Fastify API, tenant scoping, audit, SSE, job worker
packages/shared   Domain logic, Zod schemas, i18n catalogs — no DOM, no Node
packages/db       Prisma schema, migrations, demo seed
tooling/          Shared tsconfig, ESLint and Prettier configs
docs/             Architecture notes and decisions
```

`packages/shared` has no browser and no Node dependencies on purpose: a later phase
reuses it from an Expo app.

---

## What phase 4 adds

Collaboration: what happens to a timetable after it is published.

**Class changes** walk a ladder, and only the ladder:

```
draft → requested → accepted by teacher → approved by coordination → applied
              ↘ rejected      ↘ rejected            ↘ cancelled / expired
```

Every step asks the same pure function (`packages/shared/src/domain/change-requests.ts`)
whether _this actor_ may take _this step_ from _this state_, re-checks the result
against the published week with the phase-3 constraint engine, writes an audit
entry (R4) and tells the people the step concerns, each in their own language (R1).
A center where coordination is only informed (`workflow.coordinatorApprovesChanges`
= false) skips the approval state entirely; `workflow.autoApplyApprovedChanges`
decides whether an approval lands in the timetable by itself, and it lands through
the same conflict guard as a manual apply. Unanswered requests expire after
`workflow.changeRequestExpiryHours`, which the queue worker enforces on a schedule
and records as a `system` change.

**Absences and substitutions.** A teacher reports a range of days with a reason;
the system lists the classes it actually leaves uncovered and ranks who could take
each one — competence in the subject or its area, free in that slot, and with
capacity headroom — scoring each candidate and, for the ineligible ones, naming the
blocker. Asking a colleague to cover is a _request_, not an order: it creates a
change request they can decline, and the class only moves when the ladder reaches
`applied`.

**Messaging.** One-to-one conversations, an automatic group per subject, a center
channel and read-only coordinator announcements — who may read and who may post is
decided by pure rules both ends share. Attachments (10 MB, five per message, an
allow-list of types), a read indicator, and full-text search across the
conversations the reader belongs to. Delivery is SSE over the user's own channel,
with the polling endpoint as the fallback for hosts that will not hold a stream
open.

**Notifications.** A catalog of events × channels (in-app / push / email) with
per-user preferences, mandatory channels that cannot be muted, and a daily digest
for low-priority events. Push is Web Push with VAPID; the permission is only ever
requested from a real click, and on iOS — where push exists only inside a PWA added
to the home screen (16.4+) — a non-installed device gets the "Share → Add to Home
Screen" onboarding instead of a prompt that would be denied forever. Email is
Nodemailer with MJML templates, queued in the `jobs` table with retries and backoff,
and every message is rendered in the locale stored on the recipient's profile.

**The audit viewer** for administrators: filters by entity, person, date range and
origin (`user` / `ai` / `system`), with the before/after payload of each entry. The
log stays what R4 says it is — append-only, never editable.

## What phase 3 adds

Planning: the part that turns a load model into a timetable.

**Versions.** A schedule lives in a version that moves `draft → in review →
published`. Working in a draft notifies nobody — that is the whole point of the
workflow. Publishing freezes the sessions into a snapshot, diffs them against the
version that was live, archives it, and writes one notification per affected
teacher carrying **only their own changes**. A version with an unresolved hard
conflict cannot be published at all, and the comparator shows the same diff, per
teacher, before anyone commits to it.

**The constraint engine** (`packages/shared`, exhaustively unit-tested):

| Hard — these block                   | Soft — these penalise, with per-center weights |
| ------------------------------------ | ---------------------------------------------- |
| Same teacher in two places           | Slots the teacher marked "better avoided"      |
| Same room twice                      | Gaps between a teacher's classes               |
| Same group twice                     | Days with a single session                     |
| A slot marked unavailable            | Changing building between consecutive classes  |
| Beyond the contracted weekly ceiling | Teaching past the consecutive-hours limit      |
| Room too small / missing equipment   | A group's sessions bunched into few days       |

Weights live in `centers.settings_json` under `engine.weights`; a weight of zero
switches a rule off. Hard constraints are never traded away — not by the weights,
not by the solver's temperature.

**Automatic generation.** A greedy construction that always places the most
constrained group first, then simulated annealing over four moves (move a session,
swap two, reassign the teacher, change the room). It runs in a `worker_thread`
with a 60 s ceiling so the API keeps serving, reports progress over SSE (with a
polling fallback, since a shared host may not hold a stream open), and returns the
three best proposals — each with a plain-language account of which soft constraints
it sacrificed, assembled from the i18n catalogs so it reads in all three languages.

**The visual planner.** A weekly grid with the pending groups in a side column and
a status bar of the whole plan (placed, pending, conflicts, penalties, teachers out
of range). Cells are painted as you drag — green, amber with the reason in the
tooltip, red when impossible — by running the very same pure engine in the browser,
so there is no round trip per cell; the server still recomputes on every write.
Dragging has an exact keyboard equivalent (R8): Space picks a class up, the arrows
move it, Space drops it, Escape cancels. Undo and redo send the inverse call rather
than pretending locally.

**The teacher's calendar.** Day, week, month and agenda over the published
timetable, filterable by subject, with holidays already removed. It can be
subscribed to from Outlook, Google Calendar or Apple Calendar through a personal
ICS address — stored as a SHA-256 hash, revocable in one click — and exported to
PDF or Excel.

## What phase 2 adds

The core of the product: matching contracted capacity with the workload that has to
be covered.

```
capacity = contracted hours − approved reductions
workload = Σ assignments, by concept (teaching, tutoring, coordination, final projects, other)
ratio    = workload / capacity → traffic light
```

Every one of those numbers is computed in `packages/shared` and unit-tested (R7/R11),
and every traffic-light threshold is read from `centers.settings_json` (R9) — a center
that considers 95 % under-loaded gets its own colours without a code change.

- **Teaching profile** (`/teachers/:id`, and `/teachers/me` for yourself): contractual
  category, dedication, contracted hours, reductions with their reason, status and
  approver, plus the knowledge areas and subjects the person can teach. Only an
  approved reduction lowers the capacity; a pending one is visible but inert.
- **Weekly availability editor**: a grid of days × slots painted by dragging, with four
  levels (preferred, available, better avoided, unavailable) and a legend that also
  reports the hours declared at each level. The keyboard path is not a fallback — arrows
  move, Space paints, Shift+arrows paint a rectangle and 1–4 pick the level, all through
  the same pure helpers the pointer uses (R8). Consecutive slots are merged into
  intervals before saving, so painting a morning writes one row, not sixteen.
- **Date exceptions**: conferences, leave, sick leave. They only ever tighten the weekly
  pattern.

  Availability and exceptions are written by the teacher, by coordination — which has to
  make the timetable fit — and by the center administration. Reductions are the contract
  rather than the timetable, so only the center administration records and approves them.

- **Center load panel** (`/teachers`): every teacher with capacity, workload, ratio and
  traffic light, filtered by degree, category, load status and name. Filtering and
  sorting happen on the server, and the **Excel export** takes the same query string, so
  the download is the table on screen — with a second sheet stating the thresholds that
  produced each colour.
- **Personal panel** (`/my-load`): the teacher's own hours broken down by subject and by
  concept, with a simple chart rendered as a table so it reads the same by eye and by
  screen reader.

## What phase 1 adds

- Microsoft Entra ID authentication: JWKS signature check, audience, `tid` against the
  registered tenants, `iss` against that tenant, `oid` as the identity — and roles still
  read from the database.
- Configurable JIT provisioning per center, landing new accounts in
  `pending_activation` until someone approves them.
- Server-side sessions behind an httpOnly, signed, SameSite=Lax cookie, revocable on
  sign-out and on password change.
- Break-glass superadmin path with argon2id and TOTP, plus lockout.
- CRUD with server-side pagination, sorting, filtering and audit for universities,
  centers, identity tenants, degrees, academic years, subjects, groups, spaces, the
  academic calendar, users and roles.
- Bulk import of teachers and subjects with column mapping and a dry run.

## What phase 0 delivered

- Monorepo, shared tooling and CI (lint, format, typecheck, tests, e2e).
- Complete Prisma schema (40 models), initial migration and a demo seed whose timetable
  is allocated with the same conflict detector the planner will use.
- Domain package: capacity and the load traffic light, timetable conflicts including
  biweekly parity, availability resolution, center settings with parameter provenance,
  `Intl` formatting with the week starting on Monday.
- Trilingual infrastructure with hot language switching and a test that fails the build
  when a key is missing from any language.
- Design system: corporate scale, semantic tokens, light and dark mode, top-center
  toasts as the only notification mechanism.
- Application layout: collapsible desktop sidebar, five-item mobile bar, header with
  center selector and ⌘K search, role-based navigation.
- API with strict multi-tenancy enforced in the data layer, audited cross-center access,
  localized errors, SSE with polling fallback and a MySQL-backed job queue.

### Not built yet, by design

The drag & drop planner, the AI assistant, calendar synchronisation, messaging, document
ingestion and OTA updates. The tables, the settings schema and the job types they need
are already in place, as is the availability model the planner will read.

---

## Testing notes

The API integration tests and the e2e suite need a seeded MySQL: they check that a user
from one center cannot read another center's data (R2), which is only meaningful against
a real database. CI starts a MySQL service, migrates and seeds it before running them.
Unit tests — domain logic, i18n coverage, tenant scoping rules, toasts, navigation — run
without any database.

The Entra ID flow is tested without Microsoft: the suite generates an RSA key pair,
serves the public half as a JWKS over localhost, and mints real RS256 tokens — including
the ones an attacker would send (foreign tenant, mismatched issuer, wrong audience,
expired, unsigned by the published key). The e2e suite drives the local superadmin
sign-in through the real UI instead, since the Microsoft redirect cannot be automated.
