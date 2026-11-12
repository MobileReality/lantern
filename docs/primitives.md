# Primitives

What a change here leans on to prove it broke nothing, and to run unattended. A map, not a register:
if a capability is missing below, check `git log` for how the last change did it before inventing one.

## Regression checks

### `pnpm test`
`vitest.config.ts`, `test/**/*.test.ts`. The regression set every change must keep green, together
with `pnpm run typecheck`. Use for any change to `src/`, `scripts/` or a skill's scripts. Add the test
that fails before your change next to the existing one for that module; a new module gets
`test/<module>.test.ts`. Node environment by default; a DOM test opts in with
`// @vitest-environment jsdom` at the top of the file.

### Process guard
`test/support/process-guard.ts`, installed for every test by `test/setup-process-guard.ts`. Throws when
a test signals pid 0, 1 or -1. Never fake a child's pid as 1 and never disable the guard: a mocked
pid-1 child once ran `kill(-1, SIGKILL)` and closed every app on the machine.

### Event-loop yield and worker cap
`test/setup-yield.ts` makes every test end with a turn of the real event loop, and `vitest.config.ts`
caps `maxWorkers` at 6. Without them, long runs of synchronous process-spawning tests starve vitest's
worker channel and a full `pnpm test` fails with `Timeout calling "onTaskUpdate"` and 5 s timeouts.
Keep both; a test that spawns many processes builds its repos from a copied template, not one `git init` each.

### Test worlds
Build state with these instead of hand-writing it:
- `test/helpers/git-repo.ts`: a throwaway git repo with a fixed identity and dates. Any test that
  needs commits, branches or a diff.
- `test/helpers/lantern-map.ts`: an in-memory `LanternMap` (nodes, PRs). Renderer and parser tests
  of the map.
- `test/helpers/setup-project.ts`: a project on disk sized for `lantern-setup` chunking.
- `test/support/bundle-fixtures.ts`: a project as the Lantern bundle installs it (skills, agent types).
- `test/helpers/fake-claude.ts`: a `claude` binary that records its calls and replies by
  `FAKE_CLAUDE_MODE`. Anything that spawns the CLI. Never spawn the real one from `pnpm test`.
- `test/helpers/fake-bitbucket.ts`, `test/helpers/host-world.ts`: the PR host, offline.
- `test/helpers/lantern-plan-world.ts`: a project with the plan fixtures and a small map
  (`makeProject`), or one with an origin remote (`makeRemoteProject`) for item status from open and merged
  PR records. Any test of plans, in the skill scripts or in the app.
- `test/helpers/source-blocks.ts` (`functionBody`, `callArguments`, `ipcHandler`, `occurrences`, `within`):
  locate a function body, a call's arguments or an `ipcMain.handle` handler in a source file by balanced
  brackets, skipping string and template literals and `//` and `/* */` comments. Any test that asserts what
  a piece of source does or does not contain inside one block. Never slice by line count or a regex over the
  whole file; `test/source-blocks.test.ts` pins the skipping. Regex literals are not skipped.
- `test/e2e/support/overview.ts` (`openOverview`, `closeOverview`, `overview`): the Overview drawer. Macro
  specs open it through this, not with their own selector. `.lt-side` also matches the hidden drawer, so a
  spec that means the visible side pane uses `.lt-side:not(.lt-overview)`.
- `test/fixtures/`: static maps and PR records (`lantern-map`, `lantern-prs`, `lantern-macro`, …) and
  `lantern-plans/` (`plan-on-the-map`, a worked plan; `draft-reader`, a draft; a small map beside them).

### `pnpm run test:graph:e2e`
`test/e2e/`, Playwright against the harness app in `test/e2e/app`. Use when a change touches graph
layout, rendering or navigation in the renderer; `pnpm run test:graph:visual` adds the pixel
snapshots (update them with `test:graph:visual:update` only when the change is meant to move pixels,
and say so in the PR). Not part of `pnpm test`.

### `pnpm run test:graph:macro:e2e`
`test/e2e/graph-macro*.spec.ts` and `graph-macroview.spec.ts`, Playwright against the same harness. Use
when a change touches the macro (areas, systems, platform uses, foundation, legend) view of the graph.
Not part of `pnpm test`.

### `pnpm run test:pr-review:e2e`
`test/e2e/pr-review-*.spec.ts`, Playwright against the same harness. Use when a change touches the pull
request review screen (comments, explain, layout, regions, the demo). Not part of `pnpm test`.

