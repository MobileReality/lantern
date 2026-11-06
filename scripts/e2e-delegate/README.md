# lantern-delegate end-to-end test

A regression harness for the `lantern-delegate` skill (Jira LAN-22). It builds four fresh dummy
projects, points them at a mock Bitbucket and a fake ssh, lets headless Claude sessions run the skill
for real, then checks what came out. It spends money and needs the `claude` CLI with credentials, so
it is **not** part of `pnpm test`.

```
pnpm run e2e:delegate -- --yes            # the live run, about 7 USD
pnpm run e2e:delegate -- --dry-run        # prints the plan, spawns nothing, spends nothing
```

Without `--yes` (or `E2E_YES=1`) it prints the plan and refuses to start.

| flag / variable | effect |
|---|---|
| `--yes`, `E2E_YES=1` | required for a live run |
| `--dry-run` | plan, estimate and cap only, exit 0 |
| `--keep` | keep the temp projects, logs and session transcripts for inspection |
| `--only todo-cli,pyutil` | run a subset of the projects |
| `E2E_MAX_USD` | cost cap in USD, default 12 |
| `CLAUDE_BIN` | the `claude` binary, default `claude` |

Exit code 0 only when every hard check of every project passes and the total cost is within the cap.
The JSON report is written to `.ai/tmp/e2e-delegate-report.json`; it also holds `realConfig` (the real extensions file with its SHA-1 before and after).

## What a run does

1. **Workspace** (`workspace.mjs`, `projects.mjs`): a temp dir with four projects (todo-cli and
   tiny-api in Node, pyutil in Python, rubyutil in Ruby) generated from fixtures, each a git repo on
   `main` with a bare remote and the origin `git@bitbucket.org:e2e/<name>.git`, and the stored PR
   delivery (`.claude/lantern-preferences.json`, `pr` unless `skill-test lantern-delegate --delivery`
   says `push` or `local`). The account is in no file and no variable: a fake Lantern credential server
   (`fake-lantern.mjs`, on a socket named by `LANTERN_CREDENTIAL_SOCKET` in the project settings) hands
   it to the Bitbucket skill. The bundled skills are installed with `scripts/install-skills.mjs`. A mock
   Bitbucket (`mock-bitbucket.mjs`) runs as a child process on a free port.
2. **Redirects**: `fake-ssh.sh` (`GIT_SSH_COMMAND`) maps the Bitbucket URL to the local bare repo, so
   the remote still looks like Bitbucket and the delegate does not refuse it. `redirect-fetch.mjs`
   (`NODE_OPTIONS=--import`) rewrites `https://api.bitbucket.org` to the mock, so no skill script is
   modified. Both reach the sessions through each project's `.claude/settings.local.json`.
3. **Map build**: one headless `claude -p` per project, in parallel, runs `lantern-setup`, commits
   `.lantern/` to `main` and pushes.
4. **Orchestrator run**: one headless session per project, in parallel, uses `lantern-delegate` for a
   fixed small task, dispatches one delegate in the foreground and does the handover.
   Both phases use `--permission-mode auto --setting-sources project,local --model sonnet`: the project
   settings only, which simulates a machine without the user's own settings.
5. **Checks** (`checks.mjs`, `verify.mjs`), report (`report.mjs`) and cleanup.

## The extras variant

One project, `todo-cli`, runs with extras in the extensions config; the other three have none.

- **Neutral skills.** The harness writes two small skill folders itself into that project's
  `.claude/skills` (`projects.mjs`, `writeExtraSkills`): `e2e-extra` for the `delegate` slot and
  `e2e-orch-extra` for the `orchestrator` slot, each a `SKILL.md` with a one-line rule. The
  worktree of the delegate sees them through the `.claude/skills` link the protocol makes.
- **A switched-off built-in.** `tiny-api` has `lantern-local-loop` switched off for the delegate (`delegateOff` in
  `projects.mjs`, written to the `off` key with `setSwitchedOff`); `skill-use-gate` then runs against the list
  without it, the installer (run with the isolated `HOME`) leaves it out of the project, `skills-dir-clean`
  neither expects it nor tolerates it, and `off-skill-not-read` looks at the delegate's transcript.
