import { PLAN_DIR, PLAN_EXT } from '../../skills/lantern-plan/scripts/plan-format.mjs';
import { VIEW, say } from './lantern-plan-messages';

interface PlanFixSubject {
  file: string;
  problems: readonly string[];
  error: string | null;
}

interface LanternBrokenPlan {
  file: string;
  slug: string;
  error: string;
  warning: string;
}

const PLAN_FIX_TARGET = new RegExp(`^[A-Za-z0-9][A-Za-z0-9_-]*${PLAN_EXT.replace('.', '\\.')}$`);

const isPlanFixTarget = (file: string) => PLAN_FIX_TARGET.test(file);

const slugOf = (file: string) => (file.endsWith(PLAN_EXT) ? file.slice(0, -PLAN_EXT.length) : file);

const pathOf = (file: string) => `${PLAN_DIR}/${file}`;

function brokenPlan(file: string, error: string): LanternBrokenPlan {
  return { file, slug: slugOf(file), error, warning: say(VIEW.BROKEN_FILE, { file: pathOf(file), error }) };
}

function problemLines(problems: readonly string[]) {
  const head = say(problems.length === 1 ? VIEW.FIX_PROBLEMS_ONE : VIEW.FIX_PROBLEMS_MANY, { count: problems.length });
  return [head, ...problems.map((text) => say(VIEW.FIX_PROBLEM, { text }))].join('\n');
}

function planFixText({ file, problems, error }: PlanFixSubject) {
  const slug = slugOf(file);
  const where = pathOf(file);
  return [
    say(VIEW.FIX_HEADER, { slug, file: where }),
    [say(VIEW.FIX_FILE, { file: where }), say(VIEW.FIX_SLUG, { slug })].join('\n'),
    ...(error ? [say(VIEW.FIX_ERROR, { error })] : []),
    ...(problems.length ? [problemLines(problems)] : []),
    say(VIEW.FIX_TASK, { file: where, slug }),
  ].join('\n\n');
}

export { brokenPlan, isPlanFixTarget, pathOf, planFixText, slugOf };
export type { LanternBrokenPlan, PlanFixSubject };