### `pnpm run test:text-select:e2e`
`test/e2e/text-select.spec.ts`. Use when a change touches text selection in the renderer. Skips without a
Playwright Chromium. Not part of `pnpm test`.

### `pnpm run test:lsp:e2e`
Compiles, then runs `test/e2e/lsp-semantic.spec.ts` in Electron: semantic highlighting through the real
preload and IPC. Use when the embedded editor's highlighting or its LSP bridge changes; `test:lsp` is the
vitest side of the same area. Not part of `pnpm test`.

### `pnpm run test:lsp`
Compiles, then runs the LSP and semantic-highlight integration tests. Use when the embedded editor,
tsserver or highlighting changes.

### `pnpm run skill-test -- <skill>`
`scripts/skill-test/`. Checks a bundled skill on a small fixture project in slices, offline by default
(a fake agent, nothing spent). Use when a skill's `SKILL.md`, `protocol.md` or scripts change.
`lantern-delegate` takes `--delivery pr|push|local` and runs the whole flow with no credential in a file or
the environment: the account comes from `scripts/e2e-delegate/fake-lantern.mjs`, a fake credential
socket, and the checks follow the delivery (`test/lantern-delegate-delivery-flow.test.ts` runs all three).
Every delivery ends with a record and `verify --require-pr --require-reason --require-order --require-flow`
green; `push` and `local` leave it as the branch's local record (`.lantern/local/`), and `--fake no-reason`
drops its reasons to prove the gate goes red.
`--live` spends real usage and is a human's call, never a delegate's.

### `pnpm run e2e:delegate`
`scripts/e2e-delegate/`, documented in `scripts/e2e-delegate/README.md`. The whole `lantern-delegate` flow on
four dummy projects against a mock Bitbucket. Costs about 7 USD and needs `--yes`: run by a human
before releasing a change to the delegate skills, never by a delegate.

## Shared building blocks

