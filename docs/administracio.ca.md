# Manual de l'administrador

Per a qui administra un centre a UAcademic. La feina del curs, en l'ordre en
què es fa.

---

## 1. Què fa cada rol

| Rol            | Abast                  | Què hi pot fer                                                                  |
| -------------- | ---------------------- | ------------------------------------------------------------------------------- |
| `SUPERADMIN`   | Tota la plataforma     | Universitats, centres, tenants de Microsoft, coordinadors, actualitzacions      |
| `CENTER_ADMIN` | Un centre              | Assignatures, titulacions, espais, usuaris, calendari, importacions, paràmetres |
| `COORDINATOR`  | Les seves assignatures | Assigna professorat, planifica, aprova canvis, assistent d'IA                   |
| `TEACHER`      | Ell mateix             | Les seves classes, la seva càrrega, proposa canvis, xat, perfil, disponibilitat |

Una mateixa persona pot tenir rols diferents a centres diferents. Els rols es
resolen sempre de la base de dades, mai del testimoni d'inici de sessió.

---

## 1b. Donar d'alta les persones

Administració → Usuaris. Crear un usuari només demana el nom, el correu i el
rol al centre; l'usuari no es crea la contrasenya aquí, i tu no la veus mai.

En crear-lo s'envia una **invitació** al seu correu amb un enllaç a la pantalla
on tria la seva pròpia contrasenya. L'enllaç:

- serveix **una sola vegada** i caduca al cap de **7 dies**;
- queda anul·lat si n'envies un de nou («Torna a convidar» a la fila de
  l'usuari), cosa que també serveix per **restablir una contrasenya oblidada**;
- deixa el compte actiu i la persona ja dins a la primera visita.

**A quins centres té accés.** En crear l'usuari indiques un o més centres, cada
un amb el seu rol. Un compte és únic i global; el que és de cada centre és el
rol. La mateixa persona pot coordinar a una facultat i fer classe a una altra,
fins i tot de dues universitats diferents, i segueix sent **un sol compte amb
una sola contrasenya** — no dos.

Qui pot donar accés a què:

| Qui ho fa      | On pot donar accés                          |
| -------------- | ------------------------------------------- |
| `SUPERADMIN`   | Qualsevol centre de qualsevol universitat   |
| `CENTER_ADMIN` | Només els centres que administra ell mateix |

El desplegable de centres ja només ensenya els que pots donar, agrupats per
universitat, i el servidor ho torna a comprovar en rebre la petició: no n'hi ha
prou d'administrar _algun_ centre per posar algú en un altre.

A partir d'aquí aquella persona pot entrar de dues maneres: amb el seu correu i
la contrasenya que ha triat, o amb el compte de Microsoft si la seva universitat
té el tenant registrat. No cal escollir-ne una: són la mateixa identitat.

**Canviar de centre i de rol.** Qui té accés a més d'un centre el tria al
desplegable de la barra superior, agrupat per universitat. I qui té més d'un rol
en un mateix centre —fer classe i coordinar, per exemple— hi troba un segon
desplegable per canviar de rol i veure les pantalles de cada un per separat, en
lloc dels dos menús barrejats. El rol triat només canvia el que es mostra: el
que aquella persona pot fer el decideix el servidor, sempre, a partir de la base
de dades.

Si la pantalla d'usuaris et diu que la invitació no s'ha enviat, és que la
instal·lació encara no té servidor de correu configurat (Plataforma → Correu).
El compte existeix igualment; envia-li la invitació quan el correu funcioni.

---

## 2. Preparar un curs

L'ordre importa: cada pas necessita l'anterior.

1. **Curs acadèmic** — Administració → Cursos acadèmics. Dates d'inici i fi.
2. **Titulacions i assignatures** — a mà o amb una importació.
3. **Espais** — aules, laboratoris, capacitat i equipament. El planificador
   rebutja una assignació que no hi cap o que no té l'equipament necessari.
4. **Professorat** — usuaris, categoria, dedicació i hores contractades.
5. **Grups** — quants grups té cada assignatura i de quin tipus.
6. **Coordinació** — qui coordina cada assignatura. Sense això, ningú pot
   planificar-la ni fer servir l'assistent per a ella.

---

## 3. Importacions

Administració → Importacions accepta CSV i XLSX de professorat i
d'assignatures. El procés té quatre passos i cap d'ells escriu res fins a
l'últim: pujar, mapar columnes, validar i aplicar.

La validació mostra els errors fila per fila amb el motiu. Val la pena
corregir-los al fitxer i tornar a pujar-lo: aplicar una importació a mitges
deixa dades incompletes que després costa trobar.

---

## 4. Paràmetres del centre

