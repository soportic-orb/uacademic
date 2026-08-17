# CLAUDE.md — UAcademic

Reference document for every session working on this repository. Read it before
writing code. Rules in "REGLAS PERMANENTES" are non-negotiable and outlive any single
session.

---

## 1. What UAcademic is

A responsive internal academic-management web platform for universities and higher
education centers.

The core problem it solves: **matching each teacher's contracted teaching capacity with
the teaching load that must be covered, respecting their time availability.** Everything
else (calendar, messaging, profile, documents) exists to support that core.

### Roles

| Role | Scope | Responsibilities |
| --- | --- | --- |
| `SUPERADMIN` | Platform-wide (only role that crosses centers) | Universities and centers, Microsoft Entra ID tenants, coordinator users, OTA updates, metrics |
| `CENTER_ADMIN` | One center | Subjects, degrees, spaces, users, academic calendar, imports, business parameters |
| `COORDINATOR` | One or more subjects | Assigns teachers, plans schedules, approves class changes. **Only role with access to the AI assistant** |
| `TEACHER` | Self | Own classes and subjects, own load (contracted vs assigned hours), proposes class changes, chat, profile and availability |

A user may hold **different roles in different centers**. Roles live in
`user_center_roles`, never in a token.

---

## 2. Stack and architecture (non-negotiable)

pnpm workspaces monorepo:

| Package | Contents |
| --- | --- |
| `apps/web` | React 19 + TypeScript + Vite + Tailwind + shadcn/ui, TanStack Query (server state) + Zustand (UI state), react-router v7, react-hook-form + Zod, FullCalendar, i18next, vite-plugin-pwa |
| `apps/api` | Node 22 + Fastify + TypeScript + Prisma + MySQL 8, Zod validation, Pino logs, Nodemailer, web-push |
| `packages/shared` | Types, Zod schemas, i18n catalogs and **all pure domain logic** (capacity computation, conflict detection, validations). No DOM and no Node dependencies — phase 2 reuses it from an Expo app |
| `packages/db` | Prisma schema, migrations and seeds |

### Deployment constraints — these drive technical decisions

- **Shared** Linux server managed with Plesk or CloudPanel. Nginx + PM2.
- **No Redis.** The job queue is a `jobs` table in MySQL with a polling worker.
  No BullMQ, ever.
- **No Docker in production**, no Python, no OR-Tools.
- **WebSockets may be unavailable.** Use Server-Sent Events for realtime with polling
  fallback, behind an abstraction so the transport can be swapped.
- MySQL 8, `utf8mb4_unicode_ci`, InnoDB.

---

## 3. REGLAS PERMANENTES

### R1 — Trilingual, always

Català, español, English. **Zero literal strings in components**: everything goes
through i18next with keys nested by domain. Every new key must be added to all three
files (`ca.json`, `es.json`, `en.json`) in the same commit. This applies equally to
emails, push notifications, API error messages and validation texts. A test fails the
build when a key is missing in any language.

### R2 — Strict multi-tenancy

Every business table carries `center_id`. **No query leaves without a tenant filter.**
Scoping is enforced by middleware in the repository layer, plus an automated test that
attempts cross-center access and asserts it fails. Only `SUPERADMIN` crosses centers,
with an explicit header and an audit-log entry.

### R3 — Identity security

The app is registered as multi-tenant in Microsoft Entra ID. Every request must:

- validate the `tid` claim against the list of registered tenants → `403` if absent.
  Without this, a user from **any** Microsoft organization in the world would pass
  signature verification;
- validate `iss` against the published metadata;
- use `oid` as the stable user identifier, **never the email**.

**Roles are always resolved from our database and never read from the token.**

### R4 — Audit

Every business-data mutation writes to `audit_log` with before/after, author and a
`source` field valued `user | ai | system`. The log is immutable — INSERT only.

### R5 — The AI never writes without human confirmation

The assistant's write tools return a **proposal** that the UI renders as a preview with
a diff and any detected conflicts. Execution happens only after explicit user
confirmation, and is recorded.

### R6 — Strict TypeScript

`strict: true`, no `any`, no `@ts-ignore`. API types derive from the shared Zod
schemas: a single source of truth.

### R7 — Domain logic lives in `packages/shared`

