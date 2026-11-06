# Getting started

A walk through Lantern from the first launch to a reviewed change. For installing and running the
app, see [installation.md](installation.md); for how it is built, see [architecture.md](architecture.md).

## First launch

Run `pnpm install` and `pnpm start` (or open an installed Lantern). The main window lists your
projects and the sessions Claude Code runs in your VS Code windows, one entry per working
directory, each with its state and last reply.

Choose **Lantern tools → Claude or Codex** in the sidebar. This sets the assistant Lantern uses for
its maps, explainers and repairs in that project; it does not change the assistant inside the
embedded editor.

## Open a project

Open a folder from the main window, or from a terminal after installing the command line
(**Settings → Command line → Install**):

```bash
lantern .
```

The folder opens in its own window. Opening a project installs the Lantern skills into its ignored
native skill folder: `.claude/skills` for Claude and `.agents/skills` for Codex. A project window
has a toolbar with the Lantern map, Skills, the project's assistant and the mode switch.
On Codex the map is written by `gpt-<version>-sol` (recommended 6.1), `gpt-<version>-astra`
(recommended 6) or `gpt-<version>-terra` (no recommended version) of any version; an older Sol or Astra only warns.

A Claude session that was already running needs a fresh start before the agent types the bundle
installs are registered.

## The Lantern map

The **Lantern** tab shows the project's architecture as a graph. The graph comes from a `.lantern/`
folder in the project: one record per source file with its role, a one-line purpose and its
relations to other files.

- With no map yet, the tab offers **Set up Lantern map**. It runs the `lantern-setup` skill with
  the project's assistant. You can stop a run and resume it later.
- Once a map exists the button reads **Refresh map**. It is highlighted when files have changed
  since the map was written.
- The map is plain files in `.lantern/`, so it can be committed with the project.

> **Note:** Building the map of a large project for the first time can use a lot of tokens, but it
> is a one-time job. After that the map is kept up to date with every pull request: the author or
> the delegate re-maps only the files the change touched (`lantern-sync`, `lantern-delegate`), so
> this first run is the one big cost in Lantern.

## Pull request and local review

With a Bitbucket or GitHub account added in Lantern (command palette, **Integrations**), the Lantern
tab shows the project's pull requests. Open one to see its changed files in review order, the diff
of each file, the graph with the touched files marked, and a reason for each changed file.

**Integrations** also decides which account each project uses. Every project, a brand-new one without
a remote included, shows a slot for each of GitHub, Bitbucket and Jira, lists every account you
added for it, and lets you choose one for that project, change it or clear it. The provider of the
project's `origin` remote is shown as the suggestion (for example "Suggested: GitHub, from the
origin remote") and, like Jira, uses your only account of that kind without a choice. Any other
provider is used only after you choose an account for it, and a chosen account is used whatever the
remote says. A provider with no account yet offers **Add an account**. When an assistant run
says there is no account for the project, choose one for it here. A token variable already set in
the environment Lantern was started from still wins over a chosen account; the slot then says so
in a warning.

Pull requests opened by the `lantern-delegate` skill carry a record in `.lantern/prs/<id>.pr`
with those reasons, the review order and a plain-words flow of the change, so the review
opens already explained.

For changes that have no pull request yet, use **+ Compare** in the Lantern tab, or the command line:

```bash
lantern --compare origin/main                  # the uncommitted changes
lantern --compare origin/main..feat/x          # a branch without a pull request
```

A local review has the same file list, diffs and graph as a pull request. One click asks the
assistant for a one-sentence reason per changed file.

## Notifications

Lantern watches your sessions and tells you, in the menu bar and with native notifications, when a
session **finishes**, **needs approval** or is **waiting for input**.

A `pnpm start` build runs as the `dev` profile and shows no notification cards, because it watches
the same sessions as an installed Lantern. Set `LANTERN_NOTIFICATIONS=1` to turn them on there, or
`LANTERN_NOTIFICATIONS=0` to silence any run.

Codex activity hooks are optional and need an explicit **Set up** click, shown when Codex is the
selected assistant. Open `/hooks` in Codex to review and trust what Lantern installed.

## Skills

Lantern ships its own skills in [`skills/`](../skills) and installs them into each project you
open:

- `lantern-setup` builds or refreshes the `.lantern/` map.
- `lantern-sync` keeps the map true after a change and records pull requests in it.
- `lantern-plan` and its helper skills write a plan under `.lantern/plans/` that Lantern shows next to the map.
- `lantern-delegate` hands tasks to background agents that each work in their own git worktree,
  leave the map true and end their pull request with a `.lantern/prs/<id>.pr` record.
- `lantern-delegate-complex` is the same for a task whose difficulty is judgement or design: an Opus or a
  Fable delegate does the whole run itself, the map included. It costs more, so Sonnet stays the default
  and the orchestrator offers Opus or Fable only by asking you, one question per heavy task. The map
  accepts Sonnet, Opus and Fable of any version; Sonnet 5.5, Opus 5.5 and Fable 5.1 or newer are
  recommended and an older one only warns.
- `lantern-commit`, `lantern-local-loop`, `lantern-no-comments` and `lantern-code-reviewer` are the
  skills a delegate works by.
- `lantern-jira`, `lantern-bitbucket` and `lantern-github` read and update tickets and pull requests
  with the account added in Lantern, so no token is typed into a chat.

The **Skills** window in a project has three tabs: Project skills, Lantern skills and Skill linker (the
path of an external skill linker, if you use one). Skills you add are your own choice and are never
installed for you.

On Lantern skills you pick a role at the top (Delegate, Orchestrator or Reviewer). The left column lists
the skills attached to that role; the right column lists the skills you can attach, with a search box
(`/` or Ctrl+F jumps to it, Enter attaches the first match). Every attach has a scope. **Global** is kept in
`~/.claude/lantern-extensions.json` and applies in every project. **This project** is kept in
`.claude/lantern-extensions.json` of the project, which Lantern keeps out of git, and applies only there;
it is the default while a project is open. A role's effective list in a project is the global skills
followed by the project's own, each name once. A skill attached to a role but not installed in the
project is skipped with a warning when a run starts, and only in the projects whose effective list holds it.
A skill can be moved between the two scopes with its badge (or Enter on the row) and detached with
Delete. In the main window, with no project open, there is only the global scope. The off switches of the
built-in skills and the skill linker path stay global.

`pnpm run install-skills -- <project-dir>` installs the same skills into a project opened
elsewhere.

## Where to go next

- [installation.md](installation.md): installing, running and the command line.
- [architecture.md](architecture.md): processes, source layout, the `.lantern/` map and the skill bundle.
- [TROUBLESHOOTING.md](../TROUBLESHOOTING.md): known problems.
- [CONTRIBUTING.md](../CONTRIBUTING.md): working on Lantern itself.
