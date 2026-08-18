# Manual de desplegament

Per a qui instal·la i manté UAcademic en un servidor. Assumeix un hosting
compartit amb Plesk o CloudPanel, Nginx, PM2 i MySQL 8 o MariaDB — que és
l'entorn per al qual està feta la plataforma: sense Docker, sense Redis i sense
dependències natives.

---

## 1. Requisits

| Component | Versió                | Nota                                                          |
| --------- | --------------------- | ------------------------------------------------------------- |
| Node      | 22.x                  | El panell de Plesk el pot instal·lar per aplicació            |
| pnpm      | 10.x                  | `corepack enable && corepack prepare pnpm@10.33.0 --activate` |
| MySQL     | 8.0+ o MariaDB 10.11+ | `utf8mb4_unicode_ci`, InnoDB                                  |
| PM2       | 5.x                   | Si l'allotjament no permet dimonis, mira el punt 7            |
| mysqldump | el del servidor       | Les còpies de seguretat el criden                             |

L'aplicació no necessita ni Docker, ni Python, ni cap biblioteca d'imatge.

---

## 2. Estructura de directoris

```
/var/www/uacademic
├── current -> releases/2026.08.18-1    el symlink que apunten Nginx i PM2
├── releases/                           una carpeta per versió
├── shared/
│   ├── .env                            configuració, permisos 600
│   ├── uploads/                        documents i adjunts, FORA del webroot
│   └── logs/
└── backups/                            sortida de mysqldump
```

Prepara-la una sola vegada:

```bash
./scripts/deploy/bootstrap.sh /var/www/uacademic
```

Els fitxers pujats no són mai servits pel servidor web: només per l'API,
després de comprovar el rol i el centre. Per això `uploads/` viu fora del
webroot i el bloc `location /shared/` de la configuració d'Nginx retorna 404.

---

## 3. Base de dades

```sql
CREATE DATABASE uacademic CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'uacademic'@'localhost' IDENTIFIED BY '…';
GRANT ALL PRIVILEGES ON uacademic.* TO 'uacademic'@'localhost';
```

L'usuari necessita `ALTER` i `CREATE`: les migracions s'executen amb aquest
compte a cada desplegament.

---

## 4. Configuració

Totes les variables porten el prefix `UACADEMIC_`. No és decoratiu: en un
servidor compartit, un `SMTP_HOST` del veí s'agafaria en silenci i el correu
sortiria pel seu servidor. L'aplicació només llegeix les seves.

`shared/.env`, mode 600. Les imprescindibles:

```
NODE_ENV=production
UACADEMIC_DATABASE_URL=mysql://uacademic:…@127.0.0.1:3306/uacademic
UACADEMIC_SESSION_COOKIE_SECRET=…            # 32 caràcters com a mínim
UACADEMIC_APP_ENCRYPTION_KEY=…               # 32 bytes en hexadecimal (64 caràcters)
UACADEMIC_WEB_ORIGIN=https://uacademic.exemple.edu
UACADEMIC_API_PUBLIC_URL=https://uacademic.exemple.edu
UACADEMIC_APP_URL=https://uacademic.exemple.edu
UACADEMIC_UPLOAD_DIR=/var/www/uacademic/shared/uploads
UACADEMIC_BACKUP_DIR=/var/www/uacademic/backups
UACADEMIC_DEPLOY_ROOT=/var/www/uacademic
```

Genera la clau de xifratge amb `openssl rand -hex 32`. Si la canvies, els
testimonis de calendari desats deixen de ser desxifrables i cada usuari haurà
de tornar a connectar el seu calendari.

La resta de variables — Entra ID, Google, SMTP, push, assistent, embeddings —
estan documentades a `.env.example`, amb el que implica deixar-les buides.

---

## 5. Primer desplegament

```bash
scripts/deploy/release.sh 2026.08.18-1 /tmp/uacademic-2026.08.18-1.tar.gz <sha256>
```

L'script fa, en aquest ordre: verifica la suma de comprovació, fa còpia de
seguretat de la base de dades, desempaqueta a `releases/<versió>`, enllaça
l'estat compartit, executa les migracions, mou el symlink `current`, recarrega
PM2 i comprova la salut. Si la comprovació falla, torna el symlink on era.

Després, la primera vegada:

