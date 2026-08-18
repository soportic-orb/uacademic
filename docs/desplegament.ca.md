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

**Si fas servir l'instal·lador web (punt 5), aquest fitxer l'escriu ell** i
aquest apartat és la referència del que hi haurà a dins.

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

## 5. Instal·lació des del navegador

La manera recomanada. Amb el codi construït i l'API en marxa, obre
**https://uacademic.cat/install** i segueix quatre passos: testimoni, base de
dades, centre i administrador.

**El testimoni.** Quan l'API arrenca sense configuració, no falla: entra en mode
instal·lació, escriu un testimoni d'un sol ús a `shared/install.token` i
l'imprimeix al log. Llegeix-lo per SSH:

```bash
cat /var/www/uacademic/shared/install.token
pm2 logs uacademic --lines 30      # també hi surt
```

Això és el que impedeix que qualsevol que trobi l'adreça instal·li la
plataforma: cal accés al servidor.

**Què fa l'instal·lador**, en aquest ordre i sense escriure res fins a l'últim
pas: prova la connexió amb MySQL i diu què hi ha trobat (joc de caràcters,
col·lació, si ja hi ha taules) · executa les migracions · crea la universitat,
el centre i el compte SUPERADMIN · escriu `shared/.env` amb mode 600, amb el
secret de sessió i la clau de xifratge **generats**, no escollits a mà.

**Què no fa**: crear la base de dades. Crea-la abans (punt 3): un instal·lador
web amb permisos per crear bases de dades és més permís del que necessita.

En acabar, reinicia perquè llegeixi la configuració nova:

```bash
pm2 restart uacademic
```

A partir d'aquí `/install` respon 410 per sempre. Per canviar la configuració
s'edita `shared/.env` i es reinicia; no hi ha reinstal·lació.

**Entrar per primera vegada.** Una instal·lació nova no té cap aplicació
d'Entra registrada, de manera que l'instal·lador escriu
`UACADEMIC_AUTH_MODE="local"` i el botó de Microsoft de la pantalla d'accés
queda desactivat. Entra amb el correu i la contrasenya que has donat a
l'instal·lador: és la credencial de rescat del superadministrador. Quan tinguis
Entra ID registrat (apartat 11), posa `UACADEMIC_AUTH_MODE="entra"` i
`UACADEMIC_ENTRA_CLIENT_ID`, reconstrueix l'aplicació web i reinicia; la
credencial es queda com la manera d'entrar el dia que Microsoft no respongui.

Si prefereixes fer-ho per línia d'ordres, hi ha l'equivalent:

```bash
UACADEMIC_BOOTSTRAP_UNIVERSITY="…" UACADEMIC_BOOTSTRAP_CENTER="…" \
UACADEMIC_BOOTSTRAP_CENTER_CODE="…" UACADEMIC_BOOTSTRAP_EMAIL="…" \
UACADEMIC_BOOTSTRAP_PASSWORD="…" pnpm --filter @uacademic/db bootstrap
```

---

## 6. Desplegar una versió a mà

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

## 7. Nginx

Copia `scripts/deploy/nginx.conf.example` a la configuració del vhost i ajusta
el nom del servidor. Els tres punts que no es poden ometre:

- `index.html`, `sw.js` i `manifest.webmanifest` **sense cache**. Un service
  worker en cache és com un navegador es queda encallat en la versió del mes
  passat.
- `/api/` amb `proxy_buffering off` i `proxy_read_timeout 3600s`: els
  esdeveniments en temps real i les respostes de l'assistent són streams.
- El bloc `location /shared/` que retorna 404.

---

## 8. La cua de feina

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

## 9. Còpies de seguretat

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

## 10. Actualitzacions

El superadministrador les llança des de **Plataforma**. El servidor descarrega
l'artefacte del repositori privat amb el PAT, **verifica la suma de
comprovació abans de desempaquetar res**, fa còpia de la base de dades,
migra, mou el symlink, recarrega i comprova la salut. Si la comprovació falla,
torna a la versió anterior sol. Tot queda a `app_versions`.

Per a això calen:

```
UACADEMIC_GITHUB_OTA_TOKEN=…      # PAT amb permís de lectura de releases
UACADEMIC_GITHUB_OTA_REPO=soportic-orb/uacademic
UACADEMIC_HEALTH_CHECK_URL=http://127.0.0.1:3001/health
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

## 11. Microsoft Entra ID

Registra l'aplicació com a **multi-tenant**. L'inici de sessió és un flux de
client públic (PKCE) i no necessita cap secret; el secret només fa falta per al
consentiment de calendari.

Cada organització de Microsoft del món passa la verificació de signatura del
punt final `/organizations`. Per això el servidor valida el `tid` contra la
llista de tenants registrats i respon 403 si no hi és. Dona d'alta cada tenant
des de **Administració → Tenants** abans que ningú hi entri.

---

## 12. Comprovacions després de desplegar

```bash
curl -fsS https://uacademic.exemple.edu/health
pm2 status
tail -f /var/www/uacademic/shared/logs/api.error.log
```

I des del navegador: entrar, veure l'horari propi, obrir el calendari sense
connexió (mode avió) i comprovar que la instal·lació a la pantalla d'inici
funciona a l'iPhone — sense això, els avisos push no arriben mai a iOS.
