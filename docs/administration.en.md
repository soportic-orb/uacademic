# Administrator manual

For whoever administers a center in UAcademic. The year's work, in the order it
is done.

---

## 1. What each role does

| Role           | Scope              | What they can do                                                         |
| -------------- | ------------------ | ------------------------------------------------------------------------ |
| `SUPERADMIN`   | The whole platform | Universities, centers, Microsoft tenants, coordinators, updates          |
| `CENTER_ADMIN` | One center         | Subjects, degrees, spaces, users, calendar, imports, parameters          |
| `COORDINATOR`  | Their subjects     | Assigns teachers, plans, approves changes, the AI assistant              |
| `TEACHER`      | Themselves         | Their classes, their load, proposes changes, chat, profile, availability |

The same person can hold different roles in different centers. Roles are always
resolved from the database, never from the sign-in token.

---

## 1b. Adding people

Administration → Users. Creating a user asks for a name, an email address and a
role in the center; the password is not set here, and you never see it.

Creating one sends an **invitation** to that address with a link to the screen
where they choose their own password. The link:

- works **once**, and expires after **7 days**;
- is retired the moment you send another one ("Invite again" on the user's
  row), which is also how a **forgotten password is reset**;
- leaves the account active and the person already inside on their first visit.

**Which centers they get.** Creating a user asks for one or more centers, each
with a role. An account is global; what belongs to a center is the role. The
same person can coordinate at one faculty and teach at another, at two different
universities, and it stays **one account with one password** — not two.

Who may grant what:

| Who            | Where they may grant                        |
| -------------- | ------------------------------------------- |
| `SUPERADMIN`   | Any center of any university                |
| `CENTER_ADMIN` | Only the centers they administer themselves |

The center picker lists only what you may grant, grouped by university, and the
server checks it again on the way in: administering _some_ center is not enough
to put somebody into another one.

From then on they can sign in either way: with their email and the password
they chose, or with their Microsoft account if their university's tenant is
registered. It is not a choice between two accounts — it is one identity.

**Switching center and role.** Anybody with access to more than one center
picks it from the header, grouped by university. Anybody holding more than one
role in the same center — teaching and coordinating, say — gets a second
selector to switch between them and see each role's screens on their own,
instead of both menus fused together. The chosen role changes only what is
drawn: what that person may actually do is decided by the server, every time,
from the database.

If the users screen tells you the invitation was not sent, this installation
has no mail server configured yet (Platform → Mail). The account exists all the
same; send the invitation once mail works.

---

## 2. Setting up a year

The order matters: each step needs the one before it.

1. **Academic year** — Administration → Academic years. Start and end dates.
2. **Degrees and subjects** — by hand or through an import.
3. **Spaces** — rooms, labs, capacity and equipment. The planner refuses an
   assignment that does not fit or lacks the equipment it needs.
4. **Teachers** — users, category, dedication and contracted hours.
5. **Groups** — how many groups each subject has, and of what kind.
6. **Coordination** — who coordinates each subject. Without it nobody can plan
   it or use the assistant for it.

---

## 3. Imports

Administration → Imports accepts CSV and XLSX for teachers and subjects. The
process has four steps and none of them writes anything until the last: upload,
map columns, validate, apply.

Validation shows the errors row by row with the reason. It is worth fixing them
in the file and uploading it again: applying a half-good import leaves
incomplete data that is hard to find later.

---

## 4. Center parameters

Settings → parameters. Everything each center's own regulation decides: maximum
hours, credit equivalence, contractual categories, recognised reductions, the
cuts of the load traffic light, timetable rules, what counts as teaching, the
calendar and the deadlines.

**Reading the regulation.** Upload the document under Documents, wait for it to
be indexed, and go to Settings → Read the regulation. The assistant proposes
each parameter **with the literal quote that justifies it**, one block at a
time. Nothing is applied until you confirm it, parameter by parameter.

Three things worth knowing before using it:

- **No citation, no proposal.** If the document says nothing about a parameter
  it comes back as "not found" and keeps its default. This is deliberate:
  inventing a plausible number would be worse than saying nothing.
- **Contradictions are shown, not resolved.** When two articles disagree you
  see both with their quotes, and you decide.
- **What you edited by hand is not overwritten.** A later reading proposes a
  change to it; it never overrides it.

Every change leaves a version in the history, with who approved it and which
document it came from. That is what makes "under which rules was last year's
timetable generated?" answerable.

---

## 5. Documents

The library the assistant keeps in mind. Each document carries a scope, a type,
an academic year, a language, a **validity window** and a visibility.

Validity is the field most often forgotten and the one that does most damage: a
2024-25 teaching plan nobody retired keeps answering questions about 2026-27.
The list marks what has expired and what expires soon.

Visibility decides who sees it: "assistant only" never appears in the teachers'
repository; "also visible to teachers" does.

**Do not upload student data.** This library is for regulations and
organisational documents, not for class lists or academic records.

---

## 6. Planning

Planning → versions. A timetable version goes draft → review → published.
Until it is published, no teacher sees it.

The planner checks hard conflicts in real time — overlaps, availability,
contracted capacity, room capacity and equipment — and soft ones, which are
preferences with a configurable weight.

When a rule blocks an assignment, the message carries a **"Why does this rule
apply?"** link that leads to the article of the center's own regulation. When
somebody argues with a limit, that is the answer.

---

## 7. Class changes and absences

A change goes: requested → accepted by the teacher concerned → approved by
coordination → applied. If the configuration says coordination's approval is
not binding, that step is skipped and coordination is only informed.

Absences can propose substitutes, ranked by competence and availability, with
the reasons and the blockers in plain sight.

---

## 8. Audit

Every change to business data is recorded with the before, the after, the
author and the origin: `user`, `ai` or `system`. The viewer filters by entity,
person, dates and origin.

The log is insert-only: nobody edits it. Retention is configured under Privacy
and defaults to six years.

---

## 9. Data protection

The Privacy page shows the record of processing activities with the legal basis
and the retention for each, and what the assistant sends to Anthropic.

Anybody can download their own data from there. Erasure is requested by the
person and carried out by the administration: what is erased is who they are —
name, address, devices, preferences, conversations — and what is kept is the
academic record and the audit trail, where they remain as an anonymous account.
A center has to be able to say who approved what.

---

## 10. Things that go wrong often

**Somebody cannot sign in.** Check that their Microsoft tenant is registered
and that they hold a current role in this center. A role whose end date has
passed no longer counts.

**Notifications do not arrive on an iPhone.** On iOS they only arrive once the
app is installed on the home screen, and permission has to be asked for from a
gesture the person made. The notifications page walks through it.

**The external calendar is behind.** An ICS subscription is pull: Google reads
it every 8-24 hours and there is no way to speed that up. For same-day changes,
connect Microsoft or Google, which are written to immediately.

**The assistant does not answer.** Either no key is configured, or the center
switched it off, or the monthly token budget is spent. All three say so on
screen, and the rest of the platform carries on exactly as before.
