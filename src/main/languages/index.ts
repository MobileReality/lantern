import { chosenLanguage } from '../../shared/languages';
import type { Language } from '../../shared/languages';
import { projectSetting } from '../settings-store';

type LanguageKey = 'language.map' | 'language.explainers';

interface Sources {
  user: string | undefined;
  fallback: (project: string) => string | undefined;
}

// Undefined means nobody chose, so an existing map keeps its language.
function resolveLanguage(project: string, key: LanguageKey, { user, fallback }: Sources): Language | undefined {
  if (!project) return chosenLanguage(user);
  return chosenLanguage(projectSetting(project, key)) ?? chosenLanguage(user) ?? chosenLanguage(fallback(project));
}

export { resolveLanguage };
