# Contributing

How this app is built and how to work on it. The conventions below are stated in full in this
file and enforced by the tests; the Lantern skills the repo ships are in [`skills/`](skills/).

## Stack

| Concern | Tool |
|---|---|
| Runtime | **Electron** (main / preload / renderer), the version in `package.json` |
| Language | **TypeScript**, `strict: true` — type-check with `tsc --noEmit` |
| Bundler | **esbuild** (`scripts/esbuild.mjs`) — fast, but does **not** type-check |
| Tests | **Vitest** (+ jsdom for DOM units) |
| Packaging | `@electron/packager` → `@electron/fuses` → `codesign` |
| Package manager | **pnpm** (committed `pnpm-lock.yaml`) |

> **Local quirk:** `ELECTRON_RUN_AS_NODE=1` is set globally on some machines, which makes
> Electron boot as plain Node. The `start`/`build` scripts already launch via
> `env -u ELECTRON_RUN_AS_NODE`; the packaged app is additionally hardened with fuses.

## Project layout

```
src/
  main/        Main process — windows, tray, hooks, the local HTTP server, fs/native work
  preload/     contextBridge surface (the typed contract between main and renderer)
  renderer/    The UI (HTML/CSS/TS)
    features/  Feature modules wired on import (review, explain, skills)
    lib/       Pure, reusable helpers (codeview, util)
  shared/      Constants shared across processes (config)
scripts/       Build tooling (esbuild, fuses, icon, mic patch)
test/          Vitest suites (mirrors src by module name)
out/           esbuild output — generated, gitignored
dist/          Packaged .app — generated, gitignored
```

## Import aliases

Cross-folder imports use `@shared/*`, `@main/*` and `@renderer/*` (`src/shared`, `src/main`,
`src/renderer`) instead of `../../` chains; imports inside one folder stay relative. What the renderer
shares with main (types, constants) lives in `src/shared` and comes in through `@shared`. `tsconfig.json` (`compilerOptions.paths`) is
the only place the aliases are declared: `test/e2e/tsconfig.json` inherits it, and
`scripts/aliases.cjs` reads it for esbuild (`scripts/esbuild.mjs`, the e2e harness builds) and for
`vitest.config.ts`. New code uses them; older relative imports are converted when the file is touched.

## Messages, icons and shared constants

- **Texts the user reads** (labels, hints, errors, banners) and the developer log lines of
  `src/main/auth` live in `src/shared/lang/en/messages.json`, grouped by feature, and are read only
  through `msg('group.key', { name })` (also `msgList` for a list, `msgCount` for a singular and plural
  pair) from `@shared/lang/messages`. Keys are type-checked; a missing key falls back to English, then
  shows the key. `test/messages.test.ts` fails when code asks for a key that is not in the catalogue.
  The integrations screens, the profile menu and `src/main/auth` use it; older features still keep their
  text inline and move over when they are touched. A skill keeps its own small JSON beside its scripts
  (`skills/lantern-delegate/scripts/messages.json`), because a skill must stay self-contained.
- **Icons** are one SVG file each in `src/renderer/assets/icons/` (provider marks in
  `src/renderer/assets/logos/`), imported where they are drawn, never written inline in a feature.
- **Providers** (GitHub, Bitbucket, Jira) are one table, `PROVIDERS` in `src/shared/providers.ts`: id,
  name, mark, role, hosts, git remote host and its aliases, token page and fields. Code reads
  `PROVIDER.github` or the table, never the bare string (`test/bare-literals.test.ts` guards the
  integrations files). A code host also has a driver in `src/main/lantern-host-drivers.ts` that asks the
  host for the state of a pull request, so a new one is a row plus a driver.
- **Failure kinds and error codes** are const objects in `src/shared/auth-kinds.ts` (`CHECK_FAILURE`,
  `AUTH_ERROR`, `CONNECTION_STATE`, and the other kinds), each with a derived type. Main, renderer and
  tests all import them from there.

## Where code goes (process model)

Follow the Electron process split — decide by what the code needs to touch:

- **Native / OS / privileged** (filesystem, dialogs, tray, child processes, the HTTP server)
  → **main process** (`src/main/`).
- **UI / presentation** → **renderer** (`src/renderer/`). The renderer has **no Node access**.
- **The bridge** → a **preload** (`src/preload/`) that exposes a narrow, specific API via
  `contextBridge` — never raw `ipcRenderer` or Node.

To do native work from the UI, add a wrapped call to the preload and an `ipcMain.handle`
handler in main; don't reach for `nodeIntegration`.

## Project-local data

What the app keeps about a project on this machine (review marks, explainers, the "opened" stamp)
lives in `<project>/.lantern/.project/`, written only through `src/main/metadir.ts`. That folder is
local state, not part of the map: the first time the app creates it, it writes
`.lantern/.project/.gitignore` containing `*`, so nothing in it, the ignore file included, is ever
committed. The map readers, `lantern-setup`, `lantern-sync`, the validator and the file enumeration
skip it entirely.

