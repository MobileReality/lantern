# Handoff

Signing and notarization are unrun: no certificate, no API key, no Actions run. The first v* tag is the real test.

Checked locally: both scripts parse (`bash -n`); `sign --identity -` walks a real built app inside out and passes
`codesign --verify --deep --strict`; `notarize` was run against a stub `xcrun` (Accepted and Invalid paths, key file mode 600, key file deleted);
the bundled node and the Electron binary run V8 JIT and WebAssembly under the hardened runtime with `allow-jit` only.

Not checked: Chromium renderer/GPU helpers under the hardened runtime, real Team ID library validation, TCC prompts for mic, camera and Apple events.
