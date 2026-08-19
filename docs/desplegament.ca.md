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

**En un panell sense root (CloudPanel).** L'usuari del lloc és propietari de
`/home/<usuari>/htdocs/<domini>` i de res per sobre, així que l'estructura es
mou allà i les eines s'instal·len al prefix del mateix usuari — `corepack`,
`apt` i `pm2 startup` són de root:

```bash
cd /home/uacademic/htdocs/uacademic.cat
mkdir -p shared/logs shared/uploads backups
pnpm add -g pm2
echo 'export UACADEMIC_DEPLOY_ROOT=/home/uacademic/htdocs/uacademic.cat' >> ~/.profile
```

Aquesta variable és la que fa que l'API trobi `shared/.env`, i PM2 la llegeix
quan arrenca els processos — posa-la també a la sessió actual, no només a
`~/.profile`. Sense enllaç `current`, PM2 executa el checkout on troba
`ecosystem.config.cjs`, de manera que un clon normal ja funciona.

I ara el que més importa: posa l'**arrel del lloc** a `repo/apps/web/dist`.
L'única cosa que ha de ser accessible des del web és la SPA construïda — amb
l'arrel un nivell més amunt, `https://uacademic.cat/shared/.env` serviria la
contrasenya de la base de dades i la clau de xifratge.

`pm2 startup` necessita root. Sense root, sobreviu a un reinici amb el crontab
del mateix usuari:

```bash
pm2 save
(crontab -l 2>/dev/null; echo "@reboot $(command -v pm2) resurrect") | crontab -
```

---

## 3. Base de dades

```sql
CREATE DATABASE uacademic CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'uacademic'@'localhost' IDENTIFIED BY '…';
GRANT ALL PRIVILEGES ON uacademic.* TO 'uacademic'@'localhost';
```

L'usuari necessita `ALTER` i `CREATE`: les migracions s'executen amb aquest
compte a cada desplegament.

**Obrir-la més endavant.** El compte de sistema amb què entres per SSH no és el
compte de la base de dades, així que un `mysql` pelat es rebutja. Fes servir la
configuració que l'aplicació ja té:

```bash
scripts/deploy/db.sh                             # una sessió
scripts/deploy/db.sh "SELECT status, error_key, error_detail FROM documents"
```

