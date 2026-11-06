const origin = process.env.LANTERN_TEST_HOST;
const realFetch = globalThis.fetch;

globalThis.fetch = (input, init) => {
  const url = new URL(String(input));
  return realFetch(`${origin}/${url.host}${url.pathname}${url.search}`, init);
};
