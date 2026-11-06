declare module '*/lantern-delegate/scripts/skill-linker.mjs' {
  type SkillLinkerResolution = { path?: string; source?: string; repo?: string; error?: string; problem?: string; problemKind?: string; problemParams?: Record<string, string> };
  export function resolveSkillLinker(options?: { env?: Record<string, string | undefined>; home?: string }): SkillLinkerResolution;
  export const SKILLS_REPO_ENV: string;
  export const SKILL_LINKER_SOURCE: { readonly env: string; readonly config: string; readonly repo: string };
  export function resolveLinkerPath(configured: string, source?: string): SkillLinkerResolution;
}

declare module '*/lantern-delegate/scripts/bundled-skills.mjs' {
  export const BUNDLED_SKILLS: readonly string[];
  export const REQUIRED_SKILLS: readonly string[];
  export const ORCHESTRATOR_SKILLS: readonly string[];
  export const REVIEWER_SKILLS: readonly string[];
  export const ROLE_SKILLS: Readonly<Record<'delegate' | 'orchestrator' | 'reviewer', readonly string[]>>;
  export const SWITCHABLE_SKILLS: Readonly<Record<'delegate' | 'orchestrator' | 'reviewer', readonly string[]>>;
  export function switchableSkills(role: 'delegate' | 'orchestrator' | 'reviewer'): readonly string[];
  export function enabledSkills(role: 'delegate' | 'orchestrator' | 'reviewer', off?: readonly string[]): string[];
  export function alwaysOnSkills(role: 'delegate' | 'orchestrator' | 'reviewer'): string[];
  export function offEverywhere(off?: Partial<Record<'delegate' | 'orchestrator' | 'reviewer', readonly string[]>>): string[];
}

declare module '*/lantern-delegate/scripts/extensions.mjs' {
  export function projectRootOf(dir: string): string;
}

declare module '*/lantern-delegate/scripts/rtk-detect.mjs' {
  export function detectRtk(options?: { projectDirs?: string[]; loginShell?: boolean }): Promise<import('../shared/rtk').RtkStatus>;
}

declare module '*/lantern-plan/scripts/plan-flow.mjs' {
  export const FLOW: {
    readonly kinds: readonly string[];
    readonly textMax: number;
    readonly stories: number;
    readonly steps: number;
    readonly files: number;
    readonly arrow: string;
  };
  export const FLOW_TAGS: readonly string[];
  export function createFlowReader(deps: {
    say: (code: import('../shared/lantern-plan-messages').PlanMessageCode, params?: Record<string, string | number>) => string;
    ERROR: Record<string, import('../shared/lantern-plan-messages').PlanMessageCode>;
    NOUN: Record<string, import('../shared/lantern-plan-messages').PlanMessageCode>;
    decodePath: (token: string) => string;
  }): (question: { flow: import('./lantern-types').LanternFlowStory[] }, tag: string, raw: string) => string | null;
}

declare module '*/lantern-plan/scripts/plan-format.mjs' {
  export const PLAN_HEADER: string;
  export const PLAN_DIR: string;
  export const PLAN_EXT: string;
  export const PLAN_LEVEL: string;
  export const DIGEST_LENGTH: number;
  export const SLUG: RegExp;
  export const STAGE_ID: RegExp;
  export const ITEM_ID: RegExp;
  export const QUESTION_ID: RegExp;
  export const PLAN_REF: RegExp;
  export const WHO: RegExp;
  export const ISO_DATE: RegExp;
  export const DIGEST: RegExp;
  export function hasControlCharacter(text: string): boolean;
  export const TAG_LINE: RegExp;
  export const ID_LINE: RegExp;
  export const LIMITS: {
    readonly title: number;
    readonly goalLines: number;
    readonly goal: number;
    readonly scopeLines: number;
    readonly scope: number;
    readonly reason: number;
    readonly accept: number;
    readonly question: number;
    readonly answer: number;
    readonly explain: number;
    readonly explainLines: number;
    readonly risk: number;
    readonly risks: number;
  };
  export const TAG: {
    readonly TITLE: 'title';
    readonly OPENED: 'opened';
    readonly GOAL: 'goal';
    readonly SCOPE_IN: 'scope-in';
    readonly SCOPE_OUT: 'scope-out';
    readonly IMPACT: 'impact';
    readonly STAGE: 'stage';
    readonly ITEM: 'item';
    readonly TOUCH: 'touch';
    readonly ACCEPT: 'accept';
    readonly QUESTION: 'question';
    readonly ANSWER: 'answer';
    readonly EXPLAIN: 'explain';
    readonly STORY: 'story';
    readonly STEP: 'step';
    readonly BELOW: 'below';
    readonly FILE: 'file';
    readonly RISK: 'risk';
    readonly APPROVED: 'approved';
    readonly VERIFIED: 'verified';
    readonly PLAN: 'plan';
  };
  export const SECTION: { readonly TITLE: 'title'; readonly GOAL: 'goal'; readonly SCOPE: 'scope'; readonly IMPACT: 'impact'; readonly RISKS: 'risks' };
  export const SCOPE_SIDE: { readonly IN: 'in'; readonly OUT: 'out' };
  export const TARGET_KIND: { readonly AREA: 'area'; readonly FEATURE: 'feature'; readonly FILE: 'file'; readonly NEW: 'new' };
  export const ITEM_STATUS: { readonly PLANNED: 'planned'; readonly IN_PROGRESS: 'in progress'; readonly IMPLEMENTED: 'implemented'; readonly VERIFIED: 'verified' };
  export const SECTION_STATE: { readonly PENDING: 'pending'; readonly APPROVED: 'approved'; readonly STALE: 'stale' };
  export const PLAN_STATE: { readonly DRAFT: 'draft'; readonly APPROVED: 'approved'; readonly BROKEN: 'broken' };
  export const PR_STATE: { readonly OPEN: 'open'; readonly MERGED: 'merged'; readonly CLOSED: 'closed' };
  export const TARGET_KINDS: readonly ('area' | 'feature' | 'file' | 'new')[];
  export function tagLine(tag: string, ...parts: string[]): string;
  export function isIsoDate(value: string): boolean;
  export function isPathKind(kind: string): boolean;
}