### Provider table
`src/shared/providers.ts` (`PROVIDERS`, `PROVIDER`, `CODE_HOST_IDS`, `providersWithRole`). One row per
integration: id, display name, role, hosts, token page, token fields, whether it reports expiry, whether it carries an optional commit email (`optionalEmail`, GitHub: set when adding the token or later on the account card).
Use for anything that needs to know which providers exist or how one is called, reached or filled in.
Never write `'github'`, `'bitbucket'`, `'jira'`, a provider host or a provider's name as a literal
in the integrations logic: `test/bare-literals.test.ts` fails it there. A new provider is a new row, not a new branch.
`remoteHost` and `remoteAliases` (GitHub's `ssh.github.com`) are the git remote hosts `codeHostOf` recognises.

### Pull request host state
`src/main/lantern-host-status.ts` (`createHostStatus`, `refresh`, `apply`) over one driver per code host in
`src/main/lantern-host-drivers.ts` (`DRIVERS`: which git states are asked, where the credentials come from,
the request), with `lantern-host-request.ts` (Bitbucket and the shared transport: redirects stay on one
origin, a timeout, a size cap) and `lantern-host-github.ts`. Use for anything that needs whether a pull
request is open, merged or declined on the host: `loadPrs` applies it over the git scan, and the host
answer wins when there is one. The account comes from `lantern-host-account.ts` (`accountLookup`, over
`auth.injectionFor`, so the project's chosen account wins); a token is never read from a file for GitHub,
never logged, and never part of a note. A new code host is a `PROVIDERS` row plus a driver here; never a
second request path in the view. Tests: `test/lantern-host-status.test.ts` (Bitbucket),
`test/lantern-host-github.test.ts` (GitHub, with `test/helpers/fake-github.ts`), `test/lantern-host-cache.test.ts`,
`test/lantern-host-leak.test.ts`; `pnpm run test:pr-host:e2e` draws the strip of a GitHub-origin project
against a stub API in the graph harness (`LANTERN_PR_SHOTS=<dir>` keeps the screenshots).

### Kind constants
`src/shared/auth-kinds.ts` (`AUTH_ERROR`, `CHECK_FAILURE`, `CONNECTION_STATE`, `CREDENTIAL_KIND`,
`CREDENTIAL_SOURCE`, `BINDING_CHOICE`, `PERSISTENCE`, `EXPIRY_LEVEL`, `EXPIRY_SOURCE`) and their
derived types. Use for every error code, check failure, connection state and credential source that
crosses a module or process boundary. Compare and return the constant, never its string; the guard
below fails a bare one for the kinds it has patterns for. Add a value here, then handle it where the type now demands.

### Message catalogue and `msg()`
`src/shared/lang/messages.ts` over `src/shared/lang/<code>/messages.json` (`msg`, `msgCount`,
`msgList`, `createMessages`). Use for any text a person reads in the app: keys are typed from the
English catalogue, `{name}` placeholders are filled from params, `.one`/`.other` pairs pluralise, and
a missing key in another language falls back to English. Add the English entry first, then the
other languages. Not for strings a script prints outside the app: those are the skill catalogue below.

### Skill message catalogue
`skills/lantern-delegate/scripts/messages.json`, read by `message(key, params)` in `messages.mjs`.
Use for every predefined sentence a lantern-delegate script prints: help texts, errors, warnings.
Put the sentence in the JSON with `{placeholders}`; the script passes the values. An unknown key
returns the key itself, so a gap shows in the output. It holds no credential text any more (the host
skills own that). `test/lantern-delegate-messages.test.ts` checks every literal key exists and that
no key goes unused.

### Host skill call
`skills/lantern-delegate/scripts/host-skill.mjs` (`HOST_SKILL`, `skillRoots`, `hostScript`,
`runHostSkill`). Use for anything in `lantern-delegate` that touches a pull request or a credential:
it finds `lantern-bitbucket` or `lantern-github` (beside the delegate skill, in `.claude/skills` or
`.agents/skills`, then the home ones) and runs its CLI as a subprocess, so the account comes from the
environment or the running Lantern and the only code that reads a token is the host skill's.
`preflight.mjs` (`check`, and the host skill in the registry), `pr-create.mjs` (`create --branch`)
and `pr-append-cost.mjs` (`description-block`) are built on it. Never read `BITBUCKET_*` or `GITHUB_TOKEN`
in `lantern-delegate`, never call a host API from it, never scaffold or read a token from `.ai/.env`
(`git-env.mjs` is only the fallback for the commit identity: it reads `GIT_COMMIT_NAME` and
`GIT_COMMIT_EMAIL` there);
`test/lantern-delegate-host-skills.test.ts` fails the last two. A new code host is a row in
`HOST_SKILL` and a skill with the same three commands.

### Commit identity
`skills/lantern-delegate/scripts/lantern-account.mjs` (`profileEmail`, `EMAIL_SOURCE`) and
`resolveProfile` in `github/identity.mjs`. Use for anything that needs the e-mail commits go out
under. Order: the Lantern profile of the project, asked through the host skill's own
`lantern-socket.mjs` (the credential server answers `GIT_COMMIT_EMAIL` for a code host account: the
Bitbucket e-mail, the GitHub account's e-mail: the one typed or the public one read when the token
is added, editable later through `auth.setEmail`), then
`GIT_COMMIT_EMAIL` from `.ai/.env` or the environment, then nothing: the gate warns and git config
decides. The name is `GIT_COMMIT_NAME` or git config, never invented. `identity.mjs --exec` applies
it to one command, so all commits of a run share one address. `test/lantern-delegate-commit-identity.test.ts`
runs the gate and a commit against a fake Lantern socket.

### PR delivery choice
`skills/lantern-delegate/scripts/preferences.mjs` (`DELIVERY`, `storedPreference`, `setPreference`;
`get delivery` and `set delivery <pr|push|local>` on the command line). Use when the orchestrator
needs to know whether the user wants pull requests: it keeps the answer in
`.claude/lantern-preferences.json` of the project, so the user is asked once, creates the folder,
keeps every other key, refuses any other value and a damaged file. `pr` opens a pull request, `push`
pushes the branch and opens none, `local` commits only. The brief carries it as `Delivery:`, the gate
takes it as `--delivery`, and `protocol.md` has the delegate obey it. Never open a pull request
because a task sounds like one when the stored (or one-off) choice says `push` or `local`.

### Default integration skills
`skills/lantern-jira`, `skills/lantern-bitbucket`, `skills/lantern-github`: one `scripts/<host>.mjs` each
(over `cli.mjs`, `commands.mjs`, `messages.json`), dependency-free Node. Use when an agent started from
Lantern must read or change a ticket (Jira: get, search by JQL, comment, transitions, transition to a
named status, describe in Atlassian Document Format, gateway first by cloud id with the site URL as fallback for scoped API
tokens) or list, show, open and comment on a pull request (Bitbucket and GitHub: workspace or owner and
repo come from the git remote; `create` pushes plainly, with `--branch <name>` HEAD goes to that name, and
never opens a second PR for a branch). Bitbucket and GitHub also have `check` (the account resolves, and
on Bitbucket the token has `write:pullrequest`, on GitHub it authenticates and sees the repo; prints where the
account came from and with `--json` the login, never a token; `--offline` calls nothing) and
`description-block <id> --name <marker> --file <path>` (puts the file between `<!-- marker -->` markers
in the description, replacing an earlier block of that name). They read
the env Lantern injects first (names in `src/main/auth/env-names.ts`); when none of the account's
required variables is set they ask the credential server (below) through `scripts/lantern-socket.mjs`
(`completeEnv`), use the answer in memory only, and otherwise print one "add the account in Lantern"
message ending in the typed reason. Every printed line passes a redactor built from the final
variables, so a token never reaches output. Use this, in a chat inside the embedded editor too, instead of
asking the user for a token. Bundled in `BUNDLE_SKILLS` (and the Codex `only` list); a user's own
Jira, Bitbucket or GitHub skill has another name and is never touched. A skill may import only from its
own folder, so `args`, `http`, `redact`, `messages`, `lantern-socket`, `git` and `block` are deliberate copies, kept
identical by `test/integration-skills-standalone.test.ts`: change one, change all. Test them offline with
`test/helpers/fake-host.ts` (in-process `fetch` or a local server), `test/helpers/skill-runner.ts` and,
for the socket, `test/helpers/fake-lantern.ts` (a real socket server with a scripted answer).
Conventions stay the user's: each skill's `conventions` command (`conventions.mjs`, a byte-identical copy
with a per-skill location table in `commands.mjs`) lists, read-only and offline, the repository's own
PR or issue templates, the user's skills about PRs or tickets and the saved templates, as names and paths
only; `SKILL.md` tells the agent to run it before the first create, comment, describe or transition, ask
which to follow, and otherwise offer to write a template, kept with `template save <pr|ticket> --file`
in `.claude/lantern-templates/<host>-<kind>.md` (`--force` to replace; `template show` prints it).
The skills carry no default title or body text. Test it with `test/integration-skills-conventions.test.ts`
and `test/integration-skills-pr-commands.test.ts` (`check`, `description-block`, `create --branch`).
`lantern-delegate` opens its pull request through them (identity checks and the Lantern record flow stay in
its `pr-create.mjs`; see Host skill call). Not for merging, approving or deleting anything, and never a
place for a user's own workflow conventions.

### Credential server
`src/main/auth/credential-server.ts` (`createCredentialServer`), with `credential-socket.ts` (the path,
the limits, the request parser) and `known-project.ts` beside it; started in `src/main/main.ts` and
closed on quit. A Unix socket `lantern.sock` in the profile's user-data folder (a named pipe per user on
Windows; the dev profile has its own), mode 0600, one JSON line in (`{project, provider}`) and one out
(`{ok, env}` or `{ok: false, reason}` with a `CREDENTIAL_REFUSAL` kind). Use when something that Lantern
did not spawn, such as a chat in the embedded editor, needs the project's account: it answers with
`auth.injectionFor` for the opened project, so selection and bindings stay in one place, and returns only
the variables of the asked provider. Every project has a slot for every provider (`projectIntegrations` in
`project-view.ts`): the detected host and Jira use the only account by default, any other provider is served
only once an account is pinned to the project (until then the refusal is `choose-account`, or `no-account` when
none was added), and the skills turn both into "choose an account for this project in Integrations". A directory that is not an opened project (symlinks resolved) is
refused; requests are capped in size and time; nothing token-shaped is logged. Never widen what it
returns, never write a token to a file, settings or the shared editor server's environment to avoid it.
Test it with `test/helpers/credential-world.ts` (a real server over a fake account store) and
`test/credential-server.test.ts`; `test/credential-socket-e2e.test.ts` runs each integration skill's
script as a child process against it.

### Icons
`src/renderer/assets/icons/*.svg` and `src/renderer/assets/logos/*.svg`, one file per icon, imported where
it is drawn (`import CLOSE_ICON from '@renderer/assets/icons/close.svg'`; esbuild and vitest load an
`.svg` as its markup). Use for every inline SVG in the renderer; never paste SVG markup into a
component. A screen that picks an icon by name keeps that small lookup in its own file (the problems
list, the status bar). Provider marks (`currentColor`, no network fetch) are drawn with
`providerLogo(id)` from `src/renderer/lib/provider-logo.ts`, never a letter or SVG of your own; a new
provider needs its mark there: `test/provider-logos.test.ts` fails without it. `test/icons.test.ts`
checks every file is one well-formed svg hidden from screen readers.

### Tooltips and popovers
`src/renderer/tooltip/index.ts` (`installTooltips`, installed once per window) and
`src/renderer/popover/index.ts` (`mountPopover`, `rovingFocus`), styled and animated in
`src/renderer/floating.css`. Both draw in the browser's top layer (`popover="manual"`), so no z-index
or clipping parent matters; a popover is placed with CSS anchor positioning and a tooltip by the module,
both flipping when there is no room.
A tooltip is `data-tip="…"` on any element (`dataset.tip` in code); `data-tip-command="<command id>"`
adds the command's key chips from the user's keymap, and `data-tip-at="pointer"` follows the pointer
(the graph canvas). It shows after 500 ms, at once while another was just shown, on keyboard focus
too, and describes the element for screen readers unless it repeats the label. `setTipCard(el, render)`
shows a rich card built when the tip opens instead of the text (the pull request card from
`src/renderer/pr-info`); the element keeps its `data-tip` as the plain text. A popover is any
element passed to `mountPopover(trigger, pop, { placement })`: it handles the click toggle,
`aria-expanded`, focus on open and back to the trigger, a press outside, Escape (the topmost only,
never reaching the page below) and focus leaving; nested popovers stay open together. Never set a
native `title` in the renderer: `test/no-native-titles.test.ts` fails it.

### Dates
`formatDay(ms, { year, utc })` and `DATE_LOCALE` in `src/renderer/lib/util.ts`. Use to show a day
anywhere in the renderer; it returns an empty string for an invalid time. `timeAgo(stamp, now)`
("2 hours ago", "yesterday") and `exactTime(stamp)` (the full date and time, for its tooltip) take an
ISO stamp or a date-only `YYYY-MM-DD` day. Never call `toLocaleDateString` with a locale of your own.

### Path aliases
`@shared/*`, `@main/*`, `@renderer/*` map to `src/shared`, `src/main`, `src/renderer`
(`tsconfig.json`, `scripts/aliases.cjs`, checked by `test/path-aliases.test.ts`). Use for any import
that crosses a source folder or climbs more than one `../`. A new alias must be added in every place
the test reads.

### Bare-literal guard
`test/bare-literals.test.ts`. Fails when the integrations logic holds a quoted provider id, host or
name, error code, check failure or connection state instead of the table or constant. A change to
that logic keeps it green; to cover another file, add it to `LOGIC_FILES` and a pattern for the new
kind, with a line in the test showing the pattern catches it.

### Extensions config
`~/.claude/lantern-extensions.json` (global) and `<project>/.claude/lantern-extensions.json` (project, the three slots
only). Keys: `delegate`, `orchestrator` and `reviewer` (lists of extra skill names added to that slot), `off` (an
object of the same slot names, each a list of built-in skills switched off for that slot) and `skillLinker` (an
absolute path string), the last two global only. A slot's effective list in a project is the global names followed by
the project's, each once (`mergeExtras`); `projectRootOf` resolves the project from a working directory and sends a
linked worktree to its main checkout, where the file lives. A malformed file is reported by name and ignored without
touching the other one. The app writes the project file atomically inside the project's `.claude` only, after
`ensureIgnored` (`scripts/lantern-bundle.mjs`) made git ignore it, and keeps it out of git when a project opens.
Read and written by `skills/lantern-delegate/scripts/extensions.mjs` (`readExtensions`, `setExtensions`,
`readSwitchedOff`, `setSwitchedOff`, `readSkillLinker`, `setSkillLinker`) and resolved against the skill folders by `extension-skills.mjs`
(`configuredExtras`, which also returns `off`, and `resolvedExtras`). Which built-ins can be switched off is one constant,
`SWITCHABLE_SKILLS` (`switchableSkills(role)`, `enabledSkills(role, off)`) in `bundled-skills.mjs` beside the role lists: the
skills that shape how an agent works (the delegate's and the reviewer's fixed skills); `lantern-sync`, `lantern-setup`, the
planning and host skills and `lantern-delegate` stay locked. A name in `off` that is not switchable for its slot is dropped on read
with a warning (`extensions.droppedOff`), like a locked extra, and `required-skills.mjs` simply stops printing a switched-off
name; `offEverywhere(off)` names the ones switched off for every role that lists them, and the installer (`lantern-bundle.mjs`) neither installs those nor keeps a marked copy of them in the project, and the preflight registry check does not demand them (a skill still on for one role stays installed). So `check-skill-use.mjs`, the preflight `ok skills-off` line, the e2e checks and the texts that send an agent to
`required-skills.mjs` follow without a list of their own; `test/lantern-delegate-required-skills.test.ts` fails when `protocol.md`
or an agent definition names a switchable skill. `src/shared/extension-slots.ts` holds the slots and the locked prefix `lantern-plan`; the skills Lantern
owns, never an extra, are one list, `BUNDLED_SKILLS` in `skills/lantern-delegate/scripts/bundled-skills.mjs`,
with the role lists (`REQUIRED_SKILLS`, `ORCHESTRATOR_SKILLS`, `REVIEWER_SKILLS`, `ROLE_SKILLS`) and `alwaysOnSkills(role)`, the
rows each slot shows as Always on. `extensions.mjs` locks that list and the app imports it in main; the renderer
gets `alwaysOn`, `locked`, `switchable` and `off` through the `ExtensionsPanel` payload (the Always on rows of switchable skills are
on/off toggles saved through `extensionsSave` with an `off` list; the locked ones show a tooltip saying why), and `test/lantern-always-on-skills.test.ts`
fails when the window and the scripts differ. A locked name found in the config file is dropped on read with a
warning and removed on the next save. `src/main/extensions.ts` loads and saves the config for the panel (`loadExtensionsPanel`,
`saveExtensionsSlot`), and the Skills modal edits it on two of its three tabs (Project skills, Lantern skills, Skill linker): Lantern skills holds the role selector, its attached and attachable columns and Import list, Skill linker the path with its state (`skillLinkerState` and the reason `skillLinkerProblem` in the panel, from `resolveSkillLinker`; a repo folder resolves to its single executable with a `core` folder beside it through `resolveLinkerPath`, and the saved value is that executable; with `skillLinker` unset, the same `resolveLinkerPath` runs on the Skills repo named by `SKILLS_REPO`, which the app sets from its repo setting for itself and the sessions it starts, and the panel then carries `skillLinkerPath` and `skillLinkerFromRepo`; nothing is written to the file). The attachable column of Lantern skills is built from `pickerSkills` in `skills-state.ts`: the skills installed in Claude (`installedNames`, the panel's `installed`: folders with a `SKILL.md` in the project's and the user's `.claude/skills`, once each) without the locked and `lantern-plan` names, plus the skills from `skillsList().available` (the Project skills tab's data) while the linker is valid. The window opens on all three tabs with no skills repo; only Skill linker carries the clone prompt and, beside it, the editable repo path; Refresh on Lantern skills reads the installed folders again. The Add skill
button opens a step (`skills-extras-step.ts`) whose Save calls `extensions:create` (`createExtensionSkill`): main
validates the slot, the name (`extraProblem`) and the project, writes `<project>/.claude/skills/<name>/SKILL.md`
only into a new folder (an existing one is refused, nothing overwritten) and adds the name to the slot; with
empty content it only adds a name that is already installed. No list of skills is shipped: the
Lantern skills tab's Import list button opens a native file picker (`extensions:import` in `main.ts`) and
`importExtensionsList` adds the names of the chosen JSON file (`{ delegate, orchestrator, reviewer, skillLinker }`, every key
optional) add-only through the same validation, sets `skillLinker` when the file has one, and writes nothing
when the file is unreadable or malformed. A configured extra that is not installed is skipped
with a `WARN extensions` line from preflight, never a failure.
The list of skills a role must read in full is one function: `skills/lantern-delegate/scripts/required-skills.mjs`
(`requiredSkills(role, extras, { plan, host })`, `roleRequirements`, `ROLE`, `PLAN_SKILLS`), the role being the
slot name. Its CLI prints the list: `protocol.md` has the delegate run it, `SKILL.md` has the orchestrator run it
with `--role orchestrator`, `agents/reviewer.md` has the reviewer run it with `--role reviewer` (its fixed skills are
`lantern-no-comments` and `lantern-code-reviewer`), and `check-skill-use.mjs` (with the same `--role`, `--plan`, `--host`)
holds any of the three transcripts to it, so extras reach a role the way its fixed skills do and the brief never carries
them. Use for any skill a user adds to their delegates, orchestrator or reviewer, globally or for one project. Never hard-code a skill into preflight,
the gate or the brief, and never write a second list or checker. The Lantern skills tab is a role selector over two columns
(`skills-roles.ts`, `skills-rows.ts`, `skills-segmented.ts` over the pure model in `skills-state.ts`; `src/main/extensions-ipc.ts` registers its calls). Tests:
`test/extensions-config.test.ts`, `test/extensions-project.test.ts`, `test/extensions-panel.test.ts`, `test/skills-extras.test.ts`, `test/e2e/skills-extras.spec.ts`,
`test/lantern-delegate-scripts.test.ts`, `test/lantern-delegate-required-skills.test.ts`,
`test/lantern-delegate-check-skill-use.test.ts`.

## Plans in the app

A project's `.lantern/plans/*.plan` are read next to the map and drawn on it, read-only (the `lantern-plan`
skill writes, approves and answers). Compose these, never a second parser or a second highlight path:

