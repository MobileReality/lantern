# The lantern 1 format

Line-based, parsed without an LLM. It uses the `+ ~ - .` markers, `path#symbol`, `>` for data
direction, `|` before free text and the first `#` line as the description. The unit is every file at rest.

## Layout

```
.lantern/
  ignore                    optional, gitignore syntax — extra excludes for this project
  include                   optional, gitignore syntax — extra markdown files to map (see Mapped files)
  features                  optional, the project's feature ids, one per line
  systems                   optional, the project's outside systems, one id per line (see Systems)
  platforms                 optional, the project's platforms and their path rules (see Platforms)
  areas                     optional, groups the features into product areas (see Areas)
  map/
    .lantern                records for files in the project root (no directory can
                            collide: `.lantern` dirs are never mapped)
    src.lantern             records for files directly in src/
    src/services.lantern    records for files directly in src/services/
  lang/
    en/                     texts, one folder per language (see Texts)
      .lantern.json         texts for map/.lantern
      src.lantern.json      texts for map/src.lantern
      src/services.lantern.json
      features.json         feature descriptions
      systems.json          outside-system descriptions (see Systems)
      platforms.json        platform labels (see Platforms)
      areas.json            area descriptions (see Areas)
      sections/rbac.json    section texts (see Sections)
  sections/                 optional, project-wide sections (see Sections)
  prs/
    24.pr                   optional, one record per pull request (see Pull requests)
    dismissed               optional, ids of dismissed pull requests (see Pull requests)
  plans/
    add-planning.plan       optional, one plan per change, written by lantern-plan (see Plans)
```

One map file per source directory, holding records only for that directory's **direct**
files. `validate.mjs` rejects a record in the wrong file. Nothing else goes in `.lantern/`
(the exceptions are `prs/` and `plans/`, which setup never writes).
A section's language file ends in `<id>.json`, never `.lantern.json`, so it cannot collide with
a map file's texts for a source directory named `sections/`.

## Mapped files

A record exists for every source file `enumerate.mjs` lists: code, configuration and the
instruction files agents read. Markdown is not source by default; a `.md` or `.mdx` file is mapped
only when one of these holds, so a repository's documentation stays out of the map:

- it is in or below a **skill folder**, a folder that holds a `SKILL.md`;
- it is named `SKILL.md`, `CLAUDE.md`, `AGENTS.md` or `GEMINI.md` (any depth), or is
  `.github/copilot-instructions.md`;
- it is under `.claude/commands/`, `.claude/agents/` or `.claude/rules/` at the project root (inside
  `.claude/` only markdown is mapped; skills in `.claude/skills/` count by the first rule);
- it matches a pattern of `.lantern/include` (gitignore syntax, markdown only; `docs/`,
  `docs/architecture/*.md`).

`.gitignore`, `.git/info/exclude` and `.lantern/ignore` still apply and win over every rule above, and
so do the generic skips (empty, binary, over 1 MB, `@generated`, symlinks, dependency and build
folders) and the Lantern app's own installs (a folder with a `.lantern-bundle` marker; the files named
in `.claude/agents/.lantern-bundle-agents` and `lantern-mapper.md`).

Markdown mapped by the first three rules has role `skill`, and role `skill` belongs to markdown only
(`validate.mjs`); a file that `.lantern/include` adds may take another role when it is no instruction
for an agent (a prompt template the app sends to a model is `ai`). A map without markdown records is
still valid: the files appear as unmapped until a refresh maps them.

## A map file

```
lantern 1
# src/services

src/services/orderService.ts . service 3f9a1c2b4d5e
  = src/db.ts#db
  < src/types/order.ts#Order
  > src/services/mailService.ts#notifyShipped
  = ext:hosted-database
src/services/mailService.ts . gateway 9c01de77aa20
  > ext:mail-relay
```

Records carry structure only. Every word of prose is in `lang/<code>/src/services.lantern.json`
(Texts, below).

- **Line 1** is `lantern 1`. **The first `#` line** is the directory it covers — exactly the
  map file's path below `map/` without `.lantern`, or `.` for the root; the validator checks
  it. `#` lines start at column 0. Later `#` lines and blank lines are ignored.
- **No model line.** The map records no model: the floor is enforced when a run starts
  (`model.mjs check`), so any agent that passes it continues any map. A `#model <id>` line from
  an older map is ignored like any other `#` line; `scripts/migrate-model.mjs` strips it, once
  for the whole map, in its own commit. Update the skill before pulling a migrated map: an older `validate` fails on sections and texts without a model, and an older `finish` resets every map file.
- **Record** — starts at column 0:
  `<path> <marker> <role> <hash>`
  - `path` — from the project root, `/`-separated; a space is written `%20`, `#` is `%23`,
    `%` is `%25` (so a record never starts with `#` and `#symbol` stays unambiguous).
  - `marker` — see below.
  - `role` — exactly one word from `roles.md`.
  - `hash` — first 12 hex chars of SHA-256 of the file with `\r\n` normalised to `\n`.
    `plan.mjs <root> chunk <id>` prints it; never compute it by hand.
  - Its **purpose** — one line, a few words, what the file is **for**, not how — is a text,
    required for every record.
