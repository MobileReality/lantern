import en from './en/messages.json';

type Catalogue = typeof en;

type Join<Path extends string, Key extends string> = Path extends '' ? Key : `${Path}.${Key}`;

type LeafKeys<Node, Path extends string = ''> = {
  [Key in keyof Node & string]: Node[Key] extends string ? Join<Path, Key> : Node[Key] extends readonly string[] ? never : LeafKeys<Node[Key], Join<Path, Key>>;
}[keyof Node & string];

type ListKeys<Node, Path extends string = ''> = {
  [Key in keyof Node & string]: Node[Key] extends readonly string[] ? Join<Path, Key> : Node[Key] extends string ? never : ListKeys<Node[Key], Join<Path, Key>>;
}[keyof Node & string];

type PluralKeys<Keys extends string, All extends string = Keys> = Keys extends `${infer Base}.one` ? (`${Base}.other` extends All ? Base : never) : never;

type MessageKey = LeafKeys<Catalogue>;
type MessageListKey = ListKeys<Catalogue>;
type MessageCountKey = PluralKeys<MessageKey>;
type MessageParams = Readonly<Record<string, string | number>>;
type MessageTables = Record<string, unknown>;

const DEFAULT_CODE = 'en';
const PLACEHOLDER = /\{(\w+)\}/g;
const BUNDLED: MessageTables = { en };

function valueAt(table: unknown, key: string): unknown {
  return key.split('.').reduce<unknown>((at, part) => (at !== null && typeof at === 'object' ? (at as Record<string, unknown>)[part] : undefined), table);
}

function fill(template: string, params: MessageParams = {}): string {
  return template.replace(PLACEHOLDER, (placeholder, name: string) => (Object.hasOwn(params, name) ? String(params[name]) : placeholder));
}

function tableFor(code: string | undefined, tables: MessageTables): unknown {
  const base = code?.trim().toLowerCase().split(/[-_]/)[0] ?? '';
  return Object.hasOwn(tables, base) ? tables[base] : undefined;
}

function createMessages(tables: MessageTables = BUNDLED, code: string = DEFAULT_CODE) {
  const chain = [tableFor(code, tables), tableFor(DEFAULT_CODE, tables)];
  const find = (key: string) => chain.map((table) => valueAt(table, key)).find((value) => value !== undefined && value !== '');

  const text = (key: string, params?: MessageParams): string => {
    const value = find(key);
    return typeof value === 'string' ? fill(value, params) : key;
  };

  const msg = (key: MessageKey, params?: MessageParams) => text(key, params);

  const msgList = (key: MessageListKey, params?: MessageParams): string[] => {
    const value = find(key);
    return Array.isArray(value) ? value.map((item) => fill(String(item), params)) : [];
  };

  const msgCount = (key: MessageCountKey, count: number, params?: MessageParams) => text(`${key}.${count === 1 ? 'one' : 'other'}`, { count, ...params });

  return { msg, msgList, msgCount };
}

const { msg, msgList, msgCount } = createMessages();

export { createMessages, msg, msgCount, msgList };
export type { MessageCountKey, MessageKey, MessageListKey, MessageParams, MessageTables };
