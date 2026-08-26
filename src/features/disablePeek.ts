import { SETTINGS_CHANGED_EVENT, getSettings } from "../config";

const EXTRA_CONTROLS_SELECTOR = ".main-nowPlayingBar-extraControls";
const LYRICS_BUTTON_SELECTOR = 'button[data-testid="lyrics-button"]';
const PROXY_SELECTOR = 'button[data-spotify-plus-disable-peek="true"]';
const RIGHT_SIDEBAR_SELECTOR = ".Root__right-sidebar";
const RIGHT_SIDEBAR_STATE_SELECTOR = ".Root__right-sidebar-peek";
const SHOW_BUTTON_SELECTOR =
  '.Root__right-sidebar-overlayButton, button[aria-label="Show Now Playing view"]';
const HIDE_BUTTON_SELECTOR =
  '.main-nowPlayingView-headerCloseButton, button[aria-label="Hide Now Playing view"]';
const ENABLED_CLASS = "spotify-plus-disable-peek";
const BUTTON_WAIT_TIMEOUT = 1200;
const TRANSITION_TIMEOUT = 2500;
const NOW_PLAYING_ICON = `
  <svg height="16" width="16" viewBox="0 0 16 16" fill="currentColor">
    <path d="M11.196 8 6 5v6z"></path>
    <path d="M15.002 1.75A1.75 1.75 0 0 0 13.252 0h-10.5a1.75 1.75 0 0 0-1.75 1.75v12.5c0 .966.783 1.75 1.75 1.75h10.5a1.75 1.75 0 0 0 1.75-1.75zm-1.75-.25a.25.25 0 0 1 .25.25v12.5a.25.25 0 0 1-.25.25h-10.5a.25.25 0 0 1-.25-.25V1.75a.25.25 0 0 1 .25-.25z"></path>
  </svg>
`;

let proxyButton: Spicetify.Playbar.Button | null = null;
let observedSidebar: HTMLElement | null = null;
let sidebarObserver: MutationObserver | null = null;
let bodyObserver: MutationObserver | null = null;
let syncScheduled = false;
let desiredOpen: boolean | null = null;
let transitionRunner: Promise<void> | null = null;
let transitionEpoch = 0;
let pressSequence = 0;

function logInteraction(
  event: string,
  details: Record<string, unknown> = {}
) {
  console.info(`[Spotify+ Now Playing] ${event}`, {
    time: Math.round(performance.now()),
    actualOpen: isNowPlayingOpen(),
    desiredOpen,
    transitionRunning: Boolean(transitionRunner),
    ...details,
  });
}

function isEnabled() {
  return getSettings().disablePeek;
}

function isNowPlayingOpen() {
  const nowPlayingView = document.querySelector<HTMLElement>(
    'aside[aria-label="Now playing view"], .NowPlayingView'
  );
  return Boolean(nowPlayingView?.closest(".Root__right-sidebar-expanded"));
}

function setProxyOpenState(open: boolean) {
  if (!proxyButton) return;

  const element = proxyButton.element;
  element.setAttribute("aria-pressed", open ? "true" : "false");
  element.dataset.active = open ? "true" : "false";
  element.classList.toggle("main-genericButton-buttonActive", open);
  element.classList.remove("main-genericButton-buttonActiveDot");
}

function setProxyState() {
  setProxyOpenState(desiredOpen ?? isNowPlayingOpen());
}

function delay(milliseconds: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, milliseconds);
  });
}

async function waitForNativeButton(targetOpen: boolean, epoch: number) {
  const selector = targetOpen ? SHOW_BUTTON_SELECTOR : HIDE_BUTTON_SELECTOR;
  const deadline = performance.now() + BUTTON_WAIT_TIMEOUT;

  while (
    epoch === transitionEpoch &&
    isEnabled() &&
    proxyButton &&
    desiredOpen === targetOpen &&
    performance.now() < deadline
  ) {
    const button = document.querySelector<HTMLButtonElement>(selector);
    if (button?.isConnected) return button;
    await delay(50);
  }

  return null;
}

