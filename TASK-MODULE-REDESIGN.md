# Task module — redesign spec

Written against `TASK-MODULE-MAP.md` (repo read 2026-09-06). Everything here is a
change to the existing engine, not a rewrite. The generator, the deterministic
occurrence id, the org-tree authority model, the capability registry and the gate all
stay exactly as they are.

Read this whole file before writing code. Section 9 lists the decisions that are still
open — do not guess them.

---

## 0. Three words, and nothing else

The single biggest source of confusion in the current system is that a `task` is both
"a thing someone typed" and "a rule that generates work". Fix the vocabulary first and
the rest of the design falls out.

| Word | What it is | Collection | Generates work? |
|---|---|---|---|
| **Template** | A saved blueprint. Nobody is assigned. Nothing happens. | `taskTemplates` (new) | No |
| **Task** | A live assignment rule: who, when, how it is confirmed. | `tasks` (exists) | Yes |
| **Occurrence** | One person's copy for one date. | `taskInstances` (exists) | — |

Rules:
- These three words appear in the UI. `instance` never does — the user sees
  "occurrence" or just "task" in context.
- Do **not** rename the `taskInstances` collection. UI-only rename. Renaming the
  collection touches 60+ call sites for zero user benefit.
- A Template is created by "Save as template" on the assign form, or from an existing
  Task via "Save this as a template". Applying a template copies its fields into a
  fresh assign form. There is no live link afterwards — editing a template never
  changes a Task built from it.

---

## 1. Master data — what moves out of the task module

Most of this already lives outside `server/tasks/`. `server/org/tree.js` is a separate
module and the task engine only imports predicates from it. The problem is the **menu**,
not the code. So the move is mostly navigation plus a few new fields.

### 1.1 Organisation (already exists — just move the nav entry)

- Nodes: HQ → franchise → school, materialized `path`
- Levels & tiers with `rank`
- Positions (a person placed at a node with a level)
- Node working week (`node.settings.workWeek`) and holiday calendar

**Code change: none.** Move `Org Chart` from the Tasks menu to
Setup / Administration → Organisation.

### 1.2 People — new fields

Today a person is a `users` row plus one or more `positions` rows, and the only
work-time information is at the node. Add:

| Field | Where it lives | Falls back to |
|---|---|---|
| Name, photo | `users` (exists) | — |
| Mobile, WhatsApp number, email | `users` (partly exists — `notificationLog` already carries a phone) | — |
| Placement (node + level) | `positions` (exists) | — |
| Login role | `users.role` (exists) | — |
| **Working days** | `positions.workWeek: number[]` (new) | `node.settings.workWeek` |
| **Working hours** | `positions.hours: { [weekday]: { from, to } }` (new) | `node.settings.hours` (new), then nothing |
| Employment status | `positions.status: 'active' \| 'on_leave' \| 'left'` + `effectiveFrom/To` (new) | `active` |

**Working days go on the position, not the person**, because one person can hold two
positions at two schools with different weeks. Resolution order is always
position → node → default.

Two engine changes follow, both small:

1. **`generate.js` ~line 977** currently reads
   `workWeek: node?.settings?.workWeek`. Change to
   `workWeek: pos.workWeek ?? node?.settings?.workWeek`.
   This is inside the per-position loop already, so it is a one-line change and a real
   correctness win: a part-time teacher stops getting Wednesday occurrences.

2. **`escalation.js` `slaDeadline`** takes `workWeek` from the node. It should take it
   from the **approver's** position, since the SLA is the approver's clock, not the
   assignee's.

Working **hours** are deliberately not wired into deadlines by default — see decision
D3 in section 9.

`positions.status` also needs honouring in `resolveTargets`: a position marked `left`
must stop matching. Add the filter in `resolve.js` next to the de-dupe, so it applies to
all target shapes at once.

### 1.3 Task setup masters

| Master | Collection | Fields | Notes |
|---|---|---|---|
| Categories | `taskCategories` (exists) | name, colour, active, `escalationPolicyId` | Already there. Just needs a Setup screen. |
| **Priorities** | `taskPriorities` (new) | name, `rank` (integer, low = more urgent), colour, active | Seed the current four at ranks 10/20/30/40. `tasks.priority` becomes an id. See migration M3. |
| **Tags** | `taskTags` (new) | name, colour, active | `tasks.tagIds: string[]`. Controlled list, not free text — free text becomes 40 spellings of "compliance" within a month. |
| **Task templates** | `taskTemplates` (new) | name, description, and the whole assign-form payload with targets optional | See §0 |
| **Day-end forms** | `dayEndForms` (new) | name, `questions[]`, `nodeIds[]`, `levelIds[]`, active | See §4 |