Projects from before the rename keep their data. On the first access of a project in a session,
`src/main/metadir-migrate.ts` moves the old folder's contents into `.lantern/.project/` (copy into a
sibling, rename it into place, then remove the old folder), never overwrites a file already in the
new folder, and removes the old folder once it is empty. If the move fails nothing is deleted, the
app keeps using the old folder for that session, and a notification says so; the next session tries
again. The old folder's name appears only in that module; `test/legacy-meta-dir-guard.test.ts` fails
on any other mention.

## Commands

```bash
pnpm install           # install deps (downloads Electron)

pnpm start              # esbuild + launch the app locally
pnpm run compile        # esbuild only → out/
pnpm run typecheck      # tsc --noEmit (run after non-trivial changes)
pnpm run lint           # biome lint --diagnostic-level=error

pnpm test               # run the Vitest suite once
pnpm run test:watch     # watch mode
pnpm run coverage       # coverage report (text + html)

pnpm run dist           # build + fuses + codesign → dist/ (macOS)
pnpm run dist:share     # ad-hoc signed + zipped for sharing
pnpm run build:win      # Windows build
```

**Before opening a PR:** `pnpm run typecheck`, `pnpm run lint` and `pnpm test` must all be clean.
`.github/workflows/ci.yml` runs these three on every push and pull request on a plain Linux runner
(Node 22, `pnpm install --frozen-lockfile`), builds on Linux, macOS and Windows, and has two more jobs:
`e2e` runs the Playwright suites for integrations, the tray, pull request host state and skills under
`xvfb-run` with the harness windows shown (`LANTERN_GRAPH_VISIBLE=1`, `LANTERN_HARNESS_VISIBLE=1`); the graph
suite is not run in CI because WebGL is unavailable there. `coverage` runs `pnpm coverage`, writes the totals to
the job summary and uploads `coverage/` as an artifact. CI publishes nothing and holds no secret: its
macOS build is only the ad-hoc `dist:share` smoke test. `test/ci-workflow.test.ts` pins where Electron
runs and artifacts may be uploaded, and `test/release-workflow.test.ts` pins the signing job.

## Build pipeline

`src/` (TypeScript) → **esbuild** → `out/` (bundled JS) → **electron-packager** → applies
**@electron/fuses** (disables `RunAsNode`, CLI inspect, etc.) → **codesign** → `dist/`.
esbuild does not type-check, so `typecheck` is a separate, required step.

### Producing a build to share (`dist:share`)

