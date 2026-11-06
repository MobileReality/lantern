export function stopChild(child, signal = 'SIGTERM') {
  const pid = child.pid;
  if (!Number.isInteger(pid) || pid <= 1) return false;
  if (child.exitCode !== null || child.signalCode !== null) return false;
  return child.kill(signal);
}

export function waitForLine(child, pattern, timeoutMs) {
  return new Promise((resolve, reject) => {
    let seen = '';
    const timer = setTimeout(() => reject(new Error(`no line matching ${pattern} within ${timeoutMs} ms, saw: ${seen.trim()}`)), timeoutMs);
    child.stdout.on('data', (chunk) => {
      seen += chunk;
      const match = seen.match(pattern);
      if (!match) return;
      clearTimeout(timer);
      resolve(match);
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`child exited with ${code} before printing ${pattern}: ${seen.trim()}`));
    });
  });
}
