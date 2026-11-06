import { openIntegrations } from '@renderer/features/integrations';
import { mountIntegrationChip } from '@renderer/lib/integrations-chip';

interface HarnessProject {
  path: string;
  name: string;
}

const params = new URLSearchParams(location.search);
const projects: HarnessProject[] = JSON.parse(params.get('projects') ?? '[]');
if (params.get('window')) document.body.classList.add(params.get('window') as string);

const openButton = document.getElementById('open-integrations');
const bar = document.getElementById('lantern-bar');
if (!openButton || !bar) throw new Error('the harness page is missing its chrome');

const show = (opener: Element | null, focusProject?: string) => openIntegrations(opener, { projects: () => projects, focusProject });

openButton.addEventListener('click', () => show(openButton));

const [first] = projects;
if (first) {
  const chip = mountIntegrationChip(first.path, (opener) => show(opener, first.path));
  bar.append(chip.el);
}

document.documentElement.dataset.harnessReady = 'true';
