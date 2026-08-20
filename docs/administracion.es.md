# Manual del administrador

Para quien administra un centro en UAcademic. El trabajo del curso, en el orden
en que se hace.

---

## 1. Qué hace cada rol

| Rol            | Alcance            | Qué puede hacer                                                                      |
| -------------- | ------------------ | ------------------------------------------------------------------------------------ |
| `SUPERADMIN`   | Toda la plataforma | Universidades, centros, tenants de Microsoft, coordinadores, actualizaciones         |
| `CENTER_ADMIN` | Un centro          | Asignaturas, titulaciones, espacios, usuarios, calendario, importaciones, parámetros |
| `COORDINATOR`  | Sus asignaturas    | Asigna profesorado, planifica, aprueba cambios, asistente de IA                      |
| `TEACHER`      | Sí mismo           | Sus clases, su carga, propone cambios, chat, perfil, disponibilidad                  |

Una misma persona puede tener roles distintos en centros distintos. Los roles
se resuelven siempre desde la base de datos, nunca desde el token de inicio de
sesión.

---

## 1b. Dar de alta a las personas

Administración → Usuarios. Crear un usuario solo pide el nombre, el correo y el
rol en el centro; el usuario no crea aquí su contraseña, y tú no la ves nunca.

Al crearlo se envía una **invitación** a su correo con un enlace a la pantalla
donde elige su propia contraseña. El enlace:

- sirve **una sola vez** y caduca a los **7 días**;
- queda anulado si envías uno nuevo («Volver a invitar» en la fila del
  usuario), lo que sirve también para **restablecer una contraseña olvidada**;
- deja la cuenta activa y a la persona ya dentro en la primera visita.

**A qué centros tiene acceso.** Al crear el usuario indicas uno o más centros,
cada uno con su rol. Una cuenta es única y global; lo que es de cada centro es
el rol. La misma persona puede coordinar en una facultad y dar clase en otra,
incluso de dos universidades distintas, y sigue siendo **una sola cuenta con una
sola contraseña** — no dos.

Quién puede dar acceso a qué:

| Quién lo hace  | Dónde puede dar acceso                    |
| -------------- | ----------------------------------------- |
| `SUPERADMIN`   | Cualquier centro de cualquier universidad |
| `CENTER_ADMIN` | Solo los centros que administra él mismo  |

El desplegable de centros solo muestra los que puedes dar, agrupados por
universidad, y el servidor lo vuelve a comprobar al recibir la petición: no
basta con administrar _algún_ centro para poner a alguien en otro.

A partir de ahí esa persona puede entrar de dos maneras: con su correo y la
contraseña que ha elegido, o con la cuenta de Microsoft si su universidad tiene
el tenant registrado. No hay que escoger una: son la misma identidad.

**Cambiar de centro y de rol.** Quien tiene acceso a más de un centro lo elige
en el desplegable de la barra superior, agrupado por universidad. Y quien tiene
más de un rol en un mismo centro —dar clase y coordinar, por ejemplo— encuentra
un segundo desplegable para cambiar de rol y ver las pantallas de cada uno por
separado, en lugar de los dos menús mezclados. El rol elegido solo cambia lo que
se muestra: lo que esa persona puede hacer lo decide el servidor, siempre, a
partir de la base de datos.

Si la pantalla de usuarios te dice que la invitación no se ha enviado, es que la
instalación todavía no tiene servidor de correo configurado (Plataforma →
Correo). La cuenta existe igualmente; envíale la invitación cuando el correo
funcione.

---

## 2. Preparar un curso

El orden importa: cada paso necesita el anterior.

1. **Curso académico** — Administración → Cursos académicos. Fechas de inicio y
   fin.
2. **Titulaciones y asignaturas** — a mano o con una importación.
3. **Espacios** — aulas, laboratorios, capacidad y equipamiento. El
   planificador rechaza una asignación que no cabe o que no tiene el
   equipamiento necesario.
4. **Profesorado** — usuarios, categoría, dedicación y horas contratadas.
5. **Grupos** — cuántos grupos tiene cada asignatura y de qué tipo.
6. **Coordinación** — quién coordina cada asignatura. Sin eso, nadie puede
   planificarla ni usar el asistente para ella.

---

## 3. Importaciones

Administración → Importaciones acepta CSV y XLSX de profesorado y de
asignaturas. El proceso tiene cuatro pasos y ninguno escribe nada hasta el
último: subir, mapear columnas, validar y aplicar.

La validación muestra los errores fila por fila con el motivo. Merece la pena
corregirlos en el fichero y volver a subirlo: aplicar una importación a medias
deja datos incompletos que después cuesta encontrar.

---

## 4. Parámetros del centro

