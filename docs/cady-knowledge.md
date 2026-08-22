# Cady's knowledge base

Cady is the support assistant behind the round button in the corner of every
screen. She explains how UAcademic works. She sees no center data, changes
nothing, and — this is the design, not a hope — answers only from written
material. Anything the material does not cover she declines.

This document says what that material is, where it lives, and how to keep it
true.

---

## The three things she is given

Every question assembles a prompt from three sources, filtered to the role of
the person asking. A lecturer is never told how to open an academic year: it is
a screen they cannot open, and a wrong turn is not help.

### 1. Platform knowledge — `packages/shared/src/domain/support-knowledge.ts`

How the product actually works, written from the source: the schema, the
routes, the domain rules, the deployment procedure. Two parts:

- **`PLATFORM_KNOWLEDGE`** — sections on what the platform is, the four roles,
  **the order things have to happen in**, capacity and the load traffic light,
  availability, timetable versions and publishing, class changes and absences,
  getting the timetable out, accounts and invitations, Microsoft sign-in,
  imports, the center parameters, the coordination assistant, audit and data
  protection, notifications, appearance, and what Cady cannot do.
- **`SCREEN_KNOWLEDGE`** — one entry per route the router serves: what the
  screen is, who reaches it, and **what has to exist before it has anything to
  show**.

That last emphasis is the point of the whole file. Most support questions are
"this is empty" or "this will not let me", and the answer is almost never that
the screen is broken — it is a step further up that has not happened yet.

**Why a TypeScript module rather than a Markdown file.** `packages/shared` has
no Node dependencies (R7), so it cannot read from disk, and the API must not
have to find a file on a shared host after an OTA update. Compiled in, the
knowledge ships with the release it describes and cannot be left behind by one.

**Why English, when everything user-facing is trilingual (R1).** Nobody reads
it. It is model input, and the prompt pins the answer to the reader's own
language whatever the material is written in. Writing it three times would
triple the cost of keeping it true, which is the only property that matters
here.

### 2. The step-by-step guide — `packages/shared/src/domain/guide.ts`

The same guide the Guide screen shows, in the reader's language, for their
role. It carries the order the product requires and a path per step, which is
where Cady's "Menu → Planning" answers come from.

### 3. Help articles — written in the product

Administration → Help and support. The platform administrator writes these in
the three languages, for the roles they apply to.

This is the half that can know what the code cannot: **this center's** own
regulation, who approves what locally, the internal deadlines, the name of the
person to email. Nothing in the repository can know those, and Cady must not
guess at them.

---

## Where the person is standing

The chat sends the current route with every question, and the prompt names the
screen and describes it before the instructions:

> Right now they are looking at "My load" (/my-load). Contracted hours,
> recognised reductions, capacity, what has been assigned and what remains…
> Empty until the person has a teaching contract for the active year and
> coordination has assigned them something.

`screenFor(path)` resolves it: exact match first, then patterns with variable
segments, longest static prefix first — so `/admin/users` is the users screen
rather than the generic administration resource that `/admin/:resourceKey`
would also match. A path it does not recognise falls back to the section it
lives under, and an absent path simply leaves the paragraph out.

This is why "why is this empty?" is answerable in one sentence instead of a
round trip asking what "this" is.

---

## Keeping it true

**When a screen changes, this changes in the same commit.** A support assistant
confidently describing last quarter's interface is worse than one that says it
does not know — it is wrong with the platform's own authority behind it.

`packages/shared/test/support-knowledge.test.ts` holds the line it can hold
mechanically: every screen described with something worth reading, every path
named once, roles that match what the screen actually serves, and the specific
screen winning over the pattern that also matches. It cannot check that a
sentence is still true. That is a review question, on every change that touches
a screen.

## The learning loop

Cady ends every reply with a marker saying whether the answer came from the
material. It is stripped before anybody reads it and stored on the message, so
the questions the help does **not** cover are a list rather than an anecdote.

Administration → Help and support has that list on its own filter. Working
through it is how the material grows: a question about the product itself
belongs in the knowledge base above; one about this center belongs in an
article. The model never changes — the material does.
