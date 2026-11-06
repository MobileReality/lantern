import { runLanguageCode } from './agent';
import { readExistingMapLang } from './lantern-texts';
import type { SetupProgress } from './setup-progress';
import type { SetupKind } from './settings';

interface SetupState {
  progress: SetupProgress | null;
  unfinished: SetupKind | null;
}

interface SetupDeps {
  project: string;
  language?: string;
  settings: { setupUnfinished(project: string): SetupKind | null; markSetup(project: string, kind: SetupKind | null): void };
  readProgress(project: string, languageCode: string, fresh?: boolean): Promise<SetupProgress | null>;
}

type ProgressMode = 'live' | 'fresh';

// The run screen asks for 'live' (cheap while .lantern/ is unchanged) or 'fresh' (re-read now).
// An idle check, the Lantern tab opening, passes no mode: it reads only for a project whose setup
// was started and never finished, so a finished map never pays for a plan.mjs run, and it may
// answer from the stamp cache.
async function readSetupState({ project, language, settings, readProgress, mode }: SetupDeps & { mode?: ProgressMode }): Promise<SetupState> {
  const unfinished = settings.setupUnfinished(project);
  if (!mode && !unfinished) return { progress: null, unfinished: null };
  const progress = await readProgress(project, runLanguageCode(language, readExistingMapLang(project)), mode === 'fresh');
  return { progress, unfinished };
}

// Called when a run reports success: a run that says "done" with chunks still pending (it ran out
// of budget, say) stays flagged, so the Lantern tab keeps offering Resume.
async function settleSetup({ project, language, settings, readProgress }: SetupDeps): Promise<boolean> {
  const progress = await readProgress(project, runLanguageCode(language, readExistingMapLang(project)), true);
  const complete = !!progress && progress.chunks.done === progress.chunks.total;
  if (complete) settings.markSetup(project, null);
  return complete;
}

export { readSetupState, settleSetup };
export type { SetupState, ProgressMode };
