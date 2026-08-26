import { SETTINGS_CHANGED_EVENT, getSettings } from "../config";
import { toggleElementDisplay } from "../dom";

const PEEK_OVERLAY_SELECTOR = ".Root__right-sidebar-overlay";
const NATIVE_BUTTON_SELECTOR = 'button[data-testid="control-button-npv"]';
const EXTRA_CONTROLS_SELECTOR = ".main-nowPlayingBar-extraControls";
const LYRICS_BUTTON_SELECTOR = 'button[data-testid="lyrics-button"]';
const PROXY_SELECTOR = 'button[data-spotify-plus-disable-peek="true"]';

function isEnabled() {
  return getSettings().disablePeek;
}

function getNativeNowPlayingButton() {
  return Array.from(document.querySelectorAll<HTMLButtonElement>(NATIVE_BUTTON_SELECTOR)).find(
    (button) => !button.matches(PROXY_SELECTOR)
  );
}

function setProxyState(button: HTMLButtonElement) {
  const nativeButton = getNativeNowPlayingButton();
  const open = nativeButton?.getAttribute("aria-pressed") === "true";
  button.setAttribute("aria-pressed", open ? "true" : "false");
  button.dataset.active = open ? "true" : "false";
  button.classList.toggle("main-genericButton-buttonActive", open);
}

function createProxyButton(referenceButton: HTMLButtonElement) {
  const button = document.createElement("button");
  button.type = "button";
  button.dataset.spotifyPlusDisablePeek = "true";
  button.dataset.testid = "control-button-npv";
  button.dataset.encoreId = referenceButton.dataset.encoreId ?? "buttonTertiary";
  button.dataset.restoreFocusKey = "now_playing_view";
  button.className = referenceButton.className;
  button.setAttribute("aria-label", "Now playing view");
  button.innerHTML = `
    <span aria-hidden="true" class="e-10451-button__icon-wrapper">
      <svg data-encore-id="icon" role="img" aria-hidden="true" class="e-10451-icon" viewBox="0 0 16 16">
        <path d="M11.196 8 6 5v6z"></path>
        <path d="M15.002 1.75A1.75 1.75 0 0 0 13.252 0h-10.5a1.75 1.75 0 0 0-1.75 1.75v12.5c0 .966.783 1.75 1.75 1.75h10.5a1.75 1.75 0 0 0 1.75-1.75zm-1.75-.25a.25.25 0 0 1 .25.25v12.5a.25.25 0 0 1-.25.25h-10.5a.25.25 0 0 1-.25-.25V1.75a.25.25 0 0 1 .25-.25z"></path>
      </svg>
    </span>
  `;
  button.addEventListener("click", () => {
    const nativeButton = getNativeNowPlayingButton();
    if (nativeButton) {
      nativeButton.click();
    }
  });
  return button;
}

function installOldNowPlayingButton() {
  const extraControls = document.querySelector<HTMLElement>(EXTRA_CONTROLS_SELECTOR);
  const lyricsButton = extraControls?.querySelector<HTMLButtonElement>(LYRICS_BUTTON_SELECTOR);
  if (
    !extraControls ||
    !lyricsButton ||
    extraControls.querySelector(NATIVE_BUTTON_SELECTOR) ||
    extraControls.querySelector(PROXY_SELECTOR)
  ) {
    return;
  }

  const proxyButton = createProxyButton(lyricsButton);
  extraControls.insertBefore(proxyButton, lyricsButton);
  setProxyState(proxyButton);
}

function syncDisablePeekMode() {
  const enabled = isEnabled();
  for (const overlay of document.querySelectorAll<HTMLElement>(PEEK_OVERLAY_SELECTOR)) {
    toggleElementDisplay(overlay, enabled);
  }

  if (enabled) {
    installOldNowPlayingButton();
    for (const proxyButton of document.querySelectorAll<HTMLButtonElement>(PROXY_SELECTOR)) {
      setProxyState(proxyButton);
    }
    return;
  }

  for (const proxyButton of document.querySelectorAll(PROXY_SELECTOR)) {
    proxyButton.remove();
  }
}

export function startDisablePeekController() {
  syncDisablePeekMode();

  const observer = new MutationObserver(() => syncDisablePeekMode());
  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });

  window.addEventListener(SETTINGS_CHANGED_EVENT, (event) => {
    const key = (event as CustomEvent<{ key?: string }>).detail?.key;
    if (key && key !== "disablePeek") return;
    syncDisablePeekMode();
  });
}
