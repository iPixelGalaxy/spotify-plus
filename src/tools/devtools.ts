import { SETTINGS_CHANGED_EVENT, getSettings } from "../config";

const DEVTOOLS_RETRY_INTERVAL_MS = 1000;
const DEVTOOLS_RETRY_MAX_ATTEMPTS = 20;

let devtoolsRetryTimer: number | null = null;
let devtoolsRetryAttempts = 0;
let settingsBound = false;

function tryOpenDevtools() {
  const globalWindow = window as Window & {
    electron?: { webFrame?: { openDevTools?: () => unknown } };
  };

  const candidates = [
    Spicetify.Platform?.PlatformClientAPI?.openDevTools,
    Spicetify.Platform?.PlatformClientAPI?.openDeveloperTools,
    Spicetify.Platform?.PlatformClientAPI?.showDevTools,
    Spicetify.Platform?.PlatformClientAPI?.showDeveloperTools,
    Spicetify.Platform?.DeveloperAPI?.openDevTools,
    Spicetify.Platform?.DeveloperAPI?.openDeveloperTools,
    Spicetify.Platform?.DeveloperAPI?.showDevTools,
    Spicetify.Platform?.DeveloperAPI?.showDeveloperTools,
    Spicetify.Platform?.NativeAPI?.openDevTools,
    Spicetify.Platform?.NativeAPI?.openDeveloperTools,
    Spicetify.Platform?.NativeAPI?.showDevTools,
    Spicetify.Platform?.NativeAPI?.showDeveloperTools,
    globalWindow.electron?.webFrame?.openDevTools,
  ].filter((candidate): candidate is () => unknown => typeof candidate === "function");

  for (const candidate of candidates) {
    try {
      candidate();
      return true;
    } catch {
      continue;
    }
  }

  return false;
}

function resetDevtoolsRetryState() {
  devtoolsRetryAttempts = 0;
  if (devtoolsRetryTimer !== null) {
    window.clearTimeout(devtoolsRetryTimer);
    devtoolsRetryTimer = null;
  }
}

function scheduleDevtoolsRetry() {
  if (devtoolsRetryTimer !== null || devtoolsRetryAttempts >= DEVTOOLS_RETRY_MAX_ATTEMPTS) {
    return;
  }

  devtoolsRetryTimer = window.setTimeout(() => {
    devtoolsRetryTimer = null;
    devtoolsRetryAttempts += 1;

    if (tryOpenDevtools()) {
      return;
    }

    scheduleDevtoolsRetry();
  }, DEVTOOLS_RETRY_INTERVAL_MS);
}

function refreshDevtoolsStartup() {
  const settings = getSettings();
  if (!settings.enableDevtoolsOnStartup) {
    resetDevtoolsRetryState();
    return;
  }

  resetDevtoolsRetryState();
  if (!tryOpenDevtools()) {
    scheduleDevtoolsRetry();
  }
}

function bindSettingsListener() {
  if (settingsBound) return;
  settingsBound = true;

  window.addEventListener(SETTINGS_CHANGED_EVENT, (event) => {
    const key = (event as CustomEvent<{ key?: string }>).detail?.key;
    if (key !== "enableDevtoolsOnStartup") {
      return;
    }
    refreshDevtoolsStartup();
  });
}

export function startDevtoolsTool() {
  // We can't reliably write `spicetify config always_enable_devtools` from inside
  // the browser extension, so keep best-effort runtime opening behavior.
  refreshDevtoolsStartup();
  bindSettingsListener();
}

