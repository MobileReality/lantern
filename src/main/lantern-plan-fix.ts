import fs from 'node:fs';
import path from 'node:path';
import { PLAN_DIR, parsePlanFile } from './lantern-plan';
import { isPlanFixTarget, planFixText } from '../shared/lantern-plan-fix';
import { VIEW, say } from '../shared/lantern-plan-messages';

const PLAN_SCRIPT = '.claude/skills/lantern-plan/scripts/plan.mjs';

function planFixTools(target: string) {
  const plan = `./${PLAN_DIR}/${target}`;
  return ['Read(./.lantern/**)', 'Read(./.claude/skills/lantern-plan*/**)', 'Read(./.claude/skills/lantern-setup/references/**)', `Edit(${plan})`, `Bash(node ${PLAN_SCRIPT} check:*)`];
}

function planFixPrompt(project: string, target: string | undefined): { prompt: string } | { error: string } {
  const file = target ?? '';
  if (!isPlanFixTarget(file)) return { error: say(VIEW.FIX_BAD_TARGET, { file }) };
  let source: string;
  try {
    source = fs.readFileSync(path.join(project, PLAN_DIR, file), 'utf8');
  } catch (e) {
    return { error: say(VIEW.FIX_UNREADABLE, { file: `${PLAN_DIR}/${file}`, error: (e as Error).message }) };
  }
  const parsed = parsePlanFile(source, file);
  if (parsed.plan && !parsed.problems.length) return { error: say(VIEW.FIX_NOTHING, { file: `${PLAN_DIR}/${file}` }) };
  return { prompt: planFixText({ file, problems: parsed.problems, error: parsed.error }) };
}

export { PLAN_SCRIPT, planFixPrompt, planFixTools };
