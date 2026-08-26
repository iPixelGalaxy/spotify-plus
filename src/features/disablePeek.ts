import { SETTINGS_CHANGED_EVENT, getSettings } from "../config";

const NATIVE_BUTTON_SELECTOR = 'button[data-testid="control-button-npv"]';
const EXTRA_CONTROLS_SELECTOR = ".main-nowPlayingBar-extraControls";
const LYRICS_BUTTON_SELECTOR = 'button[data-testid="lyrics-button"]';
const PROXY_SELECTOR = 'button[data-spotify-plus-disable-peek="true"]';
const RIGHT_SIDEBAR_SELECTOR = ".Root__right-sidebar";
const COLLAPSED_PEEK_SELECTOR = ".Root__right-sidebar-peek.Root__right-sidebar-collapsed";
const HIDDEN_SIDEBAR_CLASS = "spotify-plus-hide-collapsed-right-sidebar";
const NOW_PLAYING_ICON = `
  <svg height="16" width="16" viewBox="0 0 16 16" fill="currentColor" stroke="currentColor">
    <path d="M11.196 8 6 5v6z"></path>
    <path d="M15.002 1.75A1.75 1.75 0 0 0 13.252 0h-10.5a1.75 1.75 0 0 0-1.75 1.75v12.5c0 .966.783 1.75 1.75 1.75h10.5a1.75 1.75 0 0 0 1.75-1.75zm-1.75-.25a.25.25 0 0 1 .25.25v12.5a.25.25 0 0 1-.25.25h-10.5a.25.25 0 0 1-.25-.25V1.75a.25.25 0 0 1 .25-.25z"></path>
  </svg>
`;

let proxyButton: Spicetify.Playbar.Button | null = null;

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

function setProxyState() {
  if (!proxyButton) return;

  const open = isNowPlayingOpen();
  const element = proxyButton.element;
  element.setAttribute("aria-pressed", open ? "true" : "false");
  element.dataset.active = open ? "true" : "false";
  element.classList.toggle("main-genericButton-buttonActive", open);
  element.classList.remove("main-genericButton-buttonActiveDot");
}

function toggleNowPlayingView() {
  const selector = isNowPlayingOpen()
    ? '.main-nowPlayingView-headerCloseButton, button[aria-label="Hide Now Playing view"]'
    : '.Root__right-sidebar-overlayButton, button[aria-label="Show Now Playing view"]';
  const nativeButton = document.querySelector<HTMLButtonElement>(selector);

  if (!nativeButton) {
    Spicetify.showNotification("Spotify+: Now Playing view is unavailable", true);
    return;
  }

  nativeButton.click();
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

function positionProxyButton() {
  if (!proxyButton) return;

  const extraControls = document.querySelector<HTMLElement>(EXTRA_CONTROLS_SELECTOR);
  const lyricsButton = extraControls?.querySelector<HTMLButtonElement>(LYRICS_BUTTON_SELECTOR);
  if (!extraControls || !lyricsButton) return;

  if (proxyButton.element.parentElement !== extraControls || proxyButton.element.nextElementSibling !== lyricsButton) {
    extraControls.insertBefore(proxyButton.element, lyricsButton);
  }
}

function removeProxyButton() {
  proxyButton?.deregister();
  proxyButton = null;
}

function syncSidebarVisibility(enabled: boolean) {
  for (const sidebar of document.querySelectorAll<HTMLElement>(RIGHT_SIDEBAR_SELECTOR)) {
    const collapsed = sidebar.matches(COLLAPSED_PEEK_SELECTOR) || Boolean(
      sidebar.querySelector(COLLAPSED_PEEK_SELECTOR)
    );
    sidebar.classList.toggle(HIDDEN_SIDEBAR_CLASS, enabled && collapsed);
  }
}

function syncDisablePeekMode() {
  const enabled = isEnabled();
  syncSidebarVisibility(enabled);

  if (!enabled) {
    removeProxyButton();
    return;
  }

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

  const observer = new MutationObserver(() => syncDisablePeekMode());
  observer.observe(document.body, {
    attributes: true,
    attributeFilter: ["class"],
    childList: true,
    subtree: true,
  });

  window.addEventListener(SETTINGS_CHANGED_EVENT, (event) => {
    const key = (event as CustomEvent<{ key?: string }>).detail?.key;
    if (key && key !== "disablePeek") return;
    syncDisablePeekMode();
  });
}