- **Reader**: `src/main/lantern-plan.ts` (`parsePlanFile`, `planApprovalStates`, `planItemStatuses`,
  `planSectionDigest`). One parser for the app, tested against the skill's. A defect in it is reported, not
  patched in the view.
- **Loader**: `loadPlans` in `src/main/lantern-plans.ts`, called by `buildGraph` with the PRs it already
  derived, so `LanternMap.plans` arrives with `lantern:load` and refreshes with the map (`lanternStamp` covers
  `.lantern/plans` and the git refs). `planView` in `lantern-plan-view.ts` turns a plan and those PRs into
  the `LanternPlanView` the renderer draws: stages in order, item status, `blocked` (an unanswered question),
  approval per section (`approved` / `pending` / `stale`) and the PRs that tick each item.
- **Impacted files**: `planImpactFiles` in `src/renderer/lib/lanternplanimpact.ts`, the one derivation of a
  plan's, stage's or item's files: the files it names (`named`), its `new` files (`new`, with the purpose from
  `#impact new`) and the direct dependents and dependencies of the named ones from the map's relations
  (`derived`). Reach for it, through `planFocus`, for anything that needs "the plan's files"; never walk the
  relations again in a view.
- **Focus**: `planFocus(plan, pick, map)` in `src/renderer/lib/lanternplanfocus.ts` turns a pick (plan, stage or
  item) into the named files (`paths`), area/feature ids, `fresh` (new path to purpose), `related` and the
  origin-labelled `files`. The macro view takes it as `MacroViewContext.plan`
  and `deriveMarks` resolves it with `presenceOf`, the same call the Flow step and the open file use; the
  existing `is-lit` / `is-changed` classes show it, a related file gets a tag in the feature's file list, and
  the Files view takes the same pick as `marks` (`planFileMarks`: new `+`, named `~`, related `related`). On a
  map without areas the flat view gets it through `planMacroMarks`.