`priority` becoming an id is the only one with teeth: `PRIORITY_LABEL`,
`PRIORITY_COLOR`, the gate sort, and three analytics roll-ups all key off the string
today. The `rank` field is what keeps sorting working after the change — sort by rank,
never by name.

---

## 2. Targeting — one shape instead of five kinds

### The problem

`targetFromPick()` picks **one** `kind` by precedence: named people beat roles beat
nodes. So the three selects cannot genuinely combine, and "every Teacher at Jubilee
Hills plus Priya from HQ" is not expressible.

### The new shape

```js
target = {
  nodeIds: [],            // where — empty means "my whole downline"
  levelIds: [],           // roles — empty means "every role"
  positionIds: [],        // named people
  excludePositionIds: [], // subtract these, whatever else matched
  includeSubtree: true,
  followJoiners: true,    // recompute each generation run, or freeze the list
}
```

Resolution:

```
if positionIds.length:
    base = positionIds                       // exactly these people
else:
    base = positions where nodeId ∈ expand(nodeIds) and (levelIds empty or levelId ∈ levelIds)
result = base − excludePositionIds − positions the actor cannot manage − positions with status 'left'
```

`nodeIds` empty means the actor's own subtree, which is what `node_level` already does
when no nodes are named. Keep that.

`followJoiners` replaces what `kind` used to encode: `position`/`user` were frozen,
`node_level`/`node`/`downline` were recomputed. Default it to `true` when
`positionIds` is empty and `false` when it is not — that matches today's behaviour, so
nothing changes for existing tasks.

`kind` stays on the stored row as a **derived, display-only** field so
`AssignedByMe` and the audit log keep reading something sensible. Compute it:
named people → `position`, roles → `node_level`, nodes only → `node`, all empty →
`downline`.

### Rejections stay

Keep the current rule: an explicitly named person out of the actor's reach is a
**named error** the assigner must see; a broad match silently skips peers and seniors.
That rule is load-bearing and tested — do not change it.

### Migration M1

Map the five existing kinds onto the new shape. `user` kind → all positions of those
users into `positionIds`. `downline` → everything empty. Set `followJoiners`
per the rule above. Write both shapes for one release: `resolve.js` reads the new
shape, falls back to the old fields when `nodeIds`/`levelIds`/`positionIds` are all
absent — same trick `targetLevelIds()` already uses for `levelId` → `levelIds`.

---

## 3. The task itself

### 3.1 Deadline, expiry, and stop-repeating are three different things

They are constantly confused. Use three different words in the UI and never abbreviate
any of them to "expiry".

| Concept | Field | Meaning | What happens at it |
|---|---|---|---|
| **Deadline** | `dueAt` (exists) | When it should be done by | Status flips to `overdue`. Still submittable. |
| **Closes on** | `expiresAt` (new) | The last moment it can be submitted at all | Status flips to `expired`. Terminal. |
| **Stop repeating on** | `recurrence.endDate` (exists) | When the rule stops making new occurrences | No more occurrences. Existing ones unaffected. |

`expiresAt` is configured relative to the deadline, not as an absolute date:
`expiry: { mode: 'never' | 'end_of_day' | 'after_days', days: n }`. Default `never`,
which is exactly today's behaviour, so nothing changes for existing tasks.

**New status `expired`.** Add to `INSTANCE_STATUSES` and `TERMINAL_STATUSES`. It is not
in `OPEN_STATUSES`, so the gate stops holding someone hostage to work that can no
longer be done — which is the main reason to build this at all.

Sweep it in `syncTasks()` alongside `refreshOverdue()`:

```js
export function expireStale(now = new Date()) { /* OPEN_STATUSES && expiresAt <= now */ }
```

Analytics needs an `expired` column, and `evaluate()` in `gate.js` needs no change
(it already filters on `OPEN_STATUSES`).

Note the existing `'rejected'` entry in `INSTANCE_STATUSES` is dead — nothing writes it,
`decide()` writes `in_progress`. Remove it in the same pass or leave it; do not add a
second dead status next to it.

### 3.2 Automation

`origin: 'manual' | 'automated'` already exists and `recurrence` already handles daily /
weekdays / weekly / monthly / specific weekdays with an interval. **No engine change
needed.** What needs work is the form:

- "Just once / It repeats" is right. Keep it.
- Repeat options: Every day / Certain days of the week / Every week / Every month.
  "weekdays" and "weekly" are the same thing to a user with different UI — merge them
  into "Certain days of the week" with the 7 toggles, and keep "Every week on ___" out
  of the UI entirely. It maps to `freq: 'weekdays'`.
- `interval` ("every 2 weeks") is currently reachable but unlabelled. Either expose it
  as "Repeat every ___ weeks" or drop it from the UI. Do not leave it half-exposed.
- Show the next 5 dates the rule produces, live. `src/services/tasks/recurrence.js`
  already computes this — it just is not shown on the repeat step.

### 3.3 Completion — collapse three natures into two

Current: `mcq` | `module_linked` | `custom`, mutually exclusive, each with its own
sub-object and its own branch in `evaluateCondition`.

Proposed:

```js
completionCondition = {
  mode: 'answers' | 'system' | 'both',

  questions: [                          // 1..n, used when mode is 'answers' or 'both'
    {
      id: 'q1',
      type: 'yes_no' | 'choose_one' | 'checklist' | 'text' | 'number' | 'file',
      prompt: 'Did you give food to the day-care children?',
      required: true,
      options: [ { value, label, accepts } ],   // choose_one, yes_no
      items:   [ { id, text, required } ],      // checklist
    }
  ],

  system: { moduleKey, signalKey, paramBinding } | null,   // mode 'system' or 'both'

  proof: { required: false, types: ['photo'], min: 1 },
}
```

Why this is a simplification and not just a reshuffle:

- Today's `mcq` is **one** `choose_one` question. Today's `custom` is **one**
  `checklist` question plus an optional `text` question. Both migrate mechanically.
- "Multi-question" — which you asked for — is free. It is just `questions.length > 1`.
- `mode: 'both'` is genuinely new and is what the day-end report needs: the system
  rolls up the day, *and* they answer some questions about it. Today those are mutually
  exclusive, which is why the day-end report has to fake it with
  `custom.submitPayload: 'day_end_report'` — a field that, per §9 of the map, is written
  and read nowhere.

Answers are stored as `completion.answers = { [questionId]: value }`, replacing
`completion.{answer, checked[], note}`.

`evaluateCondition` becomes: run the system check if there is one (unchanged, still
the pull guard in `submitWork`), then walk the questions. Return the same
`{ satisfied, verifiable, code, message, missing[] }` shape it returns today — every
caller and every test depends on that shape, and `verifiable: false` meaning "cannot
judge" rather than "no" must survive intact.

**Do not touch `verifyInstance` or the push/sweep/pull triangle.** That code is correct
and is the most carefully reasoned part of the engine. Only the `nature` dispatch
above it changes.

#### Migration M2 (`_tasksV9`)

Rewrite `completionCondition` on **both** `tasks` (12 rows) and the snapshot on
`taskInstances` (655 rows). This is the migration most likely to break something,
because the snapshot is what an in-flight occurrence is judged against.

```
mcq            → mode 'answers', one choose_one question (yes_no if exactly 2 options)
custom         → mode 'answers', one checklist question + one text question if requireNote
module_linked  → mode 'system', system = the existing moduleLinked object
requireMedia / mediaTypes / minAttachments → proof {}
```

Also migrate `completion.{answer, checked, note}` on any occurrence that has them.
Per the map, `completion` is `null` on all 655 rows today, so in practice there is
nothing to move — but write the code anyway, because production will not be empty.

Keep a read-time shim in `conditions.js` for one release: if `nature` is present and
`mode` is not, convert on read. Same pattern as `targetLevelIds()`.

### 3.4 Attachments as proof

Already works (`requiresMedia`, `mediaTypes`, `minAttachments`, `taskAttachments`,
per-round proof). Just move the three fields under `completionCondition.proof` in M2
and keep the server-side enforcement in `submitWork` exactly as it is. Note `mcq`
currently has its **own** `requireMedia` flag as well as the task-level one — collapse
both into `proof`.

---

## 4. Day-end report

It already is a task (`dayend.js` builds a template per position, `gateOrder: 100` so it
sorts last, submitting it files the report, unfiled ones lapse). Keep all of that.

What changes:

1. **The form is configurable.** A `dayEndForms` master holds a `questions[]` array in
   exactly the shape from §3.3. `syncDayEndTemplates()` picks the form matching the
   node (then the level, then a global default) and writes its questions into the
   generated template's `completionCondition` with `mode: 'both'`.

2. **The roll-up stays and stays read-only.** It is computed server-side, shown above
   the questions, and frozen into the filed report. Do not let anyone edit it — the
   whole point is that it is the system's account of the day, not the person's.

