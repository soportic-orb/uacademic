# Fase 0 — Propuesta para validación

Antes de generar el resto del código de la fase 0, esto es lo que propongo:
estructura de carpetas y esquema Prisma. El esquema completo está en
[`packages/db/prisma/schema.prisma`](../packages/db/prisma/schema.prisma) y ya pasa
`prisma validate`.

---

## 1. Estructura de carpetas

```
uacademic/
├── CLAUDE.md                        # reglas permanentes (ya creado)
├── README.md                        # arranque local
├── .env.example                     # documentado, sin secretos
├── package.json                     # scripts raíz (turbo-less: pnpm -r)
├── pnpm-workspace.yaml
├── .github/workflows/ci.yml         # lint · typecheck · test · build
│
├── tooling/
│   ├── tsconfig/                    # base.json, react.json, node.json
│   ├── eslint-config/               # base, react, node
│   └── prettier-config/
│
├── packages/
│   ├── shared/                      # sin DOM, sin Node → reutilizable en Expo (fase 2)
│   │   ├── src/
│   │   │   ├── domain/
│   │   │   │   ├── capacity/        # carga contratada vs asignada, reducciones, semáforo
│   │   │   │   ├── conflicts/       # solapamientos profesor · aula · grupo
│   │   │   │   ├── availability/    # nivel efectivo en un tramo, excepciones
│   │   │   │   ├── time/            # HH:MM ↔ minutos, intervalos, semana ISO
│   │   │   │   └── settings/        # esquema de centers.settings_json + defaults + procedencia
│   │   │   ├── schemas/             # Zod: entidades, DTOs de API, filtros
│   │   │   ├── types/               # tipos derivados de Zod (z.infer), enums de dominio
│   │   │   ├── i18n/                # claves canónicas, catálogos de enums (ca/es/en)
│   │   │   └── utils/
│   │   └── test/                    # Vitest — todo lo de domain/ tiene test
│   │
│   └── db/
│       ├── prisma/schema.prisma
│       ├── prisma/migrations/
│       ├── prisma.config.ts         # Prisma 7: la URL vive aquí, no en el schema
│       ├── src/client.ts            # PrismaClient + adapter MariaDB/MySQL
│       └── seed/                    # datos de demostración (1 universidad, 1 centro, …)
│
├── apps/
│   ├── api/
│   │   ├── src/
│   │   │   ├── main.ts              # arranque HTTP
│   │   │   ├── app.ts               # construcción de la instancia Fastify (testable)
│   │   │   ├── config/env.ts        # validación Zod de process.env
│   │   │   ├── plugins/
│   │   │   │   ├── auth.ts          # fase 0: simulada · fase 1: Entra ID (tid/iss/oid)
│   │   │   │   ├── tenant-scope.ts  # R2: inyecta centerId y bloquea consultas sin filtro
│   │   │   │   ├── audit.ts         # R4: escritura en audit_log
│   │   │   │   ├── errors.ts        # mapa error → código i18n + traceId
│   │   │   │   ├── logging.ts       # Pino, redacción de PII
│   │   │   │   └── realtime.ts      # abstracción SSE con fallback a polling
│   │   │   ├── modules/             # un directorio por dominio, siempre con la misma forma:
│   │   │   │   └── <dominio>/       #   routes.ts · service.ts · repository.ts · schemas.ts
│   │   │   ├── jobs/                # worker de polling sobre la tabla jobs + handlers
│   │   │   ├── lib/                 # crypto (AES-256-GCM), mailer, web-push, ical
│   │   │   └── i18n/                # traducciones de errores y emails (ca/es/en)
│   │   └── test/                    # integración (incluye el test de acceso cruzado)
│   │
│   └── web/
│       ├── src/
│       │   ├── main.tsx · app/      # router v7, providers (Query, i18n, theme, toast)
│       │   ├── components/
│       │   │   ├── ui/              # shadcn/ui adaptado al color corporativo
│       │   │   ├── layout/          # AppShell, Sidebar, BottomNav, Header, CommandK
│       │   │   ├── feedback/        # Toaster (superior-centro), Skeleton, Empty, ErrorState
│       │   │   └── data/            # LoadBadge (semáforo), HoursCell (tabular-nums)…
│       │   ├── features/<dominio>/  # páginas + hooks de datos por dominio
│       │   ├── hooks/               # useToast, useTheme, useCenter, useRole…
│       │   ├── stores/              # Zustand (solo estado de UI)
│       │   ├── lib/                 # api client, formateo Intl, permisos
│       │   ├── i18n/locales/{ca,es,en}/*.json
│       │   └── styles/              # tokens.css (escala primary + semánticos), tailwind
│       ├── e2e/                     # Playwright
│       └── test/                    # Vitest + Testing Library (incl. cobertura i18n)
│
└── docs/                            # este documento y decisiones de arquitectura
```

