import { SETTINGS_CHANGED_EVENT, getSettings } from "../config";

const NATIVE_BUTTON_SELECTOR = 'button[data-testid="control-button-npv"]';
const EXTRA_CONTROLS_SELECTOR = ".main-nowPlayingBar-extraControls";
const LYRICS_BUTTON_SELECTOR = 'button[data-testid="lyrics-button"]';
const PROXY_SELECTOR = 'button[data-spotify-plus-disable-peek="true"]';
const RIGHT_SIDEBAR_SELECTOR = ".Root__right-sidebar";
const ENABLED_CLASS = "spotify-plus-disable-peek";
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

function isEnabled() {
  return getSettings().disablePeek;
}

function getNativeNowPlayingButton() {
  return Array.from(document.querySelectorAll<HTMLButtonElement>(NATIVE_BUTTON_SELECTOR)).find(
    (button) => !button.matches(PROXY_SELECTOR)
  );
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
  setProxyOpenState(isNowPlayingOpen());
}

function setSidebarOpenState(open: boolean) {
  const sidebarState = document.querySelector<HTMLElement>(
    ".Root__right-sidebar-peek"
  );
  if (!sidebarState) return;

  sidebarState.classList.toggle("Root__right-sidebar-expanded", open);
  sidebarState.classList.toggle("Root__right-sidebar-collapsed", !open);
}

function toggleNowPlayingView() {
  const open = isNowPlayingOpen();
  const selector = open
    ? '.main-nowPlayingView-headerCloseButton, button[aria-label="Hide Now Playing view"]'
    : '.Root__right-sidebar-overlayButton, button[aria-label="Show Now Playing view"]';
  const nativeButton = document.querySelector<HTMLButtonElement>(selector);

  if (!nativeButton) {
    Spicetify.showNotification("Spotify+: Now Playing view is unavailable", true);
    return;
  }

  setProxyOpenState(!open);
  setSidebarOpenState(!open);
  nativeButton.click();
  window.setTimeout(setProxyState, 250);
}

function installProxyButton() {
  if (proxyButton || getNativeNowPlayingButton() || !Spicetify.Playbar?.Button) return;

  proxyButton = new Spicetify.Playbar.Button(
    "Now playing view",
    NOW_PLAYING_ICON,
    toggleNowPlayingView,
    false,
    false,
    false
  );
  proxyButton.element.dataset.spotifyPlusDisablePeek = "true";
  proxyButton.element.dataset.testid = "control-button-npv";
  proxyButton.element.dataset.restoreFocusKey = "now_playing_view";
  proxyButton.element.setAttribute("aria-pressed", "false");
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

  sidebarObserver = new MutationObserver(scheduleSync);
  sidebarObserver.observe(sidebar, {
    attributes: true,
    attributeFilter: ["class"],
    childList: true,
    subtree: true,
  });
}

function startBodyObserver() {
  if (bodyObserver) return;

  bodyObserver = new MutationObserver(scheduleSync);
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

  if (getNativeNowPlayingButton()) {
    removeProxyButton();
    return;
  }

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
