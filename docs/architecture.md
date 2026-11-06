# Architecture

A short map of how Lantern is built. The conventions and the build pipeline are in
[CONTRIBUTING.md](../CONTRIBUTING.md); `docs/primitives.md` lists the building blocks a change should reuse.

## Processes

Lantern is an Electron app with the usual three parts:

- **Main** (`src/main/`): everything native or privileged. Windows, the tray, the local HTTP
  server, the filesystem, child processes, git, the credential store.
- **Renderer** (`src/renderer/`): the UI (HTML, CSS and TypeScript). It has no Node access.
- **Preload** (`src/preload/`): `overlay.ts` and `workspace.ts`, the narrow typed surface exposed
  through `contextBridge`. The renderer reaches main only through it, and main answers mostly
  with `ipcMain.handle` handlers, plus a few one-way `ipcMain.on` channels.

`src/shared/` holds what several processes use: constants, the provider table, the message
catalogue (`src/shared/lang/`) and shared types. Cross-folder imports use `@shared/*`, `@main/*`
and `@renderer/*`.

`esbuild` (`scripts/esbuild.mjs`) bundles `src/` and `skills/` into `out/`, and `electron-packager`
turns `out/` into the app. It does not type-check, so `pnpm run typecheck` is separate.

## Where things live under `src/`

| Area | Where |
|---|---|
| Session scanning and state | `src/main/scanner.ts`, `claude-poll.ts`, `codex-scanner.ts`, `codex-turns.ts`, `session-context.ts` |
| Notifications | `src/main/notifier.ts`, `notifycard.ts`, `session-notification.ts`, `codex-hooks.ts`, `src/notify-hooks/` |
| Local HTTP server | `src/main/server.ts` |
| Running Claude or Codex for Lantern's own actions | `src/main/agent.ts`, `agent-codex.ts`, `agent-request.ts`, `provider.ts` |
| The Lantern map (reading `.lantern/`) | `src/main/lantern*.ts` (`lantern-parse.ts`, `lantern-nodes.ts`, `lantern-macro*.ts`, `lantern-areas.ts`, `lantern-plans.ts`) |
| Pull requests and local review | `src/main/lantern-prs.ts`, `lantern-pr-*.ts`, `lantern-prdiff.ts`, `lantern-local.ts`, `local-reasons.ts`, `src/shared/local-review.ts` |
| Explainers | `src/main/explains.ts`, `pr-explain*.ts` |
| Accounts and credentials | `src/main/auth/` (including `credential-server.ts`), `src/shared/providers.ts`, `src/shared/auth-kinds.ts` |
| Skill bundle | `src/main/bundle.ts`, `src/main/skills.ts`, `src/main/extensions.ts`, `scripts/lantern-bundle.mjs` |
| Embedded editor | `src/main/serveweb*.ts` |
| Code previews and language servers | `src/main/lsp/`, `src/main/languages/`, `packages/lsp-runtime/` |
| Memory view | `src/main/memory-*.ts` |
| UI features | `src/renderer/features/` |
| UI helpers, the graph and the macro view | `src/renderer/lib/` (`lantern-pixi/` draws the graph) |
| Command palette and commands | `src/renderer/command-palette/`, `src/renderer/commands/`, `src/main/commands/`, `src/shared/commands/` |
| The `lantern` command | `src/cli/lantern` |

## The `.lantern/` map and pull request records

A project's `.lantern/` folder is plain files, written by the Lantern skills and read by the app:

- `map/`: one record per source file (and per markdown skill, agent or instruction file) with its
  architectural role, a one-line purpose, a content hash and its relations to other files.
- `features`, `systems`, `areas`, `platforms`, `sections/`: the vocabulary that groups the records
  into capabilities, outside systems, product areas, platform tabs and project-wide notes.
- `lang/<code>/`: the texts, one folder per language.
- `plans/*.plan`: plans written by `lantern-plan`, drawn read-only next to the map.
- `prs/<id>.pr`: a record per pull request, with a reason per changed file, the review order, a
  plain-words flow and a description. The app shows these in the pull request view. A record does
  not say whether the pull request is still open: that comes from git and from the code host (below).
- `local/<branch>.branch`: the same record for a branch with no pull request. It is ignored by git.
- `.project/`: local state of the app (review marks, explainers, the opened stamp). Written only
  through `src/main/metadir.ts`, and never committed.

`lantern-setup` builds and refreshes the map, `lantern-sync` keeps it true after a change and writes
the pull request records. The app only reads `.lantern/`, apart from the local state in `.project/`.
Which files are mapped is decided in the skill (`skills/lantern-setup/scripts/lib.mjs`,
`ignore.mjs`) and in the app (`src/main/lantern-enumerate.ts`, `lantern-ignore.ts`); tests keep the
two lists identical.

### State of a pull request

The view first shows what git says: a branch still on the remote is open, a pull request named by a merge
commit (`pull request #N`) or whose head is in the base is merged, a record whose branch is gone is closed.
A squash or rebase merge leaves none of that behind, so for a GitHub or Bitbucket `origin` the app also
asks the host (`src/main/lantern-host-status.ts`, with one driver per provider in `lantern-host-drivers.ts`
and the request in `lantern-host-request.ts` and `lantern-host-github.ts`):