Notas:

- **Sin Turborepo**: `pnpm -r --parallel` basta para cuatro paquetes y evita una
  dependencia más en un servidor compartido.
- `packages/shared` es la única fuente de verdad de tipos: `apps/api` importa los Zod
  y `apps/web` importa los `z.infer` (R6).
- La forma repetida `routes / service / repository / schemas` en cada módulo de la API
  permite que el scoping multi-tenant se aplique en un solo sitio (el repositorio) y
  que el test de acceso cruzado sea genérico.

---

## 2. Esquema Prisma

40 modelos, 34 enums. Todas las tablas de tu modelo de datos están, más una añadida
(`entra_tenants`). Convenciones ya reflejadas en el CLAUDE.md:

| Decisión | Valor | Motivo |
| --- | --- | --- |
| PK | `CHAR(36)` UUIDv7 | Opaco hacia fuera, pero ordenado en el tiempo: InnoDB inserta al final del índice agrupado en lugar de fragmentar páginas como haría un UUIDv4 |
| Horas de reloj | `CHAR(5)` `"HH:MM"` | Comparables y ordenables en SQL, sin trampas de zona horaria; el dominio las pasa a minutos |
| `weekday` | `TINYINT` ISO (1 = lunes) | Coincide con "la semana empieza en lunes" |
| Horas de carga | `DECIMAL(6,2)` | Nunca float en algo que se compara contra un contrato |
| Nombres | Modelos PascalCase → tablas `snake_case` | El SQL queda idéntico a tu especificación |

### Índices críticos (los cuatro que pediste, más los derivados)

- `(center_id, academic_year_id)` en `subjects`, `teacher_profiles`, `assignments`,
  `schedule_versions`, `documents`, `center_settings_versions`.
- `(teacher_profile_id, weekday, start_time)` en `sessions` y en `availability`
  → detección de conflictos y de disponibilidad en la misma forma de índice.
- `(schedule_version_id, weekday)` en `sessions` → render del calendario.
- `FULLTEXT(content)` en `document_chunks` → búsqueda híbrida (léxica + embedding).
- `UNIQUE (connection_id, session_id)` en `calendar_event_map`.
- Extra: `(space_id, weekday, start_time)` en `sessions`, porque el conflicto de aula
  se detecta en el mismo paso que el de profesor.

---

## 3. Cambios que he introducido sobre tu modelo — necesito tu visto bueno

Son seis. Cada uno con su motivo; cualquiera es reversible ahora y caro después.

**D1 · Tabla nueva `entra_tenants`.**
La R3 dice "validar `tid` contra la lista de tenants dados de alta", y esa lista no
existía en el modelo: solo estaba `centers.entra_tenant_id`. Con una tabla propia el
SUPERADMIN da de alta un tenant una vez, con su `issuer` y su estado
(`active | suspended`), y varios centros pueden colgar del mismo tenant. `centers.entra_tenant_id`
sigue guardando el GUID de Microsoft y ahora es clave foránea contra ella: es
imposible tener un centro apuntando a un tenant no registrado.

**D2 · `teacher_id` → `teacher_profile_id` en `assignments`, `sessions` y `absences`
(también `substitute_id` → `substitute_profile_id`).**
La capacidad docente vive en `teacher_profiles`, que es por centro y por curso
académico. Si las asignaciones apuntaran a `users`, calcular "horas asignadas vs
contratadas" exigiría un join adivinando el perfil correcto, y nada impediría asignar
horas a alguien sin contrato en ese curso. Apuntando al perfil, la invariante la
sostiene la base de datos y el cálculo de carga es una agregación directa. El coste:
un sustituto tiene que tener perfil docente en ese centro y curso — que es justo lo
que queremos exigir.