async function waitForNowPlayingState(targetOpen: boolean, epoch: number) {
  const deadline = performance.now() + TRANSITION_TIMEOUT;

  while (
    epoch === transitionEpoch &&
    isEnabled() &&
    proxyButton &&
    performance.now() < deadline
  ) {
    if (isNowPlayingOpen() === targetOpen) {
      await delay(100);
      if (isNowPlayingOpen() === targetOpen) return true;
    }
    await delay(25);
  }

  return false;
}

async function runTransitionQueue(epoch: number) {
  while (epoch === transitionEpoch && isEnabled() && proxyButton) {
    const targetOpen = desiredOpen;
    if (targetOpen === null) return;

    if (isNowPlayingOpen() === targetOpen) {
      desiredOpen = null;
      setProxyState();
      return;
    }

    const nativeButton = await waitForNativeButton(targetOpen, epoch);
    if (epoch !== transitionEpoch || !isEnabled() || !proxyButton) return;
    if (desiredOpen !== targetOpen) continue;

    if (!nativeButton) {
      logInteraction("native button unavailable", { targetOpen });
      desiredOpen = null;
      setProxyState();
      Spicetify.showNotification("Spotify+: Now Playing view is unavailable", true);
      return;
    }

    nativeButton.click();
    logInteraction("native button clicked", { targetOpen });
    const reachedTarget = await waitForNowPlayingState(targetOpen, epoch);
    if (epoch !== transitionEpoch || !isEnabled() || !proxyButton) return;

    if (!reachedTarget) {
      logInteraction("transition timed out", { targetOpen });
      if (desiredOpen === targetOpen) desiredOpen = null;
      setProxyState();
      return;
    }

    logInteraction("transition completed", { targetOpen });
    if (desiredOpen === targetOpen) desiredOpen = null;
    setProxyState();
  }
}

function startTransitionRunner() {
  if (transitionRunner) return;

  const epoch = transitionEpoch;
  transitionRunner = runTransitionQueue(epoch).finally(() => {
    if (epoch !== transitionEpoch) return;

    transitionRunner = null;
    setProxyState();
    if (desiredOpen !== null) startTransitionRunner();
  });
}

function toggleNowPlayingView() {
  const press = ++pressSequence;
  const queued = Boolean(transitionRunner);
  desiredOpen = !(desiredOpen ?? isNowPlayingOpen());

  logInteraction("button pressed", {
    press,
    accepted: true,
    queued,
  });

  setProxyState();
  if (!queued) {
    logInteraction("transition started", { press });
  }
  startTransitionRunner();
}

function installProxyButton() {
  if (proxyButton || !Spicetify.Playbar?.Button) return;

  proxyButton = new Spicetify.Playbar.Button(
    "Now playing view",
    NOW_PLAYING_ICON,
    undefined,
    false,
    false,
    false
  );
  proxyButton.element.dataset.spotifyPlusDisablePeek = "true";
  proxyButton.element.dataset.testid = "control-button-npv";
  proxyButton.element.dataset.restoreFocusKey = "now_playing_view";
  proxyButton.element.setAttribute("aria-pressed", "false");
  proxyButton.element.addEventListener("click", toggleNowPlayingView);
  proxyButton.register();
}

function styleProxyButton(lyricsButton: HTMLButtonElement) {
  if (!proxyButton) return;

  const element = proxyButton.element;
  const open = element.dataset.active === "true";
  element.className = lyricsButton.className;
  element.classList.remove("main-nowPlayingBar-lyricsButton");
  element.dataset.encoreId = lyricsButton.dataset.encoreId ?? "buttonTertiary";

  const wrapper = element.firstElementChild;
  const nativeWrapper = lyricsButton.firstElementChild;
  if (wrapper instanceof HTMLElement && nativeWrapper instanceof HTMLElement) {
    wrapper.className = nativeWrapper.className;
    wrapper.setAttribute("aria-hidden", "true");
  }

  const icon = element.querySelector("svg");
  const nativeIcon = lyricsButton.querySelector("svg");
  if (icon && nativeIcon) {
    icon.setAttribute("class", nativeIcon.getAttribute("class") ?? "");
    icon.setAttribute("style", nativeIcon.getAttribute("style") ?? "");
    icon.setAttribute("data-encore-id", nativeIcon.dataset.encoreId ?? "icon");
    icon.setAttribute("role", "img");
    icon.setAttribute("aria-hidden", "true");
  }

  setProxyOpenState(open);
}