- **Isolated config.** Every session runs with its own `HOME` (`workspace.mjs`, `createIsolatedHome`):
  `<root>/homes/<project>`. Its `.claude/lantern-extensions.json` holds the project's slots (written with
  `setExtensions`), and the skill linker the real config names, if any (read-only), so the generic
  conventions still link. `preflight.mjs` and `check-skill-use.mjs` choose the config from `$HOME`
  (`extensionsPath`), so the sessions never see `~/.claude/lantern-extensions.json`.
  The preflight gate reads the delegate permissions from `~/.claude/settings.json`, so the home gets its own
  `settings.json` with the snippet of `permissions.mjs` (`settingsSnippet`); without it the gate fails on
  `permissions` and the orchestrator refuses to dispatch. The `claude` CLI keeps
  authenticating because the home links the real `Library` (the macOS keychain lookup) and
  `.claude/.credentials.json` when they exist (links, so a token refresh by a session writes through to the real entry; the harness itself only reads). The session transcripts land in the isolated home and go with
  the temp root.
- **Guard.** The runner takes a SHA-1 of `~/.claude/lantern-extensions.json` before the workspace is
  built and after the checks (`fingerprintFile`, `withConfigGuard`), prints both in the report, and fails
  the run if they differ. Compare it with `shasum ~/.claude/lantern-extensions.json` yourself too.

## Checks

Hard checks fail the run; informational ones are reported as `WARN`.

