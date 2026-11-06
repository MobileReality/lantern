import fs from 'node:fs';
import path from 'node:path';
import { deriveMacroView } from '../../src/main/lantern-macro';
import type { MacroView } from '../../src/main/lantern-macro';
import { macroBlocksByPath } from '../../src/main/lantern-macro-files';
import { MAP_DIR, parseMapFile } from '../../src/main/lantern-parse';
import type { ParsedRecord } from '../../src/main/lantern-parse';
import { PLATFORMS_FILE, parsePlatforms } from '../../src/main/lantern-platforms';
import { parsePrRecord } from '../../src/main/lantern-pr-parse';

const FIXTURE_ROOT = path.join(__dirname, '..', 'fixtures', 'lantern-macro');
const REPO_ROOT = path.join(__dirname, '..', '..');

function mapFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return mapFiles(full);
    return entry.name.endsWith('.lantern') ? [full] : [];
  });
}

function macroFixtureRecords(): ParsedRecord[] {
  return mapFiles(path.join(FIXTURE_ROOT, MAP_DIR)).flatMap((file) => parseMapFile(fs.readFileSync(file, 'utf8'), path.relative(FIXTURE_ROOT, file)).records);
}

function macroFixtureOptions() {
  return { platforms: parsePlatforms(fs.readFileSync(path.join(FIXTURE_ROOT, PLATFORMS_FILE), 'utf8'), []) };
}

function macroFixtureView(): MacroView {
  return deriveMacroView(macroFixtureRecords(), macroFixtureOptions());
}

function macroFixtureBlocks() {
  return macroBlocksByPath(macroFixtureRecords(), macroFixtureOptions());
}

const REPO_FEATURE_TEXTS = path.join(REPO_ROOT, '.lantern', 'lang', 'en', 'features.json');

const PINNED_SNAPSHOT_ALIASES: Record<string, string> = { 'skills-management': 'skill-installer', 'lantern-map': 'file-graph' };

// The pinned research snapshot still names some features by their old ids; the repo renamed them.
function repoFeatureTexts(): Record<string, string> {
  const texts: Record<string, string> = JSON.parse(fs.readFileSync(REPO_FEATURE_TEXTS, 'utf8')).text;
  const aliased = Object.entries(PINNED_SNAPSHOT_ALIASES).map(([old, current]) => [old, texts[current]]);
  return { ...texts, ...Object.fromEntries(aliased) };
}

function repoPrRecord(id: string) {
  const parsed = parsePrRecord(fs.readFileSync(path.join(FIXTURE_ROOT, 'prs', `${id}.pr`), 'utf8'), `${id}.pr`);
  if (!parsed.pr) throw new Error(`PR record ${id}: ${parsed.error}`);
  return parsed.pr;
}

export { FIXTURE_ROOT, macroFixtureBlocks, macroFixtureOptions, macroFixtureRecords, macroFixtureView, repoFeatureTexts, repoPrRecord };
