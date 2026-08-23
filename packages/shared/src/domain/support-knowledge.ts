/**
 * What Cady knows about UAcademic.
 *
 * This file is the support assistant's base knowledge: how the product is
 * built, what each screen is for, what has to exist before a thing can work,
 * and what the errors people actually hit really mean. It is written from the
 * source — the schema, the routes, the domain rules and the deployment
 * procedure — rather than from what a language model might assume an academic
 * platform does, which is the whole point: Cady answers from here and from the
 * center's own help articles, and declines anything neither covers.
 *
 * ── Why a TypeScript module and not a Markdown file
 *
 * `packages/shared` has no Node dependencies (R7), so it cannot read a file
 * from disk, and the API must not have to find one on a shared host after an
 * OTA update. Compiled in, the knowledge ships with the release that it
 * describes and can never drift from it by being left behind.
 *
 * ── Why English, when everything user-facing is trilingual (R1)
 *
 * Nobody reads this. It is model input, and the prompt pins the answer to the
 * reader's own language whatever the material is written in. Writing it three
 * times would triple the cost of keeping it true, which is the only property
 * that matters here.
 *
 * ── Keeping it true
 *
 * When a screen changes, this changes in the same commit. A support assistant
 * confidently describing last quarter's interface is worse than one that says
 * it does not know.
 */
import type { Role } from '../schemas/common.js'

const ALL: readonly Role[] = ['SUPERADMIN', 'CENTER_ADMIN', 'COORDINATOR', 'TEACHER']

export interface KnowledgeSection {
  id: string
  title: string
  /** Roles this is worth telling. */
  roles: readonly Role[]
  body: string
}

/**
 * How the product works, in the order somebody meets it.
 *
 * Not a feature list: the parts that answer "why is this empty", "why can I
 * not do that" and "what do I have to do first", which is what support
 * questions almost always are underneath.
 */