- **Record notes** — optional `#` lines at column 0, directly under the record they
  describe (before its relations). All absent by default; each at most once per record.
  - `#feature <id>` — the business area, one id from `.lantern/features`.
  - `#see-also <path> [<path>...]` — file(s) this one is easily mistaken for. Only
    when the confusion is non-obvious (a misleading name or folder, a twin doing a nearby job).
    Every path must be a mapped file, not the record itself; paths are encoded like record paths.
    Its optional **why** is a text.
  - `#plumbing` — no value. Retag mode's mark that the file was reviewed and deliberately has no
    feature (it supports a capability but is none itself). Written only by `retag.mjs tag-file <path> --none`;
    `plan.mjs . retag` never lists a marked record again and `macro-eval.mjs` counts it as resolved,
    not as untagged. A record has `#feature` or `#plumbing`, never both (`validate.mjs` fails it);
    tagging a feature removes the mark. Old readers skip it like any comment, so no version bump.
  - A **gotcha** has no line of its own: it is only a text — one line on a pitfall the code
    doesn't show (an ordering rule, a hidden side effect, a file that looks live but is not
    routed). Under ~120 characters. Never restate what the file does, never a TODO.

  ```
  src/pages/OrderHistory.tsx . page 3f9a1c2b4d5e
  #feature ordering
  #see-also src/pages/admin/orders/index.tsx
    = src/services/orderService.ts#getAllOrders
  ```

  They are `#` lines, so a `lantern 1` parser that predates them skips them like any other
  comment: no version bump, old maps and old readers both keep working. A record needs no note.
- **Relation** — indented, belongs to the record above it:
  `<arrow> <target>`; its optional label (what flows) is a text.
  - `>` this file sends data **into** the target (calls it with a payload, writes, renders it with props, emits to it).
  - `<` this file takes data **from** the target (reads, queries, imports its types or constants).
  - `=` both — calls it and uses what comes back. The common case for a service call.
  - `@` this file **refers to** the target: it tells its reader to read, load, run, follow or use
    it ("read `protocol.md`", "load the `lantern-commit` skill", "run `scripts/preflight.mjs`"). Not a data
    flow, and not an import: nothing is passed, only a pointer. The arrow of every relation of a
    role `skill` file (a SKILL.md, protocol, reference, agent or command file) and of no other role;
    `validate.mjs` fails `@` on a code file and a data arrow on a `skill` file. Direction is always
    from the file that names the target. Two files that point at each other each carry one `@`, and
    the viewer draws the pair as both ways. How a mapper finds and judges the pointers:
    `SKILL.md`, "Skill files and references".
  - `target` — a mapped path, optionally `#symbol` (function, class, component, channel — must
    appear literally in the target file), or `ext:<name>` for a **system** outside the repo the
    file talks to (a hosted service, a third-party API, a database or queue it does not own) —
    not for libraries, frameworks, internal modules or environment variables. One system has one
    name everywhere. When `.lantern/systems` exists, `validate.mjs` warns about an `ext:` target
    that is not listed there (see Systems).
  - A relation needs no import. A network call into this repository points at the file that handles
    it, and a file that builds, deploys or runs a service points at that service's Dockerfile, entry
    or manifest, even across platforms (`SKILL.md`, "Relations that cross platforms").
  - Every relation lives on the file that **names** the other one (the importer / caller). Don't
    write the reverse edge on the target — a program derives "used by" from the forward edges.

  `@` is the one addition to the arrows. It keeps `lantern 1`: records and every other line are
  unchanged, and a map without markdown never contains it. A reader from before it reports the line
  as a malformed relation and skips it; the app and the scripts of this checkout read it.

Classify a line by its first character: non-space → record; space → relation. Inside a line,
only look for tokens before the first ` | `: text after it is legacy inline prose (below).

## Texts

All prose lives in `lang/<code>/`: one JSON file per map file, at the map file's path below
`map/` plus `.json` (`map/src/services.lantern` → `lang/en/src/services.lantern.json`), and
`lang/<code>/features.json` for `features`.

```json
{
 "text": {
  "orderService.ts": "order CRUD against the hosted database",
  "orderService.ts gotcha": "payment lowers stock; cancel never gives it back",
  "orderService.ts see-also": "stock levels live in the older service",
  "orderService.ts = src/db.ts#db": "order docs",
  "mailService.ts > ext:mail-relay": "message JSON"
 }
}
```

- **Keys are computed from the record, never chosen.** `n` is the record path's last segment as
  written (encoded, so it has no space); the directory is the map file's.

  | text | key | needed |
  |---|---|---|
  | purpose | `n` | always — validation fails without it |
  | gotcha | `n gotcha` | optional |
  | see-also why | `n see-also` | optional; only with a `#see-also` line |
  | relation label | `n <arrow> <target>`, target exactly as in the relation line | optional |
  | feature description | `<id>`, in `features.json` | expected; missing warns |

  `gotcha`/`see-also` can't clash with an arrow, and a relation is unique by arrow + target, so a
  refresh that keeps a relation keeps its key — and its translations.
- **One file per map file** keeps writes disjoint: chunks run in parallel only on disjoint map
  files, so they write disjoint language files too. `features.json` is written once, by the main
  agent, before any chunk.
- **No `model` field.** A `"model"` field from an older map is ignored (and stripped by
  `migrate-model.mjs`).
- **Other languages** are optional and may be partial: the viewer falls back per key to the
  primary text (marked). `node $L/scripts/lang-todo.mjs <code>` lists exactly the keys a language
  still lacks, with the primary text beside each; `validate.mjs` warns with each language's
  missing count and coverage. A key that matches no record is an **orphan** (warning).
- **Legacy inline prose.** Maps written before this split carry `| purpose` on records,
  `| label` on relations, `#gotcha <text>`, `#see-also … | why` and `<id> | <desc>` in
  `features`. They still validate and render: where the primary language has no file text for a
  key, the inline text is the primary text. `node $L/scripts/migrate-lang.mjs <root> [--lang
  <code>]` moves it into `lang/<primary>/` deterministically — no source reading, hashes and
  structure untouched; `--lang` only asserts the primary code and refuses any other. A text
  in another language counts only where the primary language has one — a key with no primary
  text is an orphan there, never shown. A key set in both places warns; the language file wins.

## Features

`.lantern/features` declares the tag list once for the whole project:

