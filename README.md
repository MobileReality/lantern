<p align="center">
  <img src="docs/assets/logo.png" alt="Lantern" width="128" height="128">
</p>

<h1 align="center">Lantern</h1>

<p align="center">
  <strong>Your project, your codebase, is the whole context for your AI.</strong><br>
  Manage that context well. Lantern will help you with that.
</p>

<p align="center">
  Lantern maps your project, helps you plan changes, reviews pull requests with generated flows
  and local review, and keeps your AI assistant sessions across your harness
  together in one desktop app.
</p>

<p align="center"><a href="https://thelantern.dev">Website</a> · <a href="https://docs.thelantern.dev">Documentation</a></p>

<p align="center">
  <a href="https://github.com/MobileReality/lantern/actions/workflows/ci.yml"><img src="https://github.com/MobileReality/lantern/actions/workflows/ci.yml/badge.svg" alt="CI status"></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/MobileReality/lantern" alt="License"></a>
  <a href="https://github.com/MobileReality/lantern/releases"><img src="https://img.shields.io/github/v/release/MobileReality/lantern" alt="Latest release"></a>
</p>

## What it does

- **Watches every session** across your harness and shows a live dashboard of
  each one: its project, state, and last reply.
- **Notifies you** in the menu bar and with native notifications when a session **finishes**,
  **needs approval**, or is **waiting for input**, so you don't babysit a window.
- **Maps your project** into a `.lantern/` folder (one record per file, its role, its purpose and
  its relations) and draws it as a graph, so you can see the structure without reading the code.
- **Reviews pull requests and local changes** with a file list, diffs and the graph, in review
  order, with a reason for each changed file.
- **Local review**: review your uncommitted changes, or a branch with no pull request, with the
  same file list, diffs and graph as a pull request (**+ Compare** in the Lantern tab, or
  `lantern --compare`). One click asks Claude for a one-sentence reason per changed file.
- **Generate with Claude or Codex**: choose the assistant used by Lantern's maps
  and repairs for each project. This setting does not change the assistant inside the embedded
  editor. Pick the output **language per project** and repair broken output in place.

Sessions are told apart by their working directory: one entry per VS Code project window.

## Download

Packages are attached to each release on the
[releases page](https://github.com/MobileReality/lantern/releases): `Lantern-mac.zip` for
Apple-silicon Macs and `Lantern-win-x64.zip` for Windows. Until a release is published there,
build Lantern from source ([installation](docs/installation.md#install-and-run-from-source)).

The macOS app is signed ad hoc only, so Gatekeeper quarantines a downloaded zip; the steps to open
it are in [CONTRIBUTING.md](CONTRIBUTING.md#producing-a-release-build-distshare). The Windows build
is not code-signed, so SmartScreen may warn on first launch.

## Documentation

The documentation is at https://docs.thelantern.dev and in [docs/](docs/index.md):

- [Installation and command line](docs/installation.md)
- [Data and privacy](docs/installation.md#data-and-privacy): what Lantern stores, how to remove it, and what leaves your machine
- [Getting started](docs/getting-started.md)
- [Architecture](docs/architecture.md)
- Product overview: [thelantern.dev](https://thelantern.dev)

## Development and checks

The checks CI runs on every push and pull request (`.github/workflows/ci.yml`, a plain Linux
runner with Node 22, pnpm 10.28.0 and `pnpm install --frozen-lockfile`) are:

```bash
pnpm run typecheck
pnpm run lint        # biome lint --diagnostic-level=error
pnpm test
```

CI runs the unit tests, builds on Linux, macOS and Windows, runs the Playwright e2e for integrations,
the tray, pull request host state and skills (the graph suite is not run in CI), and publishes a coverage
report as a build artifact. It signs nothing. The stack, the project
layout, the code and testing conventions and the build pipeline are in
[CONTRIBUTING.md](CONTRIBUTING.md); a map of the source is in [docs/architecture.md](docs/architecture.md).

## More

- [CONTRIBUTING.md](CONTRIBUTING.md): how to work on the app, test it and build it.
- [SECURITY.md](SECURITY.md): how to report a vulnerability.
- [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md): how we expect people to behave in this project.
- [TROUBLESHOOTING.md](TROUBLESHOOTING.md): known problems and their fixes.
- [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md): licences of the software Lantern ships.

## License

Lantern is released under the MIT License. Copyright (c) 2026 Mobile Reality. See [LICENSE](LICENSE).
Contact: hello@themobilereality.com.

Lantern is not affiliated with or endorsed by Anthropic, OpenAI, Microsoft, Atlassian or GitHub; their names and marks are trademarks of their owners.

Made with &lt;love&gt; by People with AI  
By Mobile Reality