- **Plan-only filter**: the Files view's `.lt-pronly` toggle serves the open pull request or, while a plan is
  open, the plan (`planOnlySet` in `lanternpronly.ts` beside `prOnlySet`): the same `Filters.only`, layout and
  empty message path. The plan's new files enter the view through `withPlanFiles`
  (`lanternplanfiles.ts`), proposed nodes (`LanternNode.planNew`) on top of the map, the way `withOverlay` adds a
  pull request's.
- **View**: the Planning view. `lanternplanstrip.ts` is the entry (hidden when there are no plans); picking a
  plan makes `lanternview.ts` a top-level view of the whole Lantern area, not a pane in the side stack: the grid
  gets `lt-planning`, `.lt-planpane` on the left holds `lanternplanpanel.ts` (the plan only, full height) and the
  Macro or the Files view stays in `.lt-main` on the right, switched by the view bar that already exists; the
  side pane is hidden while planning (the PR panel in it is untouched and holds no plan). The Macro/Files choice is remembered for
  the session (`planningShows`) and leaving returns to the view the person came from. A pick marks the macro
  through `MacroViewContext.plan` and the Files view through `planFileMarks` (the existing `marks` of
  `pixi.render`, files only).
- **Text**: every user-visible string is a `view` message in `skills/lantern-plan/scripts/messages.json`,
  read with `say(VIEW.X)` from `src/shared/lantern-plan-messages.ts`. `test/lantern-plan-messages.test.ts`
  fails on a code that is used and missing, or defined and unused.
