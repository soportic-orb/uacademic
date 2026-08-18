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
