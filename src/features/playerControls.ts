import {
  SETTINGS_CHANGED_EVENT,
  getSettings,
  type SpotifyPlusSettings,
} from "../config";
import { normalizeText, toggleElementDisplay } from "../dom";

interface PlayerButtonTarget {
  key: keyof Pick<
    ReturnType<typeof getSettings>,
    "hideFriendActivityButton" | "hideMiniplayerButton"
  >;
  matchers: string[];
}

const playerTargets: PlayerButtonTarget[] = [
  {
    key: "hideFriendActivityButton",
    matchers: ["friend activity", "buddy feed"],
  },
  {
    key: "hideMiniplayerButton",
    matchers: ["miniplayer", "mini player"],
  },
];

const playerCleanupKeys: Array<
  keyof Pick<
    SpotifyPlusSettings,
    "hideFriendActivityButton" | "hideLyricsButton" | "hideMiniplayerButton"
  >
> = [
  "hideFriendActivityButton",
  "hideLyricsButton",
  "hideMiniplayerButton",
];

let observer: MutationObserver | null = null;
let hasAppliedCleanup = false;

const HIDE_LYRICS_CLASS = "spotify-plus-hide-lyrics-button";

function elementTextBlob(element: Element) {
  return ` ${normalizeText(
    [
      element.getAttribute("aria-label"),
      element.getAttribute("title"),
      element.getAttribute("data-testid"),
      element.getAttribute("data-tooltip"),
      element.textContent,
    ]
      .filter(Boolean)
      .join(" ")
  )} `;
}

function hasActivePlayerCleanup(
  settings: Pick<
    SpotifyPlusSettings,
    "hideFriendActivityButton" | "hideMiniplayerButton"
  >
) {
  return settings.hideFriendActivityButton || settings.hideMiniplayerButton;
}

function syncLyricsButtonClass(settings = getSettings()) {
  document.documentElement.classList.toggle(
    HIDE_LYRICS_CLASS,
    settings.hideLyricsButton
  );
}

function restoreLegacySpicyLyricsButtons() {
  const spicyLyricsButtons = new Set<HTMLElement>();

  for (const selector of [
    "#SpicyLyrics_PopupLyricsButton",
    "#SpicyLyrics_FullscreenButton",
  ]) {
    const button = document.querySelector<HTMLElement>(selector);
    if (button) {
      spicyLyricsButtons.add(button);
    }
  }

  const pageButton = document
    .querySelector<HTMLElement>("#SpicyLyricsPageSvg")
    ?.closest<HTMLElement>("button");
  if (pageButton) {
    spicyLyricsButtons.add(pageButton);
  }

  for (const button of spicyLyricsButtons) {
    if ("spotifyPlusOriginalDisplay" in button.dataset) {
      toggleElementDisplay(button, false);
    }
  }
}

function applyPlayerButtonCleanup(settings = getSettings()) {
  const candidates = Array.from(document.querySelectorAll<HTMLElement>("button, a"));

  for (const element of candidates) {
    const blob = elementTextBlob(element);
    if (!blob) continue;

    for (const target of playerTargets) {
      if (!target.matchers.some((matcher) => blob.includes(matcher))) continue;
      toggleElementDisplay(element, settings[target.key]);
    }
  }

  hasAppliedCleanup = true;
}

function resetPlayerButtonCleanup() {
  const candidates = Array.from(document.querySelectorAll<HTMLElement>("button, a"));

  for (const element of candidates) {
    const blob = elementTextBlob(element);
    if (!blob) continue;

    for (const target of playerTargets) {
      if (!target.matchers.some((matcher) => blob.includes(matcher))) continue;
      toggleElementDisplay(element, false);
    }
  }

  hasAppliedCleanup = false;
}

function refreshPlayerControlsController() {
  const settings = getSettings();
  syncLyricsButtonClass(settings);
  restoreLegacySpicyLyricsButtons();

  const active = hasActivePlayerCleanup(settings);

  if (active) {
    applyPlayerButtonCleanup(settings);
    if (observer) return;

    observer = new MutationObserver(() => {
      applyPlayerButtonCleanup();
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["aria-label", "title", "data-testid", "data-tooltip"],
    });
    return;
  }

  observer?.disconnect();
  observer = null;

  if (hasAppliedCleanup) {
    resetPlayerButtonCleanup();
  }
}

function onSettingsChanged(event: Event) {
  const key = (event as CustomEvent<{ key?: string }>).detail?.key;
  if (!key || !playerCleanupKeys.includes(key as (typeof playerCleanupKeys)[number])) {
    return;
  }

  refreshPlayerControlsController();
}

export function startPlayerControlsController() {
  refreshPlayerControlsController();
  window.addEventListener(SETTINGS_CHANGED_EVENT, onSettingsChanged);
}