- **Tests**: `test/lantern-plan-view.test.ts` (loader, status, stale, blocked, marks in the macro model) and
  `test/lantern-plan-panel.test.ts` (strip, panel, picks, the lit blocks, the flat view), `test/lantern-plan-files.test.ts` (the impacted files of a stage, the marks, the plan-only filter and the proposed nodes in the Files view) and `test/lantern-planning-view.test.ts` (the Planning
  view: layout, the Macro/Files switch, marks in both, leaving). All three belong to `pnpm test`.

## Permissions for unattended runs

### `skills/lantern-delegate/scripts/permissions.mjs`
The one list of commands a delegate may run (`REQUIRED_ALLOW`, `ORCHESTRATOR_ALLOW`; the file rules are `EDIT_TARGETS`, below) and must never
run (`DENY`); the branch kinds a plain push may name are `PUSH_BRANCH_TYPES`, which `pr-create.mjs` also
enforces before the host skill pushes. Preflight checks a project's settings against it. Use when a change makes a delegate or
its scripts run a new command: add the rule here, in the narrowest form that matches how the protocol
types the command (literal absolute paths, no shell variables), with a test. Never fix a denial by
editing one project's settings by hand, and never widen a rule to make a run pass. Opening a project
in Lantern merges these rules into its `.claude/settings.local.json` (`scripts/lantern-bundle.mjs`,
add-only, never removing a rule), so a new rule reaches users when they reopen the project.

