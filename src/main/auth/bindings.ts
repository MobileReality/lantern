import { AUTH_ERROR, BINDING_CHOICE } from '@shared/auth-kinds';
import type { BindingChoice } from '@shared/auth-kinds';
import { BindingError } from './errors';
import { PROVIDER_IDS, isProviderId } from './providers';
import type { ProviderId } from './providers';
import type { ProfileStore } from './profiles';
import { isRecord, readJson, writePrivateJson } from './private-file';

interface Resolution {
  choice: BindingChoice;
  profileId: string | null;
}

type ProjectBindings = Partial<Record<ProviderId, string>>;

interface BindingsDeps {
  file: string;
  profiles: ProfileStore;
  resolveProject: (project: string) => string;
  canPersist: () => boolean;
}

interface Bindings {
  resolve(provider: ProviderId, project?: string): Resolution;
  set(provider: ProviderId, profileId: string, project: string): void;
  clear(provider: ProviderId, project: string): void;
  forgetProfile(profileId: string): ProviderId[];
}

const FILE_VERSION = 1;

function loadBindings(file: string): Record<string, ProjectBindings> {
  const stored = readJson(file);
  if (!isRecord(stored) || !isRecord(stored.projects)) return {};
  const projects: Record<string, ProjectBindings> = {};
  for (const [project, byProvider] of Object.entries(stored.projects)) {
    if (!isRecord(byProvider)) continue;
    const kept: ProjectBindings = {};
    for (const [provider, id] of Object.entries(byProvider)) if (isProviderId(provider) && typeof id === 'string') kept[provider] = id;
    if (Object.keys(kept).length) projects[project] = kept;
  }
  return projects;
}

function createBindings({ file, profiles, resolveProject, canPersist }: BindingsDeps): Bindings {
  let projects = loadBindings(file);

  function commit(next: Record<string, ProjectBindings>) {
    if (canPersist()) writePrivateJson(file, { version: FILE_VERSION, projects: next });
    projects = next;
  }

  function resolve(provider: ProviderId, project?: string): Resolution {
    const bound = project ? projects[resolveProject(project)]?.[provider] : undefined;
    if (bound !== undefined && profiles.get(bound)?.provider === provider) return { choice: BINDING_CHOICE.bound, profileId: bound };
    const candidates = profiles.list(provider);
    if (candidates.length === 1) return { choice: BINDING_CHOICE.default, profileId: candidates[0].id };
    return { choice: candidates.length ? BINDING_CHOICE.choose : BINDING_CHOICE.none, profileId: null };
  }

  function set(provider: ProviderId, profileId: string, project: string) {
    const profile = profiles.get(profileId);
    if (!profile) throw new BindingError(AUTH_ERROR.unknownProfile);
    if (profile.provider !== provider) throw new BindingError(AUTH_ERROR.wrongProvider);
    const key = resolveProject(project);
    commit({ ...projects, [key]: { ...projects[key], [provider]: profileId } });
  }

  function clear(provider: ProviderId, project: string) {
    const key = resolveProject(project);
    if (projects[key]?.[provider] === undefined) return;
    const { [provider]: _removed, ...rest } = projects[key];
    const { [key]: _project, ...others } = projects;
    commit(Object.keys(rest).length ? { ...others, [key]: rest } : others);
  }

  function forgetProfile(profileId: string) {
    const touched = new Set<ProviderId>();
    const next: Record<string, ProjectBindings> = {};
    for (const [project, byProvider] of Object.entries(projects)) {
      const kept: ProjectBindings = {};
      for (const provider of PROVIDER_IDS) {
        const id = byProvider[provider];
        if (id === undefined) continue;
        if (id === profileId) touched.add(provider);
        else kept[provider] = id;
      }
      if (Object.keys(kept).length) next[project] = kept;
    }
    if (touched.size) commit(next);
    return [...touched];
  }

  return { resolve, set, clear, forgetProfile };
}

export { createBindings };
export type { Bindings, BindingChoice, Resolution };