This is the local, unnotarized build. The released macOS app is signed and notarized by the release
workflow instead (see [Release signing setup](#release-signing-setup)).

Versions: Node 22 (the version CI runs) and pnpm `10.28.0`, the `packageManager` pin in
`package.json`; enable it with `corepack enable`. Run on an Apple-silicon Mac: the build targets
`darwin-arm64` and needs `codesign` and `ditto`.

```bash
pnpm install --frozen-lockfile
pnpm run dist:share
```

`dist:share` is `build` → `fuses` → `sign:adhoc` → `pack`:

1. `build` bundles `src/` with esbuild and packages `out/` into `dist/Lantern-darwin-arm64/Lantern.app`
   with electron-packager. The licences travel with it in `Lantern.app/Contents/Resources/licenses/`:
   `scripts/licenses.mjs` writes `LICENSE`, `THIRD_PARTY_NOTICES.md`, `Overpass-OFL.txt` and the generated
   `THIRD_PARTY_LICENSES.txt` (every production dependency with its licence text) into `out/licenses/`, and
   `scripts/package-licences.mjs` adds Electron's `ELECTRON-LICENSE` and `LICENSES.chromium.html`.
2. `fuses` flips the Electron fuses on that app. This must come before signing, because flipping a
   fuse invalidates a signature.
3. `sign:adhoc` signs the app with the ad-hoc identity (`codesign --sign -`). There is no Developer
   ID certificate and no notarization, so the signature only lets the app run, it identifies nobody.
4. `pack` zips the app with `ditto` into `dist/Lantern-mac.zip`.

The output is `dist/Lantern-mac.zip` (`dist/` is gitignored). `pnpm run dist` is the local variant:
the same build and fuses, signed with the `Lantern Local` certificate from your own keychain, and no zip.

Whoever receives this zip has to get past Gatekeeper, because the app is neither notarized nor signed
with a Developer ID and a downloaded zip is quarantined. After unzipping, either Control-click
`Lantern.app` and choose Open (then Open again in the dialog), or allow it under System Settings →
Privacy & Security → Open Anyway, or clear the quarantine flag once:

```bash
xattr -dr com.apple.quarantine /path/to/Lantern.app
```

### Release signing setup

For maintainers. The release workflow (`.github/workflows/release.yml`, job `build-mac`) signs the app
with the Developer ID Application certificate of the company account and notarizes it. It runs only from
a `v*` tag, in the protected `release` environment; no other job and no other workflow can read these
secrets. The signing identity, `Developer ID Application: Mobile Reality sp. z o.o. (D8226MY2E7)`, is
public and sits in the workflow, not in a secret.

1. **Create the environment.** Settings → Environments → New environment, named `release`. Turn on
   Required reviewers and add the maintainers. Under Deployment branches and tags choose Selected
   branches and tags, and add one rule of type Tag with the pattern `v*` (no branch rule).
2. **Add five environment secrets** to it. Never paste real values into an issue, a PR or this file.

   | Secret | What it is |
   |---|---|
   | `MACOS_CERTIFICATE_P12_BASE64` | The Developer ID Application certificate with its private key, exported from Keychain Access as a `.p12`, base64-encoded |
   | `MACOS_CERTIFICATE_PASSWORD` | The password you set when exporting that `.p12` |
   | `APPLE_API_KEY_P8_BASE64` | The App Store Connect API key (`AuthKey_<id>.p8`), base64-encoded |
   | `APPLE_API_KEY_ID` | The key's ID, the `<id>` in the file name |
   | `APPLE_API_ISSUER_ID` | The issuer ID shown above the key list in App Store Connect |

3. **Encode the two files** and paste the clipboard into the secret:

   ```bash
   base64 -i certificate.p12 | pbcopy
   base64 -i AuthKey_XXXXXXXXXX.p8 | pbcopy
   ```

4. **Protect the tags.** Settings → Rules → Rulesets → New tag ruleset, target `v*`, enforcement
   Active, with Restrict creations, Restrict updates, Restrict deletions and Block force pushes, and
   only maintainers on the bypass list. A `v*` tag is what starts a signed release.
5. **Release.** Push a `v*` tag, approve the `release` deployment, and read the `build-mac` log. Each
   run signs from scratch in a temporary keychain that is deleted at the end of the job. The first tag
   after any change to the signing scripts or entitlements is the real test of them; this workflow has
   no dry run.

**Signing locally** needs the same certificate in your login keychain and a notarytool profile, stored
once:

```bash
xcrun notarytool store-credentials lantern-notary --key AuthKey_XXXXXXXXXX.p8 --key-id XXXXXXXXXX --issuer <issuer-id>

pnpm run build && pnpm run fuses
export MACOS_SIGNING_IDENTITY="Developer ID Application: Mobile Reality sp. z o.o. (D8226MY2E7)"
bash scripts/mac-sign-notarize.sh all --keychain-profile lantern-notary
pnpm run pack
```

`all` is `sign`, `notarize` and `verify`; each can be run alone (`bash scripts/mac-sign-notarize.sh --help`).
`--identity -` signs ad hoc to check that the signing walk covers every binary; that app will not launch,
because library validation rejects ad-hoc frameworks, so use it only as a dry run of `sign`.

**Entitlements** live in `build/entitlements.mac.plist` (the app) and `build/entitlements.mac.inherit.plist`
(the helper apps and the bundled Node). Add nothing to them without a reason you can state: `allow-jit`
is what lets V8 run under the hardened runtime; the app alone also holds `audio-input` and `camera` (voice
input and the editor's webviews) and `automation.apple-events` (jumping to a terminal tab through
`osascript`). Library validation stays on, since every binary in the bundle carries the same Team ID.

## Code conventions

Read these before a larger change:

- **Small, single-purpose files**: target ≤ ~300 lines, one concept per
  file. Keep the transport/UI layer thin; put real logic in pure, testable units. Named
  exports. No magic numbers — name constants. Clean as you go (no dead code/imports).
- **TypeScript**: `strict` everywhere — fix types, never `@ts-nocheck`.
  Inference-first (annotate boundaries, not obvious locals). `import type` for type-only
  imports. Derive types from a single source of truth. `any` only as a deliberate, local
  escape hatch.
- **No comments** (the same rule as `skills/lantern-no-comments`): write self-explanatory code. Comment only the non-obvious
  **why** (workarounds, gotchas, ordering constraints) — never paraphrase the code.
- **Electron security**: keep the secure defaults — `contextIsolation`
  and `sandbox` on, `nodeIntegration` off. Never set `webSecurity: false`. Validate IPC
  senders and arguments. Only `shell.openExternal` validated URLs.
- **IPC**: prefer `invoke`/`handle` for request/response; `domain:action`
  channel names; pass only serializable data; keep the preload `api` as the typed contract.

## Testing

Vitest, with suites in `test/` named after the module under test.

- **Test the logic, not the wiring.** Pure functions and parsers are tested directly; the
  process/HTTP/native orchestration (spawning `git` / `code serve-web`, HTTP probing) is
  intentionally left to manual verification — mocking it tests the mocks, not the code.
- **Prefer real temp filesystems** over mocking `fs` — create a temp dir, exercise the real
  symlink/junction and git-exclude behavior, clean up in `afterEach`. It's more faithful and
  catches cross-platform bugs.
- **Mock only Electron.** For modules that read `app.getPath('userData')`, mock `electron`
  with a temp dir (see `test/projects.test.ts` / `test/skills.test.ts` for the pattern).
- **Never let a test signal a process it did not spawn.** `process.kill` is guarded suite-wide
  (`test/setup-process-guard.ts`): pids 0, 1 and -1 throw, because `kill(-1)` reaches every
  process the user owns. Give a mocked child no pid (or a mocked `kill`) rather than a real one.
  Source: `.ai/postmortems/2026-09-30-test-killed-every-process.md`.
- **Control time** with `vi.useFakeTimers()` / `vi.setSystemTime()` for anything that reads
  `Date.now()` (including the session state machine).
- When extracting pure logic from an I/O function purely to make it testable, that's a
  welcome refactor — it also improves the logic/I/O separation.

## Verifying UI changes (dev harness)

Don't ship UI you haven't looked at. Run the app with `CCM_DEBUG=1` and a loopback-only
helper starts: on a free port under `pnpm start` (each worktree's dev build has its own, written to
`out/lantern-instance.json` as `debugPort`), on 31339 for the installed profile (it does not exist in a
normal build). Pass `--remote-debugging-port=0` for CDP; the chosen port lands in the same file as `cdpPort`.

### Debug harness

The harness is local-only and token-protected, because `/eval` runs the code it is given inside the
window, which has the whole preload API. It binds `127.0.0.1` only, and every route (`/windows`,
`/notify`, `/tray`, `/shot`, `/eval`) needs the per-launch token: 256 random bits made at start, sent as
the `X-Lantern-Debug-Token` header or the `token` query parameter. A request is refused with `401`
(no or wrong token), or `403` (a `Host` other than `127.0.0.1:<port>` or `localhost:<port>`, or any
`Origin` or `Sec-Fetch-Site` header other than `none`, which is what a web page sends). That is the
defence against a page in your browser reaching it with an `<img>`, a `fetch` or DNS rebinding. The
token is in `out/lantern-instance.json` as `debugToken` (owner-only, mode 0600) under `pnpm start`, and
for the installed profile in `lantern-debug.json` in its data folder (`~/Library/Application Support/Lantern`
on macOS). It is never printed, put in a window title or sent in a response; the start-up line only names
the file. Treat that file like a password and do not paste the token into chats or issues.

```bash
CCM_DEBUG=1 pnpm start
PORT=$(node -p "require('./out/lantern-instance.json').debugPort")
TOKEN=$(node -p "require('./out/lantern-instance.json').debugToken")

curl -H "X-Lantern-Debug-Token: $TOKEN" "http://127.0.0.1:$PORT/shot?path=/tmp/ui.png"   # screenshot the real window
curl -G -H "X-Lantern-Debug-Token: $TOKEN" "http://127.0.0.1:$PORT/eval" \
  --data-urlencode 'js=document.querySelector("#mode-btn").click()'                      # drive it / inspect live state
```

`/eval` is the fastest way to find a styling bug — ask the page which rule actually won:

```js
[...document.styleSheets].flatMap(s => [...s.cssRules])
  .filter(r => r.selectorText && el.matches(r.selectorText) && r.style.position)
```

That is how the hub-card collision with the global `.empty` class was found. Two gotchas the
harness already handles: an **occluded window stops painting**, so `/shot` raises and forces a
repaint before capturing; and the app re-renders on session scans, so do a whole
click-then-assert sequence inside **one** `/eval` call rather than several timed ones.

To try a project window without installing the `lantern` command, pass the flag it
sends: `pnpm start -- --project=/path/to/repo`. While the app is already running, a second
`env -u ELECTRON_RUN_AS_NODE electron out --project=/path/to/repo` hands the flag to the
running instance, which is the path the command takes in the packaged app.

## Skills

`skills/` in this repo is the source of truth for the Lantern skills, listed in
[docs/architecture.md](docs/architecture.md#the-skill-bundle). The three default integration skills
are a self-contained script each, reading the credentials Lantern injects; a user's own Jira,
Bitbucket or GitHub skill has a different name and is never touched. Edit them here, never in a copy. esbuild
bundles every folder under `skills/` into `out/skills` (minus `skills/lantern-setup/example-web`). When a
project is opened in the app (`installOnOpen` in `src/main/bundle.ts`, once per project per run, in
the background) it installs all sixteen into the selected
provider's native project root: the `skills` folder of the project's `.claude` folder for Claude or of its `.agents` folder for Codex. Claude
also receives the `agents/*.md` of `lantern-delegate`, of `lantern-delegate-complex` (the Opus and Fable delegate
types `lantern-delegate-complex-opus-medium|high|xhigh` and `lantern-delegate-complex-fable-medium|high|xhigh`,
and `reviewer-complex`) and of `lantern-setup` (`lantern-mapper`) in the `agents` folder of `.claude`; Codex uses native generic
delegation and receives no copied agent profiles and not `lantern-delegate-complex`, whose model choice
(Sonnet by default, Opus or Fable only after the user picked one) has no Codex counterpart. The model policy for
writing the map is `skills/lantern-setup/references/model-floor.json`: Sonnet, Opus or Fable of any version
(Sonnet 5.5, Opus 5.5 and Fable 5.1 or newer are recommended and a lower version only warns), or the exact id `gpt-6-astra` (plus, on the Codex route, `gpt-<version>-sol` recommended 6.1, `gpt-<version>-astra` recommended 6 and `gpt-<version>-terra` with no recommended version, any version accepted and a lower one only warning), which is why an Opus or Fable delegate re-maps itself. `pnpm run install-skills -- [--provider claude|codex]
<project-dir>` does the same for projects opened elsewhere, and both run `scripts/lantern-bundle.mjs`.
A fresh Claude session is still needed before its named agent types register.
The extra skills of the delegate, orchestrator and reviewer come from the user's
`~/.claude/lantern-extensions.json` and the project's `.claude/lantern-extensions.json` (global names first, then the
project's, each once; a worktree reads the file of its main checkout). Read them through `required-skills.mjs`
(`roleRequirements`) and `configuredExtras`, never from a file directly, and keep the merge in `mergeExtras`
(`skills/lantern-delegate/scripts/extensions.mjs`, mirrored in `src/shared/extension-slots.ts`). The Lantern skills tab of the
Skills window is `src/renderer/features/skills-roles.ts` (the role selector and the two columns) over the pure
model in `skills-state.ts`; `test/e2e/skills-extras.spec.ts` (`pnpm run test:skills:e2e`) drives it in Electron.
Rules: only when git ignores the target (never dirties `git status`), never write to `~`, never
overwrite an entry without a `.lantern-bundle` marker (agents: `.lantern-bundle-agents`) or a
symlink, skip entries already present in the provider's native user roots (`~/.claude` for Claude;
`~/.agents/skills` and `${CODEX_HOME:-~/.codex}/skills` for Codex); a marked copy is replaced when the
bundle's hash changes, and deleting its marker pins it. Set up and Refresh install the two skills
they need with the same helper but without the git guard. `test/lantern-pr-parity.test.ts` fails if the skill's PR parser
and the app's drift apart; `test/lantern-sync-selftest.test.ts` runs the `lantern-sync` self-test.
Which files are mapped is written twice, in the skill (`skills/lantern-setup/scripts/lib.mjs`, `skills/lantern-setup/scripts/ignore.mjs`) and in the app
(`src/main/lantern-enumerate.ts`, `lantern-ignore.ts`), markdown rule and `.lantern/include` included;
`test/lantern-enumerate.test.ts` and `test/lantern-skill-graph.test.ts` fail if they list different files.

### Testing a skill (`pnpm run skill-test`)

One command checks one skill on a tiny fixture, in slices, with a PASS/FAIL line per slice, a cost cap
and exit code 0 (all pass) or 1 (any slice failed, or the cap was exceeded). It builds on
`scripts/e2e-delegate/` (mock Bitbucket, fake ssh, the `todo-cli` project, headless `claude -p`, the
handover checks) and on `skills/lantern-sync/scripts/selftest.mjs`.

```bash
pnpm run skill-test -- lantern-setup        # map a 2-file fixture, validate --settled prints OK
pnpm run skill-test -- lantern-sync         # the self-test, then the finish/verify cycle on a fixture change
pnpm run skill-test -- lantern-delegate     # one e2e project (todo-cli) instead of four
pnpm run skill-test -- lantern-vocabulary   # three small projects through setup and retag, vocabulary judged
pnpm run skill-test -- lantern-areas        # five neutral projects through the areas loop, setup, retag and a delegate
```

- **Default is offline.** A fake agent (`scripts/skill-test/fake-agent.mjs`) stands in for `claude` and
  does what the skill's scripts would, so nothing is spent and no network is used. This is what
  `test/skill-test-harness.test.ts` runs in `pnpm test`. `--fake broken` makes the fake leave the
  fixture broken (the run must exit 1); `--fake-cost N` sets what it reports per call.
- **`--live` is the paid path** and the only way to get real `claude` sessions. It prints the plan
  and the cap first, then runs. `--dry-run` prints the plan and stops. `CLAUDE_BIN` names the binary.
- **Cost cap.** Per skill: `lantern-setup` $1, `lantern-sync` $1, `lantern-delegate` $3, `lantern-vocabulary` $6, `lantern-areas` $12; override with
  `--max-usd N` or `SKILL_TEST_MAX_USD`. Every `claude` call gets `--max-budget-usd` with what is left
  of the cap and a 10 minute timeout (`claude` has no max-turns flag). Spending past the cap, or the
  agent stopping on its budget, is a FAIL with the reason; later slices do not run. A failed slice also
  stops the slices after it, so a broken fixture never reaches a paid call.
- **Slices.** Free checks come first (`fixture-unmapped`, `selftest`, `fixture-red`, `rig-ready`) and
  prove the later check can fail; the paid slice is one agent call (two for `lantern-delegate`: map
  build, then the delegate run) judged by the skill's own gates (`validate.mjs --settled`,
  `sync.mjs verify`, the e2e checks). `--keep` keeps the temp fixture and logs; `--json` prints the report as JSON on stdout (the plan and
  the cap still go to stderr, so a `--live --json` run shows the cap before it starts).
- **Try one paid slice cheaply:** `pnpm run skill-test -- lantern-setup --live --max-usd 0.5`. It is the
  smallest one (a single call on two files).

#### `lantern-vocabulary`: do real runs follow the feature and system rules?

Three neutral fixture projects (builders in `scripts/skill-test/vocab-fixtures.mjs`, judges in
`vocab-checks.mjs`), each a free fixture slice that proves the judge is red before the agent runs, then
one paid agent call. The paid slices are `isolated`: one failing does not skip the others (only the
cap stops the run). Judgement is scripts only, never a model: `validate.mjs --settled`, `--strict`,
`systems.mjs check`, `macro-eval.mjs --json`, `plan.mjs . retag` and direct comparisons of the map.
Each slice prints PASS/FAIL with a one-line reason, the offending ids on failure, and a macro-eval
before/after table.

| slice | fixture | one agent call | passes when |
|---|---|---|---|
| `clients-setup` | 8 files, a browser client and a kiosk client (both `web`) declared in `.lantern/platforms`, each saving and exporting notes, one plumbing file each | `lantern-setup` | `--settled --strict` clean; no feature id equals or contains `browser` or `kiosk`; saving and exporting carry the same feature id on both clients (and macro-eval divergence lists neither as one-sided); both export files name the mail relay with one id; `systems.mjs check` OK; sources and `platforms` untouched |
| `plain-setup` | 6 files, one library, no platforms, no outside systems | `lantern-setup` | `--settled --strict` clean; no `.lantern/platforms`, no `ext:` relation, no `.lantern/systems` entry; macro-eval passes every check |
| `retag-run` | 8 files with a prebuilt `.lantern/` (written by the builder): feature `acmepay` named after a vendor, `ext:dayjs.js` (a library), `ext:mail-relay` and `ext:mail-relay-api` (one service) | `lantern-setup` in Retag mode | `--settled --strict` clean; `acmepay`, `dayjs.js` and the duplicate gone; record lines (path, marker, role, hash), file relations, gotcha and see-also unchanged against the before-snapshot; `systems.mjs check` OK; `plan.mjs . retag` prints `RETAG DONE`; macro-eval warnings 3 -> 0 |

- **Cap: $4 default** (`--max-usd N` or `SKILL_TEST_MAX_USD`). A live run is three headless Sonnet
  sessions that read the skill, a handful of tiny files and run scripts; the estimate is roughly
  $0.50 to $1.50 per slice, $2 to $4 in all. That is an estimate, not a measurement: the first live run
  prints the real figure, and this section should be corrected from it.
- Offline (`pnpm run skill-test -- lantern-vocabulary`) uses the fake agent, which writes a good answer
  per fixture (`--fake broken` writes platform-named features, two spellings of the relay, an invented
  system and an untouched untidy map, so every paid slice fails on a vocabulary assertion).
  `pnpm run skill-test -- lantern-vocabulary --live --max-usd 1.5` tries it cheaply; the cap is
  shared, so a small cap fails the later slices as `cost cap exceeded`.

#### `lantern-areas`: do real runs write a passing tree, or keep the flat view?

Five neutral invented projects, built by scripts with a prebuilt `.lantern/` map (no model builds a
fixture): a 13-feature online shop (builders in `scripts/skill-test/lantern-areas-fixtures.mjs`, data in
`lantern-areas-specs.mjs`), and a 12-feature booking studio. Each has a free fixture slice that proves
the judge can fail, then one paid agent call. The paid slices are `isolated`. Judgement is scripts only
(`lantern-areas-checks.mjs`): `validate.mjs --settled --strict`, `areas.mjs check`, `areas.mjs lookup packets`
and `lookup score`, and direct file comparisons (sources, record lines and hashes unchanged; only
`.lantern/areas`, `areas.json` and the allowed feature lines change). The prompts say only "use
lantern-setup" or "follow the delegate protocol's map-update step" plus a scratch directory.

| slice | fixture | one agent call | passes when |
|---|---|---|---|
| `good-setup` | 154 records, 13 features on 3 platforms (web, backend, mobile) in 6 product functions, no `.lantern/areas` | `lantern-setup` | a tree that passes `check` and the blind lookup, or the flat view said in the report; records and sources untouched |
| `trap-setup` | the same shop, but coupling crosses product functions through shared plumbing: the best `propose` candidate mixes them | `lantern-setup` | the same, and never the misleading tree (it passes `check` and only the lookup rejects it) |
| `small-setup` | 6 features, 50 records | `lantern-setup` | nothing written: no `.lantern/areas`, no areas text, map untouched |
| `retag-run` | 152 records, 12 features, tidy old map without areas | `lantern-setup` in Retag mode | a valid tree or the flat view, records kept, `plan.mjs . retag` done, strict clean |
| `overflow-delegate` | a full seven-area tree and one new unmapped feature (`staff-rota`) that fits no area | the delegate `map-update step` | the feature is mapped and placed in a rebuilt tree that passes strict `check` and the lookup, or sits under "To assign" with the old tree intact |

- **The lookup in the judge.** In live mode the agent runs the real lookup with fresh readers and leaves
  the packets and the answers in `.ai/tmp/areas` (`answers.json`). The judge re-runs `check`, rewrites the
  packets from the final tree and requires them to equal the agent's (so the lookup ran on this tree), then
  scores the agent's answers with `lookup score`. Offline, a scripted reader stand-in
  (`lantern-areas-reader.mjs`, the area whose purpose shares the most words with the feature text) answers
  instead; it exists only in offline mode. Live, the judge trusts that the answers came from fresh readers (it cannot see who wrote them), the same trust the skill itself places in the lookup; for the overflow slice it also requires the answer for the new feature to name the area it sits in.
- **Flat view.** With no tree the report must say the flat view was kept; that is what makes the judge red
  before the agent runs. The small slice has no such line: its fixture slice shows the judge failing a tree.
- **Cap: $12 default** (`--max-usd N` or `SKILL_TEST_MAX_USD`). A live run is five headless Sonnet sessions;
  the setup, trap and retag runs read about 150 records of map, write a tree and call the lookup once per
  feature. Estimate, not a measurement: about $1.50 to $2.50 each for good, trap, retag and overflow, $0.30 to
  $0.60 for small, $5 to $9 in all. The first live run prints the real figure; correct this section from it.
- Offline (`pnpm run skill-test -- lantern-areas`) uses the fake agent, which writes the right tree for each
  project; `--fake broken` writes a layered tree (good, retag), the misleading tree (trap), a tree for the
  small project and an eighth area (overflow), so every paid slice fails on an areas assertion.
  `pnpm run skill-test -- lantern-areas --dry-run` prints the plan and the cap.

### Measuring a delegate run (`pnpm run run-cost`)

Tokens and USD per phase, and tool-output tokens per tool and per agent, for one `lantern-delegate` run,
read from its transcripts. Offline: it spends nothing and reads only the directory it is given.

```bash
pnpm run run-cost -- <transcripts-dir> --agent-id <delegate id>            # prints the table
pnpm run run-cost -- <dir> --agent-id <id> --project <name> --label "<how it was made>" --out base.json
pnpm run run-cost -- --compare a.json b.json                               # delta; exit 1 if the pass result differs
```

`<transcripts-dir>` is the folder with `agent-<id>.jsonl` and `agent-<id>.meta.json` (the `subagents`
folder of a session). The delegate's reviewers are found through `parentAgentId`. Symlinks in it are ignored.

- **Estimators, printed on every run.** Tool-output tokens are the byte count divided by 4 of the `tool_result` text (no
  offline API token counter; images and `tool_reference` parts count 0). USD is list price times the
  usage in the transcript (`scripts/run-cost/prices.mjs`, 5 minute cache writes at 1.25x input, 1 hour at
  2x), not billed telemetry; a call on an unlisted model counts 0 and is reported as `unpricedCalls`.
  `tokens` is input + cache-write + cache-read + output.
- **Phases**, by tool and agent type (`scripts/run-cost/phases.mjs`). A call is classified by the tools it
  invokes; a call with only neutral tools stays in the phase before it.
  The lists are the rules in `phases.mjs`; the patterns there are the source of truth.
  - `review`: every call of a `reviewer` or `reviewer-complex` agent, and the delegate's `Agent` (or `Task`) call that spawns one.
  - `handover`: `git push`, `pr-create.mjs`, `sync.mjs`, `pr-append-cost`, `build-report.mjs`,
    the `lantern-setup` skill's scripts, `git add` of `.lantern` or `.ai/tmp`, removing the run folder, any command naming
    the Lantern map or "record pull request", `SubagentHandback`, and edits, writes or reads under `.lantern/`
    or `.ai/tmp/`.
  - `work`: edits and writes elsewhere, builds, tests and typechecks, any other command or tool.
  - neutral: `Read`, `Grep`, `Glob`, `Skill`, `ToolSearch`, task and question tools, `SendMessage`, and Bash
    commands made only of read-only or setup commands (`git fetch|reset|log|show|diff|status|add|commit|rm`
    and similar, `ls`, `cat`, `grep`, `find`, `ln`, `mkdir`, `pnpm install`, linking skills). A compound
    command (`&&`, `;`, `|`) is neutral only when every part is. Neutral keeps the previous phase.
  - Agents other than the delegate and `reviewer` (Explore and the like) start at `brief` on their own.
  - `brief`: the start, up to the first call that is not neutral: the orchestrator's brief (it sits in the
    first call's cache write) and the delegate's first reads (base reset, skills, repo reading).
- **Pass result.** The last reviewer's `VERDICT: merge` or `merge-with-followups` with `BLOCKING: 0` is a pass,
  any other verdict a fail, no verdict `null`. `--pass` / `--fail` overrides it (`source: flag`).
- **Baseline file** (`--out`, needs `--label`): JSON, `schema: "lantern-run-cost-baseline"`, `version: 1`,
  `label` (how it was made), `run` (id, project, model, effort), `estimators`, `pass`, `phases.{brief,work,review,handover}`
  and `total` (calls, input, cacheWrite, cacheRead, output, tokens, usd, toolOutputTokens), `tools.<name>`
  (calls, outputTokens), `agents[]`. Counts and costs only, never transcript text. `--compare` refuses a file
  of another version or a pair made with different estimators (exit 2), prints the delta per phase and per
  tool, and exits 1 when the pass results differ, so a saving that breaks the run is not a saving.
- **Stored baseline:** `docs/run-cost-baselines/lantern-delegate-baseline.json` is one real delegate run of this
  repository (not an e2e project). A baseline for the four e2e projects needs live paid runs
  (about 7 USD each, `scripts/e2e-delegate/README.md`), which the owner has to approve.

## Memory view

The Memory view (sidebar button and hub card) shows where the memory of Lantern's own process
tree goes: the app and its helpers, the embedded VS Code server and its extension hosts, the
agents (`claude`, `codex`) and everything else they started, by category, by project and by
process.

- **The number is the footprint, not resident size.** It is the `mem` column of
  `top -l 1 -stats pid,mem -pid …`, the figure macOS itself reports (it matched the kernel
  panic report). `ps` resident size under-counts compressed memory, and
  `app.getAppMetrics()` reports the same resident working set (about three times larger than
  the footprint on the Electron helpers we compared), so neither is used. Age is `ps` `etime`.
- **How it samples.** Only while a window has the view open: opening it starts the sampler,
  closing it (or reloading or destroying the window) stops it and drops the history. Samples
  are at least 5 s apart (the next one is scheduled 5 s after the previous one finishes, never
  overlapping). One sample is four fixed-argv `execFile` calls with no shell (`ps`, `top`,
  `lsof` for working directories, `memory_pressure -Q`) and costs about 0.8 s of wall time and
  about 0.75 s of CPU, nearly all of it `top`. The last reading's duration is shown in the view.
- **Privacy.** Command lines are read only in the main process, to classify a process and to
  match it to a project from the working directory or a project path in the command. The
  renderer receives plain data: a friendly name, a short label (no arguments), the project name,
  age and bytes. Unmatched processes are shown as unattributed.
- **Read-only.** The view itself has no kill or restart action (the sidebar's Free memory is
  described below). A process that is both older than 24 hours and larger than 1 GB is
  highlighted (`OLD_PROCESS_SECONDS` and `LARGE_PROCESS_BYTES` in `src/shared/memory.ts`).
- **Platforms.** macOS only for now; Windows and Linux show a "not supported yet" state.
- **Tests** use recorded text fixtures (`test/fixtures/memory`) and a fake command runner; they
  never signal a process or use a made-up pid.

### Free memory and Remove from sidebar

Every project row has two different buttons, shown on hover or keyboard focus:

- **Free memory** (chip icon, only on a project whose tab is open) closes the tab, stops the
  project's editor processes right away and keeps the row; clicking the row opens the project
  fresh. The status line says what was stopped, or why nothing was.
- **Remove from sidebar** (cross icon) does the same and also hides the project, which Add
  folder brings back. On a project that is not open it only hides it.

Closing a tab alone frees nothing: the embedded VS Code server keeps a closed client's
extension host (and the tsserver, file watchers and agent below it) for its reconnection grace
time, measured at 3 hours. So both buttons call `memory:free-project`, which in the main
process reuses the Memory view's process walk and project attribution (`walkTree` and
`attributeTree` in `src/main/memory-collect.ts`) and stops, through `terminatePids` in
`src/main/prockill.ts`, only:

