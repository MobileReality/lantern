import type { SettingsNode } from './settings-schema';

export const GRAPH_SETTINGS = {
  id: 'graph',
  title: 'Graph',
  properties: {
    'graph.foldFilesWhenZoomedOut': {
      type: 'boolean',
      default: true,
      description:
        'On a large map, show each folder as one tile with its file count when zoomed out. Click a tile to see its files.',
    },
  },
} satisfies SettingsNode;
