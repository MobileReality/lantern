import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { installBundleGuarded, skippedEntries, syncDelegatePermissions } from '../../scripts/lantern-bundle.mjs';
import type { BundleResult } from '../../scripts/lantern-bundle.mjs';
import { bundledSkillsRoot } from './agent';
import { DEV_PROFILE } from '../shared/config';
import type { Provider } from './provider';

interface InstallOptions {
  home?: string;
  root?: string;
  provider?: Provider;
  again?: boolean;
  consent?: PermissionConsent;
}

type PermissionConsent = (project: string) => boolean | Promise<boolean>;

let defaultConsent: PermissionConsent = () => false;

function setPermissionConsent(consent: PermissionConsent) {
  defaultConsent = consent;
}

function consentOf(project: string, consent?: PermissionConsent) {
  return () => (consent ?? defaultConsent)(canonical(project));
}

const attempted = new Set<string>();

function canonical(dir: string) {
  try {
    return fs.realpathSync.native(dir);
  } catch {
    return dir;
  }
}
const inFlight = new Map<Promise<unknown>, string>();

// Never throws: a failed install must not get in the way of opening the project.
async function installLanternBundle(project: string, { home = os.homedir(), root = bundledSkillsRoot(), provider = 'claude', again = false, consent }: InstallOptions = {}): Promise<BundleResult | null> {
  try {
    const resolved = path.resolve(project);
    const key = `${provider}:${canonical(resolved)}`;
    if (attempted.has(key) && !again) {
      if (provider === 'claude') await syncDelegatePermissions({ project: resolved, root, home, consent: consentOf(resolved, consent) });
      return null;
    }
    attempted.add(key);
    const result = await installBundleGuarded({ project: resolved, root, home, provider, consent: consentOf(resolved, consent) });
    if (result.skipped === 'not-ignored') console.warn(`Lantern bundle: nothing installed in ${resolved}; git does not ignore the bundle paths and the repo-local exclude could not cover them`);
    else for (const { name, reason } of skippedEntries(result, provider)) console.warn(`Lantern bundle: skipped ${name} in ${resolved} (${reason})`);
    return result;
  } catch {
    return null;
  }
}

async function syncPermissionsOf(project: string, { home = os.homedir(), root = bundledSkillsRoot(), provider = 'claude', consent }: InstallOptions = {}): Promise<null> {
  if (provider === 'claude') await syncDelegatePermissions({ project: path.resolve(project), root, home, consent: consentOf(project, consent) });
  return null;
}

function installOnOpen(project: string, options?: InstallOptions): void {
  // A dev run would overwrite the installed app's bundle in the project with this repo's WIP skills,
  // and the two would keep replacing each other. Test the install by starting without the profile.
  const run = (DEV_PROFILE ? syncPermissionsOf(project, options) : installLanternBundle(project, options)).finally(() => inFlight.delete(run));
  inFlight.set(run, canonical(path.resolve(project)));
}

// A switch saved in the Skills window takes effect in the open project now, not at its next open.
function reinstallOf(project: string, options?: InstallOptions): Promise<unknown> {
  const run = settledFor(project)
    .then(() => (DEV_PROFILE ? syncPermissionsOf(project, options) : installLanternBundle(project, { ...options, again: true })))
    .finally(() => inFlight.delete(run));
  inFlight.set(run, canonical(path.resolve(project)));
  return run;
}

function settledFor(project: string): Promise<unknown> {
  const key = canonical(path.resolve(project));
  return Promise.all([...inFlight].filter(([, k]) => k === key).map(([run]) => run));
}

function settled(): Promise<unknown> {
  return Promise.all([...inFlight.keys()]);
}

function forgetAttempts() {
  attempted.clear();
}

export { setPermissionConsent, installLanternBundle, installOnOpen, reinstallOf, syncPermissionsOf, settled, settledFor, forgetAttempts };
export type { PermissionConsent };
