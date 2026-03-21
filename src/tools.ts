import {
  SETTINGS_CHANGED_EVENT,
  getSettings,
  setSetting,
} from "./config";

const LAST_LOCATION_KEY = "spotify-plus.last-location";

type StoredLocation = {
  pathname: string;
  search: string;
  hash: string;
};

type HistoryLike = {
  listen?: (listener: () => void) => () => void;
  push?: (...args: unknown[]) => unknown;
  replace?: (...args: unknown[]) => unknown;
  location?: Partial<StoredLocation>;
};

let restoreUnsubscribe: (() => void) | null = null;
let restoreRetryTimer: number | null = null;
let restorePatchedHistory:
  | {
      history: HistoryLike;
      push?: HistoryLike["push"];
      replace?: HistoryLike["replace"];
      popstate: () => void;
      hashchange: () => void;
    }
  | null = null;
let hasRestoredSession = false;
let pendingRestoreTarget: string | null = null;
let keydownBound = false;
let devtoolsRetryTimer: number | null = null;
let devtoolsRetryAttempts = 0;
let hasPrimedDevtoolsSetting = false;

const RESTORE_RETRY_INTERVAL_MS = 500;
const RESTORE_RETRY_MAX_ATTEMPTS = 20;
const DEVTOOLS_RETRY_INTERVAL_MS = 1000;
const DEVTOOLS_RETRY_MAX_ATTEMPTS = 20;

function ensureDeveloperModePersisted() {
  const globalWindow = window as Window & {
    require?: (id: string) => unknown;
    process?: { env?: Record<string, string | undefined> };
  };

  if (typeof globalWindow.require !== "function") {
    return;
  }

  try {
    const fs = globalWindow.require("fs") as {
      existsSync: (path: string) => boolean;
      mkdirSync: (path: string, options?: { recursive?: boolean }) => void;
      readFileSync: (path: string, encoding: string) => string;
      writeFileSync: (path: string, data: string, encoding: string) => void;
    };
    const path = globalWindow.require("path") as {
      dirname: (path: string) => string;
      join: (...parts: string[]) => string;
    };
    const os = globalWindow.require("os") as { homedir: () => string };

    const appData =
      globalWindow.process?.env?.APPDATA ??
      path.join(os.homedir(), "AppData", "Roaming");
    const prefsPath = path.join(appData, "Spotify", "prefs");
    const prefsDir = path.dirname(prefsPath);

    if (!fs.existsSync(prefsDir)) {
      fs.mkdirSync(prefsDir, { recursive: true });
    }

    if (!fs.existsSync(prefsPath)) {
      fs.writeFileSync(prefsPath, "app.enable-developer-mode=true\n", "utf8");
      return;
    }

    const prefsContent = fs.readFileSync(prefsPath, "utf8");
    if (prefsContent.includes("app.enable-developer-mode=true")) {
      return;
    }

    if (/^app\.enable-developer-mode=.*$/m.test(prefsContent)) {
      fs.writeFileSync(
        prefsPath,
        prefsContent.replace(
          /^app\.enable-developer-mode=.*$/m,
          "app.enable-developer-mode=true"
        ),
        "utf8"
      );
      return;
    }

    const separator =
      prefsContent.length === 0 || prefsContent.endsWith("\n") ? "" : "\n";
    fs.writeFileSync(
      prefsPath,
      `${prefsContent}${separator}app.enable-developer-mode=true\n`,
      "utf8"
    );
  } catch {
    // Best effort only. Spotify runtime environments vary.
  }
}

function tryOpenDevtools() {
  const globalWindow = window as Window & {
    electron?: { webFrame?: { openDevTools?: () => unknown } };
    require?: (id: string) => unknown;
  };

  const tryRequire = (id: string) => {
    try {
      return typeof globalWindow.require === "function" ? globalWindow.require(id) : null;
    } catch {
      return null;
    }
  };

  const electronModule = tryRequire("electron") as
    | {
        webFrame?: { openDevTools?: () => unknown };
        remote?: {
          getCurrentWebContents?: () => { openDevTools?: (options?: unknown) => unknown };
          getCurrentWindow?: () => {
            webContents?: { openDevTools?: (options?: unknown) => unknown };
          };
        };
      }
    | null;
  const electronRemoteModule = tryRequire("@electron/remote") as
    | {
        getCurrentWebContents?: () => { openDevTools?: (options?: unknown) => unknown };
        getCurrentWindow?: () => {
          webContents?: { openDevTools?: (options?: unknown) => unknown };
        };
      }
    | null;

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
    electronModule?.webFrame?.openDevTools,
    () => electronModule?.remote?.getCurrentWebContents?.()?.openDevTools?.({ mode: "detach" }),
    () => electronModule?.remote?.getCurrentWindow?.()?.webContents?.openDevTools?.({ mode: "detach" }),
    () => electronRemoteModule?.getCurrentWebContents?.()?.openDevTools?.({ mode: "detach" }),
    () => electronRemoteModule?.getCurrentWindow?.()?.webContents?.openDevTools?.({ mode: "detach" }),
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

function resetDevtoolsRetryState() {
  devtoolsRetryAttempts = 0;
  if (devtoolsRetryTimer !== null) {
    window.clearTimeout(devtoolsRetryTimer);
    devtoolsRetryTimer = null;
  }
}

function primeDevtoolsSetting() {
  if (hasPrimedDevtoolsSetting) {
    return;
  }

  hasPrimedDevtoolsSetting = true;
  setSetting("enableDevtoolsOnStartup", false);
  setSetting("enableDevtoolsOnStartup", true);
}

function getHistory(): HistoryLike | null {
  return (Spicetify.Platform?.History as HistoryLike | undefined) ?? null;
}

function toLocationSnapshot(location: Partial<StoredLocation> | null | undefined): StoredLocation | null {
  if (!location?.pathname) return null;

  return {
    pathname: location.pathname,
    search: location.search ?? "",
    hash: location.hash ?? "",
  };
}

function readStoredLocation(): StoredLocation | null {
  const raw = Spicetify.LocalStorage.get(LAST_LOCATION_KEY);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as StoredLocation;
    return toLocationSnapshot(parsed);
  } catch {
    return null;
  }
}