- the extension hosts attributed to that project that sit below the server process Lantern
  started (`serveweb.serverPid()`), and every process below them;
- never a pid of 1 or less, the server process itself, Lantern, or a process attributed to
  another project (its subtree is spared too).

When the host cannot be identified (no server of ours, an ambiguous attribution, the project
also open in its own window, a process list that cannot be read) nothing is signalled: the tab
is closed, the status line says so and the server's grace time does the rest. A project with a
running or waiting agent session asks for confirmation first and does nothing without it. The
renderer only receives counts per kind, never command lines. The tests inject the kill function
and use the recorded fixtures; they never send a real signal.

## Claude session status and notifications

Lantern polls `claude agents --json --all` for Claude sessions, starting at four seconds and
backing off while nothing changes, after failures, and while no window is open. The CLI snapshot
is the only source of Claude session status; transcript age and Claude Code hooks must not infer
completion. The poll is asynchronous, bounded by a timeout and an output cap, and never overlaps.
A row with an unknown state or status reads as unknown; a malformed row is dropped. Polling never
touches Codex sessions. A failed poll displays the known
sessions as unavailable and the first successful recovery snapshot is a quiet baseline.

Notification cards are emitted only after an observed transition to finished or waiting.
Initial snapshots, newly discovered sessions, repeated states, failures, stopped sessions,
and legacy `/event` or `/notify` hook requests (answered with 410) stay quiet. Startup removes only hook entries
previous Lantern versions installed in `~/.claude/settings.json`, preserving other hooks in
the same group, making a backup and an atomic replace before any write; Lantern no longer
installs Claude hooks.

## Codex notifications and lifecycle hooks

Codex uses a separate authenticated endpoint and token. The token must exist with mode `0600`
before the loopback server starts, including when user notifications are disabled. Only
authenticated `/codex/event` input produces Codex state.

Codex hook installation is an explicit renderer action exposed through trusted, zero-argument
IPC. It writes only `${CODEX_HOME:-~/.codex}/hooks.json` and Lantern's user-data token/scripts.
Keep status checks read-only. Preserve foreign top-level fields, event groups, matchers, and
handlers, including foreign handlers sharing a group with Lantern. Reject malformed or
symlinked destinations, back up only before a real config mutation, replace atomically, and
preserve the existing mode. Configuration still requires the user's normal `/hooks` trust
review in Codex.

The transport scripts are observational. They forward raw stdin to the exact loopback endpoint,
return `{}` with exit status zero on every path, and never emit an approval or continuation
decision. `SessionStart` and `SessionEnd` stay synchronous and bounded; turn hooks are async.
Lantern notifies on the first `Stop` boundary per turn because another independent hook may ask
Codex to continue after that boundary.
