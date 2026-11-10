# Handoff

Plan unreviewed (unattended run). Code and tests are in; review and map steps are next.

## Finding
`update.electronjs.org/MobileReality/lantern/darwin-arm64/0.2.2` answers 404: `Lantern-mac.zip` has no `-arm64` in its name, so the service files it under darwin-x64. It needs `Lantern-mac-arm64.zip` (or `-darwin-arm64`). The app treats the 404 as "feed not available", a quiet no-op.
