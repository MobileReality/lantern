import fs from 'node:fs';
import path from 'node:path';
import { PLAN_DIR, PLAN_EXT, parsePlanFile } from './lantern-plan';
import { planView } from './lantern-plan-view';
import type { LanternPlanView } from './lantern-plan-view-types';
import type { LanternPr } from './lantern-types';
import { brokenPlan } from '../shared/lantern-plan-fix';
import type { LanternBrokenPlan } from '../shared/lantern-plan-fix';

interface PlansLoad {
  plans: LanternPlanView[];
  broken: LanternBrokenPlan[];
  warnings: string[];
}

interface PlanRead {
  plan: LanternPlanView | null;
  broken: LanternBrokenPlan | null;
}

async function planFileNames(root: string) {
  try {
    return (await fs.promises.readdir(path.join(root, PLAN_DIR))).filter((name) => name.endsWith(PLAN_EXT)).sort();
  } catch {
    return [];
  }
}

async function readPlan(root: string, name: string, prs: readonly LanternPr[]): Promise<PlanRead> {
  try {
    const parsed = parsePlanFile(await fs.promises.readFile(path.join(root, PLAN_DIR, name), 'utf8'), name);
    if (!parsed.plan) return { plan: null, broken: brokenPlan(name, parsed.error ?? '') };
    return { plan: planView(parsed.plan, prs, parsed.problems), broken: null };
  } catch (e) {
    return { plan: null, broken: brokenPlan(name, (e as Error).message) };
  }
}

async function loadPlans(projectPath: string, prs: readonly LanternPr[] = []): Promise<PlansLoad> {
  const root = path.resolve(projectPath);
  const read = await Promise.all((await planFileNames(root)).map((name) => readPlan(root, name, prs)));
  const broken = read.flatMap((one) => (one.broken ? [one.broken] : []));
  return {
    plans: read.flatMap((one) => (one.plan ? [one.plan] : [])),
    broken,
    warnings: broken.map((one) => one.warning),
  };
}

export { loadPlans };
export type { PlansLoad };