Configuración → parámetros. Todo lo que la normativa de cada centro decide:
horas máximas, equivalencia de créditos, categorías contractuales, reducciones
reconocidas, cortes del semáforo de carga, reglas de horario, conceptos
computables, calendario y plazos.

**Leer la normativa.** Sube el documento a Documentos, espera a que se indexe y
ve a Configuración → Lee la normativa. El asistente propone cada parámetro
**con la cita literal que lo justifica**, bloque a bloque. Nada se aplica hasta
que lo confirmas, parámetro a parámetro.

Tres cosas que conviene saber antes de usarlo:

- **Sin cita no hay propuesta.** Si el documento no dice nada de un parámetro,
  sale como «no encontrado» y se queda con el valor por defecto. Es
  deliberado: inventar un número plausible sería peor que no decir nada.
- **Los conflictos se muestran, no se resuelven.** Si dos artículos dicen cosas
  distintas, los verás ambos con su cita y decides tú.
- **Lo que has editado a mano no se sobrescribe.** Una lectura posterior lo
  propone como cambio, nunca lo pisa.

Cada cambio deja una versión en el historial, con quién la aprobó y de qué
documento sale. Eso es lo que permite responder «con qué reglas se generó el
horario del curso pasado».

---

## 5. Documentos

La biblioteca que el asistente tiene presente. Cada documento lleva ámbito,
tipo, curso, idioma, **vigencia** y visibilidad.

La vigencia es el campo que más se olvida y el que más daño hace: un plan
docente de 2024-25 que nadie ha retirado sigue respondiendo preguntas de
2026-27. La lista marca los caducados y los que caducan pronto.

La visibilidad decide quién lo ve: «solo para el asistente» no aparece en el
repositorio del profesorado; «visible también para el profesorado» sí.

**No subas datos de estudiantes.** Esta biblioteca es para normativa y
documentos organizativos, no para listados ni expedientes.

---

## 6. Planificación

Planificación → versiones. Una versión de horario pasa por borrador → revisión
→ publicada. Hasta que no se publica, nadie del profesorado la ve.

El planificador comprueba en tiempo real los conflictos duros — solapamientos,
disponibilidad, capacidad contratada, aforo y equipamiento del espacio — y los
blandos, que son preferencias con un peso configurable.

Cuando una regla bloquea una asignación, el aviso lleva un enlace **«¿Por qué
se aplica esta regla?»** que llega hasta el artículo de la normativa del
centro. Si alguien discute un límite, esa es la respuesta.

---

## 7. Cambios de clase y ausencias

Un cambio pasa por: solicitado → aceptado por el docente afectado → aprobado
por coordinación → aplicado. Si la configuración dice que la aprobación de
coordinación no es vinculante, ese paso se salta y la coordinación solo queda
informada.

Las ausencias pueden proponer sustitutos, ordenados por competencia y
disponibilidad, con los motivos y los impedimentos a la vista.

---

## 8. Auditoría

Toda modificación de datos de negocio queda registrada con el antes, el
después, el autor y el origen: `usuario`, `ia` o `sistema`. El visor filtra por
entidad, persona, fechas y origen.

El registro es solo de inserción: nadie lo edita. La retención se configura en
Privacidad y, por defecto, son seis años.

---

## 9. Protección de datos

La página Privacidad muestra el registro de actividades de tratamiento con la
base jurídica y la conservación de cada una, y lo que el asistente envía a
Anthropic.

Cualquier persona puede descargar sus datos desde ahí. El borrado lo pide la
persona y lo ejecuta la administración: se borra quién es — nombre, dirección,
dispositivos, preferencias, conversaciones — y se conserva el registro
académico y la auditoría, donde queda como cuenta anónima. Un centro debe poder
decir quién aprobó qué.

---

## 10. Cosas que fallan a menudo

**Alguien no puede entrar.** Comprueba que su tenant de Microsoft está dado de
alta y que tiene un rol vigente en este centro. Un rol con fecha de fin pasada
ya no cuenta.

**Los avisos no llegan a un iPhone.** En iOS solo llegan si la aplicación está
instalada en la pantalla de inicio, y el permiso debe pedirse con un gesto de
la persona. La página de avisos lo explica paso a paso.

**El calendario externo va retrasado.** Una suscripción ICS es pull: Google la
lee cada 8-24 horas y no hay manera de acelerarlo. Para cambios del mismo día,
conecta Microsoft o Google, que se escriben al instante.

**El asistente no responde.** O no hay clave configurada, o el centro lo ha
desactivado, o se ha agotado el presupuesto mensual de tokens. Los tres casos
lo dicen en pantalla, y el resto de la plataforma funciona igual.