function positionProxyButton() {
  if (!proxyButton) return;

  const extraControls = document.querySelector<HTMLElement>(EXTRA_CONTROLS_SELECTOR);
  const lyricsButton = extraControls?.querySelector<HTMLButtonElement>(LYRICS_BUTTON_SELECTOR);
  if (!extraControls || !lyricsButton) return;

  styleProxyButton(lyricsButton);

  if (proxyButton.element.parentElement !== extraControls || proxyButton.element.nextElementSibling !== lyricsButton) {
    extraControls.insertBefore(proxyButton.element, lyricsButton);
  }
}

function removeProxyButton() {
  transitionEpoch += 1;
  desiredOpen = null;
  transitionRunner = null;
  proxyButton?.deregister();
  proxyButton = null;
}

function scheduleSync() {
  if (syncScheduled) return;

  syncScheduled = true;
  requestAnimationFrame(() => {
    syncScheduled = false;
    syncDisablePeekMode();
  });
}

function observeSidebar() {
  const sidebar = document.querySelector<HTMLElement>(RIGHT_SIDEBAR_SELECTOR);
  if (sidebar === observedSidebar) return;

  sidebarObserver?.disconnect();
  sidebarObserver = null;
  observedSidebar = sidebar;

  if (!sidebar) return;

  sidebarObserver = new MutationObserver((mutations) => {
    const relevant = mutations.some((mutation) => {
      if (mutation.type === "attributes") {
        return (
          mutation.target === sidebar ||
          (mutation.target instanceof Element &&
            mutation.target.matches(RIGHT_SIDEBAR_STATE_SELECTOR))
        );
      }

      if (mutation.target === sidebar) return true;
      return [...mutation.addedNodes, ...mutation.removedNodes].some(
        (node) =>
          node instanceof Element &&
          (node.matches(RIGHT_SIDEBAR_STATE_SELECTOR) ||
            Boolean(node.querySelector(RIGHT_SIDEBAR_STATE_SELECTOR)))
      );
    });

    if (relevant) scheduleSync();
  });
  sidebarObserver.observe(sidebar, {
    attributes: true,
    attributeFilter: ["class"],
    childList: true,
    subtree: true,
  });
}

function startBodyObserver() {
  if (bodyObserver) return;

  bodyObserver = new MutationObserver((mutations) => {
    if (observedSidebar && !observedSidebar.isConnected) {
      scheduleSync();
      return;
    }

    if (proxyButton && !proxyButton.element.isConnected) {
      scheduleSync();
      return;
    }

    const relevant = mutations.some((mutation) => {
      if (
        mutation.target instanceof Element &&
        mutation.target.matches(EXTRA_CONTROLS_SELECTOR)
      ) {
        return true;
      }

      return [...mutation.addedNodes, ...mutation.removedNodes].some(
        (node) =>
          node instanceof Element &&
          (node.matches(`${RIGHT_SIDEBAR_SELECTOR}, ${EXTRA_CONTROLS_SELECTOR}`) ||
            Boolean(
              node.querySelector(
                `${RIGHT_SIDEBAR_SELECTOR}, ${EXTRA_CONTROLS_SELECTOR}`
              )
            ))
      );
    });

    if (relevant) scheduleSync();
  });
  bodyObserver.observe(document.body, {
    childList: true,
    subtree: true,
  });
}

function stopObservers() {
  sidebarObserver?.disconnect();
  sidebarObserver = null;
  observedSidebar = null;
  bodyObserver?.disconnect();
  bodyObserver = null;
}

function syncDisablePeekMode() {
  const enabled = isEnabled();
  document.documentElement.classList.toggle(ENABLED_CLASS, enabled);

  if (!enabled) {
    stopObservers();
    removeProxyButton();
    return;
  }

  observeSidebar();
  startBodyObserver();

  installProxyButton();
  positionProxyButton();
  setProxyState();
}

export function startDisablePeekController() {
  syncDisablePeekMode();

  window.addEventListener(SETTINGS_CHANGED_EVENT, (event) => {
    const key = (event as CustomEvent<{ key?: string }>).detail?.key;
    if (key && key !== "disablePeek") return;
    syncDisablePeekMode();
  });
}
