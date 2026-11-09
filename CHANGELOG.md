# Changelog

All notable changes to Lantern are listed here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Release packages are on the
[releases page](https://github.com/MobileReality/lantern/releases).

## [Unreleased]

## [0.2.0]

The first open-source release.

### What Lantern does

- Watches every AI assistant session across your harness and shows a live dashboard of each one:
  its project, state and last reply.
- Notifies you in the menu bar and with native notifications when a session finishes, needs
  approval or is waiting for input.
- Maps a project into a `.lantern/` folder (one record per file, with its role, purpose and
  relations) and draws it as a graph.
- Reviews pull requests and local changes with a file list, diffs and the graph, in review order,
  with a reason for each changed file.
- Generates maps, plans and explainers with Claude or Codex, with the output language chosen per
  project.
- Ships portable skills (`lantern-setup`, `lantern-sync`, `lantern-plan`, `lantern-delegate`)
  that any assistant can follow, and a `lantern` command to open a folder or a review from a
  terminal.

### What the open-source release contains

- The source under the MIT License, with `CONTRIBUTING.md`, `SECURITY.md`,
  `CODE_OF_CONDUCT.md`, `TROUBLESHOOTING.md` and `THIRD_PARTY_NOTICES.md`.
- Documentation in `docs/`, published at https://docs.thelantern.dev.
- GitHub Actions workflows for CI, CodeQL, documentation deployment and releases, with pinned
  actions and Dependabot.
- Issue templates with title defaults and a pull request template.
- Private vulnerability reporting.
- GitHub pull request state in the review view.
- Release packages: `Lantern-mac.zip` (Apple silicon, ad-hoc signed only) and
  `Lantern-win-x64.zip` (not code-signed).

[Unreleased]: https://github.com/MobileReality/lantern/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/MobileReality/lantern/releases/tag/v0.2.0
