import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

interface HintProject {
  records: number;
  features: number;
  areas?: string;
}

function featureOf(index: number, features: number) {
  return index < features ? `feature-${String(index).padStart(2, '0')}` : null;
}

function mapText({ records, features }: HintProject) {
  const lines = Array.from({ length: records }, (_, index) => {
    const feature = featureOf(index, features);
    return `src/f${index}.ts . util ${String(index).padStart(12, '0')}${feature ? `\n#feature ${feature}` : ''}`;
  });
  return `lantern 1\n# src\n\n${lines.join('\n')}\n`;
}

function writeHintProject(project: HintProject): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-areas-hint-'));
  fs.mkdirSync(path.join(root, '.lantern', 'map'), { recursive: true });
  fs.writeFileSync(path.join(root, '.lantern', 'map', 'src.lantern'), mapText(project));
  if (project.areas !== undefined) writeAreas(root, project);
  return root;
}

function writeJson(root: string, rel: string, text: Record<string, string>) {
  const file = path.join(root, '.lantern', rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify({ text })}\n`);
}

function writeAreas(root: string, project: HintProject) {
  const ids = Array.from({ length: project.features }, (_, index) => featureOf(index, project.features) as string);
  fs.writeFileSync(path.join(root, '.lantern', 'areas'), project.areas as string);
  fs.writeFileSync(path.join(root, '.lantern', 'features'), `${ids.join('\n')}\n`);
  writeJson(root, 'lang/en/features.json', Object.fromEntries(ids.map((id) => [id, `what ${id} covers`])));
  const areaIds = (project.areas as string).split('\n').filter((line) => line && !line.startsWith(' '));
  writeJson(root, 'lang/en/areas.json', Object.fromEntries(areaIds.map((id) => [id, `what ${id} groups`])));
}

export { writeHintProject };
export type { HintProject };
