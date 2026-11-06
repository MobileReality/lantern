import { BINDING_CHOICE, CONNECTION_STATE, CREDENTIAL_SOURCE } from '@shared/auth-kinds';
import type { ConnectionState, CredentialSource } from '@shared/auth-kinds';
import type { ProjectHost, ProjectIntegrations, ProjectSlot } from '@shared/auth-view';
import type { CodeHost } from '@main/lantern-host-origin';
import type { Bindings, Resolution } from './bindings';
import { CREDENTIAL_VARS, namesInEnvironment } from './env-names';
import { PROVIDER_IDS, PROVIDER_ROLE, PROVIDERS } from './providers';
import type { ProviderId } from './providers';
import type { ProfileStore } from './profiles';
import { profileStatus } from './status';

interface ProjectViewDeps {
  profiles: ProfileStore;
  bindings: Bindings;
  stateOf: (profileId: string) => ConnectionState;
  resolveProject: (project: string) => string;
  detectHost: (root: string) => Promise<CodeHost | null>;
  readFileNames: (root: string) => Promise<Set<string>>;
  env: () => NodeJS.ProcessEnv;
}

const slotOrder = (suggested: ProviderId | null): ProviderId[] => [
  ...PROVIDER_IDS.filter((provider) => provider === suggested),
  ...PROVIDER_IDS.filter((provider) => provider !== suggested && PROVIDERS[provider].role === PROVIDER_ROLE.codeHost),
  ...PROVIDER_IDS.filter((provider) => PROVIDERS[provider].role !== PROVIDER_ROLE.codeHost),
];

const WINNER_PRIORITY: readonly CredentialSource[] = [CREDENTIAL_SOURCE.environment, CREDENTIAL_SOURCE.lantern, CREDENTIAL_SOURCE.projectFile];

const winnerOf = (available: Partial<Record<CredentialSource, boolean>>): CredentialSource => WINNER_PRIORITY.find((source) => available[source]) ?? CREDENTIAL_SOURCE.none;

function resolutionOf(deps: ProjectViewDeps, provider: ProviderId, project: string, suggested: boolean): Resolution {
  const resolution = deps.bindings.resolve(provider, project);
  const automatic = suggested || PROVIDERS[provider].role === PROVIDER_ROLE.tracker;
  if (resolution.choice === BINDING_CHOICE.bound || automatic || resolution.choice === BINDING_CHOICE.none) return resolution;
  return { choice: BINDING_CHOICE.unused, profileId: null };
}

function slotOf(deps: ProjectViewDeps, provider: ProviderId, project: string, suggested: boolean, inEnvironment: Set<string>, inFile: Set<string>): ProjectSlot {
  const vars = CREDENTIAL_VARS[provider];
  const { choice, profileId } = resolutionOf(deps, provider, project, suggested);
  const names = [...vars.required, ...vars.optional];
  const projectFileComplete = vars.required.every((name) => inFile.has(name));
  return {
    provider,
    role: PROVIDERS[provider].role,
    suggested,
    binding: choice,
    bound: profileId,
    candidates: deps.profiles.list(provider).map((profile) => profileStatus(deps.stateOf, profile)),
    inEnvironment: names.filter((name) => inEnvironment.has(name)),
    inProjectFile: names.filter((name) => inFile.has(name)),
    projectFileComplete,
    winner: winnerOf({
      [CREDENTIAL_SOURCE.environment]: vars.required.some((name) => inEnvironment.has(name)),
      [CREDENTIAL_SOURCE.lantern]: profileId !== null && deps.stateOf(profileId) === CONNECTION_STATE.connected,
      [CREDENTIAL_SOURCE.projectFile]: projectFileComplete,
    }),
  };
}

async function projectIntegrations(deps: ProjectViewDeps, project: string): Promise<ProjectIntegrations> {
  const root = deps.resolveProject(project);
  const [host, inFile] = await Promise.all([deps.detectHost(root), deps.readFileNames(root)]);
  const inEnvironment = namesInEnvironment(deps.env());
  const suggested = host?.provider ?? null;
  return {
    project,
    host: { provider: suggested, owner: host?.owner ?? null, repo: host?.repo ?? null },
    slots: slotOrder(suggested).map((provider) => slotOf(deps, provider, project, provider === suggested, inEnvironment, inFile)),
  };
}

export { projectIntegrations };
export type { CredentialSource, ProjectHost, ProjectIntegrations, ProjectSlot, ProjectViewDeps };
