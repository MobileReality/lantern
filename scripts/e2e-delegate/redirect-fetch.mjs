const REAL_API = 'https://api.bitbucket.org';
const port = process.env.MOCK_BB_PORT;

if (port) {
  const realFetch = globalThis.fetch;
  const mock = `http://127.0.0.1:${port}`;
  globalThis.fetch = (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.startsWith(`${REAL_API}/`)) return realFetch(mock + url.slice(REAL_API.length), init);
    return realFetch(input, init);
  };
}
