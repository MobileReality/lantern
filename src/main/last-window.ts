const TRAY_DESKTOPS = ['kde', 'xfce', 'cinnamon', 'mate', 'budgie', 'unity', 'pantheon'];

interface QuitInputs {
  platform: NodeJS.Platform;
  trayAvailable: boolean;
}

interface TrayReachInputs {
  platform: NodeJS.Platform;
  trayCreated: boolean;
  env: NodeJS.ProcessEnv;
}

interface LastWindowDeps {
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
  trayCreated: () => boolean;
  isQuitting: () => boolean;
  quit: () => void;
}

function desktopHostsTray(env: NodeJS.ProcessEnv) {
  const names = (env.XDG_CURRENT_DESKTOP ?? '').toLowerCase().split(':');
  return names.some((name) => TRAY_DESKTOPS.some((desktop) => name.includes(desktop)));
}

function trayReachable({ platform, trayCreated, env }: TrayReachInputs) {
  if (!trayCreated) return false;
  return platform === 'linux' ? desktopHostsTray(env) : true;
}

function shouldQuitWhenAllWindowsClosed({ platform, trayAvailable }: QuitInputs) {
  if (platform === 'darwin') return false;
  return !trayAvailable;
}

function createLastWindowHandler(deps: LastWindowDeps) {
  return () => {
    if (deps.isQuitting()) return;
    const trayAvailable = trayReachable({ platform: deps.platform, trayCreated: deps.trayCreated(), env: deps.env });
    if (shouldQuitWhenAllWindowsClosed({ platform: deps.platform, trayAvailable })) deps.quit();
  };
}

export { shouldQuitWhenAllWindowsClosed, trayReachable, desktopHostsTray, createLastWindowHandler };
