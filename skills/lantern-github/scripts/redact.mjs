const MASK = '[redacted]';
const AUTH_HEADER = /(authorization["']?\s*[:=]\s*["']?)(basic|bearer|token)\s+[^\s"',;]+/gi;
const URL_USERINFO = /(\b[a-z][a-z0-9+.-]*:\/\/)[^/\s@]+@/gi;

export function createRedactor(secrets) {
  const known = [...new Set(secrets.filter((secret) => typeof secret === 'string' && secret.length > 0))].sort((a, b) => b.length - a.length);
  return (text) =>
    known
      .reduce((safe, secret) => safe.split(secret).join(MASK), String(text))
      .replace(AUTH_HEADER, `$1$2 ${MASK}`)
      .replace(URL_USERINFO, `$1${MASK}@`);
}

export function basicSecrets(email, token) {
  if (!token) return [];
  return [token, encodeURIComponent(token), email ? Buffer.from(`${email}:${token}`).toString('base64') : ''];
}
