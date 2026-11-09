# Handoff

Signing and notarization are unrun: no certificate, no API key, no Actions run. The first v* tag is the real test.

Checked locally: both scripts parse (`bash -n`); `sign --identity -` walks a real built app inside out and passes
`codesign --verify --deep --strict`; `notarize` was run against a stub `xcrun` (Accepted and Invalid paths, key file mode 600, key file deleted);
the bundled node and the Electron binary run V8 JIT and WebAssembly under the hardened runtime with `allow-jit` only.

Not checked: Chromium renderer/GPU helpers under the hardened runtime, real Team ID library validation, TCC prompts for mic, camera and Apple events.

## Reviewer follow-ups (non-blocking, verdict merge-with-followups)
- Consider @electron/osx-sign instead of the hand-written codesign walk (electron-packaging).
- `security import -P ... -A`: password in argv and every app may use the key; `-T /usr/bin/codesign` is narrower.
- Drop `cache: pnpm` from build-mac to remove a cache-poisoning path into the signing job.
- `device.camera` mirrors the existing videoCapture grant; nothing shows the camera is used. Drop entitlement, grant and policy together later.
- The inherit plist gives allow-jit to the GPU and plugin helpers too, broader than the renderer alone.
- Add a launch check of the signed app in CI after `verify`, before `pack`.
- Biome warns `noTemplateCurlyInString` four times in test/release-workflow.test.ts (literal GitHub expressions).
- Docs fixed after the verdict (unreviewed): present-tense signed claim, re-run of an old tag, "same Team ID".