3. **Forms are templates.** Save one, name it, assign it to a node or a level. That is
   what "can be saved as a template to assign for someone else" means here.

4. **Fix `gateOrder` first.** Per §9.1 of the map, `normalizeTask` (`model.js:127-152`)
   builds the stored task field by field and omits `gateOrder`. So `PUT /tasks/:id` on a
   day-end template writes `undefined` onto every future occurrence and the report stops
   sorting last. One line. Do it before touching anything else in this file.

---

## 5. Menu

### Task module

```
TASKS
  Finish before today   ← badge; hidden entirely when the count is 0
  My tasks
  Assign                ← Create · Templates · Assigned by me  (three tabs)
  Approvals             ← Awaiting me · Re-edit requests · Held at the door
  Reports               ← My team · Me · Day-end reports received
```

- **Finish before today** is the gate's `armed` list — mandatory work from a strictly
  earlier local day. It is the only screen that should ever be red. Do not show it when
  empty; a permanently visible empty warning trains people to ignore it.
  Note the existing distinction: `blocked` (deadline arrived, refuses logout) vs
  `armed` (from an earlier day, refuses writes). This screen is `armed`. The logout
  modal is `blocked`. Two different lists, and the map shows they are easy to confuse.
- **My tasks** keeps the six buckets. Today's `/tasks` landing page merges into it as
  the default view.
- **Held at the door** is today's `Blocked.jsx`, which currently has a route but is
  missing from the tab list — so it is reachable only by typing the URL.
- **Day-end reports received** is today's `/tasks/day-end/received`.

### Setup / Administration

```
ORGANISATION
  Org chart
  Nodes & branches
  Levels & tiers
  People
  Working days & holidays
TASK SETUP
  Categories
  Priorities
  Tags
  Task templates
  Day-end report forms
  Escalation policies
```

Escalation policies have no UI at all today (`escalationPolicies` has 0 rows and nobody
has ever written one). Put the screen here.

While moving it: `POST /escalation-policies` and `PUT /escalation-policies/:id` are the
**only two** task endpoints not exempt from the task gate, because the path matches none
of the patterns in `gate.js:31-38`. So a gated admin cannot configure escalation.
Add `/^\/escalation-policies(\/|$)/` to `EXEMPT`.

---

## 6. UI

### Library

**Stay on Mantine 8. Do not add a second library.** Three of fourteen task screens are
on it; eleven are on hand-rolled CSS classes (`.btn`, `.card`, `.table-wrap`,
`.page-head`). Two systems side by side is already the worst state — a third would be
worse than either. Finish the migration in this order, highest traffic first:

1. Assign form (already Mantine) + the new masters screens
2. My tasks, Finish before today
3. Approvals
4. Task detail
5. Reports

Add `@mantine/dates`, `@mantine/form` and `@mantine/notifications` if not already
present. `react-hook-form` and `zod` are dependencies but the assign form does not use
them — either adopt `@mantine/form` throughout or drop the unused deps. Do not run both.

The eight vitest render smoke tests exist for exactly this: a wave that breaks a screen
should fail the suite, not your browser. Add one per new screen.

### Plain English

| Do not say | Say |
|---|---|
| instance, occurrence (in body copy) | this task, today's task |
| nature, signal, binding, capability | how we know it's done |
| module-linked | the system checks it |
| target, downline | who it's for, your team |
| escalate, SLA breach | nobody has decided yet — it moves up |
| overdue vs expired | late / closed |
| blocking task | must be done before you sign off |

