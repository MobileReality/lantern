# Plan

Uninstall button in the Settings CLI panel (plan windows-squirrel-installer, s2.1).

1. Test first in test/cli-panel.test.ts: visible only when installed, one call, error and note shown.
2. cli:uninstall IPC in main.ts (darwin: cli.uninstall, else uninstallUserCli), preload cliUninstall, global.d.ts type.
3. Button in cli-panel.ts.
