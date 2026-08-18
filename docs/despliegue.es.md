# Manual de despliegue

Para quien instala y mantiene UAcademic en un servidor. Asume un hosting
compartido con Plesk o CloudPanel, Nginx, PM2 y MySQL 8 o MariaDB — que es el
entorno para el que está hecha la plataforma: sin Docker, sin Redis y sin
dependencias nativas.

---

## 1. Requisitos

| Componente | Versión               | Nota                                                          |
| ---------- | --------------------- | ------------------------------------------------------------- |
| Node       | 22.x                  | El panel de Plesk puede instalarlo por aplicación             |
| pnpm       | 10.x                  | `corepack enable && corepack prepare pnpm@10.33.0 --activate` |
| MySQL      | 8.0+ o MariaDB 10.11+ | `utf8mb4_unicode_ci`, InnoDB                                  |
| PM2        | 5.x                   | Si el alojamiento no permite demonios, mira el punto 7        |
| mysqldump  | el del servidor       | Las copias de seguridad lo invocan                            |

La aplicación no necesita Docker, ni Python, ni ninguna biblioteca de imagen.

---

## 2. Estructura de directorios

```
/var/www/uacademic
├── current -> releases/2026.08.18-1    el symlink al que apuntan Nginx y PM2
├── releases/                           una carpeta por versión
├── shared/
│   ├── .env                            configuración, permisos 600
│   ├── uploads/                        documentos y adjuntos, FUERA del webroot
│   └── logs/
└── backups/                            salida de mysqldump
```

Prepárala una sola vez:

```bash
./scripts/deploy/bootstrap.sh /var/www/uacademic
```

Los ficheros subidos nunca los sirve el servidor web: solo la API, después de
comprobar el rol y el centro. Por eso `uploads/` vive fuera del webroot y el
bloque `location /shared/` de la configuración de Nginx devuelve 404.

**En un panel sin root (CloudPanel).** El usuario del sitio es propietario de
`/home/<usuario>/htdocs/<dominio>` y de nada por encima, así que la estructura
se traslada allí y las herramientas se instalan en el prefijo del propio
usuario — `corepack`, `apt` y `pm2 startup` son de root:

```bash
cd /home/uacademic/htdocs/uacademic.cat
mkdir -p shared/logs shared/uploads backups
pnpm add -g pm2
echo 'export UACADEMIC_DEPLOY_ROOT=/home/uacademic/htdocs/uacademic.cat' >> ~/.profile
```

Esa variable es la que hace que la API encuentre `shared/.env`, y PM2 la lee al
arrancar los procesos — ponla también en la sesión actual, no solo en
`~/.profile`. Sin enlace `current`, PM2 ejecuta el checkout donde encuentra
`ecosystem.config.cjs`, de modo que un clon normal ya funciona.

Y ahora lo que más importa: pon la **raíz del sitio** en `repo/apps/web/dist`.
Lo único que debe ser accesible desde la web es la SPA construida — con la raíz
un nivel más arriba, `https://uacademic.cat/shared/.env` serviría la contraseña
de la base de datos y la clave de cifrado.

`pm2 startup` necesita root. Sin él, sobrevive a un reinicio con el crontab del
propio usuario:

```bash
pm2 save
(crontab -l 2>/dev/null; echo "@reboot $(command -v pm2) resurrect") | crontab -
```

---

## 3. Base de datos

```sql
CREATE DATABASE uacademic CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'uacademic'@'localhost' IDENTIFIED BY '…';
GRANT ALL PRIVILEGES ON uacademic.* TO 'uacademic'@'localhost';
```

El usuario necesita `ALTER` y `CREATE`: las migraciones se ejecutan con esta
cuenta en cada despliegue.

---

## 4. Configuración

**Si usas el instalador web (punto 5), este fichero lo escribe él** y este
apartado es la referencia de lo que habrá dentro.

Todas las variables llevan el prefijo `UACADEMIC_`. No es decorativo: en un
servidor compartido, un `SMTP_HOST` del vecino se tomaría en silencio y el
correo saldría por su servidor. La aplicación solo lee las suyas.

`shared/.env`, modo 600. Las imprescindibles:

```
NODE_ENV=production
UACADEMIC_DATABASE_URL=mysql://uacademic:…@127.0.0.1:3306/uacademic
UACADEMIC_SESSION_COOKIE_SECRET=…            # 32 caracteres como mínimo
UACADEMIC_APP_ENCRYPTION_KEY=…               # 32 bytes en hexadecimal (64 caracteres)
UACADEMIC_WEB_ORIGIN=https://uacademic.ejemplo.edu
UACADEMIC_API_PUBLIC_URL=https://uacademic.ejemplo.edu
UACADEMIC_APP_URL=https://uacademic.ejemplo.edu
UACADEMIC_UPLOAD_DIR=/var/www/uacademic/shared/uploads
UACADEMIC_BACKUP_DIR=/var/www/uacademic/backups
UACADEMIC_DEPLOY_ROOT=/var/www/uacademic
```

