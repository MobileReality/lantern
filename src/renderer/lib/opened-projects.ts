import { activeProjectPath, app } from '@renderer/state';
import { baseName } from './util';

interface ProjectRef {
  path: string;
  name: string;
}

function openedProjects(): ProjectRef[] {
  const paths = new Set<string>();
  for (const tab of app.opened.values()) if (tab.path) paths.add(tab.path);
  const active = activeProjectPath();
  if (active) paths.add(active);
  return [...paths].map((path) => ({ path, name: app.groups.find((group) => group.path === path)?.name ?? baseName(path) }));
}

export { openedProjects };
export type { ProjectRef };
