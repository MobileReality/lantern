import type { LanternPlanView } from '../../main/lantern-plan-view-types';
import { createCopyFeedback } from './lanternplancopy';
import { formatAsks, pendingAsks, planNotes, questionsOf } from './lanternplananswers';
import type { PlanNotes } from './lanternplananswers';
import { openQuestionModal } from './lanternplanquestion';
import type { QuestionModal } from './lanternplanquestion';

interface PlanAskOptions {
  host: HTMLElement;
  project: string;
  copy: (text: string) => Promise<void>;
  plan: () => LanternPlanView | undefined;
  onChange: () => void;
  onShow: (question: string) => void;
  onClose: (question: string) => void;
}

interface PlanAsk {
  notes(slug: string): PlanNotes;
  open(question: string): void;
  isOpen(): boolean;
  close(): void;
  copy(): Promise<boolean>;
  copied(): boolean;
  dispose(): void;
}

function createPlanAsk(options: PlanAskOptions): PlanAsk {
  let modal: QuestionModal | null = null;
  const feedback = createCopyFeedback(options.copy, () => {
    if (!modal) options.onChange();
  });
  const watched = new Map<string, () => void>();

  function watch(slug: string, notes: PlanNotes) {
    if (watched.has(slug)) return;
    watched.set(
      slug,
      notes.onChange(() => {
        if (!modal) options.onChange();
      }),
    );
  }

  const notesOf = (slug: string) => {
    const notes = planNotes(options.project, slug);
    watch(slug, notes);
    return notes;
  };

  async function copy(text?: string) {
    if (text !== undefined) return options.copy(text).then(() => true, () => false);
    const plan = options.plan();
    if (!plan) return false;
    const asks = pendingAsks(plan, notesOf(plan.slug).all());
    if (!asks.length) return false;
    return feedback.copy(formatAsks(plan, asks));
  }

  function close() {
    modal?.close();
  }

  return {
    notes: notesOf,
    open(id) {
      const plan = options.plan();
      const question = plan ? questionsOf(plan).find((each) => each.id === id) : undefined;
      if (!plan || !question) return;
      close();
      modal = openQuestionModal({
        host: options.host,
        plan,
        question,
        notes: notesOf(plan.slug),
        copy,
        onShow: () => options.onShow(id),
        onClose() {
          modal = null;
          options.onClose(id);
        },
      });
    },
    isOpen: () => modal !== null,
    close,
    copy,
    copied: feedback.copied,
    dispose() {
      feedback.dispose();
      close();
      for (const stop of watched.values()) stop();
      watched.clear();
    },
  };
}

export { createPlanAsk };
export type { PlanAsk, PlanAskOptions };
