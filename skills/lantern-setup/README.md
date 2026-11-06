# lantern-setup

- Created: 2026-09-29
- Based on: `lantern 1` map format (this skill's `references/format.md`), role vocabulary grounded in Fowler, *Patterns of Enterprise Application
  Architecture* catalog (Service Layer, Repository, Gateway, Data Transfer Object, Page/Front
  Controller — martinfowler.com/eaaCatalog), Fowler, *PresentationDomainDataLayering*
  (martinfowler.com/bliki), Evans' Entity / Value Object / Service via Fowler's
  *EvansClassification*, Express middleware definition (expressjs.com/en/guide/using-middleware),
  React component and custom Hook definitions (react.dev/learn/your-first-component,
  /reusing-logic-with-custom-hooks), 12-factor Config (12factor.net/config), pure function
  (en.wikipedia.org/wiki/Pure_function); the `ai` role from Anthropic, *Building effective agents*
  (anthropic.com/engineering/building-effective-agents: workflows vs agents, the augmented LLM),
  LlamaIndex RAG stages (developers.llamaindex.ai/python/framework/understanding/rag), LangChain
  agent = model + tools (docs.langchain.com/oss/python/langchain/overview) and OpenAI function
  calling (developers.openai.com/api/docs/guides/function-calling); the `infra` role from Fowler,
  *InfrastructureAsCode* (martinfowler.com/bliki/InfrastructureAsCode.html), Terraform, Kubernetes,
  GitHub Actions and Dockerfile references (listed in `references/roles.md`); gitignore semantics per git-scm.com/docs/gitignore;
  Node ≥18, no dependencies
- Reference: none — the committed examples under `example-web/` are all fictional
- Home: the Lantern repo (`skills/lantern-setup/`).

**Model.** Maps are written by Sonnet, Opus or Fable of any version, or the exact id `gpt-6-astra`; Sonnet 5.5, Opus 5.5 and Fable 5.1 or newer are recommended and a lower version only warns. On the Codex route `gpt-<version>-sol` (recommended 6.1), `gpt-<version>-astra` (recommended 6) and `gpt-<version>-terra` (no recommended version, so never a warning) of any version are accepted too, with the same warning below the recommended version. The policy is `references/model-floor.json`
and is checked when a run starts; the map itself records no model (Codex: `references/codex.md`). The pinned worker
`agents/lantern-mapper.md` is installed once (`cp agents/lantern-mapper.md ~/.claude/agents/`,
then restart the session). To migrate an existing map, run `node scripts/migrate-model.mjs <project-root>` once and commit the
result on its own. Update the skill before pulling a migrated map: an older `validate` fails on sections and texts without a model, and an older `finish` resets every map file.

**Feature, see-also, gotcha.** Records may carry `#feature` and `#see-also` lines and a gotcha
text, and `.lantern/features` declares the tags (`references/format.md`); the viewer filters and groups
by feature. The fictional `example-web/demo-sections/.lantern` sample carries them.
Basis: the file-descriptor research ranked a feature tag
and "confusable with"/gotcha lines below computed facts; no study tests them, they follow
Anthropic's guidance to keep pitfalls and drop what the code shows.

**One vocabulary.** A feature is a capability, not a platform, channel or vendor, and an `ext:`
target is an outside system, one name each, taken from the optional `.lantern/systems`
(`scripts/systems.mjs`). `validate.mjs` warns about breaches (`--strict` errors),
`scripts/macro-eval.mjs` prints the numbers a macro view depends on, and retag mode
(`scripts/retag.mjs`, `plan.mjs . retag`) cleans an existing map without a re-map. Rules in `SKILL.md`,
formats in `references/format.md`.

**Sections.** Optional `rbac`, `states`, `db` and `facts` blocks in `.lantern/sections/`, texts in
`.lantern/lang/<code>/sections/`, rendered below the graph (`references/format.md`, "Sections").
Grounded in NIST RBAC (role × permission assignment, csrc.nist.gov/projects/role-based-access-control),
UML state machines (initial/final states, transitions with triggers) and the entity-relationship model;
`declared` vs `inferred` follows Firestore's schemaless collections, whose shape is only in code
unless rules declare it. The fictional `example-web/demo-sections/` bookshop carries all four
sections with its source files, so `node scripts/validate.mjs example-web/demo-sections --settled`
exits 0; `example-web/demo-sections.html` is rendered from it (command below).

**Platforms.** Optional `.lantern/platforms` (`<id> <kind> <glob>...`, kinds web, backend, mobile,
desktop, infra, other) gives the viewer one tab per platform; first matching rule wins, unclaimed
files are `shared`, an `other` platform carries a free label in `lang/<code>/platforms.json`,
sections may take a `#platform` scope (`references/format.md`, "Platforms"). Adds role `infra`
(IaC, manifests, Dockerfiles, CI pipelines); the vocabulary widens, `lantern 1` stays, existing
maps stay valid. The fictional `example-web/demo-platforms` sample declares six platforms, with its
root file falling into `shared`; single-platform maps render as before.
Relations across platforms follow two rules in `SKILL.md` ("Relations that cross platforms"): a
network call into the repository points at its handler file, a build or deploy file points at the
service's entry; when the target is not one file, nothing is written. `scripts/cross-platform.mjs`
warns (`[relations]`, never an error) when a platform with gateway files, or an infra platform,
relates to no other platform.

**Pull requests.** `.lantern/prs/<id>.pr` (`lantern-pr 1`) records the files one PR changed,
each optionally with a one-line reason (`#why`, shown under the file in the app) and a review
position (`#order`, numbering the files in the app)
(`references/format.md`, "Pull requests"); `scripts/prs.mjs` parses and validates them and
`validate.mjs` runs it. Setup never writes them: the `lantern-sync` skill does, after the PR
exists, and the Lantern app reads them and derives open/merged/closed from git. The fictional
`example-web/demo-platforms/.lantern/prs/` holds two (`node scripts/prs.mjs example-web/demo-platforms`).

**Dismissed pull requests.** `.lantern/prs/dismissed` (`lantern-prs-dismissed 1`, one id per line)
hides merged or declined PRs without a record file each; `lantern-sync dismiss <id>...` writes it
and `prs.mjs` parses and validates it (`references/format.md`, "Dismissed pull requests").

**Skill files.** Markdown that steers an agent is mapped like source: `SKILL.md` and everything in
a skill folder, `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, `.github/copilot-instructions.md`, the root
`.claude/commands|agents|rules/`, and whatever `.lantern/include` adds (gitignore syntax); a
repository's README, changelog and docs stay out (`SKILL.md`, "Which markdown is mapped"). One role,
`skill` (`references/roles.md`; agents and commands are skills too: same reader, same references),
and one new relation arrow, `@` "refers to" (`references/format.md`, "Relation"): a skill file does
not import or call, it tells its reader to read, load or run, so its relations are `@` and no other
role's are. The vocabulary widens and `lantern 1` stays; old maps stay valid and the markdown shows
as unmapped until a refresh. `scripts/refs.mjs` lists the resolvable pointers in a markdown file
(links, paths, `$L`-style variables, "the `x` skill") and the mapper judges them. Grounded in
the Agent Skills layout (`SKILL.md` with optional `references/`, `scripts/` and `agents/`
beside it) and Claude Code's `CLAUDE.md`, `.claude/commands`, `.claude/agents` and `.claude/rules`.
`example-web/demo-skills/` is a *fictional*, complete two-skill repository with its settled map
(`node scripts/validate.mjs example-web/demo-skills --settled`) and `example-web/demo-skills.html`
rendered from it (Skills column, dotted lime `@` lines):

```bash
node skills/lantern-setup/example-web/render.mjs skills/lantern-setup/example-web/demo-skills --out skills/lantern-setup/example-web/demo-skills.html --title "demo-skills (fictional)"
```

`test/lantern-skill-files.test.ts`, `test/lantern-skill-refs.test.ts` and `test/lantern-skill-graph.test.ts`
cover the rule, the role, `@`, the reference resolution and the app.

**Writes `.lantern/` into the mapped project** — nothing else, never source files.

**Example page:** `example-web/` renders a `.lantern/` map as an interactive architecture graph
(the fictional samples below are committed as `example-web/demo-*.html`, which open by
double-click). Build one for any project from that project's root:

```bash
node <skill>/example-web/render.mjs . --out .ai/tmp/lantern.html --title <name> [--lang pl]
```

**Sections demo.** `example-web/demo-sections/` is a *fictional* online bookshop with its eight
source files and a settled map: one `rbac`, `states`, `db` and `facts` section each, features, a
see-also and a gotcha. `example-web/demo-sections.html` is rendered from it:

```bash
node skills/lantern-setup/example-web/render.mjs skills/lantern-setup/example-web/demo-sections --out skills/lantern-setup/example-web/demo-sections.html --title "demo-sections (fictional)"
```

**AI demo.** `example-web/demo-ai/` is a *fictional* 10-file support-assistant map (prompt builder,
LLM client, agent loop, retriever, guardrails, handler, page, service, repository, types) that
exists only to show the AI column; it has no source files. `example-web/demo-ai.html` is
rendered from it:

```bash
node skills/lantern-setup/example-web/render.mjs skills/lantern-setup/example-web/demo-ai --out skills/lantern-setup/example-web/demo-ai.html --title "demo-ai (fictional)"
```

**Platforms demo.** `example-web/demo-platforms/` is a *fictional* 16-file fitness-tracker map
(web, backend, mobile, desktop, infra and an `other` platform labelled "Smartwatch", plus one
`shared` root file) that exists only to show the tabs; it has no source files.
`example-web/demo-platforms.html` is rendered from it:

```bash
node skills/lantern-setup/example-web/render.mjs skills/lantern-setup/example-web/demo-platforms --out skills/lantern-setup/example-web/demo-platforms.html --title "demo-platforms (fictional)"
```

**Languages.** Two separate things, both default `en`:

- *Viewer* — every UI string and the display name + one-line description of each role live in
  `example-web/locales.json` (`en`, `pl`). `render.mjs --lang <code>` picks one; the page has a
  language switch and honours `#lang=<code>`. A key missing from a language falls back to `en`.
- *Map texts* — records hold structure only; purposes, relation labels, gotchas, see-also whys
  and feature descriptions live in `.lantern/lang/<code>/`, one JSON file per map file, under
  keys computed from the record (`references/format.md`, "Texts"). `LANTERN_LANG=<code>` in the
  environment, else the language the existing map already has (read by `scripts/lang.mjs` and
  `render.mjs`) sets the **primary** language, the one setup writes. The committed sample is
  English only.

Add a viewer language: copy the `en` block in `locales.json` to a new key (`de`), translate the
values (keep `{placeholders}` and the keys), set `lang.name` to the language's own name, then
`node scripts/check-locales.mjs` must pass — it fails on missing or extra keys and on a role in
`references/roles.md` with no entry. No code changes. `references/roles.md` itself stays English;
the JSON names are for the viewer only.

Add a map language (file descriptions), from the project root: `node <skill>/scripts/lang-todo.mjs de`
lists every key German still lacks with its primary text, grouped by the file it goes in
(`.lantern/lang/de/…json`). Fill in only the values, and
re-run until it lists nothing; `validate.mjs .` shows each language's coverage. No source is
read, so the mapping model policy doesn't apply to translations. Missing keys fall back to the
primary language in the viewer. A map made before the split keeps its inline prose working;
`node <skill>/scripts/migrate-lang.mjs .` moves it into `lang/<primary>/` without touching
hashes.
