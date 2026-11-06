import type { Provider as ToolsProvider } from '../../main/provider';

let providers = new Map<string, ToolsProvider>();

function providerForProject(project: string | null): ToolsProvider {
  return (project && providers.get(project)) || 'claude';
}

function setProviders(entries: Record<string, ToolsProvider> | undefined) {
  providers = new Map(Object.entries(entries ?? {}));
}

function setProvider(project: string, provider: ToolsProvider) {
  providers.set(project, provider);
}

function providerLabel(provider: ToolsProvider) {
  return provider === 'codex' ? 'Codex' : 'Claude';
}

function assistantName(project: string | null) {
  return providerLabel(providerForProject(project));
}

export { assistantName, providerForProject, providerLabel, setProvider, setProviders };
export type { ToolsProvider };