Configuració → paràmetres. Tot el que la normativa de cada centre decideix:
hores màximes, equivalència de crèdits, categories contractuals, reduccions
reconegudes, talls del semàfor de càrrega, regles d'horari, conceptes
computables, calendari i terminis.

**Llegir la normativa.** Puja el document a Documents, espera que s'indexi i
ves a Configuració → Llegeix la normativa. L'assistent proposa cada paràmetre
**amb la cita literal que el justifica**, bloc a bloc. Res s'aplica fins que ho
confirmes, paràmetre a paràmetre.

Tres coses que val la pena saber abans de fer-ho servir:

- **Sense cita no hi ha proposta.** Si el document no diu res d'un paràmetre,
  surt com a «no trobat» i es queda amb el valor per defecte. És deliberat:
  inventar un número plausible seria pitjor que no dir res.
- **Els conflictes es mostren, no es resolen.** Si dos articles diuen coses
  diferents, els veuràs tots dos amb la seva cita i decideixes tu.
- **El que has editat a mà no es sobreescriu.** Una lectura posterior ho
  proposa com a canvi, mai el pisa.

Cada canvi deixa una versió a l'historial, amb qui la va aprovar i de quin
document surt. Això és el que permet respondre «amb quines regles es va generar
l'horari del curs passat».

---

## 5. Documents

La biblioteca que l'assistent té present. Cada document porta àmbit, tipus,
curs, idioma, **vigència** i visibilitat.

La vigència és el camp que més s'oblida i el que més mal fa: un pla docent de
2024-25 que ningú ha retirat continua responent preguntes de 2026-27. La
llista marca els caducats i els que caduquen aviat.

La visibilitat decideix qui el veu: «només per a l'assistent» no apareix al
repositori del professorat; «visible també per al professorat» sí.

**No pugis dades d'estudiants.** Aquesta biblioteca és per a normativa i
documents organitzatius, no per a llistats ni expedients.

---

## 6. Planificació

Planificació → versions. Una versió d'horari passa per esborrany → revisió →
publicada. Fins que no es publica, ningú del professorat la veu.

El planificador comprova en temps real els conflictes durs — solapaments,
disponibilitat, capacitat contractada, aforament i equipament de l'espai — i
els suaus, que són preferències amb un pes configurable.

Quan una regla bloqueja una assignació, l'avís porta un enllaç **«Per què
s'aplica aquesta regla?»** que arriba fins a l'article de la normativa del
centre. Si algú discuteix un límit, aquesta és la resposta.

---

## 7. Canvis de classe i absències

Un canvi passa per: sol·licitat → acceptat pel docent afectat → aprovat per
coordinació → aplicat. Si la configuració diu que l'aprovació de coordinació no
és vinculant, aquest pas se salta i la coordinació només queda informada.

Les absències poden proposar substituts, ordenats per competència i per
disponibilitat, amb els motius i els impediments a la vista.

---

## 8. Auditoria

Tota modificació de dades de negoci queda registrada amb l'abans, el després,
l'autor i l'origen: `usuari`, `ia` o `sistema`. El visor filtra per entitat,
persona, dates i origen.

El registre és només d'inserció: ningú l'edita. La retenció es configura a
Privacitat i, per defecte, són sis anys.

---

## 9. Protecció de dades

La pàgina Privacitat mostra el registre d'activitats de tractament amb la base
jurídica i la conservació de cadascuna, i el que l'assistent envia a Anthropic.

Qualsevol persona pot descarregar les seves dades des d'allà. L'esborrat el
demana la persona i l'executa l'administració: s'esborra qui és — nom, adreça,
dispositius, preferències, converses — i es conserva el registre acadèmic i
l'auditoria, on queda com a compte anònim. Un centre ha de poder dir qui va
aprovar què.

---

## 10. Coses que fallen sovint

**Algú no pot entrar.** Comprova que el seu tenant de Microsoft està donat
d'alta i que té un rol vigent en aquest centre. Un rol amb data de fi passada
ja no compta.

**Els avisos no arriben a un iPhone.** A iOS només arriben si l'aplicació està
instal·lada a la pantalla d'inici, i el permís s'ha de demanar amb un gest de
la persona. La pàgina d'avisos ho explica pas a pas.

**El calendari extern va endarrerit.** Una subscripció ICS és pull: Google la
llegeix cada 8-24 hores i no hi ha manera d'accelerar-ho. Per a canvis del
mateix dia, connecta Microsoft o Google, que s'escriuen a l'instant.

**L'assistent no respon.** O no hi ha clau configurada, o el centre l'ha
desactivat, o s'ha esgotat el pressupost mensual de tokens. Els tres casos ho
diuen a la pantalla, i la resta de la plataforma funciona igual.
