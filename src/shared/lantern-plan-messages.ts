import messages from '../../skills/lantern-plan/scripts/messages.json';

type Messages = typeof messages;
type Section = keyof Messages;
type Codes<S extends Section> = { [K in keyof Messages[S] & string]: `${S}.${K}` };
type PlanMessageCode = { [S in Section]: Codes<S>[keyof Codes<S>] }[Section];

const PLACEHOLDER = /\{(\w+)\}/g;

function codesOf<S extends Section>(section: S): Codes<S> {
  return Object.fromEntries(Object.keys(messages[section]).map((key) => [key, `${section}.${key}`])) as Codes<S>;
}

const ERROR = codesOf('error');
const WARNING = codesOf('warning');
const NOUN = codesOf('noun');
const LINE = codesOf('line');
const VIEW = codesOf('view');

function say(code: PlanMessageCode, params: Record<string, string | number> = {}) {
  const [section, key] = code.split('.') as [Section, string];
  const template = (messages[section] as Record<string, string>)[key];
  if (template === undefined) throw new Error(`no message ${code}`);
  return template.replace(PLACEHOLDER, (_, name: string) => {
    if (!Object.hasOwn(params, name)) throw new Error(`message ${code} needs {${name}}`);
    return String(params[name]);
  });
}

const located = (where: string, text: string) => say(LINE.LOCATED, { where, text });

export { ERROR, NOUN, VIEW, WARNING, located, say };
export type { PlanMessageCode };