Genera la clave de cifrado con `openssl rand -hex 32`. Si la cambias, los
tokens de calendario guardados dejan de poder descifrarse y cada usuario tendrá
que volver a conectar su calendario.

El resto de variables — Entra ID, Google, SMTP, push, asistente, embeddings —
están documentadas en `.env.example`, con lo que implica dejarlas vacías.

---

## 5. Instalación desde el navegador

La manera recomendada. Con el código construido y la API en marcha, abre
**https://uacademic.cat/install** y sigue cuatro pasos: token, base de datos,
centro y administrador.

**El token.** Cuando la API arranca sin configuración, no falla: entra en modo
instalación, escribe un token de un solo uso en `shared/install.token` y lo
imprime en el log. Léelo por SSH:

```bash
cat /var/www/uacademic/shared/install.token
pm2 logs uacademic --lines 30      # también aparece ahí
```

Eso es lo que impide que cualquiera que encuentre la dirección instale la
plataforma: hace falta acceso al servidor.

**Qué hace el instalador**, en este orden y sin escribir nada hasta el último
paso: prueba la conexión con MySQL y dice qué ha encontrado (juego de
caracteres, colación, si ya hay tablas) · ejecuta las migraciones · crea la
universidad, el centro y la cuenta SUPERADMIN · escribe `shared/.env` con modo
600, con el secreto de sesión y la clave de cifrado **generados**, no elegidos
a mano.

**Qué no hace**: crear la base de datos. Créala antes (punto 3): un instalador
web con permisos para crear bases de datos es más permiso del que necesita.

Al terminar, reinicia para que lea la configuración nueva:

```bash
pm2 restart uacademic
```

A partir de ahí `/install` responde 410 para siempre. Para cambiar la
configuración se edita `shared/.env` y se reinicia; no hay reinstalación.

**Entrar por primera vez.** Una instalación nueva no tiene ninguna aplicación
de Entra registrada, así que el instalador escribe
`UACADEMIC_AUTH_MODE="local"` y el botón de Microsoft de la pantalla de acceso
queda desactivado. Entra con el correo y la contraseña que le has dado al
instalador: es la credencial de rescate del superadministrador. Cuando tengas
Entra ID registrado (apartado 11), pon `UACADEMIC_AUTH_MODE="entra"` y
`UACADEMIC_ENTRA_CLIENT_ID`, reconstruye la aplicación web y reinicia; la
credencial se queda como la forma de entrar el día que Microsoft no responda.

Si prefieres hacerlo por línea de comandos, existe el equivalente:

```bash
UACADEMIC_BOOTSTRAP_UNIVERSITY="…" UACADEMIC_BOOTSTRAP_CENTER="…" \
UACADEMIC_BOOTSTRAP_CENTER_CODE="…" UACADEMIC_BOOTSTRAP_EMAIL="…" \
UACADEMIC_BOOTSTRAP_PASSWORD="…" pnpm --filter @uacademic/db bootstrap
```

---

## 6. Desplegar una versión a mano

```bash
scripts/deploy/release.sh 2026.08.18-1 /tmp/uacademic-2026.08.18-1.tar.gz <sha256>
```

El script hace, en este orden: verifica la suma de comprobación, hace copia de
seguridad de la base de datos, desempaqueta en `releases/<versión>`, enlaza el
estado compartido, ejecuta las migraciones, mueve el symlink `current`,
recarga PM2 y comprueba la salud. Si la comprobación falla, devuelve el symlink
a donde estaba.

Después, la primera vez:

```bash
pnpm --filter @uacademic/db exec prisma migrate deploy   # ya lo hace el script
pm2 start /var/www/uacademic/current/ecosystem.config.cjs
pm2 save && pm2 startup
```

---

## 7. Nginx

Hay dos formas, y las dos funcionan.

**Nginx sirve la SPA y hace de proxy de `/api/`** — la estructura de
`scripts/deploy/nginx.conf.example`, y la preferible: los ficheros estáticos
los sirve quien sabe hacerlo bien.

**El panel hace de proxy de todas las rutas hacia el puerto de la aplicación**,
que es lo que producen los tipos de sitio Node.js de CloudPanel y de Plesk.
Entonces la API sirve ella misma la SPA construida, desde `apps/web/dist`:
`/install` y todas las pantallas siguientes funcionan sin configurar ningún
estático. No hay nada que hacer — si la aplicación web está construida, se
sirve. (`UACADEMIC_WEB_DIST` cambia dónde se busca.) A cambio, el bundle lo
sirve Node, así que cuando la plataforma esté en marcha conviene más la primera
forma.

Para la primera forma, copia `scripts/deploy/nginx.conf.example` a la
configuración del vhost y ajusta el nombre del servidor. Los tres puntos que no
se pueden omitir:

- `index.html`, `sw.js` y `manifest.webmanifest` **sin caché**. Un service
  worker en caché es cómo un navegador se queda atascado en la versión del mes
  pasado.
- `/api/` con `proxy_buffering off` y `proxy_read_timeout 3600s`: los eventos
  en tiempo real y las respuestas del asistente son streams.
- El bloque `location /shared/` que devuelve 404.