export const PLATFORM_KNOWLEDGE: readonly KnowledgeSection[] = [
  {
    id: 'what-it-is',
    title: 'What UAcademic is',
    roles: ALL,
    body: `An academic-management platform for universities and higher-education centers.

The problem it exists to solve: matching each lecturer's contracted teaching capacity against the teaching load that has to be covered, while respecting when they can actually teach. Everything else — the calendar, messaging, documents, the profile — supports that.

A person signs in once and holds roles per center. The same account can coordinate at one faculty and teach at another, even at two different universities: one account, one password, several roles. The header carries a center selector, and a role selector when somebody holds more than one role in the center they are looking at. Changing the role there only changes what the interface draws — the server checks permissions against the database on every request regardless.`,
  },
  {
    id: 'roles',
    title: 'The four roles, and what each one can do',
    roles: ALL,
    body: `SUPERADMIN — the only role that crosses centers. Universities, centers, Microsoft Entra tenants, the platform's languages, the mail server, OTA updates, metrics, and the support assistant. Not a center role: a platform administrator does not coordinate or teach.

CENTER_ADMIN — one center. Academic years, degrees, subjects, groups, spaces, the academic calendar, people and their roles, bulk imports, and the center's own parameters.

COORDINATOR — one or more subjects. Assigns teaching staff to groups, plans the timetable, publishes versions, approves class changes. The only role with the coordination assistant (the AI that reads the center's data and proposes timetable changes).

TEACHER — themselves. Their classes and subjects, their own load (contracted against assigned hours), their availability, class-change requests, absences, messages, profile, and their own teaching calendar as a PDF or a phone subscription.

Roles live in the database, never in a token, and are resolved per request. A role can be given a validity range, so one that has expired stops working without anybody deleting anything.`,
  },
  {
    id: 'setup-order',
    title: 'The order things have to happen in',
    roles: ['SUPERADMIN', 'CENTER_ADMIN', 'COORDINATOR'],
    body: `Most "this screen is broken" reports are a step further up that has not happened yet. The chain is:

1. A university, then a center inside it (platform administration).
2. An academic year for that center, marked active. Without an active year there is no teaching load to compute, and the dashboard, the subjects list and the load screens are empty rather than broken.
3. Degrees, then subjects inside a degree, then groups inside a subject. A group is what actually gets taught and timetabled.
4. Spaces (rooms), if the timetable is to place classes anywhere.
5. The academic calendar: term dates, holidays, holiday periods, exam periods. The planner shades the closed days and the engine skips them.
6. People, with their roles. A lecturer also needs a teaching contract for the year — the account and the contract are different things, created at different moments.
7. The center's parameters: maximum teaching hours, what counts as full time, the load thresholds, session length, and so on.
8. Then coordination can assign staff to groups and plan the timetable.

A center that has just been created will therefore show a great deal of nothing. That is the expected state, not a fault.`,
  },
  {
    id: 'capacity',
    title: 'Capacity, load, and the traffic light',
    roles: ALL,
    body: `Contracted hours minus recognised reductions gives a lecturer's capacity for the year. What coordination assigns them is their assigned hours. The ratio of the two is the load, shown as a traffic light with an icon and a word as well as a colour:

- under 85% — under-load, blue
- 85–100% — optimal, green
- 100–110% — at the limit, amber
- over 110% — overload, red

The bands are center parameters, not constants: a center can move them. Hours are decimal hours and are stored exactly, never as floats.

Assigned hours come from assignments (a person to a group, with a concept: lecture, tutoring, coordination, final-project supervision, other) and from what the parameters say other work is worth — final-project supervision per student up to a ceiling, weekly tutoring, degree and subject coordination. A center that under-counts its staff usually has those parameters left at their defaults.`,
  },
  {
    id: 'availability',
    title: 'Availability',
    roles: ALL,
    body: `Each lecturer paints their week in four levels: preferred, available, avoid, unavailable. There are also dated exceptions for one-off situations.

Silence before anybody has been asked means available: a lecturer who has never opened the screen is plannable at any hour. Silence inside a week they have spoken about does not — there they left that hour out on purpose. This is why the grid stores every level, including the refusals.

The planner reads those levels as it places. Putting a class on an hour somebody marked unavailable is refused outright; one they asked to avoid goes through with a warning. Availability is worth five minutes of a lecturer's time: without it they get planned around blindly.`,
  },
  {
    id: 'planning',
    title: 'Timetable versions, planning and publishing',
    roles: ['COORDINATOR', 'CENTER_ADMIN'],
    body: `Nothing is planned in the open. A timetable is a version — a draft of the whole week — that gets worked on and then published. The first one is created from the planning screen; later ones are branched from an existing version so the previous one is never lost.

The planner is a weekly grid, because a timetable repeats weekly. Arrows step through the year: the columns carry the day of the month, today is marked, and the days the center is shut are shaded and named. Only the classes that actually happen in the week on screen are drawn — a term that has not started, or the off week of a fortnightly class, shows nothing, and a caption says how many of the version's classes fall in that week.

Classes are moved by dragging or entirely by keyboard: Space picks a session up, the arrows move it, Space drops it, Escape puts it back. Cell colours are computed in the browser from the same constraint rules the engine uses — green when a placement costs nothing, amber when it breaks a soft constraint (the reason is in the tooltip), red when it is impossible.

Beside the grid: the groups still to place, and every colleague with the hours this version gives them, counted from what is on screen so the figures move as classes land.

Every class is placed on a day, one at a time, and nothing repeats it: a week is planned by placing that week's classes, and the following week is placed again. The platform never copies a session onto another week or another month.

Publishing snapshots the version, archives the previous one and notifies only the people whose classes actually changed.

Hard constraints cannot be published through — a lecturer or a room in two places at once, an hour somebody cannot do. Soft ones (gaps, too many consecutive hours, a building change with no time to walk it) are warnings with weights the center can tune.`,
  },
  {
    id: 'changes-absences',
    title: 'Class changes and absences',
    roles: ALL,
    body: `Once a timetable is published, a lecturer does not edit it: they request a change, saying which class, when they would move it to, and why. The system checks the new slot against the same rules the planner uses before coordination even sees it. Whether coordination's approval is binding is a center parameter — some centers only inform coordination.

Absences are reported on their own screen. Where the center has it configured, the system proposes who could cover: people with availability at that hour who know the subject area.`,
  },
  {
    id: 'calendar',
    title: 'Getting the timetable out of the platform',
    roles: ALL,
    body: `Three ways, and they suit different people.

1. The calendar screen shows the published timetable as a month, week or list.
2. A subscription address (ICS) that a phone or a desktop calendar reads, with a QR code to scan. Classes appear in the phone's own calendar and update themselves when the timetable changes. The address is personal and must not be shared — only a hash of its token is stored, so a database dump yields no working URL and revoking one is a single row.
3. A connected Google or Microsoft calendar, which the platform writes events into directly.

There is also the teaching calendar as a PDF: A4 landscape, one month per page, over a date range chosen before printing. A lecturer downloads their own from their card; coordination sends everybody theirs by email from the foot of the planning screen, one message each.`,
  },
  {
    id: 'people',
    title: 'Accounts, invitations and signing in',
    roles: ['SUPERADMIN', 'CENTER_ADMIN'],
    body: `Creating a user asks for a name, an email, and one or more centers each with a role. The password is never set here and is never visible to an administrator.

The invitation is a checkbox, off by default. Tick it and the person is emailed a one-time link, good for seven days, to a screen where they choose their own password. Leave it unticked and the account is still created and nothing is sent — which is what a batch prepared before term wants. The invitation can be sent later from "invite again" on the person's row, and sending a new one retires the previous link, which is also how a forgotten password is reset.

Somebody who already exists is not duplicated: their roles are added. Somebody who can already sign in is never sent an invitation.

Two ways in: a Microsoft work or school account, or an email and a password. Both reach the same account.`,
  },
  {
    id: 'entra',
    title: 'Microsoft sign-in',
    roles: ['SUPERADMIN'],
    body: `The application is registered as multi-tenant, so any Microsoft organisation can authenticate against it. Whether they may enter is decided here: the token's tenant claim is checked against the tenants registered on this installation, and one that is not registered is refused. Without that check, a user from any Microsoft organisation in the world would pass signature verification.

A multi-tenant application also has to be installed once in each customer tenant. Until an administrator there consents, Microsoft refuses everybody from that university with AADSTS500011 — and shows no consent prompt, because there is no resource in that tenant to prompt about. Administration → Tenants shows, on each row, the consent link to send to that university's IT department.

The identifier used is the token's stable object id, never the email address: people change their surname and their address, and an account that follows the address is a different account.`,
  },
  {
    id: 'imports',
    title: 'Bulk imports',
    roles: ['CENTER_ADMIN'],
    body: `A whole year's structure can be loaded from a spreadsheet — degrees, subjects, groups, staff — rather than typed in. There is a sample workbook to download with the columns already in it.

An import is validated before anything is written, row by row, and reports what it would do and what it would refuse. Nothing is half-applied.`,
  },
  {
    id: 'parameters',
    title: 'The center parameters, and where they come from',
    roles: ['CENTER_ADMIN', 'COORDINATOR'],
    body: `Teaching regulations differ in every center, so the thresholds, the weights, the session length, whether coordination's approval is binding and so on are configuration rather than code.

They can be set by hand, and they can be read out of the center's own regulation by the assistant: it proposes each parameter with the article and the quotation it came from, and a person confirms or rejects each one. A parameter that carries a citation can explain itself — when a constraint blocks something, the interface can show which document and which article says so.

Parameters that are lists rather than figures — contractual categories, recognised reductions, exam periods, holidays, the days the center teaches — are edited as tables, a row per entry.

Each save writes a new settings version, so what the rules were on a given date is answerable.`,
  },
  {
    id: 'assistant',
    title: 'The coordination assistant (not Cady)',
    roles: ['COORDINATOR', 'CENTER_ADMIN'],
    body: `A different assistant, for a different job: it reads this center's data — hours, availability, conflicts, room occupancy, the change history — and answers questions about the timetable, and it can propose changes to it.

It never writes on its own. A write is returned as a proposal: a preview with the diff and any conflicts it found, which a person confirms or discards. What is applied is recorded as coming from the AI.

Only coordination and center administration have it. Everything it spends is recorded against a monthly budget the center sets.

Cady is not that assistant. Cady explains how the platform works, sees no center data and changes nothing.`,
  },
  {
    id: 'audit-privacy',
    title: 'Audit and data protection',
    roles: ['SUPERADMIN', 'CENTER_ADMIN'],
    body: `Every change to business data is recorded with what it was before, what it became, who did it and whether it came from a person, the AI or the system. The log is insert-only; nobody edits it. Retention is configurable and defaults to six years.

The privacy screen carries the record of processing activities with the legal basis and retention for each, and what the assistant sends to Anthropic. Anybody can download their own data from there. Erasure is requested by the person and carried out by the administration: who somebody is gets erased — name, address, devices, preferences, conversations — while the academic record and the audit trail remain, with the account anonymised. A center has to be able to say who approved what.`,
  },
  {
    id: 'notifications',
    title: 'Notifications and messages',
    roles: ALL,
    body: `The bell carries what has happened to you: a published timetable that changed your classes, a change request that concerns you, a reply. Each person chooses per channel — in the platform, by email, as a push notification on their phone — and can ask for a daily digest instead of a message per event.

Messages are conversations inside the platform, started with anybody in the center or anywhere in the same university. Writing to the same colleague twice continues the existing thread rather than opening a second one.`,
  },
  {
    id: 'appearance',
    title: 'Language, appearance and the menu',
    roles: ALL,
    body: `The platform is in Catalan, Spanish and English, chosen per person in Settings. A platform administrator decides which of the three the installation offers.

Light and dark on every screen, following the system or forced either way.

Settings → Your menu lets each person put the menu items in the order that suits them and insert separators with their own labels, saving as they go. It affects only their account and follows them to any machine. What the menu may contain is still decided by their roles.

It can be installed as an application on a phone or a desktop from the browser's own install button, and it keeps working with an unreliable connection.`,
  },
  {
    id: 'limits',
    title: 'What Cady cannot do',
    roles: ALL,
    body: `Cady cannot see this center's data: no timetables, no people, no hours, no documents. Asked "how many hours do I have assigned", the honest answer is where to look — the load screen — not a number.

Cady cannot change anything: not a class, not a role, not a parameter. Asked to do something, she explains where the person does it themselves.

Cady does not know this center's own rules unless somebody has written them into a help article: the regulation, who approves what locally, the internal deadlines.

Cady never asks for a password and never repeats one.`,
  },
]