```
# comment lines and blank lines are ignored
auth
ordering
```

`<id>` is lowercase kebab-case, unique; what belongs there is its text in
`lang/<code>/features.json`. Keep the
list under ~12 (the validator warns above; ~30 once `.lantern/areas` exists). A `#feature` naming an id not in the file — or any
`#feature` when the file does not exist — fails validation. Derive the list from the directory
and route structure, not from file names; a file that fits no feature gets no tag.

A feature is a capability the product offers its users, so its id is never a platform id, a
delivery channel, a client type or a vendor, and the same capability on two platforms carries
the same id. `validate.mjs` warns (an error with `--strict`) on a feature id that equals a platform
id or contains one as a whole hyphen-separated word, and on one that equals an `ext:` target or a
listed system.

## Systems

`.lantern/systems` is the optional canonical list of the outside systems an `ext:` target may
name, in the style of `features`:

```
# comment lines and blank lines are ignored
mail-relay
payment-gateway
```

`<id>` is lowercase kebab-case, unique, one per line; its optional short text (under 80
characters) is in `lang/<code>/systems.json` under the id, like a feature description. Only
`systems.mjs` writes the list (`add`, `seed`), plus `retag.mjs` when it renames or merges one; chunk
mappers and delegates read it. A system is a hosted service, a third-party API, a database or
queue the project does not own, never a library, framework, internal module or environment
variable.

With the file present, `validate.mjs` warns on an `ext:` target missing from it (naming the
listed id it probably means), and, with or without it, on `ext:` ids that normalise to one name
(they differ only by `-api`, `-sdk`, `-client`, `-service`, `-rest`, `-http` or a plural) and on
an `ext:` id used by one record only that looks like a package (`@scope/x`, `a/b`, `npm:x`, a
`.js` name). These warnings carry `[vocabulary]`; `--strict` makes them errors. A malformed
`systems` file is always an error. Without the file nothing is checked against a list.

## Areas

`.lantern/areas` is the optional two-level grouping of the features into product areas, in the
style of `features`: plain text, `#` comments and blank lines ignored, one id per line, nesting by
exactly two spaces. A line with no indent is an area; an indented line is a feature id from
`.lantern/features` (a leaf). File order is draw order. Without the file nothing is checked and
nothing changes.

```
# comment lines and blank lines are ignored
order-handling
  catalog
  orders
money-matters
  payments
  invoices
delivery-and-returns
  shipping
  returns
people-and-insight
  accounts
  reports
```

An area's one-sentence text is in `lang/<code>/areas.json` under its id, like a feature
description: `{"text": {"order-handling": "taking orders and following them to the door"}}`.
The shown name is the id in sentence case, so the id has to read well on its own.

`areas.mjs propose` prints the evidence for drafting this file (features with their partners,
feature-to-feature weights, unnamed candidate groups) and `areas.mjs check` applies the quality
rules the validator leaves out: the area count (4 to 7), cohesion against random groupings,
platform, channel, vendor and layer words in names, name shape and anchor, and the one-sentence
purpose of 4 to 20 words. Neither writes the file; no rule judges an area by its share of files.
Exit 0 passes, 1 a rule failed, 2 the file is missing or unreadable.

`validate.mjs` reports `[areas]` findings, counted in its summary; only when the file exists.
Errors: a feature listed twice; a leaf not in `.lantern/features`; a `core:*` id (foundation
blocks stay out); an area with no children; a line nested deeper than two levels; an area id that
is not lowercase kebab-case, is used twice, or equals a feature, platform or outside-system id;
more than 7 areas; more than 7 children in an area. Warnings: a declared feature that has
records but sits in no area (the Macro view will show it under "To assign"; the tree stays
valid); an area id containing a platform id, an outside-system id or a channel or layer word
(`web`, `mobile`, `api`, `backend`, `service`, `misc`, ...) as a whole word (an error with
`--strict`); an id of one word; a count of areas outside 4 to 6 (a quiet seventh is fine); an
area with one child; an area without a primary-language text; a key in `areas.json` that names
no area. Every message gives `file:line`, the id and the fix.

## Markers — in-progress tracking

| marker | meaning | validator |
|---|---|---|
| `.` | at rest: mapped, hash matches the file | file must exist, hash must match |
| `~` | being changed right now | file must exist; hash may lag |
| `+` | being added; file may not exist yet | hash may be `-` |
| `-` | being removed | file may already be gone |

A marker may carry an owner: `~@feat-cache`, `+@agent-3f2a`. The owner is a `[\w.-]+` token
naming whoever holds the file (a branch, an agent id), so a program can show who is working
where and a stale claim can be traced. Setup writes only `.`; `--settled` makes any other marker
a failure, which is how setup proves it left nothing half-claimed. Setting and clearing these
during normal work belongs to a separate skill, not this one.

## Staleness

The hash is the whole staleness mechanism: a program re-hashes the file and compares, no
reading, no LLM, no git. A record whose hash differs is **stale** — its role, purpose and
relations may still be right, but nobody has confirmed it since the file changed. A missing file
with a `.` record is **gone**. A file with no record is **unmapped**.

## Language

