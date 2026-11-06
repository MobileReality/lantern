import type { LanternBrokenPlan } from '../shared/lantern-plan-fix';
import type { LanternPlanView } from './lantern-plan-view-types';

type Arrow = '>' | '<' | '=' | '@';
type Freshness = 'fresh' | 'gone';
type PlatformKind = 'web' | 'backend' | 'mobile' | 'desktop' | 'infra' | 'other';

interface LanternRelation {
  from: string;
  arrow: Arrow;
  to: string | null;
  ext: string | null;
  symbol: string | null;
  label: string;
}

interface LanternNode {
  path: string;
  dir: string;
  marker: string;
  owner: string | null;
  role: string;
  hash: string;
  purpose: string;
  freshness: Freshness;
  feature: string | null;
  seeAlso: string[];
  seeAlsoNote: string;
  gotcha: string | null;
  platform: string | null;
  prNew?: true;
  planNew?: true;
}

interface LanternFeature {
  id: string;
  description: string;
}

interface LanternPlatform {
  id: string;
  kind: PlatformKind | 'shared';
  label: string;
  count: number;
}

interface LanternLanguage {
  primary: string;
  code: string;
  available: string[];
  fallbackCount: number;
  fallbackKeys: string[];
}

interface LanternCite {
  path: string;
  symbol: string | null;
  mapped: boolean;
}

interface SectionBase {
  id: string;
  file: string;
  platform: string | null;
  title: string | null;
  intro: string | null;
}

interface RbacEntry {
  id: string;
  text: string;
  cites: LanternCite[];
}

interface RbacCell {
  role: string;
  resource: string;
  access: 'allow' | 'deny' | 'cond';
  text: string;
  cites: LanternCite[];
}

interface RbacSection extends SectionBase {
  type: 'rbac';
  roles: RbacEntry[];
  resources: RbacEntry[];
  cells: RbacCell[];
  sources: RbacEntry[];
  guards: RbacEntry[];
}

interface StateDef {
  id: string;
  text: string;
  initial: boolean;
  terminal: boolean;
  cites: LanternCite[];
}

interface StateTransition {
  from: string;
  to: string;
  text: string;
  cites: LanternCite[];
}

interface StateMachine {
  id: string;
  text: string;
  cites: LanternCite[];
  states: StateDef[];
  transitions: StateTransition[];
}

interface StatesSection extends SectionBase {
  type: 'states';
  machines: StateMachine[];
}

type DbOrigin = 'declared' | 'inferred';

interface DbField {
  name: string;
  type: string;
  origin: DbOrigin;
  text: string;
  cites: LanternCite[];
}

interface DbRelation {
  field: string;
  kind: 'ref' | 'fk' | 'embed';
  target: string;
  text: string;
  cites: LanternCite[];
}

interface DbEntity {
  id: string;
  kind: 'table' | 'collection' | 'view' | 'document' | 'other';
  origin: DbOrigin;
  text: string;
  cites: LanternCite[];
  owners: LanternCite[];
  fields: DbField[];
  relations: DbRelation[];
}

interface DbSection extends SectionBase {
  type: 'db';
  entities: DbEntity[];
}

interface FactItem {
  id: string;
  text: string;
  note: string;
  cites: LanternCite[];
}

interface FactsSection extends SectionBase {
  type: 'facts';
  items: FactItem[];
}

type LanternSection = RbacSection | StatesSection | DbSection | FactsSection;

type LanternPrFileKind = 'added' | 'modified' | 'removed';
type LanternPrState = 'open' | 'merged' | 'closed' | 'declined';

interface LanternPrFile {
  path: string;
  kind: LanternPrFileKind;
  mapped: boolean;
  reason?: string;
}

type LanternFlowKind = 'actor' | 'action' | 'subject' | 'interaction' | 'consequence';

type LanternFlowStep = ({ kind: Exclude<LanternFlowKind, 'consequence'>; text: string } | { kind: 'consequence'; old: string; new: string }) & { files?: string[] };

interface LanternFlowStory {
  title: string;
  steps: LanternFlowStep[];
  below: LanternFlowStep[];
}

type LanternPrDescriptionSection = 'what' | 'before' | 'after' | 'verified';
type LanternPrDescription = Partial<Record<LanternPrDescriptionSection, string[]>>;

interface LanternPrPlanRef {
  slug: string;
  item: string;
}

interface LanternPr {
  id: string;
  title: string;
  url: string;
  branch: string;
  base: string;
  opened: string;
  head: string;
  summary?: string;
  description?: LanternPrDescription;
  plans?: LanternPrPlanRef[];
  files: LanternPrFile[];
  ordered?: boolean;
  flow?: LanternFlowStory[];
  flowError?: string;
  state: LanternPrState;
  tip?: string;
  revision?: string;
  hostBase?: string;
  mergedAt?: string;
  source: 'tree' | 'remote' | 'local';
}

interface LanternPrOverlay {
  prId: string;
  tip: string;
  nodes: LanternNode[];
  relations: LanternRelation[];
  missing: string[];
  warnings: string[];
}

interface LanternMap {
  exists: boolean;
  project: string;
  nodes: LanternNode[];
  relations: LanternRelation[];
  errors: string[];
  unmapped: string[];
  unmappedCount: number;
  total: number;
  features: LanternFeature[];
  platforms: LanternPlatform[];
  sections: LanternSection[];
  warnings: string[];
  language: LanternLanguage;
  prs: LanternPr[];
  plans: LanternPlanView[];
  brokenPlans: LanternBrokenPlan[];
  coveragePending?: boolean;
}

interface LanternCoverage {
  unmapped: string[];
  unmappedCount: number;
  total: number;
}

export type {
  Arrow,
  DbEntity,
  DbField,
  DbOrigin,
  DbRelation,
  DbSection,
  FactItem,
  FactsSection,
  Freshness,
  LanternCite,
  LanternCoverage,
  LanternFeature,
  LanternFlowKind,
  LanternFlowStep,
  LanternFlowStory,
  LanternLanguage,
  LanternMap,
  LanternNode,
  LanternPlanView,
  LanternPr,
  LanternPrDescription,
  LanternPrDescriptionSection,
  LanternPrFile,
  LanternPrFileKind,
  LanternPrOverlay,
  LanternPrPlanRef,
  LanternPrState,
  LanternPlatform,
  LanternRelation,
  LanternSection,
  PlatformKind,
  RbacCell,
  RbacEntry,
  RbacSection,
  SectionBase,
  StateDef,
  StateMachine,
  StatesSection,
  StateTransition,
};