### `EDIT_TARGETS` (the same file)
The one list of files the skills tell an agent to create or edit with the Edit or Write tool (not through a
script): `.lantern/map/**`, `.lantern/lang/**` (the `%2Eclaude` alias folders sit inside both),
`.lantern/areas`, `.lantern/features`, `.lantern/platforms`, `.lantern/ignore`, `.lantern/include`,
`.lantern/sections/**`, `.lantern/plans/*.plan`, the `.ai/tmp/` scratch files (`reason`, `order`, `flow`,
`describe` as JSON, `pr-body.md`, `areas/answers.json`) and `.ai/runs/**`. `editAllow()` turns each row into an
`Edit(...)` and a `Write(...)` rule, relative so they resolve in the delegate's worktree, and `requiredAllow()`
carries them, so the bundle merge, `install-skills` and preflight (which names each missing rule) treat them like
the Bash rules. An unattended agent cannot answer an edit prompt, so a path missing here is a refused run, not a
question. **Any new file an agent writes with Edit or Write is added to `EDIT_TARGETS` in the same change**, narrow
(never `.claude/settings*`, never a wildcard over the project). `test/delegate-edit-permissions.test.ts` scans the
skills' markdown for every `.lantern/` and `.ai/` path and fails, naming it, when one is neither covered nor listed
in the test's `NOT_WRITTEN_WITH_EDIT` (a path a script writes, with the reason). `DENY` is untouched.