If a function computes hours, validates an overlap or decides whether an assignment is
legal, it belongs there and it has a unit test.

### R8 — Accessibility WCAG 2.2 AA is an acceptance criterion

Contrast, visible focus, full keyboard navigation (including the drag & drop planner,
which needs a keyboard alternative), aria-labels, `prefers-reduced-motion` respected.

### R9 — Configurable, not hardcoded

Load thresholds, schedule-engine weights, session duration, whether the coordinator must
approve changes, formats… all live in `centers.settings_json` with defaults and Zod
validation. Teaching-regulation rules differ in every center. In addition, every
parameter can carry **provenance**: which regulatory document and which article it came
from, so that any constraint blocking an action is explainable with its citation.

### R10 — No secrets in the repo

Everything through environment variables, with a documented `.env.example`. GitHub
tokens for OTA and the Claude API key are read on the server only.

### R11 — Tests

Vitest for unit and integration, Playwright for e2e of critical flows. Anything touching
hour computation or conflict detection needs a test before it is considered done.

### R12 — Conventional commits, in English

Code and comments in English; user-facing content in the three languages.

---

## 4. Design system

### Color

Corporate color `#0072CE`, exposed as CSS variables:

```
--primary-50  #EAF4FC   --primary-500 #0072CE   (corporate)
--primary-100 #D0E7FA   --primary-600 #005CA8
--primary-200 #A3CFF5   --primary-700 #004782
--primary-300 #6FB2EE   --primary-800 #00335C
--primary-400 #2E90E0   --primary-900 #001F38
```

Light and dark mode on **every** screen, Tailwind class strategy, semantic tokens
(`--bg`, `--surface`, `--surface-raised`, `--border`, `--text`, `--text-muted`).
Dark mode is not inversion: in dark, primary lightens to `#3D9BE0` to keep AA contrast
over the `#0F172A` background.

Semantic colors: success `#15803D`, warning `#B45309`, danger `#B91C1C`.

### Teaching-load traffic light

Always with an icon and text in addition to color:

| Range | Meaning | Color |
| --- | --- | --- |
| `< 85%` | under-load | blue |
| `85–100%` | optimal | green |
| `100–110%` | at limit | amber |
| `> 110%` | overload | red |

### Typography and spacing

Inter variable. Scale 12/14/16/20/24/32. `tabular-nums` on every hour figure. 8px grid.
Radius 12px on cards, 8px on controls. Very subtle shadows — visual weight is carried by
the border.

Aesthetics: modern, clean, generous whitespace, no gratuitous decoration. Compact
density only in the planning view; comfortable everywhere else.

### Toasts — the only notification mechanism

All confirmations, warnings and errors are shown as toasts in the **top-center** zone of
the screen. No exceptions. Success 4s, error 6s, persistent when it needs user action.
Maximum 3 stacked. `aria-live="polite"`. Use the `useToast` hook; any other alert
mechanism is forbidden.

### Layout

Collapsible sidebar on desktop, 5-item bottom navigation on mobile. Header with center
selector (when applicable), global search with ⌘K, notification bell and user menu.

Every screen needs its loading (skeletons, never full-page spinners), empty (with a
suggested action) and error (with retry) states.

---

## 5. Conventions

- **Dates/numbers**: always through `Intl`, week starts on **Monday**.
- **Times**: stored as `HH:MM` (`CHAR(5)`, 24h, center-local). Domain logic converts to
  minutes-since-midnight in `packages/shared`.
- **Weekday**: ISO-8601 integer, `1 = Monday … 7 = Sunday`.
- **Hours**: `DECIMAL(6,2)`, never floats.
- **IDs**: UUIDv7 (`CHAR(36)`), time-ordered for InnoDB index locality.
- **Naming**: Prisma models are PascalCase and map to `snake_case` tables; fields are
  camelCase and map to `snake_case` columns.
- **Crypto**: calendar tokens encrypted at rest with AES-256-GCM using an app key from
  the environment. Never plaintext in the database.

---

## 6. Repository map

```
apps/web        React SPA (PWA)
apps/api        Fastify API + job worker
packages/shared Domain logic, Zod schemas, types, i18n catalogs
packages/db     Prisma schema, migrations, seeds
tooling/        Shared tsconfig, ESLint and Prettier configs
docs/           Architecture and decision records
```
