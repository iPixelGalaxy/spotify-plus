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
  selectors?: string[];
}

const playerTargets: PlayerButtonTarget[] = [
  {
    key: "hideFriendActivityButton",
    matchers: ["friend activity", "buddy feed"],
    selectors: ['[data-restore-focus-key="buddy_feed"]'],
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
let cleanupFrame: number | null = null;
const cleanupTargets = new Set<HTMLElement>();
const pendingControls = new Set<HTMLElement>();
const addedRoots = new Set<Element>();
const candidateSelector = ["button", "a", ...playerTargets.flatMap((target) => target.selectors ?? [])].join(", ");

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

function matchingTargets(element: HTMLElement) {
  const blob = elementTextBlob(element);
  return playerTargets.filter((target) =>
    target.selectors?.some((selector) => element.matches(selector)) ||
    (element.matches("button, a") && target.matchers.some((matcher) => blob.includes(matcher)))
  );
}

function applyControl(element: HTMLElement, settings: SpotifyPlusSettings) {
  const targets = matchingTargets(element);
  if (targets.length) {
    cleanupTargets.add(element);
    toggleElementDisplay(element, targets.some((target) => settings[target.key]));
  } else if (cleanupTargets.delete(element)) {
    toggleElementDisplay(element, false);
  }
}

function queueControl(element: Element | null) {
  const control = element?.closest<HTMLElement>(candidateSelector);
  // Volume labels change frequently, but only cleanup targets need a frame.
  if (control && (cleanupTargets.has(control) || matchingTargets(control).length)) {
    pendingControls.add(control);
  }
}

function flushPlayerButtonCleanup() {
  cleanupFrame = null;
  const settings = getSettings();
  for (const root of addedRoots) {
    if (!root.isConnected) continue;
    // A parent addition already covers any separately reported descendants.
    let parent = root.parentElement;
    while (parent && !addedRoots.has(parent)) parent = parent.parentElement;
    if (parent) continue;
    queueControl(root);
    for (const control of root.querySelectorAll<HTMLElement>(candidateSelector)) {
      queueControl(control);
    }
  }
  addedRoots.clear();
  for (const control of pendingControls) {
    if (control.isConnected) applyControl(control, settings);
  }
  pendingControls.clear();
  for (const control of cleanupTargets) {
    if (!control.isConnected) {
      toggleElementDisplay(control, false);
      cleanupTargets.delete(control);
    }
  }
}

function onPlayerControlMutations(mutations: MutationRecord[]) {
  for (const mutation of mutations) {
    const element = mutation.target instanceof Element ? mutation.target : mutation.target.parentElement;
    queueControl(element);
    for (const node of mutation.addedNodes) {
      if (node instanceof Element && (node.matches(candidateSelector) || node.querySelector(candidateSelector))) {
        addedRoots.add(node);
      }
    }
  }
  const hasDetachedTargets = [...cleanupTargets].some((control) => !control.isConnected);
  if (cleanupFrame === null && (pendingControls.size || addedRoots.size || hasDetachedTargets)) {
    cleanupFrame = window.requestAnimationFrame(flushPlayerButtonCleanup);
  }
}

function refreshPlayerControlsController() {
  const settings = getSettings();
  syncLyricsButtonClass(settings);
  restoreLegacySpicyLyricsButtons();

  if (observer) {
    for (const control of cleanupTargets) applyControl(control, settings);
    return;
  }

  // Scan once; subsequent settings changes revisit only known cleanup targets.
  for (const control of document.querySelectorAll<HTMLElement>(candidateSelector)) {
    applyControl(control, settings);
  }
  observer = new MutationObserver(onPlayerControlMutations);
  observer.observe(document.body, {
    childList: true,
    characterData: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["aria-label", "title", "data-testid", "data-tooltip", "data-restore-focus-key"],
  });
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