La contrasenya viatja per `MYSQL_PWD`, de manera que no arriba ni a la llista de
processos ni a l'historial del teu intèrpret d'ordres.

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
UACADEMIC_TIMEZONE=Europe/Madrid
```

`UACADEMIC_TIMEZONE` és el rellotge amb què s'executen l'API i el treballador,
aplicat en arrencar: un servidor compartit sol anar en UTC, i una tasca que vol
dir les 07:00 s'executaria una o dues hores abans mig any. Les pantalles mostren
la zona pròpia de cada centre, que és una columna del centre, no aquest valor.

`UACADEMIC_UPLOAD_DIR` conté els documents, els adjunts dels missatges, les
fotografies de perfil i els logotips de les universitats. La còpia de seguretat
nocturna només cobreix la base de dades, així que aquest directori ha d'entrar
en el que faci la còpia dels fitxers.

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
Entra ID registrat (apartat 11), posa `UACADEMIC_ENTRA_CLIENT_ID` i reinicia:
només amb això el botó s'activa, perquè el navegador pregunta a l'API amb quina
aplicació s'ha d'entrar i no cal reconstruir res. La credencial es queda com la
manera d'entrar el dia que Microsoft no respongui.

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

**Desplegar des d'un checkout**, que és com sol anar una primera instal·lació,
són tres ordres i la del mig no és opcional:

```bash
git pull
pnpm install --frozen-lockfile    # un pull pot portar una dependència nova
pnpm build
pm2 restart uacademic --update-env
```

Saltar-se la instal·lació fa fallar la construcció, no l'arrencada:
`noEmitOnError` està posat, així que una construcció que no compila deixa
l'anterior funcionant.

---

## 7. Nginx

Hi ha dues formes, i totes dues funcionen.

**Nginx serveix la SPA i fa de proxy de `/api/`** — l'estructura de
`scripts/deploy/nginx.conf.example`, i la preferible: els fitxers estàtics els
serveix qui sap fer-ho bé.

**El panell fa de proxy de tots els camins cap al port de l'aplicació**, que és
el que produeixen els tipus de lloc Node.js de CloudPanel i de Plesk. Aleshores
l'API serveix ella mateixa la SPA construïda, des d'`apps/web/dist`: `/install`
i totes les pantalles següents funcionen sense cap configuració d'estàtics. No
cal fer res — si l'aplicació web està construïda, se serveix.
(`UACADEMIC_WEB_DIST` canvia on es busca.) A canvi, el bundle el serveix Node,
així que quan la plataforma ja estigui en marxa val més la primera forma.

Per a la primera forma, copia `scripts/deploy/nginx.conf.example` a la
configuració del vhost i ajusta el nom del servidor. Els tres punts que no es
poden ometre:

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

Per a això calen, a `shared/.env`:

```
UACADEMIC_GITHUB_OTA_TOKEN=…      # PAT amb permís de lectura de releases
UACADEMIC_GITHUB_OTA_REPO=soportic-orb/uacademic
UACADEMIC_DEPLOY_ROOT=/var/www/uacademic
UACADEMIC_HEALTH_CHECK_URL=http://127.0.0.1:3001/health
UACADEMIC_PM2_APP_NAME=uacademic
```

El testimoni és un token d'accés personal **de gra fi** sobre el repositori, amb
`Contents: Read-only` i res més. Llegeix les releases; no escriu mai. Viu al
servidor, mai al repositori (R10) i mai al navegador: el panell pregunta a
l'API, i el testimoni el té l'API.

**Dues condicions que el panell no et pot crear.**

Hi ha d'haver alguna release: el workflow en publica una a cada push a `main`
que passi lint, tipus i tests, així que una branca no fusionada no genera res
per instal·lar. `Actions → Release → Run workflow` en talla una a mà.

I la instal·lació ha de tenir l'estructura de l'apartat 2 — `releases/`,
`current`, `shared/` — perquè una actualització desempaqueta a
`releases/<versió>` i mou `current`. Instal·lar des d'un clon normal funciona i
és la manera habitual de començar, però el botó d'actualitzar no té on deixar la
release. Fes el canvi una vegada, abans d'activar les actualitzacions:

```bash
cd /var/www/uacademic/repo                  # el teu checkout
pnpm build                                  # la promoció copia una construcció, no codi font
scripts/deploy/promote.sh
```

Copia la construcció al costat del checkout com a `releases/<versió>`, mou la
configuració a `shared/.env` si encara era dins del checkout, instal·la des del
lockfile, mou `current`, reinicia PM2 des d'allà i comprova la salut. Es nega
abans que quedar a mitges, i el checkout no es toca: continua sent on fas
`git pull`.

No copiïs el checkout a mà. `cp -a` s'emporta també `.git`, i els seus
directoris d'objectes són de només lectura: els crea sense permís d'escriptura i
després no hi pot escriure els objectes, i falla a mitges amb centenars de
«Permission denied».

A partir d'aquí PM2 segueix `current`, i cada actualització el mou.

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

**URI de redirecció.** A _Autenticació_, afegeix una plataforma de tipus
**Aplicació d'una sola pàgina** — no _Web_: un registre de tipus Web rebutja la
petició de testimoni del navegador amb `AADSTS9002326` — i dona d'alta dues
adreces:

```
https://uacademic.cat/auth-callback.html   entrada
https://uacademic.cat/                     sortida
```

La primera és una pàgina buida que només existeix per rebre la resposta de
Microsoft. No és l'aplicació, i és volgut: enviar la finestra emergent a l'arrel
del lloc hi carrega tota l'aplicació a dins, cosa que és una finestra en blanc
mentre dura i, si hi ha una versió nova esperant, una recàrrega que llença la
resposta i deixa la finestra en blanc per sempre.

Fes servir exactament l'amfitrió que escriu la gent. Per a Entra,
`https://www.uacademic.cat` i `https://uacademic.cat` són dos registres
diferents, i el que falti falla amb `AADSTS50011`.

