import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const FIXTURES = pathToFileURL(path.join(REPO, 'scripts', 'skill-test', 'areas-fixtures.mjs')).href;
const DENIED = "Permission to use Bash has been denied. IMPORTANT: You *may* attempt to accomplish this action using other tools that might naturally be used to accomplish this goal, e.g. using head instead of cat.";

const emit = (line) => process.stdout.write(`${JSON.stringify(line)}\n`);
const say = (text) => emit({ type: 'assistant', message: { content: [{ type: 'text', text }] } });
const tool = (command, extra = {}) => emit({ type: 'assistant', ...extra, message: { content: [{ type: 'tool_use', id: `toolu_${Math.random().toString(36).slice(2, 10)}`, name: 'Bash', input: { command } }] } });

function lookupAnswer(input, env) {
  const project = env.FAKE_LANTERN_PROJECT;
  const texts = JSON.parse(fs.readFileSync(path.join(project, '.lantern', 'lang', 'en', 'features.json'), 'utf8')).text;
  const asked = input.split('Feature:\n')[1]?.split('\n')[0] ?? '';
  const feature = Object.keys(texts).find((id) => texts[id] === asked);
  let area = '';
  let answer = '';
  for (const raw of fs.readFileSync(path.join(project, '.lantern', 'areas'), 'utf8').split('\n')) {
    if (raw && !raw.startsWith(' ')) area = raw.trim();
    else if (raw.trim() === feature) answer = area;
  }
  process.stdout.write(JSON.stringify({ type: 'result', is_error: false, result: answer, total_cost_usd: 0.0001 }));
  return 0;
}

function node(skill, script, cwd, args) {
  const result = spawnSync(process.execPath, [path.join(skill, 'scripts', script), ...args], { cwd, encoding: 'utf8', env: process.env });
  return { status: result.status, out: `${result.stdout}${result.stderr}`.trim() };
}

async function areasLoop({ skill, cwd, prompt, fixtures }) {
  const scratch = prompt.match(/--out (\.lantern\/[\w./-]*[\w])/)?.[1];
  if (!scratch) throw new Error('the prompt names no scratch folder for the blind lookup');
  node(skill, 'areas.mjs', cwd, [cwd, 'propose']);
  fixtures.writeAreas(cwd, fixtures.TREES.five);
  const check = node(skill, 'areas.mjs', cwd, [cwd, 'check']);
  if (check.status !== 0) throw new Error(`areas check failed: ${check.out}`);
  if (process.env.CLAUDE_BIN !== process.argv[1]) throw new Error('CLAUDE_BIN does not name this binary, so the blind lookup would reach another claude');
  const lookup = node(skill, 'areas.mjs', cwd, [cwd, 'lookup', 'run', '--out', path.join(cwd, scratch)]);
  if (lookup.status !== 0) throw new Error(`blind lookup failed: ${lookup.out}`);
  say(`Areas written and checked; blind lookup: ${lookup.out.split('\n')[0]}`);
}

async function mainRun({ args, env }) {
  const prompt = args[args.indexOf('-p') + 1] ?? '';
  const cwd = process.cwd();
  const skill = env.FAKE_LANTERN_SKILL;
  const scenario = env.FAKE_LANTERN_SCENARIO || '';
  const fixtures = await import(FIXTURES);
  emit({ type: 'system', subtype: 'init' });
  say('Mapping the project.');
  if (scenario === 'worker-denied') {
    const worker = { parent_tool_use_id: 'toolu_agent_chunk_3' };
    const id = 'toolu_worker_bash_1';
    emit({ type: 'assistant', ...worker, message: { content: [{ type: 'tool_use', id, name: 'Bash', input: { command: 'cd /project; L=.claude/skills/lantern-setup; node $L/scripts/plan.mjs . chunk 3' } }] } });
    emit({ type: 'user', ...worker, message: { content: [{ type: 'tool_result', tool_use_id: id, is_error: true, content: DENIED }] } });
  }
  if (scenario === 'main-denied') {
    const id = 'toolu_main_bash_1';
    emit({ type: 'assistant', message: { content: [{ type: 'tool_use', id, name: 'Bash', input: { command: 'cd /project; for f in a b; do cat $f; done' } }] } });
    emit({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, is_error: true, content: "A variable in this command can't be checked before it runs" }] } });
  }
  const features = fs.readdirSync(path.join(cwd, 'src')).sort();
  fixtures.writeAreasMap(cwd, features);
  tool(`node ${skill}/scripts/areas.mjs ${cwd} required`);
  const needed = node(skill, 'areas.mjs', cwd, [cwd, 'required']).status === 1;
  const sawStep = prompt.includes('step 4a');
  if (needed && sawStep && scenario !== 'skip-areas') await areasLoop({ skill, cwd, prompt, fixtures });
  const finish = ['validate.mjs', cwd, '--settled', ...(scenario === 'skip-areas' || !prompt.includes('--require-areas') ? [] : ['--require-areas'])];
  tool(`node ${skill}/scripts/${finish[0]} ${finish.slice(1).join(' ')}`);
  const validated = node(skill, finish[0], cwd, finish.slice(1));
  say(validated.out.split('\n').slice(-3).join(' '));
  emit({ type: 'result', subtype: validated.status === 0 ? 'success' : 'error_during_execution', is_error: validated.status !== 0, total_cost_usd: 0.02, duration_ms: 5, permission_denials: [] });
  return 0;
}

export async function run({ args, input, env }) {
  const format = args[args.indexOf('--output-format') + 1];
  if (format === 'json') return lookupAnswer(input, env);
  return mainRun({ args, env });
}