function writeStoredLocation(location: Partial<StoredLocation> | null | undefined) {
  const snapshot = toLocationSnapshot(location);
  if (!snapshot) {
    return;
  }

  const currentPath = currentPathWithSearchAndHash(snapshot);
  if (pendingRestoreTarget && currentPath !== pendingRestoreTarget) {
    return;
  }

  if (pendingRestoreTarget && currentPath === pendingRestoreTarget) {
    clearPendingRestoreTarget();
  }

  Spicetify.LocalStorage.set(LAST_LOCATION_KEY, JSON.stringify(snapshot));
}

function currentPathWithSearchAndHash(location: StoredLocation) {
  return `${location.pathname}${location.search}${location.hash}`;
}

function clearPendingRestoreTarget() {
  pendingRestoreTarget = null;

  if (restoreRetryTimer !== null) {
    window.clearTimeout(restoreRetryTimer);
    restoreRetryTimer = null;
  }
}

function scheduleRestoreRetry(target: string, attempt: number) {
  if (restoreRetryTimer !== null) {
    window.clearTimeout(restoreRetryTimer);
  }

  restoreRetryTimer = window.setTimeout(() => {
    const history = getHistory();
    const current = toLocationSnapshot(history?.location);

    if (!history?.replace || !current) {
      clearPendingRestoreTarget();
      return;
    }

    if (currentPathWithSearchAndHash(current) === target) {
      clearPendingRestoreTarget();
      return;
    }

    if (attempt >= RESTORE_RETRY_MAX_ATTEMPTS) {
      clearPendingRestoreTarget();
      return;
    }

    history.replace(target);
    scheduleRestoreRetry(target, attempt + 1);
  }, RESTORE_RETRY_INTERVAL_MS);
}

function restorePreviousSessionOnce() {
  if (hasRestoredSession) return;
  hasRestoredSession = true;

  const history = getHistory();
  const current = toLocationSnapshot(history?.location);
  const stored = readStoredLocation();

  if (!history?.replace || !current || !stored) return;
  if (currentPathWithSearchAndHash(current) === currentPathWithSearchAndHash(stored)) return;

  const target = currentPathWithSearchAndHash(stored);
  pendingRestoreTarget = target;
  history.replace(target);
  scheduleRestoreRetry(target, 1);
}

function attachRestoreTracking() {
  const history = getHistory();
  if (!history || restoreUnsubscribe || restorePatchedHistory) return;

  const captureLocation = () => {
    writeStoredLocation(getHistory()?.location);
  };

  if (typeof history.listen === "function") {
    restoreUnsubscribe = history.listen(() => {
      captureLocation();
    });
    return;
  }

  const popstate = () => {
    captureLocation();
  };
  const hashchange = () => {
    captureLocation();
  };

  restorePatchedHistory = {
    history,
    push: history.push,
    replace: history.replace,
    popstate,
    hashchange,
  };

  if (typeof history.push === "function") {
    history.push = (...args: unknown[]) => {
      const result = restorePatchedHistory?.push?.(...args);
      queueMicrotask(captureLocation);
      return result;
    };
  }

  if (typeof history.replace === "function") {
    history.replace = (...args: unknown[]) => {
      const result = restorePatchedHistory?.replace?.(...args);
      queueMicrotask(captureLocation);
      return result;
    };
  }

  window.addEventListener("popstate", popstate);
  window.addEventListener("hashchange", hashchange);
}

function onToolKeydown(event: KeyboardEvent) {
  const tagName = (event.target as HTMLElement | null)?.tagName?.toLowerCase();
  const isEditableTarget =
    tagName === "input" ||
    tagName === "textarea" ||
    (event.target as HTMLElement | null)?.isContentEditable === true;

  if (isEditableTarget) return;

  if (event.key === "F5") {
    event.preventDefault();
    window.location.reload();
    return;
  }

  if (event.key === "F8") {
    event.preventDefault();
    Function("debugger")();
  }
}

export function startToolsController() {
  primeDevtoolsSetting();

  const settings = getSettings();

  if (settings.enableDevtoolsOnStartup) {
    ensureDeveloperModePersisted();
    resetDevtoolsRetryState();
    if (!tryOpenDevtools()) {
      scheduleDevtoolsRetry();
    }
  } else {
    resetDevtoolsRetryState();
  }

  restorePreviousSessionOnce();
  attachRestoreTracking();

  if (!keydownBound) {
    window.addEventListener("keydown", onToolKeydown, true);
    keydownBound = true;
  }

  window.addEventListener(SETTINGS_CHANGED_EVENT, (event) => {
    const key = (event as CustomEvent<{ key?: string }>).detail?.key;
    if (key !== "enableDevtoolsOnStartup") {
      return;
    }

    const updatedSettings = getSettings();
    if (updatedSettings.enableDevtoolsOnStartup) {
      ensureDeveloperModePersisted();
      resetDevtoolsRetryState();
      if (!tryOpenDevtools()) {
        scheduleDevtoolsRetry();
      }
      return;
    }

    resetDevtoolsRetryState();
  });
}
