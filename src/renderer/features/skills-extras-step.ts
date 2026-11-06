import { extraProblemMessage } from '@shared/extension-problem';
import { EXTENSION_SCOPES, type ExtensionScope, type ExtensionSlot } from '@shared/extension-slots';
import { msg } from '@shared/lang/messages';
import { el, footBtn } from '../lib/util';
import { scopeLabel, slotLabel } from './skills-rows';
import { segmentedControl } from './skills-segmented';

export interface AddSkillStep {
  project: string | null;
  slot: ExtensionSlot;
  taken: string[];
  locked: string[];
  scope: ExtensionScope;
  scoped: boolean;
  onBack: () => void;
  onSaved: () => void;
}

function field(label: string, control: HTMLElement) {
  const row = el('div', 'sk-set-input sk-set-stack');
  row.append(el('span', 'sk-set-label', label), control);
  return row;
}

export function renderAddSkillStep(body: HTMLElement, foot: HTMLElement, step: AddSkillStep) {
  let scope = step.scope;
  const name = Object.assign(el('input', 'sk-set-field'), { type: 'text', placeholder: msg('skillsExtras.step.namePlaceholder'), spellcheck: false });
  name.dataset.skillName = 'name';
  const content = Object.assign(el('textarea', 'sk-set-field sk-set-area'), { placeholder: msg('skillsExtras.step.contentPlaceholder'), spellcheck: false });
  content.dataset.skillContent = 'content';
  const error = el('div', 'sk-set-err hidden');
  error.setAttribute('role', 'alert');
  const wrap = el('div', 'sk-settings');
  wrap.dataset.addSkillStep = step.slot;
  wrap.append(el('div', 'sk-role-name sk-extras-title', msg('skillsExtras.step.title', { slot: slotLabel(step.slot) })), el('div', 'sk-set-note', msg('skillsExtras.step.hint')), field(msg('skillsExtras.step.name'), name));
  if (step.scoped) {
    const picker = el('div', 'sk-set-input sk-set-stack');
    const draw = () => {
      const control = segmentedControl({
        label: msg('skillsExtras.step.scope'),
        className: 'sk-scope-pick',
        zone: 'step-scope',
        value: scope,
        options: EXTENSION_SCOPES.map((value) => ({ value, label: scopeLabel(value), tip: msg(`skillsExtras.scope.${value}Tip`) })),
        onSelect: (value) => {
          scope = value;
          draw();
        },
      });
      picker.replaceChildren(el('span', 'sk-set-label', msg('skillsExtras.step.scope')), control);
    };
    draw();
    wrap.append(picker);
  }
  wrap.append(field(msg('skillsExtras.step.content'), content), error);
  body.replaceChildren(wrap);

  const fail = (text: string) => {
    error.textContent = text;
    error.classList.remove('hidden');
  };
  let busy = false;
  const save = footBtn(
    msg('skillsExtras.step.save'),
    async () => {
      if (busy) return;
      const skill = name.value.trim();
      const problem = skill ? extraProblemMessage([...step.taken, skill], step.locked) : msg('skillsExtras.step.nameRequired');
      if (problem) return fail(problem);
      busy = true;
      save.disabled = true;
      try {
        const panel = await window.ccmws.extensionsCreate(step.project, step.slot, skill, content.value, scope);
        if (panel.error) fail(panel.error);
        else step.onSaved();
      } catch (err) {
        fail(msg('skillsExtras.saveFailed', { reason: (err as Error).message }));
      } finally {
        busy = false;
        save.disabled = false;
      }
    },
    'btn-primary',
  );
  save.dataset.addSkillSave = 'save';
  const back = footBtn(msg('skillsExtras.step.back'), step.onBack);
  back.dataset.addSkillBack = 'back';
  foot.replaceChildren(save, el('span', 'spacer'), back);
  name.focus();
}