---

## 8. La cola de trabajo

Hay dos maneras, y son intercambiables porque un trabajo se reclama con un
`UPDATE` condicional, no con un bloqueo en memoria:

**PM2 (recomendado).** `ecosystem.config.cjs` ya arranca el proceso
`uacademic-worker`.

**Cron cada minuto**, si el alojamiento no permite demonios:

```cron
* * * * * /usr/bin/flock -n /tmp/uacademic-jobs.lock \
    node /var/www/uacademic/current/apps/api/dist/jobs/tick.js
```

`flock` evita que una tanda lenta sea adelantada por la del minuto siguiente.

---

## 9. Copias de seguridad

El trabajo `db.backup` se ejecuta cada día y escribe en
`UACADEMIC_BACKUP_DIR`. La retención es `UACADEMIC_BACKUP_RETENTION_DAYS` (14
por defecto); cero significa conservarlo todo, que es una decisión, no un
descuido.

Restaurar:

```bash
gunzip -c backups/uacademic-2026-08-18_03-00-00.sql.gz | mysql -u uacademic -p uacademic
```

Prueba una restauración de verdad al menos una vez por curso. Una copia que
nadie ha intentado restaurar no es una copia.

---

## 10. Actualizaciones

El superadministrador las lanza desde **Plataforma**. El servidor descarga el
artefacto del repositorio privado con el PAT, **verifica la suma de
comprobación antes de desempaquetar nada**, copia la base de datos, migra,
mueve el symlink, recarga y comprueba la salud. Si la comprobación falla,
vuelve solo a la versión anterior. Todo queda en `app_versions`.

Para eso hacen falta:

```
UACADEMIC_GITHUB_OTA_TOKEN=…      # PAT con permiso de lectura de releases
UACADEMIC_GITHUB_OTA_REPO=soportic-orb/uacademic
UACADEMIC_HEALTH_CHECK_URL=http://127.0.0.1:3001/health
UACADEMIC_PM2_APP_NAME=uacademic
```

**Regla de migraciones.** Dentro de una misma versión, las migraciones deben
ser compatibles hacia atrás: añadir columna → rellenarla → usarla. Nunca
borrar en el mismo despliegue. Entre la migración y la recarga, el código
antiguo sigue sirviendo peticiones contra el esquema nuevo — y después de un
rollback, vuelve a hacerlo.

**Para el profesorado no pasa nada.** El service worker detecta la versión
nueva y **no** fuerza ninguna recarga: la guarda y la aplica en el siguiente
arranque de la aplicación. Quien esté escribiendo un mensaje no pierde nada.

---

## 11. Microsoft Entra ID

Registra la aplicación como **multi-tenant**. El inicio de sesión es un flujo
de cliente público (PKCE) y no necesita ningún secreto; el secreto solo hace
falta para el consentimiento de calendario.

Cada organización de Microsoft del mundo pasa la verificación de firma del
endpoint `/organizations`. Por eso el servidor valida el `tid` contra la lista
de tenants registrados y responde 403 si no está. Da de alta cada tenant desde
**Administración → Tenants** antes de que nadie entre.

---

## 12. Cuando el navegador dice 502

Nginx está en marcha y detrás no responde nadie. Casi siempre es una de estas
tres cosas, en este orden:

```bash
pm2 status                          # ¿la API está en marcha?
pm2 logs uacademic --lines 50       # si se reinicia en bucle, por qué
curl -fsS http://127.0.0.1:3001/health
ss -ltnp | grep 3001                # quién escucha, si es que hay alguien
```

**`pm2 status` vacío o en `errored`.** Los procesos no se han arrancado nunca, o
han muerto. Arráncalos desde la raíz del repositorio:

```bash
cd /var/www/uacademic/current
pm2 start ecosystem.config.cjs && pm2 save
```

**`/health` responde y el navegador sigue dando 502.** Nginx está haciendo
`proxy_pass` a otro sitio. Comprueba que el puerto que aparece ahí es el mismo
en el que escucha la API (3001, salvo que `UACADEMIC_PORT` diga otra cosa): en
CloudPanel es el puerto del proxy inverso del sitio; en Plesk, las «Additional
nginx directives».

**`/health` responde `{"status":"setup"}`.** Eso es correcto antes de instalar:
la API está en modo instalación, esperando al asistente. Si entonces `/install`
responde 404, no hay nadie sirviendo la página — comprueba que existe
`apps/web/dist`, es decir que `pnpm build` ha terminado.

Una API que muere al arrancar escribe el motivo en
`shared/logs/api.error.log`, en una línea, diciendo qué variable o qué fichero
falta.

---

## 13. Comprobaciones después de desplegar

```bash
curl -fsS https://uacademic.ejemplo.edu/health
pm2 status
tail -f /var/www/uacademic/shared/logs/api.error.log
```

Y desde el navegador: entrar, ver el horario propio, abrir el calendario sin
conexión (modo avión) y comprobar que la instalación en la pantalla de inicio
funciona en el iPhone — sin eso, los avisos push no llegan nunca en iOS.
