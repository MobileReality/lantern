import fs from 'node:fs';
import path from 'node:path';
import { ENV_LINE, MAX_ENV_BYTES, cleanValue, readBoundedFile } from '@main/lantern-host-credentials';
import { PROVIDER } from './providers';
import type { ProviderId } from './providers';

interface CredentialVars {
  required: readonly string[];
  optional: readonly string[];
}

const CREDENTIAL_VARS: Record<ProviderId, CredentialVars> = {
  [PROVIDER.github]: { required: ['GITHUB_TOKEN'], optional: [] },
  [PROVIDER.bitbucket]: { required: ['BITBUCKET_EMAIL', 'BITBUCKET_API_TOKEN'], optional: [] },
  [PROVIDER.jira]: { required: ['ATLASSIAN_EMAIL', 'GLOBAL_ATLASSIAN_TOKEN'], optional: ['ATLASSIAN_BASE_URL'] },
};

const ENV_FILES = [path.join('.ai', '.env'), '.env'];

const ALL_NAMES = new Set(Object.values(CREDENTIAL_VARS).flatMap((vars) => [...vars.required, ...vars.optional]));

const isSet = (value: string | undefined) => typeof value === 'string' && value.trim() !== '';

function namesInEnvironment(env: NodeJS.ProcessEnv): Set<string> {
  return new Set([...ALL_NAMES].filter((name) => isSet(env[name])));
}

const lstat = (root: string, relative: string) => fs.promises.lstat(path.join(root, relative));

async function insideSymlinkedFolder(root: string, relative: string): Promise<boolean> {
  const folder = path.dirname(relative);
  return folder !== '.' && (await lstat(root, folder)).isSymbolicLink();
}

const FILE_RULES: readonly ((meta: fs.Stats) => boolean)[] = [(meta) => meta.isFile(), (meta) => meta.size <= MAX_ENV_BYTES];

async function isSafeToRead(root: string, relative: string): Promise<boolean> {
  if (await insideSymlinkedFolder(root, relative)) return false;
  const meta = await lstat(root, relative);
  return FILE_RULES.every((rule) => rule(meta));
}

function credentialNamesIn(text: string): string[] {
  return text.split(/\r?\n/).flatMap((line) => {
    const match = ENV_LINE.exec(line);
    return match && ALL_NAMES.has(match[1]) && cleanValue(match[2]) ? [match[1]] : [];
  });
}

async function namesInFile(root: string, relative: string): Promise<string[]> {
  try {
    if (!(await isSafeToRead(root, relative))) return [];
    const text = await readBoundedFile(path.join(root, relative));
    return text === null ? [] : credentialNamesIn(text);
  } catch {
    return [];
  }
}

async function namesInProjectFiles(root: string): Promise<Set<string>> {
  const found = await Promise.all(ENV_FILES.map((relative) => namesInFile(root, relative)));
  return new Set(found.flat());
}

export { CREDENTIAL_VARS, isSet, namesInEnvironment, namesInProjectFiles };
export type { CredentialVars };