**L'àmbit de l'API.** A _Exposa una API_, accepta l'URI d'identificador
d'aplicació que et proposa (`api://<client-id>`) i afegeix un àmbit anomenat
**`access_as_user`**, consentible per administradors i usuaris. És l'àmbit que
demana el navegador, i el testimoni que en surt és el que verifica el servidor;
sense això l'entrada s'atura amb `AADSTS65005`.

**Instal·lar-la a cada universitat.** L'aplicació viu al tenant on es va
registrar. Qualsevol altra organització l'ha d'instal·lar una vegada, i fins
que no ho fa, Microsoft hi rebutja tothom amb:

```
AADSTS500011: The resource principal named api://<client-id> was not found in
the tenant named <universitat>.
```

No hi ha cap pantalla de consentiment per acceptar — el recurs no existeix en
aquell tenant per poder-hi demanar res —, o sigui que algú que pugui
administrar _aquell_ directori ha d'obrir una vegada l'enllaç de
consentiment:

```
https://login.microsoftonline.com/<tenant>/adminconsent?client_id=<client-id>&redirect_uri=https://uacademic.cat/auth-callback.html
```

**Administració → Tenants** mostra aquest enllaç a cada fila, construït amb la
configuració de la mateixa instal·lació; envia'l al servei informàtic de la
universitat. Un cop l'accepten, tothom d'aquell tenant ja hi pot entrar.

**Tenants.** Cada organització de Microsoft del món passa la verificació de
signatura del punt final `/organizations`. Per això el servidor valida el `tid`
contra la llista de tenants registrats i respon 403 si no hi és. Dona d'alta
cada tenant des de **Administració → Tenants** abans que ningú hi entri: això, i
`centers.entra_tenant_id`, és com una única pantalla d'entrada sense cap
selector d'organització sap igualment a quin centre pertany cadascú — el tenant
arriba dins del testimoni, no de res que la persona hagi escrit.

---

## 12. Quan el navegador diu 502

Nginx està en marxa i darrere no respon ningú. Gairebé sempre és una d'aquestes
tres coses, en aquest ordre:

```bash
pm2 status                          # l'API està en marxa?
pm2 logs uacademic --lines 50       # si es reinicia en bucle, per què
curl -fsS http://127.0.0.1:3001/health
ss -ltnp | grep 3001                # qui escolta, si és que hi ha algú
```

**`pm2 status` buit o en `errored`.** Els processos no s'han arrencat mai, o han
mort. Arrenca'ls des de l'arrel del repositori:

```bash
cd /var/www/uacademic/current
pm2 start ecosystem.config.cjs && pm2 save
```

**`/health` respon i el navegador continua donant 502.** Nginx està fent
`proxy_pass` cap a un altre lloc. Comprova que el port que hi diu és el mateix
on escolta l'API (3001, tret que `UACADEMIC_PORT` digui una altra cosa): a
CloudPanel és el port del proxy invers del lloc; a Plesk, les «Additional nginx
directives».

**`/health` respon `{"status":"setup"}`.** Això és correcte abans d'instal·lar:
l'API és en mode instal·lació, esperant l'assistent. Si aleshores `/install`
respon 404, no hi ha ningú servint la pàgina — comprova que existeix
`apps/web/dist`, és a dir que `pnpm build` ha acabat.

Una API que mor en arrencar escriu el motiu a `shared/logs/api.error.log`, en
una línia, dient quina variable o quin fitxer falta.

---

## 13. Comprovacions després de desplegar

```bash
curl -fsS https://uacademic.exemple.edu/health
pm2 status
tail -f /var/www/uacademic/shared/logs/api.error.log
```

I des del navegador: entrar, veure l'horari propi, obrir el calendari sense
connexió (mode avió) i comprovar que la instal·lació a la pantalla d'inici
funciona a l'iPhone — sense això, els avisos push no arriben mai a iOS.
