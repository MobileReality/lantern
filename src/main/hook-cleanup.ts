import fs from 'node:fs';
import { writeFileAtomically } from './atomic-write';

type OwnsHook = (command: string) => boolean;

function readSettings(settingsPath: string): any {
  try {
    return JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw new Error(`Could not parse ${settingsPath}: ${(error as Error).message}`);
  }
}

function removeInstalledHooks(settingsPath: string, backupLabel: string, ownsHook: OwnsHook) {
  const settings = readSettings(settingsPath);
  let changed = false;
  for (const event of Object.keys(settings.hooks || {})) {
    const groups = settings.hooks[event];
    if (!Array.isArray(groups)) continue;
    let eventChanged = false;
    const keptGroups = groups.flatMap((group: any) => {
      const hooks = Array.isArray(group?.hooks) ? group.hooks : [];
      let groupChanged = false;
      const kept = hooks.filter((hook: any) => {
        const owned = typeof hook?.command === 'string' && ownsHook(hook.command);
        if (owned) {
          changed = true;
          eventChanged = true;
          groupChanged = true;
        }
        return !owned;
      });
      if (!groupChanged) return [group];
      return kept.length ? [{ ...group, hooks: kept }] : [];
    });
    if (!eventChanged) continue;
    if (keptGroups.length) settings.hooks[event] = keptGroups;
    else delete settings.hooks[event];
  }
  if (!changed) return { changed: false, backup: null };
  if (settings.hooks && !Object.keys(settings.hooks).length) delete settings.hooks;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backup = `${settingsPath}.${backupLabel}-bak-${stamp}`;
  fs.copyFileSync(settingsPath, backup);
  writeFileAtomically(settingsPath, `${JSON.stringify(settings, null, 2)}\n`);
  return { changed: true, backup };
}

function isLegacyNotifierCommand(command: string, currentHooksDir: string) {
  if (command.includes(currentHooksDir)) return true;
  const shellHook = command.includes('MRCH_TOKEN_FILE=')
    && command.includes('MRCH_PORT=31337')
    && /notify-hooks[\\/]notify\.sh/.test(command);
  const powershellHook = /powershell/i.test(command)
    && /notify-hooks[\\/]notify\.ps1/i.test(command)
    && /-Port\s+31337/i.test(command)
    && /-TokenFile\s+[^\r\n]*notifier\.token/i.test(command);
  return shellHook || powershellHook;
}

function runCleanups(cleanups: [string, () => unknown][], report: (message: string) => void) {
  for (const [name, cleanup] of cleanups) {
    try {
      cleanup();
    } catch (error) {
      report(`legacy ${name} cleanup failed: ${(error as Error).message}`);
    }
  }
}

export { isLegacyNotifierCommand, removeInstalledHooks, runCleanups };
