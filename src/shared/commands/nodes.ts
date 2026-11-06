import type { CommandsNode } from '.';

export const PALETTE_COMMANDS = {
  id: 'palette',
  title: 'Palette',
  commands: { 'palette.open': { title: 'Command palette', keys: 'mod+shift+p', menu: true } },
} satisfies CommandsNode;

export const SETTINGS_COMMANDS = {
  id: 'settings',
  title: 'Settings',
  commands: {
    'settings.open': { title: 'Settings', keys: 'mod+,', menu: true },
    'settings.openFile': { title: 'Open settings.json' },
  },
} satisfies CommandsNode;

export const PROJECT_COMMANDS = {
  id: 'project',
  title: 'Projects',
  commands: {
    'project.new': { title: 'New VS Code window' },
    'project.addFolder': { title: 'Add folder', keys: 'mod+o' },
    'project.filter': { title: 'Filter projects', keys: 'mod+p' },
  },
} satisfies CommandsNode;

export const EDITOR_COMMANDS = {
  id: 'editor',
  title: 'Editor',
  commands: {
    'editor.show': { title: 'Show editor' },
    'editor.restart': { title: 'Restart VS Code server' },
    'editor.devtools': { title: 'Editor devtools', keys: 'mod+alt+i' },
  },
} satisfies CommandsNode;

export const LANTERN_COMMANDS = {
  id: 'lantern',
  title: 'Lantern',
  commands: {
    'lantern.open': { title: 'Architecture map', keys: 'mod+shift+l' },
    'lantern.refresh': { title: 'Refresh map' },
    'lantern.problems': { title: 'Problems', keys: 'mod+shift+m' },
  },
} satisfies CommandsNode;

export const EXPLAIN_COMMANDS = {
  id: 'explain',
  title: 'Explain',
  commands: {
    'explain.open': { title: 'Explainers' },
    'explain.popout': { title: 'Explainer in its own window' },
  },
} satisfies CommandsNode;

export const MEMORY_COMMANDS = {
  id: 'memory',
  title: 'Memory',
  commands: { 'memory.open': { title: 'Memory' } },
} satisfies CommandsNode;

export const INTEGRATIONS_COMMANDS = {
  id: 'integrations',
  title: 'Integrations',
  commands: { 'integrations.open': { title: 'Integrations' } },
} satisfies CommandsNode;

export const SKILLS_COMMANDS = {
  id: 'skills',
  title: 'Skills',
  commands: {
    'skills.open': { title: 'Skills' },
    'skills.fixMicrophone': { title: 'Enable microphone' },
  },
} satisfies CommandsNode;
