import { SETTINGS_CHANGED_EVENT, getSettings } from "../config";

const TITLE_APPLY_INTERVAL_MS = 1000;
const APP_TITLE_READY_RETRY_MS = 250;

let titleApplyInterval = 0;
let readyRetryTimeout = 0;
let titleObserver: MutationObserver | null = null;
let activeTitle = "";
let appTitleClear: (() => void) | null = null;
let applySequence = 0;

function getForcedTitle() {
  const settings = getSettings();
  if (!settings.forceWindowTitle) {
    return "";
  }

  return settings.windowTitle.trim() || "Spotify";
}

function clearAppTitleHandle() {
  try {
    appTitleClear?.();
  } catch {
    // Best effort only; Spotify may invalidate old title handles.
  }
  appTitleClear = null;
}

async function applyForcedTitle() {
  const title = activeTitle;
  if (!title) {
    return;
  }

  const appTitle = Spicetify.AppTitle;
  if (!appTitle?.set || !appTitle.reset) {
    return;
  }

  const sequence = ++applySequence;
  try {
    await appTitle.reset();
    const handle = await appTitle.set(title);
    if (sequence !== applySequence || activeTitle !== title) {
      handle?.clear?.();
      return;
    }

    clearAppTitleHandle();
    appTitleClear = handle?.clear ?? null;
    document.title = title;
  } catch {
    document.title = title;
  }
}

function stopForcingTitle() {
  window.clearInterval(titleApplyInterval);
  window.clearTimeout(readyRetryTimeout);
  titleApplyInterval = 0;
  readyRetryTimeout = 0;
  activeTitle = "";
  applySequence += 1;
  clearAppTitleHandle();
  titleObserver?.disconnect();
  titleObserver = null;
  void Spicetify.AppTitle?.reset?.();
}

function ensureTitleObserver() {
  if (titleObserver) {
    return;
  }

  const titleElement = document.querySelector("title");
  if (!titleElement) {
    return;
  }

  titleObserver = new MutationObserver(() => {
    if (activeTitle && document.title !== activeTitle) {
      void applyForcedTitle();
    }
  });
  titleObserver.observe(titleElement, { childList: true });
}

function startForcingTitle(title: string) {
  activeTitle = title;
  ensureTitleObserver();
  void applyForcedTitle();

  if (!titleApplyInterval) {
    titleApplyInterval = window.setInterval(() => {
      if (document.title !== activeTitle) {
        void applyForcedTitle();
        return;
      }

      void applyForcedTitle();
    }, TITLE_APPLY_INTERVAL_MS);
  }
}

function refreshWindowTitleController() {
  const title = getForcedTitle();
  if (!title) {
    stopForcingTitle();
    return;
  }

  if (!Spicetify.AppTitle?.set || !Spicetify.AppTitle.reset) {
    window.clearTimeout(readyRetryTimeout);
    readyRetryTimeout = window.setTimeout(
      refreshWindowTitleController,
      APP_TITLE_READY_RETRY_MS
    );
    return;
  }

  if (activeTitle !== title) {
    startForcingTitle(title);
    return;
  }

  ensureTitleObserver();
  void applyForcedTitle();
}

function onSettingsChanged(event: Event) {
  const key = (event as CustomEvent<{ key?: string }>).detail?.key;
  if (key !== "forceWindowTitle" && key !== "windowTitle") {
    return;
  }

  refreshWindowTitleController();
}

export function startWindowTitleController() {
  refreshWindowTitleController();
  window.addEventListener(SETTINGS_CHANGED_EVENT, onSettingsChanged);
  window.addEventListener("focus", refreshWindowTitleController);
}
