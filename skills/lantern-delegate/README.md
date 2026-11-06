# lantern-delegate

- Created: 2026-09-30
- Reference: the Lantern desktop app, which draws the `.lantern/` map and lists the pull-request
  records this skill makes every delegate leave behind.

**Writes into a project's `.lantern/` through `lantern-sync`, and pushes the delegate's own branch a
second time.** After the PR exists the delegate commits `.lantern/prs/<id>.pr` and pushes the same
branch again (plain, never forced): the one place it widens the "push your branch, open one PR" rule.
It touches only `.lantern/`, so no source hash goes stale and the review is not reopened.

## What is in the folder

| path | what |
|---|---|
| `SKILL.md` | the orchestrator's workflow: preflight gate, scoping, brief, dispatch, diff, review check, map gate, PR handover with real cost, clean-up |
| `protocol.md` | the delegate's side, self-contained: rules, green loop, shipping, PR body, the 13 Lantern steps, Report |
| `scripts/preflight.mjs` | the dispatch gate (`--repo-dir`, `--no-api`, `--init`, `--delivery`); requires the host skill of the detected host and runs its `check`; a repository with no remote passes in local mode |
| `scripts/permissions.mjs` | the commands a delegate runs, as a ready `settings.json` snippet; preflight warns about the ones not allowed and prints the snippet (`node scripts/permissions.mjs` prints it alone) |
| `scripts/init-local.mjs` | makes a fresh folder dispatchable: init on `main`, a minimal `.gitignore`, one commit; refuses the home directory and more than 5000 files |
| `scripts/pr-create.mjs` | checks the commit identity and the branch name, then opens the PR by running the host skill's `create`; the host comes from the remote URL |
| `scripts/pr-append-cost.mjs` | appends the real cost table to a PR on either host, through the host skill's `description-block` |
| `scripts/host-skill.mjs` | finds `lantern-bitbucket` or `lantern-github` (beside this skill, in `.claude/skills` or `.agents/skills`) and runs its CLI as a subprocess: the one place credentials live |
| `scripts/preferences.mjs` | reads and writes the project's PR delivery choice in `.claude/lantern-preferences.json` (`pr`, `push` or `local`) |
| `scripts/lantern-account.mjs` | asks the running Lantern, through the host skill's socket module, for the e-mail of the project's profile |
| `scripts/git-env.mjs`, `scripts/github/identity.mjs` | the git identity check and the commit wrapper; the e-mail is the Lantern profile's, else `GIT_COMMIT_EMAIL` from `.ai/.env` (read only for that and `GIT_COMMIT_NAME`, never for a token) |
| `agents/` | `lantern-delegate-low|medium|high|xhigh` (Sonnet, worktree-isolated) and `reviewer` |
| `scripts/delegate-kinds.mjs` | the agent-type constants and tests the transcript linters share: Sonnet, Opus or Fable delegate (read from the agent type, else from the model), and which of `reviewer` or `reviewer-complex` reviews it |

It is self-contained: nothing is loaded from the skills repo's delegate skills. Changes to them
there do not reach this copy; port what is worth having.

## One-time setup

The Lantern app installs `lantern-setup`, `lantern-sync`, this skill and its agent types
(`.claude/agents/`) into a project when the project is opened in it. For a project opened elsewhere
run `pnpm run install-skills -- <project>` in the Lantern repo. Both add the bundle's own paths to
the repo-local exclude file when they are not ignored (never `.gitignore`, never in a non-git
directory), never overwrite what has no `.lantern-bundle` marker, skip agent names already in `~/.claude/agents`
and never write to `~`. A session that started earlier may reject the types once; the skill retries the dispatch, then falls
back to the registered `delegate-sonnet-<level>` type.

`lantern-code-reviewer`, `lantern-commit`, `lantern-local-loop` and `lantern-no-comments` ship with Lantern. The
preflight gate checks all of them and this skill, in `<cwd>/.claude/skills` and `~/.claude/skills`.

## The complex variant

`skills/lantern-delegate-complex/` offers an Opus or a Fable delegate for a task too hard for
`sonnet-high`, **only after the user chose it**. Sonnet is always the default: when the orchestrator
judges a task heavy it asks the user one question (Sonnet recommended and cheaper, Opus, Fable the most
capable and dearest) and dispatches as they answer; no stored preference selects a dearer model. The
skill carries no script, no brief template and no protocol of its own: its `SKILL.md` states only what
differs and sends the orchestrator here, its agent types (`lantern-delegate-complex-opus-medium|high|xhigh`
on Opus, `lantern-delegate-complex-fable-medium|high|xhigh` on Fable, and `reviewer-complex` on Fable) send
the delegate to this folder's `protocol.md`, whose "Opus and Fable delegates" section is the one place the
differences are written for the delegate.

- **Whole run.** The delegate does everything itself: the code, the green loop, `sync.mjs finish` and the
  re-mapping, features and areas, the PR record with its reasons, order and flow, `sync.mjs verify`, the
  push and the pull request. The model policy of `lantern-setup` accepts Sonnet, Opus and Fable of any
  version (5.5, 5.5 and 5.1 or newer are recommended and an older one only warns), so no mapper or other agent is involved; the `--model` of `finish` is the delegate's own exact
  id.
- **Reviewer.** `reviewer` (Opus) for a Sonnet or an Opus delegate, `reviewer-complex` (Fable) for a Fable
  delegate; the spawn carries no `model`.
- **Checks.** `scripts/lint-reviewer.mjs` reads the delegate's kind from `agent-<id>.meta.json` (else from
  the model in the transcript) and flags a review by the wrong reviewer type (`review-not-by-reviewer`), a
  missing reviewer type (`reviewer-missing`), a reviewer spawned with a `model` that would override its
  pinned one (`model-override-on-spawn`) and a delegate type that ran on another model family
  (`delegate-type-on-wrong-model`). `check-skill-use.mjs` and `lint-transcript.mjs` need no change: the
  required-skill list is per role and the command rules are the same for every kind. Codex does not get the
  skill.

## Differences from the skills-repo delegates

- The default pinned Sonnet rungs run from `sonnet-low` to `sonnet-xhigh`; no Opus, Fable or Haiku rung
  (Opus and Fable delegates exist only through `lantern-delegate-complex`, after the user's choice).
  Explicit-model runtimes may also use exact `gpt-6-astra` with truthful attribution and the same map rules.
- `preflight.mjs` takes `--repo-dir` (every git check runs there, so a session in one repo can
  dispatch work for another) and `--no-api`; the original checked the session repo's remote and
  failed falsely for cross-repo work. The target is matched as `refs/heads/<target>`, not as a
  suffix of another branch. The always-group of skills is this skill plus the ones that ship with Lantern, and the
  gate also requires the host skill of the detected host (`lantern-bitbucket` or `lantern-github`),
  since the delegate opens its PR and the orchestrator appends the cost through it.
- Credentials are the host skills': environment, or the running Lantern over its socket. This skill
  reads no token and no `.ai/.env` token, and scaffolds nothing.
- Whether a PR is opened is the user's recorded choice (`Delivery: pr|push|local` in the brief), asked
  once per project by the orchestrator.
- Every base: the delegate's first step is `git fetch origin`, then `git reset --hard origin/<base>`,
  because a delegate worktree forks from the main checkout's original commit, not from the branch
  that was checked out when it was dispatched.
- The delegate never signals processes it did not spawn, and a reviewer result that never arrives
  is reported rather than invented: the delegate pushes and stops, and the orchestrator runs a fresh
  reviewer and relays the verdict.