```bash
pnpm --filter @uacademic/db exec prisma migrate deploy   # ja ho fa l'script
pm2 start /var/www/uacademic/current/ecosystem.config.cjs
pm2 save && pm2 startup
```

---

## 6. Nginx

Copia `scripts/deploy/nginx.conf.example` a la configuració del vhost i ajusta
el nom del servidor. Els tres punts que no es poden ometre:

- `index.html`, `sw.js` i `manifest.webmanifest` **sense cache**. Un service
  worker en cache és com un navegador es queda encallat en la versió del mes
  passat.
- `/api/` amb `proxy_buffering off` i `proxy_read_timeout 3600s`: els
  esdeveniments en temps real i les respostes de l'assistent són streams.
- El bloc `location /shared/` que retorna 404.

---

## 7. La cua de feina

Hi ha dues maneres, i són intercanviables perquè una feina es reclama amb un
`UPDATE` condicional, no amb un bloqueig en memòria:

**PM2 (recomanat).** `ecosystem.config.cjs` ja arrenca el procés
`uacademic-worker`.

**Cron cada minut**, si l'allotjament no permet dimonis:

```cron
* * * * * /usr/bin/flock -n /tmp/uacademic-jobs.lock \
    node /var/www/uacademic/current/apps/api/dist/jobs/tick.js
```

`flock` evita que una tanda lenta sigui avançada per la del minut següent.

---

## 8. Còpies de seguretat

La feina `db.backup` s'executa cada dia i escriu a `UACADEMIC_BACKUP_DIR`. La
retenció és `UACADEMIC_BACKUP_RETENTION_DAYS` (14 per defecte); zero vol dir
conservar-ho tot, que és una decisió, no un descuit.

Restaurar:

```bash
gunzip -c backups/uacademic-2026-08-18_03-00-00.sql.gz | mysql -u uacademic -p uacademic
```

Comprova una restauració de veritat almenys un cop per curs. Una còpia que
ningú ha provat a restaurar no és una còpia.

---

## 9. Actualitzacions

El superadministrador les llança des de **Plataforma**. El servidor descarrega
l'artefacte del repositori privat amb el PAT, **verifica la suma de
comprovació abans de desempaquetar res**, fa còpia de la base de dades,
migra, mou el symlink, recarrega i comprova la salut. Si la comprovació falla,
torna a la versió anterior sol. Tot queda a `app_versions`.

Per a això calen:

```
UACADEMIC_GITHUB_OTA_TOKEN=…      # PAT amb permís de lectura de releases
UACADEMIC_GITHUB_OTA_REPO=soportic-orb/uacademic
UACADEMIC_HEALTH_CHECK_URL=http://127.0.0.1:3001/api/v1/health
UACADEMIC_PM2_APP_NAME=uacademic
```

**Regla de migracions.** Dins d'una mateixa versió, les migracions han de ser
compatibles cap enrere: afegir columna → omplir-la → fer-la servir. Mai
esborrar en el mateix desplegament. Entre la migració i la recàrrega, el codi
antic encara està servint peticions contra l'esquema nou — i després d'un
rollback, hi torna.

**Per al professorat no passa res.** El service worker detecta la versió nova
i **no** força cap recàrrega: la guarda i l'aplica al següent arrencament de
l'aplicació. Qui estigui escrivint un missatge no perd res.

---

## 10. Microsoft Entra ID

Registra l'aplicació com a **multi-tenant**. L'inici de sessió és un flux de
client públic (PKCE) i no necessita cap secret; el secret només fa falta per al
consentiment de calendari.

Cada organització de Microsoft del món passa la verificació de signatura del
punt final `/organizations`. Per això el servidor valida el `tid` contra la
llista de tenants registrats i respon 403 si no hi és. Dona d'alta cada tenant
des de **Administració → Tenants** abans que ningú hi entri.

---

## 11. Comprovacions després de desplegar

```bash
curl -fsS https://uacademic.exemple.edu/api/v1/health
pm2 status
tail -f /var/www/uacademic/shared/logs/api.error.log
```

I des del navegador: entrar, veure l'horari propi, obrir el calendari sense
connexió (mode avió) i comprovar que la instal·lació a la pantalla d'inici
funciona a l'iPhone — sense això, els avisos push no arriben mai a iOS.