- Bitbucket: `GET /2.0/repositories/<workspace>/<repo>/pullrequests/<id>` with the account's e-mail and token.
- GitHub: `GET /repos/<owner>/<repo>/pulls/<id>` with the account's token as a bearer. `closed` is merged
  when `merged` is true or `merged_at` is set, otherwise declined.

Both answers become open, merged or declined, plus the base branch. The account is the one Integrations
chooses for the project (a chosen one wins, otherwise the only one of the kind); the token stays in memory
and is never logged, and every failure (no account, 401, 403, 404, a timeout, a network error) ends in one
note on the view, never an exception. Answers are cached for five minutes per project and the refresh button
drops them. A GitHub rate limit (429, or 403 with `x-ratelimit-remaining: 0` or `Retry-After`) stops further
requests of that project for the cache window. A record whose `#url` is on the other provider's host is
never sent to this one.

The host answer is the source of truth and overrides git in either direction; when there is none, because
there is no account or the request failed, the git state stays. Bitbucket is asked about the pull requests
git calls open. GitHub is asked about all of them (the open ones, then the 30 newest others), because only
the host knows a squash merge.

## The skill bundle

The extra skills each role (delegate, orchestrator, reviewer) reads are two files of the same shape: the
user's `~/.claude/lantern-extensions.json` and the project's `.claude/lantern-extensions.json`. The
effective list of a role in a project is the global names followed by the project's, each name once
(`skills/lantern-delegate/scripts/extensions.mjs`, `extension-skills.mjs`; `src/main/extensions.ts` for the Skills
window). The project is the folder the work runs in, except that a linked worktree resolves to its main
checkout, where the file lives (`projectRootOf`). `off` and `skillLinker` are read from the global file only. A
malformed file is reported by name and ignored without touching the other file. The app writes the project file
atomically, only inside the project's `.claude` folder, and only once git ignores it (`ensureIgnored` in
`scripts/lantern-bundle.mjs`, which also excludes it when the project is opened).

`skills/` is the source of the skills Lantern ships, sixteen in all.

**The map**

- `lantern-setup`: builds or refreshes the `.lantern/` map, one record per file with its role,
  purpose, content hash and relations.
- `lantern-sync`: keeps the map true after a change by re-mapping the files it touched, and writes
  the pull request record `.lantern/prs/<id>.pr`.

**Planning**

- `lantern-plan`: the entry skill. Writes a plan under `.lantern/plans/` that Lantern shows next to
  the map, and has you approve it section by section.
- `lantern-plan-impact`: works out from the map what a planned change touches and writes the plan's
  impact section.
- `lantern-plan-stages`: splits the change into ordered stages of items, each with an acceptance
  check and its open questions.
- `lantern-plan-review`: shows the plan one section at a time and records each approval.
- `lantern-plan-handoff`: hands an approved plan to `lantern-delegate` and keeps its items ticked
  from the pull request records.

**Delegation**

- `lantern-delegate`: hands tasks to background agents that each work in their own git worktree,
  leave the map true and end their pull request with a `.lantern/prs/<id>.pr` record.
- `lantern-delegate-complex`: the same delegate flow on Opus or Fable for hard tasks, offered only after you
  choose that model for the task (Sonnet is the default); the Opus or Fable delegate does the whole run itself.
- `lantern-local-loop`: plans a task and implements it as small verified steps, one commit per step,
  with nothing pushed.
- `lantern-commit`: short, concrete commit messages with no trailers.
- `lantern-no-comments`: code that explains itself, with a comment only for a non-obvious reason.
- `lantern-code-reviewer`: reviews a change against the conventions the project has linked.

**Integrations**

- `lantern-jira`: gets, searches, comments on and moves Jira Cloud tickets, and writes their
  descriptions.
- `lantern-bitbucket`: lists, shows, opens and comments on Bitbucket Cloud pull requests.
- `lantern-github`: lists, shows, opens and comments on GitHub pull requests.

The integration skills use the account added in Lantern, so no token is typed into a chat. Each project
can use any account added for any of the three providers: the provider of its `origin` remote and Jira
use the only account of a kind without a choice, and any other provider needs an account chosen for
that project in Integrations.

