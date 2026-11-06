import type { MenuItemConstructorOptions } from 'electron';

interface TrayMenuProject {
  name: string;
  path: string;
  emoji: string;
}

interface TrayMenuDeps {
  projects: TrayMenuProject[];
  tests: { kind: string; label: string }[];
  openProject: (projectPath: string) => void;
  openWorkspace: () => void;
  clearFinished: () => void;
  testNotification: (kind: string) => void;
  quit: () => void;
}

const SEPARATOR: MenuItemConstructorOptions = { type: 'separator' };

function compactTrayMenu(deps: TrayMenuDeps): MenuItemConstructorOptions[] {
  return [
    { label: 'Open workspace…', click: deps.openWorkspace },
    { label: 'Clear finished', click: deps.clearFinished },
    SEPARATOR,
    { label: 'Quit', click: deps.quit },
  ];
}

function fullTrayMenu(deps: TrayMenuDeps): MenuItemConstructorOptions[] {
  const projectItems: MenuItemConstructorOptions[] =
    deps.projects.length === 0
      ? [{ label: 'No projects', enabled: false }]
      : deps.projects.map((project) => ({ label: `${project.emoji || '📁'}  ${project.name}`, click: () => deps.openProject(project.path) }));
  const testItems: MenuItemConstructorOptions[] = deps.tests.length
    ? [{ label: 'Test notification', submenu: deps.tests.map((test) => ({ label: test.label, click: () => deps.testNotification(test.kind) })) }]
    : [];
  return [
    { label: 'Lantern', enabled: false },
    SEPARATOR,
    ...projectItems,
    SEPARATOR,
    { label: 'Open workspace…', click: deps.openWorkspace },
    { label: 'Clear finished', click: deps.clearFinished },
    SEPARATOR,
    ...testItems,
    SEPARATOR,
    { label: 'Quit', click: deps.quit },
  ];
}

export { compactTrayMenu, fullTrayMenu };
export type { TrayMenuDeps };
