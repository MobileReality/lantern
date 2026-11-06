import { DEFAULT_INTENT, INTENT_IDS, copyTexts } from '../../../shared/lang/fix-requests';
import type { IntentId } from '../../../shared/lang/fix-requests';
import type { FixItem } from './model';

const PER_COMMENT = 'per-comment';
const CHOICE_KEY = 'lantern.copyIntent';

type CopyChoice = IntentId | typeof PER_COMMENT;

interface ChoiceBackend {
  load(): CopyChoice;
  save(choice: CopyChoice): void;
}

const COPY_CHOICES: readonly CopyChoice[] = [PER_COMMENT, ...INTENT_IDS];
const INTERFACE_TEXTS = copyTexts('en');

function intentLabel(id: IntentId) {
  return INTERFACE_TEXTS.intents[id].label;
}

function isCopyChoice(value: unknown): value is CopyChoice {
  return COPY_CHOICES.some((choice) => choice === value);
}

function intentOf(item: Pick<FixItem, 'intent'>, choice: CopyChoice): IntentId {
  if (item.intent) return item.intent;
  return choice === PER_COMMENT ? DEFAULT_INTENT : choice;
}

function choiceKey(project: string | undefined) {
  return `${CHOICE_KEY}|${project ?? ''}`;
}

function browserChoiceBackend(project: string | undefined): ChoiceBackend {
  const key = choiceKey(project);
  return {
    load() {
      try {
        const saved = localStorage.getItem(key);
        return isCopyChoice(saved) ? saved : PER_COMMENT;
      } catch {
        return PER_COMMENT;
      }
    },
    save(choice) {
      try {
        if (choice === PER_COMMENT) localStorage.removeItem(key);
        else localStorage.setItem(key, choice);
      } catch {
        return;
      }
    },
  };
}

export { COPY_CHOICES, PER_COMMENT, browserChoiceBackend, choiceKey, intentLabel, intentOf, isCopyChoice };
export type { ChoiceBackend, CopyChoice };
