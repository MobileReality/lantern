import { openSkills } from '@renderer/features/skills';
import { app } from '@renderer/state';
import { installTooltips } from '@renderer/tooltip';

const project = new URLSearchParams(location.search).get('project');
app.activeKey = project || null;
installTooltips();

Object.assign(window, { openHarnessSkills: () => openSkills() });

document.documentElement.dataset.harnessReady = 'true';