| check | proves |
|---|---|
| `map-build-session` | the map session ended with a successful result line |
| `map-pushed` | `.lantern/map` is on `origin/main` |
| `one-open-pr` | the mock holds exactly one open PR, feature branch into `main` |
| `sync-verify-green` | `sync.mjs verify --require-pr --require-why --require-order --require-flow` is GREEN on the pushed branch (a fresh clone of it) |
| `no-pr`, `branch-pushed`, `nothing-pushed` | under delivery `push` or `local` the mock holds no PR; `push` leaves the branch on the remote, `local` leaves the remote with `main` only (and `sync-verify-green` runs with the same four `--require-*` flags on the branch's local record, `sync.mjs carry`-ed into the clone) |
| `panel-sees-record` | under delivery `push` or `local`, `localPrs` of `src/main/lantern-local.ts` shows the branch against `main` with a reason for every file, the review order, the flow and the description |
| `validate-settled` | `validate.mjs --settled` prints OK on that clone |
| `panel-sees-pr` | `src/main/lantern-prs.ts` (bundled with esbuild) loads the PR as `open`, lists every changed file, with no warnings |
| `skills-dir-clean` | the bundled skills (among them `lantern-commit`, `lantern-no-comments` and `lantern-local-loop`) are real folders; the rest are symlinks to generic conventions only (no `delegate`, `wayfinder`, ...; a user's own linked `commit`, `no-comments` or `local-loop` stays allowed); the project's own extras are the one allowed exception and must be present |
| `no-transcript-errors` | no `Unknown skill`, `ERR_MODULE_NOT_FOUND` or `not found. Available agents` tool error in any session transcript newer than the run start |
| `reviews-by-reviewer` | the delegate dispatched at least one review and every one used `subagent_type: "reviewer"` |
| `skill-use-gate` | `check-skill-use.mjs` is clean on the delegate (required skills and the project's delegate extras read in full, the brief carrying no list: the delegate gets it from `required-skills.mjs`) |
| `reviewer-skill-use` | `check-skill-use.mjs --role reviewer` is clean on the reviewer transcript (`lantern-no-comments`, `lantern-code-reviewer` and the reviewer extras read in full; the reviewer gets the list from `required-skills.mjs --role reviewer` at its start) |
| `extra-read-in-full` | project with a delegate extra: the delegate read that `SKILL.md` in full, though the dispatch prompt does not name it (the `skill-not-read` and `skill-partly-read` findings of `check-skill-use.mjs`, whose list is `required-skills.mjs`, run by the delegate at its start) |
| `off-skill-not-read` | informational, for a project with a built-in skill switched off for the delegate (the `off` key of the isolated config, `delegateOff` in `projects.mjs`): the delegate did not read it in full, since `required-skills.mjs` left it out and `skill-use-gate` runs against `requiredSkills(ROLE.delegate, extras, { off })` |
| `orch-extra-read-in-full` | project with an orchestrator extra: an orchestrator session read `.claude/skills/<name>/SKILL.md` in full, by the rule `check-skill-use.mjs` applies to the delegate (`skillReadFindings`), against the orchestrator list of `required-skills.mjs` (`requiredSkills(ROLE.orchestrator, extras)`); `SKILL.md` has the orchestrator run `required-skills.mjs --role orchestrator` at its start |
| `orch-extra-not-in-brief` | the orchestrator extra is named nowhere in the dispatch prompt: the orchestrator's skills are never sent to a delegate |
| `command-lint-ratio` | informational: the share of delegate commands breaking `lint-transcript.mjs` rules stays under 25% |
| `reviewer-unavailable` | the last reviewer verdict says `UNAVAILABLE:` with `no <language> convention available` and cites no TypeScript, Biome or Zod rules. Hard for Python and Ruby, informational for the plain JavaScript projects (a TypeScript convention may reasonably be argued there). Best effort: it reads the reviewer's final message, which a reviewer delivers as the `message` of its `SubagentHandback` call, and may need tuning after the first live runs. The policy is `HARD_UNAVAILABLE_LANGUAGES` in `checks.mjs` |
| `session-finished` | the orchestrator ended with a successful result line |
| `no-permission-denials` | the orchestrator result has no `permission_denials` |

## Cost

The previous full run cost about 7 USD. The cap is 12 USD (`E2E_MAX_USD`). Each call gets a
`--max-budget-usd` derived from it, so that the worst case over all calls stays within the cap (with
4 projects and 12 USD: 0.89 per map build, 2.11 per orchestrator run; a smaller cap shrinks them).
The 2.11 USD per orchestrator run is tight: a first live run may end with `error_max_budget_usd`
(shown by `session-finished`); raise `E2E_MAX_USD` then. A session that gives no `result` line (killed
on timeout, crashed) has an unknown cost, so the report shows `>= $x` instead of an exact figure. A
timed-out session gets SIGTERM, then SIGKILL after 15 s, on its own pid only. The sessions get the
parent environment minus `CLAUDECODE`, `AGENT_USAGE_REPO`, `BITBUCKET_*`, `GITHUB_TOKEN`, `GH_TOKEN`, `GIT_COMMIT_*`, `GIT_AUTHOR_*`
and `GIT_COMMITTER_*`, so a real token never replaces the dummy one. The total is the sum of `total_cost_usd` over every stream-json `result` line, setup and runs. The
orchestrator phase is not launched when the map builds already passed the cap, and a total over the
cap fails the run. Sessions run in parallel, so the cap is checked between phases and enforced inside
a phase by the per-call budgets.

## Cleanup

Unless `--keep` is given, the temp projects, remotes and logs are removed, and so are the session
transcript folders under `~/.claude/projects` whose names derive from the temp project path (never
any other folder). The mock is stopped by its own pid; the harness never signals by process name and
never signals a pid of 1 or below.

## Tests

`test/delegate-e2e-harness.test.ts` runs in the normal suite with no `claude` and no network beyond
localhost: the mock, the fetch hook, fake ssh against a temp bare repo, the project fixtures (their
own tests run with the real node, python3 and ruby when present), every check with a passing and a
failing fixture, cost accounting and the cap, the cleanup guard, and the whole runner against a fake
`claude` binary.

## Known gaps

- **Permission modes other than `auto`.** The run uses `--permission-mode auto`, so the preflight
  snippet that is meant to remove prompts in other modes is not exercised.
- **The user's own global skills.** `--setting-sources project,local` leaves out `~/.claude`, so
  interactions with a user's full set of global skills are not covered. `install-skills.mjs` also
  keeps a bundled skill that already exists in `~/.claude/skills`; `skills-dir-clean` then reports it
  missing.
- **Stacked tasks and map-only tasks.** Covered by unit tests only; the four tasks are single-branch
  code changes.
- **Long tasks on a real stack.** The tasks are small and the projects tiny; context pressure, long
  review loops and real Bitbucket behaviour are not exercised.
- **Real Bitbucket and ssh.** The mock implements only the routes the skill scripts use.
