# Plan

Windows job builds the Squirrel installer, uploads Setup.exe, RELEASES, full nupkg; SHA256SUMS adds Lantern-Setup.exe.

## Tasks

| # | Step | Status |
|---|---|---|
| 1 | Tests first (release-workflow.test.ts) | done |
| 2 | release.yml + release-checksums.sh | done |
