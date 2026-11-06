import { message } from './messages.mjs';

const TIMEOUT_MS = 30_000;
const DETAIL_LIMIT = 300;
const HINTS = Object.freeze({ 401: 'http.hint.401', 403: 'http.hint.403', 404: 'http.hint.404' });

export class SkillError extends Error {}

const parseJson = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

export function createHttp({ fetch, redact }) {
  async function request(method, url, { headers = {}, body } = {}) {
    let response;
    try {
      response = await fetch(url, {
        method,
        headers: body === undefined ? headers : { ...headers, 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (cause) {
      throw new SkillError(message('http.unreachable', { host: new URL(url).host, reason: redact(String(cause?.message ?? cause)) }));
    }
    const text = await response.text();
    return { status: response.status, ok: response.ok, text, detail: redact(text).slice(0, DETAIL_LIMIT), data: parseJson(text) };
  }
  return { request };
}

export function ensureOk(result, action) {
  if (result.ok) return result;
  const hint = HINTS[result.status] ? ` ${message(HINTS[result.status])}` : '';
  throw new SkillError(message('http.refused', { action, status: result.status, hint, detail: result.detail }));
}
