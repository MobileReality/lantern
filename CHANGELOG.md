# Changelog

All notable changes to Lantern are listed here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Release packages are on the
[releases page](https://github.com/MobileReality/lantern/releases).

## [Unreleased]

## [0.3.1] - 2026-11-10

### Added

- Automatic updates on macOS (Apple silicon): Lantern checks for a new release at start and every
  few hours, downloads in the background and installs only when no terminal or run started from
  Lantern would be ended. An update card shows when one is ready, "Check for Updates…" in the
  menu checks by hand, and a setting turns the checks off. On Windows a notice links to the
  release page.

### Changed

- Each release now also publishes the macOS build as `Lantern-mac-arm64.zip`, a copy of
  `Lantern-mac.zip`, for the updater. The `Lantern-mac.zip` link is unchanged.

## [0.3.0] - 2026-11-10

### Added

- Diagnostics: a local, bounded and redacted log of Lantern's own errors and crashes, shown live
  in a Diagnostics view. It records uncaught errors, renderer and child process crashes, IPC
  handler errors, VS Code server start, exit and health failures, and editor webview errors.
  After an unexpected close the next start shows a one-time notice. Report on GitHub opens a
  prefilled issue you can edit; Lantern sends nothing by itself.
- A redesigned review pane: a header with the file name, folder and line counts, line counts on
  each changed file row, a copy menu on right-click, arrow keys to step through files, and a new
  comment composer with intents and quick texts for each intent.

## [0.2.2] - 2026-11-10

### Security

- Updated js-yaml, the only vulnerable package shipped in the app, and brought the dev
  dependencies flagged by `pnpm audit` to a clean audit.
- Fixed code-scanning alerts in the renderer, the PR description parser, the settings model and
  the website heading helpers.

### Changed

- The package version now matches the release tags.
- CI builds on Linux, macOS and Windows, with e2e suites and coverage.
- Added a social preview image.

## [0.2.1] - 2026-11-09

### Added

- A CodeQL workflow and private vulnerability reporting.
- Issue template config and title defaults.
- A release workflow that publishes `Lantern-mac.zip` (Apple silicon, signed with a Developer ID
  certificate and notarized by Apple, so it opens without the unidentified-developer warning) and
  `Lantern-win-x64.zip` (not code-signed) to GitHub Releases.
- CODEOWNERS, release-notes categories, this changelog, README badges and Download sections.

## [0.2.0] - 2026-11-09

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

### Repository contents

- The source under the MIT License, with `CONTRIBUTING.md`, `SECURITY.md`,
  `CODE_OF_CONDUCT.md`, `TROUBLESHOOTING.md` and `THIRD_PARTY_NOTICES.md`.
- Documentation in `docs/`, published at https://docs.thelantern.dev.
- GitHub Actions workflows for CI and documentation deployment, with pinned actions and
  Dependabot.
- Issue templates and a pull request template.
- GitHub pull request state in the review view.

[Unreleased]: https://github.com/MobileReality/lantern/compare/v0.3.1...HEAD
[0.3.1]: https://github.com/MobileReality/lantern/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/MobileReality/lantern/compare/v0.2.2...v0.3.0
[0.2.2]: https://github.com/MobileReality/lantern/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/MobileReality/lantern/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/MobileReality/lantern/releases/tag/v0.2.0