When a project is opened, `installOnOpen` in `src/main/bundle.ts` installs them into the project's
native skill folder (`.claude/skills` for Claude, `.agents/skills` for Codex), only where git
ignores that folder, and never over a skill that is not marked as the bundle's. Claude also gets
the agent types of `lantern-delegate` and `lantern-delegate-complex` in `.claude/agents`.
`lantern-delegate-complex` is the same delegate flow on Opus or Fable for hard tasks, dispatched only after the
user chose that model for the task (Sonnet is the default). The Opus or Fable delegate does the whole run,
the code, the green loop, the re-mapping and the pull request record; a Fable delegate is reviewed by
`reviewer-complex` (Fable), the others by `reviewer`. That is possible because the map's model policy
(`lantern-setup`'s `references/model-floor.json`) accepts Sonnet, Opus and Fable of any version (5.5, 5.5 and 5.1 or newer are recommended and an older one only warns; on the Codex route the same holds for `gpt-<version>-sol`, recommended 6.1, `gpt-<version>-astra`, recommended 6, and `gpt-<version>-terra`, with no recommended version). It has no
Codex counterpart. `pnpm run install-skills -- <project-dir>`
does the same for a project opened elsewhere. Details and rules are in
[CONTRIBUTING.md](../CONTRIBUTING.md#skills).

## The dev profile

`pnpm start` runs as the `dev` profile (`LANTERN_PROFILE=dev`), one build per worktree. Each
worktree gets its own data folder (`Lantern-dev-<worktree>-<hash>`, first seeded with the projects
and settings of `Lantern-dev`) and free ports, so several dev builds run beside each other and
beside an installed Lantern. A build is named after its branch (or `LANTERN_INSTANCE`) and shows a
short form of that name (last branch segment, ten characters at most) next to a menu-bar icon in its
own colour, on the Dock badge and in a coloured banner under the window's top bar; the colour
differs per worktree. It writes its ports to `out/lantern-instance.json` in the worktree.
`pnpm open:dev --project=<dir>` opens a project in this worktree's running build.

The dev profile does not install the skill bundle into opened projects, the `lantern` CLI link or
Codex hooks (the installed app owns those). Both profiles still share `~/.vscode-server`. Both
instances watch the same Claude sessions, so the dev profile shows no notification cards;
`LANTERN_NOTIFICATIONS=1` turns them back on, and `LANTERN_NOTIFICATIONS=0` silences any run. The
`CCM_DEBUG` harness listens on 31339 in the installed profile and on a free port in a dev build
(`debugPort` in `out/lantern-instance.json`); every request needs its per-launch token
(`debugToken` in the same file, `lantern-debug.json` in the data folder for the installed profile), see
[Debug harness](../CONTRIBUTING.md#debug-harness).

`pnpm test:graph:e2e` runs the graph's Electron checks in a hidden, nonactivating window; set
`LANTERN_GRAPH_VISIBLE=1` only when debugging them locally.

## Code previews, language servers and diffs

Code previews package a language server for TypeScript and JavaScript. Syntax colors appear
immediately for supported languages from bundled TextMate grammars and the VS Code-shaped
`lantern-dark.json` theme. The checked-in theme consumes `colors`, `tokenColors`,
`semanticHighlighting`, and `semanticTokenColors`; normalized themes with the same fields can be
ported later without adding a theme picker or import UI. Semantic selectors support token types,
modifiers, and language qualifiers. VS Code token-type hierarchies and extension-contributed
defaults are outside this local theme format. Semantic colors replace lexical properties only when
the server supports semantic tokens and the source is still the exact version that was displayed.
Pull request revisions run from isolated Git snapshots, without installing dependencies or running
project build scripts. Snapshot analysis is limited to 30,000 files and 64 MB, and individual
semantic documents to 2 MB.

Diffs keep TextMate state separately for the old and new sides of each hunk, including lines
revealed from a fold. Grammar state restarts at a disjoint hunk because previews do not fetch the
omitted historical source between hunks.

Historical TypeScript reuses an installed dependency tree only when package manifests and the
lockfile match the snapshot. Workspaces and local links fall back to the server's bundled
TypeScript libraries so an old revision never resolves source from the live checkout.

The packaged server runtime is platform-specific and includes a genuine Node runtime.
Cross-platform packages must be built on their target platform. Run `pnpm test:lsp` to build the
runtime, initialize vtsls, and exercise real cross-file TypeScript semantic tokens.

## Notifications and Codex hooks

Claude session status comes from the `claude agents --json --all` snapshot Lantern polls; see
"Claude session status and notifications" in [CONTRIBUTING.md](../CONTRIBUTING.md). Lantern no
longer installs Claude hooks.

Codex activity hooks are optional and require an explicit **Set up** click shown when Codex is
selected. Lantern merges its handlers into `${CODEX_HOME:-~/.codex}/hooks.json`, preserves foreign
handlers and file permissions, and backs up the file before a change. Open `/hooks` in Codex to
review and trust the installed definitions. Presence in the file does not mean Codex has trusted or
enabled them. The scripts only forward the hook event to Lantern's loopback server with a private
local token; they never make an approval decision.

Codex sends a `Stop` event at a turn boundary, so Lantern alerts on the first `Stop` for that
turn. Another hook may then ask Codex to continue; a later prompt returns the session to its
working state without repeating the earlier alert. `SessionEnd` is not a tab-switch signal. It can
follow archive, delete, or normal close, and Codex may also send it after a chat stays unopened for
about 30 minutes.

The official Codex editor extension is optional. Lantern does not install or modify it, and
compatibility between that extension and Lantern's embedded serve-web editor has not been verified.
On Windows, Lantern launches only a directly resolved native Claude or Codex executable; a PATH
containing only a `.cmd` shim is reported as unavailable rather than run through a shell. Native
Windows hook and runner behavior has not yet been verified.
