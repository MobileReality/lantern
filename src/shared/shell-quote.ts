export const shellQuote = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`;
