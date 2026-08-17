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

### Signing in during phase 0

Authentication is simulated until Microsoft Entra ID lands in phase 1. The web app has
an identity switcher in the header with one demo account per role, and the API accepts
an `x-mock-user: <email>` header:

| Role           | Email                                 |
| -------------- | ------------------------------------- |
| `SUPERADMIN`   | `ona.bertran@demo.uacademic.test`     |
| `CENTER_ADMIN` | `ferran.aymerich@demo.uacademic.test` |
| `COORDINATOR`  | `marta.puig@demo.uacademic.test`      |
| `TEACHER`      | `sergi.vila@demo.uacademic.test`      |

Roles are never read from a header or a token: they are resolved from
`user_center_roles` on every request (R3).

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

`packages/shared` has no browser and no Node dependencies on purpose: phase 2 reuses it
from an Expo app.

---

## What phase 0 delivers

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

### Not in phase 0, by design

Microsoft Entra ID authentication, the drag & drop planner, the AI assistant, calendar
synchronisation, messaging, document ingestion and OTA updates. The tables, the settings
schema and the job types they need are already in place.

---

## Testing notes

The API integration tests and the e2e suite need a seeded MySQL: they check that a user
from one center cannot read another center's data (R2), which is only meaningful against
a real database. CI starts a MySQL service, migrates and seeds it before running them.
Unit tests — domain logic, i18n coverage, tenant scoping rules, toasts, navigation — run
without any database.