Existing good practice to keep: every step in the assign form prints a read-back
sentence saying what was actually chosen ("Every Teacher and Day Care Staff at Jubilee
Hills — including anyone who joins later"). Extend this to every new step. It is the
single most useful thing in the current form.

### Mobile

Teachers will use this on a phone. My tasks, Task detail, and Finish before today must
work at 360px. The assign form can stay desktop-first — principals assign at a desk.

---

## 7. Build order

Each phase leaves the app working.

**Phase 0 — bug fixes, no behaviour change** (half a day)
- `gateOrder` dropped by `normalizeTask` (§9.1 of the map) — writes `undefined` onto
  live occurrences today
- `/escalation-policies` gate exemption (§9.2)
- `AssignedByMe.jsx:26` reads `t.levelId` so a multi-role task shows as one role (§9.6)
- `sweepModuleLinked` compares a local `serviceDate` to a UTC date (§9.4)
- Seed hand-writes occurrences without consulting `workWeek`, so the suite is red on a
  Sunday (§9.5). Either generate them or pin the test date. CI at a weekend is
  currently always red.
- `decorateInstance` overwrites four snapshotted fields with live template values (§9.7)

**Phase 1 — masters and the menu**
Priorities, tags, task templates, the Setup screens, the nav move. No engine change
beyond the priority id migration. Ship it — this alone makes the module feel organised.

**Phase 2 — people**
Working days and hours on positions, employment status, the `generate.js` one-liner,
the `resolve.js` status filter, the People screen.

**Phase 3 — targeting**
The new target shape, exclusions, `followJoiners`, migration M1, the rebuilt
`TargetPicker` with three genuinely independent multiselects.

**Phase 4 — completion**
Migration M2, the question-set editor, `mode: 'both'`, the reshaped
`evaluateCondition`. This is the riskiest phase; do it on its own.

**Phase 5 — expiry**
`expiresAt`, the `expired` status, the sweep, the analytics column.

**Phase 6 — day-end forms**
`dayEndForms` master, form builder, wiring into `syncDayEndTemplates()`.

**Phase 7 — finish Mantine**
Screen by screen, with a smoke test each.

---

## 8. Migrations

Follow the existing pattern: a flag-guarded block inside `initDb()`, runs once, sets its
flag, no down-migration.

| Id | What | Risk |
|---|---|---|
| `_tasksV9` | Completion condition → `mode`/`questions` on `tasks` **and** the snapshot on `taskInstances`, plus `completion.answers` | **High.** In-flight occurrences are judged against the snapshot. Test with an occurrence in every one of the 8 statuses. |
| `_tasksV10` | Target shape (M1) | Medium. Keep a read-time fallback for one release. |
| `_tasksV11` | Priority string → `taskPriorities` id, seeded at ranks 10/20/30/40 | Low, but touches every sort and three analytics roll-ups. |
| `_orgV2` | `positions.workWeek`, `positions.hours`, `positions.status` — all null, all falling back | Low. |

`_tasksV8` is the precedent for how much care this takes: retiring one on-complete
action meant rewriting the templates, the already-generated occurrences **and** the run
log, because the run log is keyed by `module.action` and is what stops a parent being
messaged twice.

---

## 9. Open decisions — do not guess these

**D1 — Priorities as a master, or a fixed four with editable labels?**
A full master means anyone can add "Super Urgent" at rank 5. A fixed four with editable
name and colour keeps sorting, colours and analytics predictable. Recommendation: the
master, with `rank`, because you asked for it — but seed exactly the current four and
make adding a new one an admin-only action.

**D2 — Do working *hours* affect deadlines?**
"By end of the day" could mean 23:59 local (today's behaviour) or the end of that
person's shift. The second is more correct and will surprise everyone the day it ships.
Recommendation: a node-level switch, default off, so nothing changes silently.

**D3 — Should a template ever stay linked to the tasks made from it?**
A live link means fixing a typo in the template fixes every task. It also means an edit
silently rewrites work already assigned. Recommendation: no link. Copy on apply.

**D4 — Where do received day-end reports live?**
Reports (an inbox you read) or Approvals (a queue you act on)? Acknowledging is an
action, which argues for Approvals; but it is not a decision, which argues for Reports.
Recommendation: Reports, with a badge.

**D5 — Does `expired` count against someone in analytics?**
It is the difference between "you failed to do it" and "the window closed". They should
not be one number. Recommendation: separate column, and exclude `expired` from
completion-rate denominators.

---

## 10. Do not change

Listed because the temptation will come up during Phase 4.

- The occurrence id `sha1(taskId|positionId|occurrenceKey)`. Idempotent generation is
  what makes the timer, the login catch-up and the lazy sweep safe to run at once.
- The pull guard in `submitWork` — the live signal re-read is the only trusted
  verification path. Push and sweep are latency optimisations and are allowed to be
  wrong.
- `runCompletionActions` claiming in `taskActionRuns` **before** the side effect, keyed
  on `(instanceId, module.action)` without the round. That is what stops a parent being
  told twice across a reject → resubmit cycle.
- `canManagePosition` — same node means strictly lower rank, different node means strict
  ancestry. Both authority systems (role permissions and the org tree) must keep being
  checked independently.
- `taskLock.check` failing **open** when the provider throws.
- Actions firing only on terminal completion, never on submit-for-approval.
- Rejection writing `in_progress` and bumping the round, so mandatory work keeps
  blocking until it is actually approved.