Only texts are language-dependent. Everything in a map file — role ids, markers, arrows, paths,
`#symbols`, the `lantern 1` header — is the same in every language, so `service` is `service`
everywhere. The mapper writes texts in the primary language from `node $L/scripts/lang.mjs .`
(`LANTERN_LANG` in the environment, else the existing map's language; default `en`) into `lang/<that code>/`.
The validator does not judge language.

Still `lantern 1`: a keyed map uses only syntax `lantern 1` already allowed — the ` | text` parts
were always optional to the parser — so no reader breaks; an older reader just shows no
purposes until it reads `lang/`.

## Sections

Optional project-wide facts that no single record holds — who may do what, how an entity's status
moves, what the data store looks like — written once by the main agent after mapping. A map
without `sections/` is complete; readers that predate them never look in the folder.

```
.lantern/
  sections/
    rbac.section            one file per section; the file name is its id (kebab-case)
    states.section
  lang/en/sections/
    rbac.json               its texts, {"text": {…}} like every lang file
```

```
lantern-section 1
# rbac

role manager @ src/services/authService.ts#MANAGER_EMAILS
res cancel-order @ src/api/routes.ts#cancelOrder
cell manager cancel-order allow @ src/api/guards.ts#requireRole
```

- **Line 1** `lantern-section 1`; **the first `#` line** is the type — `rbac`, `states`, `db` or
  `facts` (anything else fails). An optional `#platform <id>` line scopes the section to one
  platform (Platforms); without it the section belongs to all. Like map files, sections record no
  model; an older `#model` line is ignored.
- **Item** — `<kind> <args…> @ <path[#symbol]> [<path[#symbol]>…]`. Every item cites at least
  one **mapped** file (encoded like record paths); a `#symbol` must occur literally in it. No
  citation, no item: evidence you can't point at is a guess.
- Ids are single tokens (`[A-Za-z0-9_$][\w$.:-]*`); a field type is any token without spaces or `@`.
- Texts are keyed `<kind> <key args>`, so a refresh that keeps an item keeps its key and its
  translations. Every section may have `title` and `intro`; `title` is required for `facts`.

| type | item | args | key | text |
|---|---|---|---|---|
| `rbac` | `role` | `<role>` | `role <role>` | required — who they are |
| | `res` | `<res>` | `res <res>` | required — the area or resource |
| | `cell` | `<role> <res> allow\|deny\|cond` | `cell <role> <res>` | required for `cond` (the condition), else optional |
| | `source` | `<id>` | `source <id>` | required — how a user's role is decided |
| | `guard` | `<id>` | `guard <id>` | required — what this enforcement point checks |
| `states` | `machine` | `<m>` | `machine <m>` | required — the entity and field |
| | `state` | `<m> <state> [initial] [terminal]` | `state <m> <state>` | required — what the state means |
| | `tr` | `<m> <from> <to>` | `tr <m> <from> <to>` | required — the trigger; cite the file that performs it |
| `db` | `entity` | `<e> table\|collection\|view\|document\|other declared\|inferred` | `entity <e>` | required |
| | `field` | `<e> <name> <type> declared\|inferred` | `field <e> <name>` | optional — notes |
| | `rel` | `<e> <field> ref\|fk\|embed <target>` | `rel <e> <field> <target>` | optional |
| | `own` | `<e>` | — | none; cites the repository files that own it |
| `facts` | `item` | `<id>` | `item <id>`, `item <id> note` | item required, note optional |

- **References** — a `cell` names a declared `role` and `res`; a `state` or `tr` a declared
  `machine`, and `tr`'s `from`/`to` states of that machine; `field`, `rel` (both ends) and `own` a
  declared `entity`. Order inside the file is free. A key used twice fails.
- **`declared`** means read from DDL, a migration, an ORM entity or security rules; **`inferred`**
  means read off repository code and types. A Firestore project with no rules in the repo is all
  `inferred`.
- `validate.mjs` fails on everything above and on a required text missing in the primary
  language; it warns on a matrix gap, a machine with no `initial` state and orphan keys, and
  prints one line per section: its item counts, other languages' coverage, `OK` or `FAIL <n>`.

## Platforms

Optional. A repository that holds several kinds of code (front end, back end, mobile, infra, a
watch app) declares them once; the viewer then shows one tab per platform. A map without
`platforms` — or with one platform — is complete and renders exactly as before.

```
# <id> <kind> <glob>...   first matching rule wins; files no rule claims are shared
web      web      src/** public/**
backend  backend  functions/**
watch    other    watch/**
```

- **Line** — `<id> <kind> <glob>...`: an id (lowercase kebab-case, unique; `shared` and `all` are
  reserved), a kind, and at least one path rule. `#` lines and blank lines are ignored.
- **Kind** — `web`, `backend`, `mobile`, `desktop`, `infra` or `other`; anything else fails. The
  kind picks the tab's layer profile (below). `other` is the open one: a smartwatch, a TV OS, a
  game client — it must carry its own label.
- **Rules** — gitignore-style globs matched against each file's path from the project root: a
  pattern with a `/` is anchored at the root (`functions/**`), one without matches a file name at
  any depth (`*.tf`), a trailing `/` is shorthand for `<folder>/**` from the root. A bare folder
  name matches only a file of that name, so write `functions/**`. No `!` negation.
- **Overlap: first match wins**, in file order (line by line, rule by rule). Put the narrow
  platform above the broad one. A first-match list is what the author can read off top to bottom,
  and two mappers get the same answer without ranking "specificity". `plan.mjs <root> chunk <id>`
  prints each file's platform, so the outcome is never a guess.
- **Unmatched files are `shared`.** Root configs and cross-cutting files belong to no single
  platform. `shared` is not declared: it becomes its own last tab when at least one mapped file
  falls into it. It is not repeated inside every tab, so each file sits in exactly one tab, the
  tab counts add up to the total, and a platform's Support column is not padded with the root
  `package.json`. A relation from a platform file into `shared` (or the other way) shows as a
  boundary link like any other.
- **Labels are texts.** `lang/<code>/platforms.json` is `{"text": {"<id>": "<label>"}}`,
  written like every primary-language file. The
  label of `other` is required in the primary language; for the other kinds it is optional and the
  tab falls back to the viewer's name of the kind (`Web`, `Backend`, ...) in the viewer language.
  Other languages are translations: `lang-todo.mjs <code>` lists the missing labels, the viewer
  falls back to the primary label.
- **Section scope** — a section file may carry one `#platform <id>` line (Sections). A scoped
  section shows in that platform's tab and in All; an unscoped one shows everywhere. An id that is
  not declared fails.

**Layer profile.** A kind chooses which layer columns its tab uses and what they are called; the
roles are the same everywhere, only the reading changes. A role whose layer the kind hides falls
into Support. Empty columns never show.

| kind | hides | names and captions |
|---|---|---|
| `web`, `other`, `shared` | — | the default layers |
| `backend` | Presentation | Endpoints (requests and jobs arrive), Business logic, Data & services |
| `mobile` | — | App shell (start and navigation), Screens (screens and view state) |
| `desktop` | — | Main process (windows, IPC, native), Renderer (UI in the windows) |
| `infra` | Presentation, AI | Infra & pipelines (cloud, manifests, CI/CD) holding role `infra`, Tooling |

Role `infra` (`roles.md`) has its own column in a platform tab; in a map without platforms it sits
in Support like `config`.

**Validation.** `validate.mjs` fails on an unknown kind, a bad or duplicate id, a platform with no
rule, a `!` rule, an `other` platform without a primary label, and a section scoped to an undeclared platform. It warns on a rule that
wins no file (it matches nothing, or an earlier platform takes its files), a platform with no
mapped file, orphan label keys and missing translations. Every mapped file resolves to exactly one
platform or `shared` (first matching rule, else `shared`); the run prints one count per platform
and the total.

**Viewer.** With two or more platforms declared the page gets a tab bar (All, one per platform,
Shared) and `#platform=<id>` in the hash. A tab scopes the graph, the counts, the role, feature and
directory filters and the sections. Relations that leave or enter the tab are drawn to dashed
boundary nodes named after the other platform; clicking one opens that platform. With fewer than
two, nothing about platforms is written into the page.

## Pull requests

Optional. `.lantern/prs/<id>.pr` lists every file one pull request changed, so the viewer can
show the PR and highlight what it touches. `id` is the PR number (digits). Written by the
`lantern-sync` skill, never by setup; read by the Lantern app.

```
lantern-pr 1
# 24
#title test: refuse to signal pids 0, 1 and -1
#url https://git.example.test/owner/repo/pull-requests/24
#branch fix/test-process-kill-guard
#base main
#opened 2026-09-30
#head 3f9a1c2b4d5e6f708192a3b4c5d6e7f8091a2b3c
#summary one line, optional
#describe what Support agents can refund an order from the order screen.
#describe before Refunds needed a ticket to engineering.
#describe after The refund button refunds in one click.
#describe verified Ran the order tests; all green.
#plan add-refunds s1.2
+ src/orders/refund-button.tsx
+ test/orders/refund-button.test.tsx
+ test/support/process-guard.ts
~ src/admin/permissions.ts
~ vitest.config.ts
- src/old/legacy.ts
#reason test/support/process-guard.ts Refuses pid 0, 1 and -1 so a test cannot signal the whole machine.
#reason vitest.config.ts Loads the guard before any test file runs.
#order test/support/process-guard.ts
#order vitest.config.ts
#order src/old/legacy.ts
#story A support agent lets a customer refund orders
#step actor Support agent
#step action changes the permissions of
#file src/admin/permissions.ts
#step subject a customer account
#below actor Customer
#below interaction can now refund their own orders
#file src/orders/refund-button.tsx
#file test/orders/refund-button.test.tsx
#below consequence could only view orders => can refund orders
```

- **Header** — line 1 is `lantern-pr 1`. The first `#` line is `# <id>` and equals the file name
  (`24.pr`). `#title`, `#url`, `#branch`, `#base`, `#opened` (ISO date `YYYY-MM-DD`) and `#head`
  (the full 40-hex commit sha the map matches) are required; `#summary` is optional. Each
  appears at most once. `#reason`, `#order`, `#describe`, `#plan` and the flow lines `#story`, `#step`, `#below`, `#file` (below) are the repeatable keys. Other `#` lines and blank
  lines are ignored.
- **File lines** — `<kind> <path>`: `+` added, `~` modified, `-` removed. A rename is a `-` and a
  `+`. Every changed file is listed, mapped or not.
- **Paths** — relative to the project root, encoded like map record paths: `%20` for a space,
  `%23` for `#`, `%25` for `%`.
- **Reasons** — optional `#reason <path> <reason>` lines, at most one per file; `lantern-sync`
  writes them after the file lines in file order (readers accept any position). `<path>` is the file's path exactly as its file line writes it (same
  encoding), up to the first space; the rest of the line is the reason, as `reason.md` in this folder
  defines it: one sentence of why, 1 to 160 characters (counted in characters, not bytes), no
  control characters or newlines, otherwise free text (a literal `#`, `%` or `=` needs no escaping;
  the app shows it as plain text). Files without a reason simply have no `#reason` line. The format
  stays `lantern-pr 1` on purpose: a `#reason` line is an unknown `#` line, which every reader of
  that version already ignores, whereas an indented continuation line under the file line would
  make older readers reject the whole record. `prs.mjs` errors on a `#reason` for a path the record
  does not list, on a second `#reason` for one path, an empty or over-long reason; the app reader
  drops such a reason and still shows the record. `lantern-sync pr --reason` writes them and
  `lantern-sync pr` refuses to write a record where a changed file lacks one (lockfiles, assets and generated files get a default), and `lantern-sync verify` fails on such a record.
