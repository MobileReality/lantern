const LOOPBACK_HOST = '127.0.0.1';

export const GRANTED_PERMISSIONS: ReadonlySet<string> = new Set([
  'media',
  'microphone',
  'audioCapture',
  'videoCapture',
  'clipboard-read',
  'clipboard-sanitized-write',
  'notifications',
]);

const MICROPHONE_POLICY = 'microphone=*, camera=*, display-capture=*';

export function isServeWebUrl(url: string | undefined, port: number): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' && parsed.hostname === LOOPBACK_HOST && parsed.port === String(port);
  } catch {
    return false;
  }
}

const WEBVIEW_HOST_SUFFIX = '.vscode-cdn.net';

export function isServeWebWebviewUrl(url: string, port: number): boolean {
  if (isServeWebUrl(url, port)) return true;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && parsed.hostname.endsWith(WEBVIEW_HOST_SUFFIX);
  } catch {
    return false;
  }
}

export function isPermissionGranted(
  permission: string,
  port: number,
  pageUrl: string | undefined,
  ...frameUrls: Array<string | undefined>
): boolean {
  if (!GRANTED_PERMISSIONS.has(permission) || !isServeWebUrl(pageUrl, port)) return false;
  return frameUrls.every((url) => url === undefined || isServeWebWebviewUrl(url, port));
}

export function withMicrophonePolicy(
  headers: Record<string, string[]>,
  responseUrl: string,
  port: number,
): Record<string, string[]> {
  if (!isServeWebUrl(responseUrl, port)) return headers;
  const hasPolicy = Object.keys(headers).some((name) => /^(permissions-policy|feature-policy)$/i.test(name));
  return hasPolicy ? headers : { ...headers, 'Permissions-Policy': [MICROPHONE_POLICY] };
}
