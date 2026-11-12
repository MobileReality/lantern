# Installation and command line

How to install and run Lantern, and how to use it from any terminal or harness. For a walk through
the app itself, see [getting-started.md](getting-started.md).

## Requirements

- Node 22 (the version CI runs) and pnpm 10.28.0, the `packageManager` pin in `package.json`
  (`corepack enable` provides it), to build and run Lantern from source.
- git, which the review, worktree and map features run.
- Claude Code or Codex, for the assistant features: maps, explainers, plans and delegates.

## Download

Packages are attached to each release on the
[releases page](https://github.com/MobileReality/lantern/releases): `Lantern-mac.zip` for
Apple-silicon Macs, `Lantern-win-x64.zip` for Windows and `Lantern-linux-x64.zip` for 64-bit Linux
(Linux packages are x64 only). The Apple-silicon build is also published
as `Lantern-mac-arm64.zip` for the updater, and the `Lantern-mac.zip` link stays the one to use. Until a release is published there,
build Lantern from source as described below.

The macOS app of a release built by the current workflow is signed with a Developer ID certificate
and notarized by Apple, so macOS only asks once to confirm opening `Lantern-mac.zip`'s app. Earlier
releases are signed ad hoc and need the steps in
[CONTRIBUTING.md](../CONTRIBUTING.md#producing-a-build-to-share-distshare). The Windows build is not
code-signed, so SmartScreen may warn on first launch.

**Verify the download.** Every release carries a `SHA256SUMS` file. Put it next to the zips you downloaded and run
`sha256sum -c SHA256SUMS --ignore-missing` on Linux or
`shasum -a 256 -c SHA256SUMS --ignore-missing` on macOS; each zip should print `OK`.

The Linux build is x64 only and unsigned. Extract it, make the binary executable and run it:

```bash
unzip Lantern-linux-x64.zip
cd Lantern-linux-x64
chmod +x Lantern
./Lantern
```

Chromium's sandbox needs unprivileged user namespaces or a setuid helper. Ubuntu 24.04 and newer
restrict user namespaces, so on such a system the app can exit at start with "The SUID sandbox
helper binary was found, but is not configured correctly". Fix it once with
`sudo chown root:root chrome-sandbox && sudo chmod 4755 chrome-sandbox` in the extracted folder,
or start the app with `./Lantern --no-sandbox`, which switches the sandbox off for that run. The
Linux build is new: CI builds it on Ubuntu but never runs it, and the memory view still says
"Not supported yet" there.

## Install and run from source

Lantern is an Electron app built with pnpm (Node 22).

```bash
pnpm install     # downloads Electron
pnpm start       # launches the app
```

`pnpm start` runs the `dev` profile: one build per worktree, with its own data folder and free
ports, so several dev builds run beside each other and beside an installed Lantern. The details
are in [architecture.md](architecture.md#the-dev-profile).

For a packaged build of your own (an ad-hoc signed, not notarized `Lantern-mac.zip` for
Apple-silicon Macs), see the `dist:share` section of
[CONTRIBUTING.md](../CONTRIBUTING.md#producing-a-build-to-share-distshare).

To try the pull request review flow with synthetic data, run `pnpm demo:pr-review`. It opens a
sample file diff; use the left and right arrow keys to move between files, or close the preview
to explore the review order and graph.

The architecture graph uses Pixi and WebGL. If WebGL cannot start or its context is lost,
Lantern shows an inline error.

Choose **Lantern tools → Claude or Codex** in the sidebar. Opening a project installs the
portable skills into its ignored native skill directory: `.claude/skills` for Claude and
`.agents/skills` for Codex. Every Lantern action uses Codex's configured model; mapping
only writes with a model the lantern-setup model policy accepts (on Codex: `gpt-<version>-sol`, recommended 6.1, `gpt-<version>-astra`, recommended 6, or `gpt-<version>-terra`, with no recommended version, of any version). Follow-up runs resume only a valid session from the
same provider and project root. Claude keeps its existing resume behavior. Codex forks the
latest valid context, preserves the parent thread, and runs the child from that project root.

## Releases

`.github/workflows/release.yml` builds Lantern and attaches the packages to a GitHub Release. It
runs the same package scripts as a local build. On a macOS runner, `pnpm run build` and
`pnpm run fuses` build the app, `scripts/mac-sign-notarize.sh` signs and notarizes it, and
`pnpm run pack` gives `Lantern-mac.zip` (Apple silicon). `pnpm run build:win` on a Windows runner
gives `Lantern-win-x64.zip`, and `pnpm run build:linux` then `pnpm run pack:linux` on an Ubuntu
runner give `Lantern-linux-x64.zip`. A last job creates the release for the tag when it is missing, with
generated release notes, copies `Lantern-mac.zip` to `Lantern-mac-arm64.zip` (the name the updater
needs to find the Apple-silicon build) and uploads the four files; running it again replaces them.

- **Release a new version**: push a tag that starts with `v`, for example
  `git tag v0.2.1 && git push origin v0.2.1`. The workflow starts on the push, and the macOS job
  waits for a reviewer to approve the `release` environment.
- **Release a tag that already exists**: in GitHub, open Actions, choose **Release**, pick the tag
  itself under **Use workflow from**, click **Run workflow** and type the same tag (for example
  `v0.2.0`). It builds that tag's commit, so nothing needs re-tagging. The macOS job refuses to run
  from a branch, or when the typed tag differs from the one picked. The workflow file is the one at
  that tag, so only a tag whose commit already holds the signing job produces a signed app; an
  older tag is rebuilt ad hoc.

The macOS build is signed with a Developer ID Application certificate, hardened runtime on, and
notarized and stapled by Apple, so a downloaded `Lantern-mac.zip` opens without a Gatekeeper
warning. The certificate and the notarization key are secrets of the protected `release` environment;
how a maintainer sets them up is in
[CONTRIBUTING.md](../CONTRIBUTING.md#release-signing-setup). The Windows and Linux builds are not
code-signed (Windows SmartScreen may warn on first launch).

## Use Lantern with any setup

Lantern is files plus scripts. The app reads a project's `.lantern/` folder (the map, plans, pull
request records and local review reasons); see [architecture.md](architecture.md#the-lantern-map-and-pull-request-records).
Everything that writes those files is a skill: instructions that any assistant can follow, and
scripts that run from any terminal, in Claude Code, in Codex, in a plain shell, in CI or from
another agent tool. The `lantern` command is the other half: from that terminal it brings the app
to the right folder or review. So the assistant, the harness and the editor are your choice, not
something the app fixes.

Skill scripts live in the project's skill folder, `.claude/skills` for Claude or `.agents/skills`
for Codex; the paths below use `.claude/skills`. `pnpm run install-skills -- <project-dir>` puts
them there from the Lantern repo without opening the project in the app; add `--provider codex`
for `.agents/skills`.

| You want to | Run |
|---|---|
| Open a project in its own window | `lantern .` |
| Review uncommitted changes | `lantern --compare origin/main` |
| Review a branch without a pull request | `lantern --compare origin/main..feat/x` |
| Write the reasons shown in such a review | `node .claude/skills/lantern-sync/scripts/sync.mjs local --base origin/main --reason-file .ai/tmp/reason.json` |
| See which files the map is behind on | `node .claude/skills/lantern-sync/scripts/sync.mjs status --base main` |
| Refresh the map after a change | `node .claude/skills/lantern-sync/scripts/sync.mjs finish --base main --model <model id>` prints the files to re-map (run it again until it prints `WORK LIST EMPTY`); your assistant re-maps them following `lantern-setup`, then `node .claude/skills/lantern-setup/scripts/validate.mjs . --settled` must pass |
| Record a pull request | `node .claude/skills/lantern-sync/scripts/sync.mjs pr <id> --url <url> --title "<title>" --base main --reason-file .ai/tmp/reason.json` |
| Check the map before sharing it | `node .claude/skills/lantern-sync/scripts/sync.mjs verify --base main --require-pr` |
| Start a plan (Claude install only) | `node .claude/skills/lantern-plan/scripts/plan.mjs gate`, then `plan.mjs new <slug> --title <t> --goal <g>` |
| Check a project before delegating | `node .claude/skills/lantern-delegate/scripts/preflight.mjs --target main` |

An assistant writes the map records by following `lantern-setup`; its scripts enumerate the
files, validate the result and do the bookkeeping. A plan is written with `plan.mjs` (or by hand)
under `lantern-plan`. The pull request and local review records are written by `sync.mjs pr` and
`sync.mjs local`. Which assistant that is, Claude or Codex, is your choice in the sidebar (see
[getting-started.md](getting-started.md#first-launch)); the Codex route of delegation is
`skills/lantern-delegate/references/codex.md`, which runs its preflight with `--provider codex`. The graph
and the macro view have no command: they open from the app.

## The `lantern` command

On macOS, open **Settings → Command line** and click **Install** to link the `lantern`
command into `/usr/local/bin` (it asks for your password if that folder needs it). Then:

```bash
lantern              # open Lantern
lantern .            # open the current folder in its own window
lantern ~/code/app   # open a folder in its own window
```

`--compare` opens a folder's Lantern tab straight on a local review, the same as picking it
under **+ Compare**: `<head>` against where it left `<base>`. Each side is a branch, `HEAD`
or a commit; leave `<head>` out (or write `@`) for the uncommitted changes. Without a folder
it uses the current one, so an agent can show you its work with one command:

```bash
lantern --compare origin/main                  # the uncommitted changes
lantern --compare origin/main..feat/x          # a branch without a pull request
lantern ~/code/app --compare main..a1b2c3d     # up to a given commit
```

The reasons an agent leaves with `sync.mjs local` (table above) show under each file of such a
comparison, the way a pull request carries them.

A project window has no project list, so each project can live on its own Space. Running
`lantern` on a folder that already has a window brings that window to the front. A project
window keeps a toolbar with the Lantern map, Skills, the microphone fix, the project's
assistant and the mode switch, and the folder is listed in the main window only while its
window is open. The Command line panel also shows the `ln` command to link it by hand, and
how to remove it. Lantern never replaces a `/usr/local/bin/lantern` it did not install: the
panel shows where it points and how to swap it yourself.

## Data and privacy

Lantern keeps what it stores on your machine. Below is where each piece lives, how to remove it,
and what leaves the machine.

### What Lantern stores, and how to remove it

| Where | What | To remove |
|---|---|---|
| Lantern's user data folder: `Lantern` inside your application-data folder (a dev build has its own folder beside it) | Settings (`settings.json`, `ccm-settings.json`), the project list (`ccm-projects.json`), the skills settings (`ccm-skills.json`), local review reasons (`local-reasons/`), pull request explanations (`pr-explanations/`), and your accounts: profiles and bindings (`auth-profiles.json`, `auth-bindings.json`) with the tokens in `auth-secrets.json`, each token encrypted with Electron's `safeStorage`. When the system cannot encrypt, a token stays in memory for the session and is not written. | Quit Lantern and delete the folder; the next start is a first launch. To drop one account, remove it in Integrations. |
| `<project>/.lantern/` | The map, its texts, plans, pull request records and the project's `settings.json`. | Delete the folder; Set up writes the map again. |
| `<project>/.lantern/.project/` | The app's own data for the project (`project.json`, explainers). It keeps itself out of git with its own `.gitignore`. | Delete the folder; it is created again when the project opens. |
| `<project>/.claude/skills` or `<project>/.agents/skills`, and `<project>/.claude/agents` | The portable skills and agent files Lantern installs when you open a project, listed in the repository's `.git/info/exclude` so git ignores them. | Delete the skill and agent folders Lantern installed (not your own); they are copied again the next time the project opens, unless the skill is switched off in Skills. |
| `<project>/.claude/settings.local.json` | Rules that let background delegates run git and Lantern's skill scripts, added only after you click **Allow** in a dialog that says what changes. Nothing is written if you decline, and Lantern remembers the answer for the project. | Delete the rules from the file. Lantern adds them again when the project opens, unless you also remove the project's entry under `permissionConsent` in `ccm-settings.json`, which makes it ask again. |
| `~/.claude/lantern-extensions.json` (all projects) and `<project>/.claude/lantern-extensions.json` (one project) | The extra skills you add to the orchestrator, delegate and reviewer roles in Skills. | Delete the file, or remove the entry in Skills. |
| `${CODEX_HOME:-~/.codex}/hooks.json` | Lantern's activity hooks for Codex, added only when you click **Set up** next to the Lantern tools choice. A backup (`hooks.json.lantern-bak`) is kept next to it; the hook scripts and their token are in the user data folder (`codex-hooks/`, `codex-hooks.token`). | Click **Remove** in the same place, or delete Lantern's entries from the file. |
| `~/.claude/settings.json` | Nothing is added. On start Lantern removes the hook entries that older Lantern builds put there, after copying the file to a timestamped backup next to it. | Nothing to remove. |
| `~/.vscode-server` | The embedded editor's server data: its extensions and user data, including the editor settings Lantern writes. | Quit Lantern and delete the folder; the editor server creates it again when it starts. |
| `extension.js` of the Claude Code extension in `~/.vscode-server/extensions` | The microphone fix: Lantern edits this third-party file only after you confirm **Patch the extension**, and keeps the original as `extension.js.ccm-bak` next to it. | Copy the `.ccm-bak` file back over `extension.js`, or run `pnpm run patch-mic:revert` in the Lantern repository. |

### What leaves your machine

Lantern's own code contacts only these hosts, and only once you have added the matching account in
Integrations: `api.github.com`, `api.bitbucket.org`, `api.atlassian.com` and your own
`*.atlassian.net` Jira site. They serve the token check, the state of a pull request, and the
GitHub, Bitbucket and Jira skills that an assistant runs with that account. Everything else Lantern
does on the network is loopback traffic on `127.0.0.1`: the embedded editor server and the local
endpoint that receives session events. Lantern has no telemetry and no automatic updates.

Programs that Lantern starts, or that you ask it to start, have their own traffic: the Claude Code
or Codex assistant you run, the VS Code server behind the embedded editor (Lantern asks you to
accept its server licence before it starts), `git` against your remotes and against the skills
repository URL you enter, and the browser that opens a link you click.