- **Review order** — optional `#order <path>` lines, one per file, first line = review first;
  `lantern-sync pr --order` writes them after the file lines and before the `#reason` lines (readers
  accept any position). `<path>` is encoded exactly as in its file line. The agent that opened the
  pull request orders the files so a reviewer can read them top to bottom: the file that carries
  the core idea or contract first, then the logic that uses it, then wiring/IPC/UI, then tests,
  then map, docs and generated files. The order may be partial: files without an `#order` line sort
  after the ordered ones in their normal order (the file-line order below); no `#order` line at all
  means no review order and the app shows the kind groups. Like `#reason`, an `#order` line is an
  unknown `#` line to every reader of `lantern-pr 1`, so older readers ignore it and the format
  stays `lantern-pr 1`. `prs.mjs` errors on an `#order` for a path the record does not list, on a
  second `#order` for one path and on an empty one; the app reader drops such a line and still
  shows the record. `lantern-sync verify` warns about changed files with no position
  (`--require-order` fails instead).
- **Flow** — optional, what the pull request changes for people, drawn by the app as plain blocks
  in rows (the Flow view next to Files and Macro). A flow is one to five *stories*; a story is
  `#story <title>` followed by its `#step` lines (the row of steps, left to right, at least one,
  at most six) and then, optionally, its `#below` lines (a second row under it, at most six).
  Both take `<kind> <text>`, the kind one of `actor` (a person or role: "Admin"), `action` (what
  they do: "changes permissions of"), `subject` (who or what it is done to: "another user"),
  `interaction` (what that party can now do in the app: "can open the billing screen") and
  `consequence`, whose text is `<old> => <new>` (old and new both required, the old one without a
  `=>`: `could only view orders => can refund orders`). Each title and text is one line of 1 to 80
  characters, no control characters or tabs. Written from the user's point of view, never naming a
  file or a function. A story reads like the example above: row one is who does what to whom, row two
  is what that party can then do and what changes, old against new. `#step` after a `#below` of the
  same story is an error. Like `#reason`, the lines are unknown `#` lines to a reader that predates them, so the format
  stays `lantern-pr 1`; a record without them is unchanged. A step can point at the changed files
  that implement or carry it with `#file <path>` lines directly under its `#step` or `#below` line
  (one path per line, encoded like a file line, at most six per step; steps with no honest file get
  none): the code that grants the permission, the screen the new interaction lives on, the test that
  proves the consequence. Every `#file` path must be a file line of the same record (a removed file
  counts), no path twice on a step, and a `#file` before any step is an error. The app shows the
  files as chips under the step and marks them in the list, the graph and Macro when the step is
  selected. `prs.mjs` errors on an unknown kind, an
  empty, over-long or control-character text, a consequence without `=>` or with an empty side, a
  `#step` or `#below` before any `#story`, a story with no `#step`, more than five stories or six
  steps in a row, and a `#file` that is empty, names a path the record does not list, repeats a path
  of its step, or is a seventh on a step. The app reader shows no flow for a record whose flow is malformed (and says so in the
  Flow view), but still shows the record. `lantern-sync pr --flow-file` writes the lines after the `#reason`
  lines (a step's JSON takes an optional `"files": ["src/a.ts"]` array of decoded paths, kept on re-run)
  and `lantern-sync verify --require-flow` fails a record without a flow; `verify` warns when a flow
  has no `#file` line at all.
- **Description** — optional `#describe <section> <text>` lines, the pull request's own words for
  the reader who does not open the host (and the only description in local mode). `<section>` is
  `what` (what changes), `before`, `after` (the old and the new behaviour) or `verified` (how it was
  checked). A section may repeat on up to 8 lines, each a short paragraph or bullet of 1 to 400
  characters (counted in characters), no control characters or tabs, plain words: no cost tables, no
  `<!-- ... -->` markers. `lantern-sync pr --describe-file` writes the lines right after `#summary`
  (a JSON object `{"what": [...], "before": [...], "after": [...], "verified": [...]}`, every key
  optional) and keeps them on re-run; `{}` clears them. Readers strip `<!-- ... -->` markers and
  drop any line that mentions `delegate:cost` or starts with `|` (a table row), and a line that is
  then empty, so a cost block pasted from a PR body never reaches the app. `#summary` stays the
  one-line lead; the app shows the sections "What changes", "Before / after" and "Verification"
  under it, collapsed to a short lead when long, and shows no heading for a section the record
  lacks. Like `#reason`, a `#describe` line is an unknown `#` line to a reader that predates it, so the
  format stays `lantern-pr 1` and a record without it is unchanged. `prs.mjs` errors on an unknown
  section, an empty, over-long or control-character text and a ninth line in a section; the app
  reader drops such a line and still shows the record. `verify` has no requirement for it.
- **Plan ticks** — optional `#plan <slug> <item>` lines, one per plan item the pull request implements
  (`<slug>` a plan in `.lantern/plans/`, `<item>` an item id of it such as `s1.2`; see Plans).
  `lantern-sync pr --plan <slug> --item <id>` writes them, right after the description, and refuses a plan
  or item that does not exist; `verify` warns about a record that names an unknown one. The record is the
  only tick: the plan file is not edited per pull request, and an item's status is derived from the
  state of the records that name it (Plans, "Status"). Like `#reason`, an unknown `#` line to a reader that
  predates it, so the format stays `lantern-pr 1`. `prs.mjs` errors on a `#plan` that is not exactly a slug
  and an item id (the one `PLAN_REF` pattern of `scripts/plan-ref.mjs`, re-exported by `skills/lantern-plan/scripts/plan-format.mjs`, the same one the app
  reader uses), or that repeats; the app reader drops such a line and still shows the record.
- **File line order** — kind groups `+`, `~`, `-`, each sorted by the encoded path as written, plain code-unit order. A different order is a warning;
  a path listed twice is an error.
- **State is never stored.** The app derives it from git: *merged* when `#head` is an ancestor
  of the PR's `<base>` or of the repo's default branch (`origin/HEAD`, `origin/main`, `main`), or
  when a merge commit (or a `Merged in …` / `Merge pull request …` subject) naming
  `pull request #<id>` is in the history of `<base>`, the default branch or the checked-out HEAD
  (unless HEAD is the PR's own branch), so a base branch that was merged and deleted still counts;
  *open* when the branch exists on `origin` and is not merged; otherwise *declined* (the branch is
  gone and no merge was found).
- **When it is written.** The PR id exists only after the PR is opened, so the record is a
  second commit on the same branch, pushed normally (no force-push), touching only `.lantern/`,
  so no source hash is invalidated.
- `node scripts/prs.mjs <root>` prints one line per record and every problem, exit 1 on an
  error; `validate.mjs` runs the same checks. A missing `prs/` folder is fine.

### Dismissed pull requests

`.lantern/prs/dismissed` hides finished pull requests everywhere without keeping a record file
per PR. Written by `lantern-sync dismiss`, never by setup; read by the Lantern app.

```
lantern-prs-dismissed 1
37
38
44
```

- **Header** — line 1 is `lantern-prs-dismissed 1`. Then one PR id (digits) per line, unique and
  sorted ascending numerically (an unsorted file is a warning). `#` lines and blank lines are
  ignored; any other line is an error, as is a duplicate id.
- **Meaning** — a dismissed id means that PR is hidden everywhere and its `<id>.pr` record is
  gone. A record `<id>.pr` that still exists for a dismissed id is ignored by readers and is a
  validator warning ("record kept for a dismissed PR"). `lantern-sync pr <id>` refuses to write a
  record for a dismissed id.
- **Only merged or declined PRs** are meant to be dismissed. The CLI cannot know a PR's state
  (the app derives state and enforces this); the docs say so instead.
- **Append-friendly** — one id per line, so concurrent dismissals on different branches merge
  cleanly. `prs.mjs` and `validate.mjs` read the file and no longer report it as a stray
  non-`.pr` file in `prs/`.

### Local comparisons

`.lantern/local/<base>__<head>.reason` holds the reasons for a comparison that has no pull request (the
uncommitted working tree, or a branch nobody opened a PR for). Written by `lantern-sync local`, read by the
Lantern app, never committed: the folder's own `.gitignore` (`*`) keeps it out of git, and `validate.mjs`
and `verify` ignore it.

```
lantern-local 1
#base origin/main
#head @
#at 2026-10-26
#reason src/main/local-reasons.ts 3f2a…:4120:1761466813456.12 Writes one reason per changed file so a solo change reads like a PR.
```

- `#head @` is the working tree; otherwise a branch name. `#base` and `#head` are spelled as the person
  sees them in Lantern, since the app matches on them.
- `#reason <path> <version> <reason>`: the path encoded as in map files, then the file's version, then
  the sentence. The version is `<merge-base>:<last commit of the branch outside .lantern/>` for a branch and
  `<merge-base>:<size>:<mtime>` for a working-tree file; the app shows the reason only while the version
  still matches, so an edit retires it.

#### Branch records

`.lantern/local/<branch, with / as __>.branch` is the whole record of a branch that has no host pull
request: what `pr` is for a PR, keyed by the branch name (so it cannot collide with a PR id). Written by
`lantern-sync pr` called without `<id>`, `--url` and `--title`; moved out of a delegate's worktree by
`lantern-sync carry`; read by `lantern-sync verify` (all four `--require-*` flags), by `plan.mjs status`
and by the app's comparison of the branch with its base. Like the `.reason` files it is ignored by git
(never committed, never in a merge).

```
lantern-branch 1
#branch feat/bye-function
#base main
#opened 2026-10-29
#head 3f2a9c0d1b7e4a5c8d6e2f10a9b8c7d6e5f4a3b2
#summary ...
#describe what ...
#plan demo s1.1
~ src/bye.ts
#order src/bye.ts
#reason src/bye.ts Adds the farewell the greeting lacked.
#story ...
```

- The lines are those of a pull request record ("Pull requests" above: file lines, `#reason <path> <text>`,
  `#order`, `#story` / `#step` / `#below` / `#file`, `#describe`, `#plan`, `#summary`) with the header
  `lantern-branch 1` and no `# <id>`, `#title` or `#url`. `#branch`, `#base`, `#opened` and `#head` are
  required; `#head` is the last commit that touched anything outside `.lantern/`, and the app shows the
  record only while it equals that commit of the branch. The file name is the branch with `/` as `__`.
- Opening a PR for the branch later (`pr <id> --url ... --title ...`) adopts it: the PR record keeps its
  reasons, order, flow, description and plan ticks and the local file is removed.

## Plans

Optional. `.lantern/plans/<slug>.plan` is a plan for one change, written by the `lantern-plan` skill on a
settled map, approved by a person section by section, executed by `lantern-delegate`, and read by the
Lantern app. Committed next to the map. Setup never writes it; `validate.mjs` ignores it; `lantern-plan`'s
`plan.mjs check` judges it. `<slug>` is lowercase kebab-case, at most 40 characters.

```
lantern-plan 1
# plan-on-the-map
#title Show a plan's stages and progress on the Lantern map
#opened 2026-10-26
#goal Lantern reads the plans under .lantern/plans and shows each plan's stages and item progress.
#scope-in A stage list with its open questions and item status.
#scope-out Planning or approving from the app.
#impact feature macro-view The stage impact is drawn as a highlight on the macro view.
#impact file src/main/lantern-prs.ts Item status comes from the PR states this file derives.
#impact new src/main/lantern-plans.ts Loads every plan file with the pull requests that tick its items.
#stage s1 Read plans in the main process
#item s1.1 Load every plan with the pull requests that tick its items
#touch file src/main/lantern-prs.ts
#touch new src/main/lantern-plans.ts
#accept A test loads one plan and two PRs and gets one open and one merged item.
#question s1.q1 Do plans on other branches show, or only the checked-out one?
#answer jun Only the checked-out branch for now.
#risk A plan edited after approval must show as changed, not as approved.
#approved title jun 2026-10-26 2d9198d66d04
#approved plan jun 2026-10-27
#verified s1.1 jun 2026-11-02
```

(Blank lines between the groups are optional; the writer puts them there.)

- **Header** — line 1 is `lantern-plan 1`. The first `#` line is `# <slug>` and equals the file name. Every
  other line is `#<tag> <text>`: a line that is not a tag line is an error, an unknown tag is skipped
  (readers and writers of `lantern-plan 1` ignore what they do not know). Lines are trimmed and may be indented. Text is one line, no control
  characters, counted in characters.
- **Sections**, each separately approvable, in this order: `title`, `goal`, `scope`, `impact`, one section
  per stage (`s1`, `s2` ...), `risks`.

| tag | meaning | rules |
|---|---|---|
| `#title <text>` | the plan's name | once, 1 to 100 characters |
| `#opened <date>` | ISO date | once |
| `#goal <text>` | what is true when it is done | 1 to 3 lines, each at most 200 characters |
| `#scope-in <text>`, `#scope-out <text>` | what the plan covers, what it leaves alone | in: 1 to 8 lines; out: 0 to 8; each at most 160 |
| `#impact <kind> <target> <reason>` | what the work changes, computed with `plan.mjs impact` | `kind` is `area`, `feature`, `file` or `new`; a `file` or `new` path is encoded like a map path (`%20`, `%23`, `%25`); the reason is 1 to 160 characters; no kind and target twice. A `new` line names a file the work will create and the reason is its **purpose**, what it is for |
| `#stage s<N> <title>` | a stage, what is implemented before the next | ids `s1`, `s2` ... in file order, title at most 100 |
| `#touch <kind> <target>` | what a stage, an item or a question changes or concerns | after the `#stage` (the stage's own), the `#item` (the item's) or the `#question` (the question's, which the app marks when the person picks "Show on the plan"); no repeat; `new <path>` says the item creates that file |
| `#item s<N>.<M> <title>` | one delegate's pull request | ids run `s1.1`, `s1.2` ... in the stage they sit under; title at most 100 |
| `#accept <text>` | the check that proves the item done | once per item, at most 160 |
| `#question s<N>.q<M> <text>` | something to decide before the stage can be built | sits under the stage it blocks (a question before any stage is an error), at most 200 |
| `#answer <who> <text>` | the answer, and who gave it | directly after its `#question`, at most 200; no digest effect |
| `#explain <text>` | help for the person answering a question | after its `#question` (and its `#touch` lines), 0 to 4 lines, each at most 200; no digest effect |
| `#story <title>`, `#step <kind> <text>`, `#below <kind> <text>`, `#file <path>` | the flow of a question: who does what, drawn by the app as a pull request's flow is | after its `#question`, the same grammar and limits as the flow of a pull request record (Pull requests), except that a `#file` is any path (encoded like a map path), checked against the map by `plan.mjs check`; a plan line that breaks them is an error, like any other; no digest effect |
| `#risk <text>` | a risk and how it is held | 0 to 10 lines, each at most 160 |
| `#approved <section> <who> <date> <digest>` | a person approved this section | `<digest>` is the first 12 hex of the SHA-256 of the section's lines in the canonical layout `plan.mjs` writes, joined by `\n`, without what follows a `#question` (`#touch`, `#explain`, the flow, `#answer`); a changed section no longer matches and reads as **stale** |
| `#approved plan <who> <date>` | the whole plan is approved | only valid while every section is approved and current |
| `#verified <item> <who> <date>` | the item's acceptance check passed | the only status the plan stores |

- **What `check` requires** beyond the grammar: a title, `#opened`, a goal, a `#scope-in`, an impact, at least one
  stage; every stage has items; stages, items and questions number from 1 in file order; every item has an
  `#accept` and a `#touch`; every `area`, `feature` and `file` named by `#impact` and `#touch` exists in the
  map (an unknown id is an error, a file that was deleted since is a warning, a file that exists but has no
  record says to refresh the map); a `new` path is **not** in the map, and is a warning when the path is
  already in the map or on disk (it should be a `file`), and every `new` path an item or stage touches has an
  `#impact new` line with its purpose, else an error; a touch the impact section does not cover is a warning; an `#approved`
  names a section the plan has; `#verified` names an item the plan has.
- **Status is derived, never edited.** Many pull requests would conflict on one plan file, so a plan item
  carries only intent. A pull request record names the items it implements with `#plan` lines (Pull
  requests), and an item is **planned** (no record names it), **in progress** (a record that names it is
  *open*), **implemented** (a record that names it is *merged* and none is open) or **verified** (the plan
  holds `#verified` for it). A declined record counts for nothing. *Open*, *merged* and *closed* (the app
  shows a closed pull request as declined) are the states the app already derives for pull requests (Pull requests, "State is never stored"); `plan.mjs
  status` applies the same rules from git, offline. A stage is done when its items are implemented or
  verified, and the next stage starts then; an item whose stage has an unanswered `#question` is
  **blocked** for delegation until it is answered.
- **Readers.** The app reads a plan with `src/main/lantern-plan.ts`, the scripts with
  `skills/lantern-plan/scripts/plan-parse.mjs`; both parse the same fixtures, take the format
  constants from `plan-format.mjs` and their messages from `messages.json`. A reader keeps what it
  understands and skips the rest. `lantern-plan` rewrites a plan in the canonical layout above and drops
  unknown tags (it says so).

## Cost

Records are read by programs first and agents second. Keep purpose to a few words, labels to a
couple, and list only relations to other mapped files or to external systems the file talks to
directly — not every standard-library import. A label earns its key only when the target's
name doesn't already say what flows.