/* ────────────────────────────── the screens ────────────────────────────── */

export interface ScreenKnowledge {
  /** Route pattern, `:param` for a variable segment. */
  path: string
  title: string
  roles: readonly Role[]
  body: string
}

/**
 * What each screen is, in the words somebody standing on it would need.
 *
 * The point is the second half of each entry: what has to exist before the
 * screen has anything to show, because "it is empty" is the most common
 * support question there is and it almost never means the screen is broken.
 */
export const SCREEN_KNOWLEDGE: readonly ScreenKnowledge[] = [
  {
    path: '/',
    title: 'Dashboard',
    roles: ALL,
    body: `The summary for the role that is looking: for coordination, the teaching load of the center's staff with the traffic light and what is still unassigned; for a lecturer, their own week and their own load. Needs an active academic year — without one it says so and, for an administrator, offers the way to create one.`,
  },
  {
    path: '/planning',
    title: 'Planning',
    roles: ['COORDINATOR', 'CENTER_ADMIN'],
    body: `Where the timetable is built, week by week. A version toolbar (the version can be renamed at any time, published included), the week itself, the comparison between two versions, and — at the foot — sending every lecturer their own teaching calendar as a PDF. Each class is placed on its own day, with its teacher and, if somebody writes one, the topic of the class; nothing is repeated onto another week. Needs a version to exist; with none, the screen offers to create the first one. Needs groups to have something to place.`,
  },
  {
    path: '/calendar',
    title: 'Calendar',
    roles: ALL,
    body: `The published timetable as a month, a week or a list. Shows nothing until a version has been published — a draft is not on anybody's calendar.`,
  },
  {
    path: '/my-load',
    title: 'My load',
    roles: ['TEACHER', 'COORDINATOR'],
    body: `Contracted hours, recognised reductions, capacity, what has been assigned and what remains, with the traffic light and a breakdown by subject and by concept. Empty until the person has a teaching contract for the active year and coordination has assigned them something.`,
  },
  {
    path: '/teachers',
    title: 'Teaching staff',
    roles: ['CENTER_ADMIN', 'COORDINATOR'],
    body: `Everybody with a teaching contract this year and their load. Also where a contract is written by hand for somebody who holds the lecturer role but has none yet. Somebody missing here usually has an account but no contract for this year.`,
  },
  {
    path: '/teachers/:id',
    title: 'A lecturer’s card',
    roles: ALL,
    body: `One person: their profile and category, the subjects assigned to them, their weekly availability, their dated exceptions, and their teaching calendar as a PDF. A lecturer reaches their own by going to /teachers/me — the availability screen in the menu is this same card.`,
  },
  {
    path: '/subjects',
    title: 'Subjects',
    roles: ALL,
    body: `The teaching plan for the active year: the subjects, their degree, their credits and their groups. Empty when the year has no subjects yet, which is the center administration's step.`,
  },
  {
    path: '/assistant',
    title: 'Coordination assistant',
    roles: ['COORDINATOR', 'CENTER_ADMIN'],
    body: `The AI that reads this center's data and proposes timetable changes, with every write shown as a preview to confirm. Coordination only. Unavailable when the installation has no Anthropic key, when the center switched it off, or when the monthly budget is spent — and it says which.`,
  },
  {
    path: '/changes',
    title: 'Class changes',
    roles: ALL,
    body: `A lecturer asks to move a class here, with the reason and the new slot; coordination approves or refuses. The system checks the new slot against the timetable rules before it is submitted.`,
  },
  {
    path: '/absences',
    title: 'Absences',
    roles: ALL,
    body: `Reporting an absence, and — where the center has it configured — the suggested substitutes: people free at that hour who know the subject area.`,
  },
  {
    path: '/messages',
    title: 'Messages',
    roles: ALL,
    body: `Conversations inside the platform. A new one is started by picking a recipient from this center or from anywhere in the same university.`,
  },
  {
    path: '/notifications',
    title: 'Notifications',
    roles: ALL,
    body: `What has happened that concerns you, and the preferences: which channel each kind of event uses, and whether to receive a daily digest instead of a message per event.`,
  },
  {
    path: '/connections',
    title: 'Calendar connections',
    roles: ALL,
    body: `The personal subscription address with its QR code, and connections to Google or Microsoft calendars. The address is personal and must not be shared; a new one can be generated, which revokes the old.`,
  },
  {
    path: '/documents',
    title: 'Documents',
    roles: ['SUPERADMIN', 'CENTER_ADMIN', 'COORDINATOR'],
    body: `The center's own library — regulations, agreements, procedures — which the coordination assistant reads and cites. Each document has a scope, a type and a visibility; one marked as for the assistant only does not appear in the general list.`,
  },
  {
    path: '/imports',
    title: 'Imports',
    roles: ['CENTER_ADMIN'],
    body: `Loading a year's structure from a spreadsheet, with a sample workbook to download. Validated row by row before anything is written.`,
  },
  {
    path: '/settings',
    title: 'Settings',
    roles: ALL,
    body: `Appearance, language, and the personal menu, for everybody. For a center administrator, also the center's parameters, reading a regulation into them with the assistant, and the history of settings versions.`,
  },
  {
    path: '/profile',
    title: 'Profile',
    roles: ALL,
    body: `Name, photograph, and — for somebody who signs in with a password — changing it.`,
  },
  {
    path: '/guide',
    title: 'Guide',
    roles: ALL,
    body: `The step-by-step guide for the role that is reading, in the order the product actually requires. The ticks are a reading aid kept in the browser; nothing behaves differently because a box is ticked.`,
  },
  {
    path: '/privacy',
    title: 'Privacy',
    roles: ALL,
    body: `The record of processing activities, downloading your own data, and requesting erasure.`,
  },
  {
    path: '/audit',
    title: 'Audit',
    roles: ['SUPERADMIN', 'CENTER_ADMIN'],
    body: `Every change to business data with its before and after, filterable by entity, person, date and origin — person, AI or system.`,
  },
  {
    path: '/platform',
    title: 'Platform',
    roles: ['SUPERADMIN'],
    body: `The installation itself: the languages it offers, the mail server and its test message, the version it is running and OTA updates.`,
  },
  {
    path: '/support',
    title: 'Help and support (Cady)',
    roles: ['SUPERADMIN'],
    body: `Where Cady is switched on and off, where every conversation people have had with her can be read — including a filter for the ones she could not answer — and where the help articles she answers from are written, in the three languages.`,
  },
  {
    path: '/admin',
    title: 'Administration',
    roles: ['SUPERADMIN', 'CENTER_ADMIN', 'COORDINATOR'],
    body: `The index of the administration screens this role reaches — the structure of the year (degrees, subjects, groups, spaces, the calendar) for a center administrator, plus universities, centers and Microsoft tenants for a platform administrator. A card missing from here is one this role does not administer.`,
  },
  {
    path: '/admin/users',
    title: 'Users',
    roles: ['SUPERADMIN', 'CENTER_ADMIN'],
    body: `Creating accounts with the centers and roles they hold, sending or re-sending invitations, editing somebody's details and managing their roles in this center. Creating a user does not email them unless the invitation box is ticked.`,
  },
  {
    path: '/admin/universities',
    title: 'Universities',
    roles: ['SUPERADMIN'],
    body: `The institutions on this installation, each with its logo. A center belongs to one.`,
  },
  {
    path: '/admin/centers',
    title: 'Centers',
    roles: ['SUPERADMIN'],
    body: `The faculties and schools, each under a university and optionally tied to a Microsoft tenant.`,
  },
  {
    path: '/admin/entra-tenants',
    title: 'Microsoft Entra tenants',
    roles: ['SUPERADMIN'],
    body: `The Microsoft organisations allowed to sign in, and on each row the consent link to send that university's IT department so the application can be installed in their tenant.`,
  },
  {
    path: '/admin/academic-years',
    title: 'Academic years',
    roles: ['SUPERADMIN', 'CENTER_ADMIN'],
    body: `The center's years, one of them active. Almost everything else in the product hangs off the active year; a center without one shows empty screens rather than broken ones.`,
  },
  {
    path: '/admin/degrees',
    title: 'Degrees',
    roles: ['CENTER_ADMIN'],
    body: `The qualifications the center teaches. Subjects belong to a degree.`,
  },
  {
    path: '/admin/subjects',
    title: 'Subjects',
    roles: ['CENTER_ADMIN'],
    body: `The subjects of the active year, their degree, credits, year and term, and who coordinates each one.`,
  },
  {
    path: '/admin/groups',
    title: 'Groups',
    roles: ['CENTER_ADMIN', 'COORDINATOR'],
    body: `The groups inside each subject — the things that actually get taught and timetabled — with their kind, their size and their weekly hours.`,
  },
  {
    path: '/admin/spaces',
    title: 'Spaces',
    roles: ['CENTER_ADMIN'],
    body: `Rooms, with their building, capacity and kind. The planner uses the building to warn about a change with no time to walk it.`,
  },
  {
    path: '/admin/calendar-entries',
    title: 'Academic calendar',
    roles: ['CENTER_ADMIN'],
    body: `Holidays, holiday periods and exam periods. A holiday closes the center and the planner shades it; an exam period is on the calendar and still teaches. A single day is recorded with the same date at both ends.`,
  },
]