### Lantern's own headless runs
`allowedToolsFor` in `src/main/agent.ts`. Set up, Refresh and Resume run `claude -p` with
`--permission-mode acceptEdits` plus this list; the `lantern-mapper` workers they dispatch get the same
list (`skills/lantern-setup/agents/lantern-mapper.md` only names their tools). Use only for runs Lantern
spawns itself; a delegate runs in the user's session and gets its rules from `permissions.mjs`. A call
the list does not cover is refused and nobody can answer, so the skill, the agent and the prompt
(`buildPrompt`, `lanternRunLines`) prescribe one command shape: `node <literal skill path>/scripts/x.mjs
<literal project root> ...`, no `cd`, shell variable, loop, heredoc or redirect.
- **Finish gate**: `validate.mjs . --settled --require-areas` and `areas.mjs . required` (one function,
  `skills/lantern-setup/scripts/areas-required.mjs`) refuse a map over the Areas thresholds that has no
  `.lantern/areas` passing `areas.mjs . check`, naming step 4a. The app runs the same check itself when a
  run ends (`settleLanternRun` in `agent.ts`, `runAreasGate` in `src/main/lantern-run-gate.ts`), so a model
  that skips step 4a, or a project whose skill copy is older, still ends in an `error` event, not `done`.
  The same function reports a mapper worker that was refused a call (`watchMessage`, sub-agent messages
  carry `parent_tool_use_id`): the run ends in `error` naming the command.
- **Tests that cannot drift**: `test/lantern-headless-permissions.test.ts` reads the commands out of
  `SKILL.md`, the mapper agent and the prompts and fails on a program no rule covers;
  `test/lantern-run-flow.test.ts` runs Set up and Refresh on a 121-record, 12-feature project through
  `agent.start` with `test/helpers/fake-claude.ts` (mode `lantern`, `test/helpers/fake-lantern-agent.mjs`)
  and covers the skipped step and a refused worker; `test/lantern-areas-required.test.ts` pins the
  thresholds.
- **Agent file**: `ensureMapperAgent` is a call into the bundle's agent installer (`installAgents` in
  `scripts/lantern-bundle.mjs`): `lantern-mapper.md` carries the `.claude/agents/.lantern-bundle-agents` marker like the
  delegate agents, is refreshed only while the marker owns it (an unmarked old copy of this one file is replaced and marked once at the start of a run; every other agent keeps the rule that an unowned file is never touched), and a user-level copy of the same name wins.