**D3 · Nombres trilingües en `degrees`** (`name_ca/es/en`, como en `subjects`).
El nombre de una titulación es contenido de usuario y la R1 no admite excepciones.

**D4 · `push_subscriptions.endpoint_hash`** (SHA-256, `CHAR(64)`, único).
El `endpoint` de Web Push puede pasar de 255 caracteres, así que es `TEXT`, y MySQL no
indexa `TEXT` para unicidad. Sin el hash no hay forma de evitar suscripciones
duplicadas al re-registrar el service worker.

**D5 · `jobs.locked_at` y `jobs.locked_by`, más `max_attempts`.**
Con PM2 puede haber más de un proceso vivo. Sin columna de bloqueo, dos workers cogen
el mismo trabajo y se envía el email dos veces. El claim se hace con
`UPDATE … WHERE status='pending' AND locked_at IS NULL LIMIT 1`.

**D6 · Campos de conveniencia añadidos** sin cambiar la semántica de ninguna tabla:
`center_id` desnormalizado en las tablas hijas que solo llegaban al centro vía join
(`groups`, `teacher_skills`, `availability`, `messages`, `document_chunks`…) — es lo
que hace posible la R2 sin joins en cada consulta —; `created_at`/`updated_at` en las
tablas mutables; `status` en `teacher_reductions`; `endpoint`/`etag`/`sequence` ya
estaban. Y `sessions` se llama `ClassSession` en código (la tabla sigue siendo
`sessions`) para no chocar con las sesiones de autenticación.

---

## 4. Tres decisiones abiertas

**A · Prisma 7 y adaptador de driver.**
La versión actual es la 7.9.1 y cambia el arranque: la URL de conexión ya no va en el
`schema.prisma` sino en `prisma.config.ts`, y el cliente se construye con un adaptador
de driver (`@prisma/adapter-mariadb`, que es el que sirve para MySQL 8). Lo he dejado
así. La alternativa es fijar Prisma 6, que es el arranque clásico. Mi recomendación:
Prisma 7, porque el proyecto es nuevo y el binario del motor Rust desaparece — menos
peso en un servidor compartido.

**B · `settings_json` vs `center_settings_versions`.**
Ahora mismo `centers.settings_json` es el valor vigente y `center_settings_versions`
el histórico con su procedencia. ¿Lo dejamos así (lectura barata, escritura en dos
sitios) o hacemos que `centers.settings_json` sea siempre una vista de la última
versión aprobada? Propongo lo primero, con la escritura encapsulada en un único
servicio que actualiza las dos tablas en la misma transacción.

**C · Alcance del `center_id` en `users`.**
`users` es global: una persona con roles en dos centros es una sola fila, y los roles
viven en `user_center_roles`. Es la única forma de que funcione "un usuario puede tener
roles distintos en centros distintos", pero implica que un CENTER_ADMIN solo puede ver
usuarios con los que comparta centro — filtrado que se aplica en el repositorio, no en
la tabla. Lo mismo vale para `notification_prefs`, `push_subscriptions` y las tablas de
calendario, que van por `user_id`. Está anotado como excepción explícita en la cabecera
del schema.

---

## 5. Qué haría a continuación, una vez lo valides

En este orden, con la migración inicial y el seed al final para que ya nazcan contra el
esquema definitivo:

1. Monorepo, tsconfig compartido, ESLint + Prettier, CI.
2. `packages/shared`: tiempo, capacidad, conflictos, settings + Zod, con sus tests.
3. `packages/db`: migración inicial y seed (1 universidad, 1 centro, 1 curso,
   8 asignaturas, 12 docentes con contratos y disponibilidades realistas, 3 aulas).
4. API Fastify: env, errores, logging, healthcheck, auth simulada, scoping de tenant y
   el test de acceso cruzado.
5. Web: tokens CSS y Tailwind, tema claro/oscuro persistente, shadcn/ui, toasts
   superior-centro con `useToast`, layout con sidebar/bottom-nav y navegación por rol.
6. i18n en los tres idiomas + test de cobertura de claves.
7. README y `.env.example`.