/**
 * The screen a path is on.
 *
 * Exact match first, then patterns with variable segments, longest first — so
 * `/admin/users` is the users screen rather than the generic administration
 * resource that `/admin/:resourceKey` would also match.
 */
export function screenFor(path: string | null | undefined): ScreenKnowledge | null {
  if (!path) return null

  const wanted = normalise(path)
  const exact = SCREEN_KNOWLEDGE.find((screen) => normalise(screen.path) === wanted)
  if (exact) return exact

  const segments = wanted.split('/')
  const candidates = SCREEN_KNOWLEDGE.filter((screen) => matches(screen.path, segments))

  return (
    candidates.sort((a, b) => staticDepth(b.path) - staticDepth(a.path))[0] ??
    // A screen we do not know about still has a section it lives under, and
    // "/admin/something" is more useful context than nothing at all.
    SCREEN_KNOWLEDGE.find((screen) => screen.path === `/${segments[1] ?? ''}`) ??
    null
  )
}

function normalise(path: string): string {
  const clean = path.split('?')[0]?.split('#')[0] ?? ''
  const trimmed = clean.replace(/\/+$/, '')
  return trimmed === '' ? '/' : trimmed
}

function matches(pattern: string, segments: readonly string[]): boolean {
  const parts = normalise(pattern).split('/')
  if (parts.length !== segments.length) return false
  return parts.every((part, index) => part.startsWith(':') || part === segments[index])
}

function staticDepth(pattern: string): number {
  return normalise(pattern)
    .split('/')
    .filter((part) => part && !part.startsWith(':')).length
}

/** Everything worth telling this role, as one block of prose. */
export function platformKnowledge(role: Role): string {
  const sections = PLATFORM_KNOWLEDGE.filter((section) => section.roles.includes(role)).map(
    (section) => `## ${section.title}\n${section.body}`,
  )

  const screens = SCREEN_KNOWLEDGE.filter((screen) => screen.roles.includes(role)).map(
    (screen) => `### ${screen.title} — ${screen.path}\n${screen.body}`,
  )

  return [...sections, `## The screens\n\n${screens.join('\n\n')}`].join('\n\n')
}
