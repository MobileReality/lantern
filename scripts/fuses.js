#!/usr/bin/env node
'use strict';

// Harden the packaged binary's Electron fuses. The key one is RunAsNode: off —
// this machine sets ELECTRON_RUN_AS_NODE globally, which would otherwise make the
// packaged app boot as plain Node; disabling the fuse makes it ignore that env var
// entirely (so it always launches as the real app). Run after packaging, before
// signing on macOS (flipping fuses invalidates the signature).

const fs = require('fs');
const path = require('path');
const { flipFuses, FuseVersion, FuseV1Options } = require('@electron/fuses');

const target =
  process.platform === 'win32'
    ? path.join('dist', 'Lantern-win32-x64', 'Lantern.exe')
    : path.join('dist', 'Lantern-darwin-arm64', 'Lantern.app');

if (!fs.existsSync(target)) {
  console.error(`fuses: target not found: ${target}`);
  process.exit(1);
}

flipFuses(target, {
  version: FuseVersion.V1,
  resetAdHocDarwinSignature: false,
  [FuseV1Options.RunAsNode]: false,
  [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
  [FuseV1Options.EnableNodeCliInspectArguments]: false,
  [FuseV1Options.OnlyLoadAppFromAsar]: true,
})
  .then(() => console.log(`fuses flipped: ${target}`))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
