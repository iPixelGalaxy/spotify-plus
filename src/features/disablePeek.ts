import { SETTINGS_CHANGED_EVENT, getSettings } from "../config";

const EXTRA_CONTROLS_SELECTOR = ".main-nowPlayingBar-extraControls";
const PLAYBAR_SELECTOR = '[data-testid="now-playing-bar"], .Root__now-playing-bar';
const LYRICS_BUTTON_SELECTOR = 'button[data-testid="lyrics-button"]';
const QUEUE_BUTTON_SELECTOR = 'button[data-testid="control-button-queue"]';
const PLAYBAR_ANCHOR_SELECTOR =
  `${LYRICS_BUTTON_SELECTOR}, ${QUEUE_BUTTON_SELECTOR}, button[data-testid="pip-toggle-button"], button[data-testid="fullscreen-mode-button"]`;
const PROXY_SELECTOR = 'button[data-spotify-plus-disable-peek="true"]';
const MAIN_VIEW_SELECTOR = '#main-view, .Root__main-view';
const NOW_PLAYING_VIEW_SELECTOR =
  'aside[aria-label="Now playing view" i], aside.NowPlayingView, aside:has([data-testid="NPV_Panel_OpenDiv"])';
const PANEL_SELECTOR = `#Desktop_PanelContainer_Id, ${NOW_PLAYING_VIEW_SELECTOR}`;
const PEEK_CONTENT_SELECTOR = '.Root__right-sidebar-peekContent, [aria-hidden], [inert], [hidden]';
const SHOW_BUTTON_SELECTOR =
  'button.Root__right-sidebar-overlayButton, button[aria-label="Show Now Playing view" i]';
const PANEL_CLOSE_BUTTON_SELECTOR = '[data-testid="PanelHeader_CloseButton"] button';
const HIDE_BUTTON_SELECTOR =
  `button.main-nowPlayingView-headerCloseButton, button[aria-label="Hide Now Playing view" i], ${PANEL_CLOSE_BUTTON_SELECTOR}`;
const NATIVE_PLAYBAR_BUTTON_SELECTOR =
  `button[data-testid="control-button-npv"]:not(${PROXY_SELECTOR}), button[data-testid="cover-art-button"]`;
const STRUCTURAL_SELECTOR =
  `${PANEL_SELECTOR}, ${PLAYBAR_SELECTOR}, ${PLAYBAR_ANCHOR_SELECTOR}, ${EXTRA_CONTROLS_SELECTOR}, ${MAIN_VIEW_SELECTOR}, ${SHOW_BUTTON_SELECTOR}`;
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
let observedControls: HTMLElement | null = null;
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

function findSidebar() {
  const panel = document.querySelector<HTMLElement>(PANEL_SELECTOR);
  if (!panel) return null;

  const mappedSidebar = panel.closest<HTMLElement>('.Root__right-sidebar');
  if (mappedSidebar) return mappedSidebar;

  const mainView = document.querySelector<HTMLElement>(MAIN_VIEW_SELECTOR);
  let ancestor: HTMLElement | null = panel;
  while (ancestor && ancestor !== document.body) {
    // The sidebar and main view share the layout parent, even when classes change.
    if (mainView && ancestor.parentElement === mainView.parentElement) {
      return ancestor !== mainView && !ancestor.contains(mainView) ? ancestor : null;
    }
    ancestor = ancestor.parentElement;
  }

  // A detached layout can still expose the peek content and its show button.
  const content = panel.closest<HTMLElement>(PEEK_CONTENT_SELECTOR);
  const wrapper = content?.parentElement;
  return wrapper?.querySelector(SHOW_BUTTON_SELECTOR) && !wrapper.contains(mainView)
    ? wrapper
    : null;
}

function findPeekContent(sidebar: HTMLElement) {
  const panel = sidebar.querySelector<HTMLElement>(PANEL_SELECTOR);
  const content = panel?.closest<HTMLElement>(PEEK_CONTENT_SELECTOR);
  return content && sidebar.contains(content) && content !== sidebar ? content : null;
}

function isPeekHidden(sidebar: HTMLElement) {
  let ancestor = sidebar.querySelector<HTMLElement>(PANEL_SELECTOR);
  while (ancestor && ancestor !== sidebar) {
    if (ancestor.matches('[aria-hidden="true"], [inert], [hidden]')) return true;
    ancestor = ancestor.parentElement;
  }
  return Boolean(
    sidebar.matches('.Root__right-sidebar-peek.Root__right-sidebar-collapsed') ||
    sidebar.querySelector('.Root__right-sidebar-peek.Root__right-sidebar-collapsed')
  );
}

function isQueueOpen() {
  return [...document.querySelectorAll<HTMLButtonElement>(QUEUE_BUTTON_SELECTOR)].some(
    (button) => button.getAttribute("aria-pressed") === "true" || button.dataset.active === "true"
  );
}

function isNowPlayingOpen() {
  // Spotify retains the previous panel DOM while Queue is entering.
  if (isQueueOpen()) return false;
  return [...document.querySelectorAll<HTMLElement>(NOW_PLAYING_VIEW_SELECTOR)].some(
    (view) =>
      !view.closest('[aria-hidden="true"], [inert], [hidden], .Root__right-sidebar-collapsed')
  );
}

function setProxyOpenState(open: boolean) {
  if (!proxyButton) return;

  const element = proxyButton.element;
  element.setAttribute("aria-pressed", open ? "true" : "false");
  element.dataset.active = open ? "true" : "false";
  element.classList.toggle("main-genericButton-buttonActive", open);
  element.classList.toggle("main-genericButton-buttonActiveDot", open);
}

function setProxyState() {
  setProxyOpenState(desiredOpen ?? isNowPlayingOpen());
}

function delay(milliseconds: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, milliseconds);
  });
}

function isNativeButtonAvailable(button: HTMLButtonElement) {
  return button.isConnected && !button.disabled &&
    button.getAttribute("aria-disabled") !== "true" &&
    !button.closest('[inert], [aria-hidden="true"], [hidden]');
}

function findNativeNowPlayingToggle() {
  const sidebar = findSidebar();
  const candidates = [...(sidebar ?? document).querySelectorAll<HTMLButtonElement>(SHOW_BUTTON_SELECTOR)];
  if (sidebar) {
    const content = findPeekContent(sidebar);
    // The overlay is the only button outside the panel; its label is localized.
    const overlayButtons = [...sidebar.querySelectorAll<HTMLButtonElement>('button')]
      .filter((candidate) => content && !content.contains(candidate));
    if (overlayButtons.length === 1) candidates.push(overlayButtons[0]);
  }
  const playbar = document.querySelector<HTMLElement>(PLAYBAR_SELECTOR);
  candidates.push(...(playbar ?? document).querySelectorAll<HTMLButtonElement>(NATIVE_PLAYBAR_BUTTON_SELECTOR));
  return candidates.find(isNativeButtonAvailable) ?? null;
}

async function waitForNativeButton(targetOpen: boolean, epoch: number) {
  const deadline = performance.now() + BUTTON_WAIT_TIMEOUT;

  while (
    epoch === transitionEpoch &&
    isEnabled() &&
    proxyButton &&
    desiredOpen === targetOpen &&
    performance.now() < deadline
  ) {
    const view = document.querySelector<HTMLElement>(NOW_PLAYING_VIEW_SELECTOR);
    const hideButton = targetOpen || !view ? null :
      [...view.querySelectorAll<HTMLButtonElement>(HIDE_BUTTON_SELECTOR)].find(isNativeButtonAvailable);
    const button = hideButton ?? findNativeNowPlayingToggle();
    if (button) return button;
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

function cancelTransition() {
  transitionEpoch += 1;
  desiredOpen = null;
  transitionRunner = null;
}

function onQueueClick(event: MouseEvent) {
  if (!isEnabled() || !(event.target instanceof Element)) return;

  const button = event.target.closest<HTMLButtonElement>('button');
  if (!button || !isNativeButtonAvailable(button)) return;
  const queueOpen = isQueueOpen();
  const queueButton = button.matches(QUEUE_BUTTON_SELECTOR);
  const queueCloseButton = queueOpen && button.matches(PANEL_CLOSE_BUTTON_SELECTOR) &&
    findSidebar()?.contains(button);
  if (!queueButton && !queueCloseButton) return;

  cancelTransition();
  setProxyOpenState(false);
  if (!queueOpen) return;

  const toggle = findNativeNowPlayingToggle();
  if (!toggle) return;

  event.preventDefault();
  event.stopImmediatePropagation();
  // Native Queue close restores the previous panel. Two synchronous NPV toggles
  // instead move Queue to Now Playing, then Disabled, before the browser paints.
  toggle.click();
  (findNativeNowPlayingToggle() ?? toggle).click();
  if (event.detail > 0) button.blur();
  else document.querySelector<HTMLButtonElement>(QUEUE_BUTTON_SELECTOR)?.focus({ preventScroll: true });
  scheduleSync();
}

function toggleNowPlayingView(event: MouseEvent) {
  if (event.detail > 0 && event.currentTarget instanceof HTMLElement) {
    event.currentTarget.blur();
  }

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
  proxyButton.element.setAttribute("aria-label", "Now playing view");
  proxyButton.element.setAttribute("aria-pressed", "false");
  proxyButton.element.addEventListener("click", toggleNowPlayingView);
  proxyButton.register();
}

function styleProxyButton(nativeButton: HTMLButtonElement) {
  if (!proxyButton) return;

  const element = proxyButton.element;
  const open = element.dataset.active === "true";
  element.className = nativeButton.className;
  element.classList.remove("main-nowPlayingBar-lyricsButton");
  element.dataset.encoreId = nativeButton.dataset.encoreId ?? "buttonTertiary";

  const wrapper = element.firstElementChild;
  const nativeWrapper = nativeButton.firstElementChild;
  if (wrapper instanceof HTMLElement && nativeWrapper instanceof HTMLElement) {
    wrapper.className = nativeWrapper.className;
    wrapper.setAttribute("aria-hidden", "true");
  }

  const icon = element.querySelector("svg");
  const nativeIcon = nativeButton.querySelector("svg");
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

  const playbar = document.querySelector<HTMLElement>(PLAYBAR_SELECTOR);
  const mappedControls = document.querySelector<HTMLElement>(EXTRA_CONTROLS_SELECTOR);
  const root = mappedControls ?? playbar ?? document;
  const nativeButton = root.querySelector<HTMLButtonElement>(LYRICS_BUTTON_SELECTOR) ??
    root.querySelector<HTMLButtonElement>(PLAYBAR_ANCHOR_SELECTOR);
  if (!nativeButton?.parentElement) return;

  let extraControls = mappedControls ?? nativeButton.parentElement;
  if (!mappedControls && !nativeButton.matches(LYRICS_BUTTON_SELECTOR)) {
    // Queue can have a drop-target wrapper. Find its shared control group.
    let parent: HTMLElement | null = extraControls;
    while (parent && parent !== playbar && parent !== document.body) {
      if (parent.querySelectorAll(PLAYBAR_ANCHOR_SELECTOR).length > 1) {
        extraControls = parent;
        break;
      }
      parent = parent.parentElement;
    }
  }
  observedControls = extraControls;
  const templateButton = [...extraControls.querySelectorAll<HTMLButtonElement>(PLAYBAR_ANCHOR_SELECTOR)]
    .find((candidate) => candidate.dataset.active !== "true" && candidate.getAttribute("aria-pressed") !== "true") ?? nativeButton;
  styleProxyButton(templateButton);

  let anchor: HTMLElement = nativeButton;
  while (anchor.parentElement && anchor.parentElement !== extraControls) {
    anchor = anchor.parentElement;
  }
  if (proxyButton.element.parentElement !== extraControls || proxyButton.element.nextElementSibling !== anchor) {
    extraControls.insertBefore(proxyButton.element, anchor);
  }
}

function removeProxyButton() {
  cancelTransition();
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
  const sidebar = findSidebar();
  if (sidebar) {
    const hidden = isPeekHidden(sidebar);
    if (sidebar.dataset.spotifyPlusPeekHidden !== String(hidden)) {
      sidebar.dataset.spotifyPlusPeekHidden = String(hidden);
    }
  }
  if (sidebar === observedSidebar) return;

  delete observedSidebar?.dataset.spotifyPlusPeekHidden;
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
            (mutation.target.matches(PANEL_SELECTOR) || Boolean(mutation.target.querySelector(PANEL_SELECTOR))))
        );
      }

      return [...mutation.addedNodes, ...mutation.removedNodes].some(
        (node) =>
          node instanceof Element &&
          (node.matches(PANEL_SELECTOR) || Boolean(node.querySelector(PANEL_SELECTOR)))
      );
    });

    if (relevant) scheduleSync();
  });
  sidebarObserver.observe(sidebar, {
    attributes: true,
    attributeFilter: ["class", "aria-hidden", "inert", "hidden"],
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
      if (mutation.target instanceof Element && mutation.target.closest(PROXY_SELECTOR)) {
        return false;
      }
      if (mutation.type === "attributes") {
        return mutation.target instanceof Element &&
          mutation.target.matches(STRUCTURAL_SELECTOR);
      }
      if (
        mutation.target === observedControls ||
        (mutation.target instanceof Element && mutation.target.matches(EXTRA_CONTROLS_SELECTOR))
      ) {
        return true;
      }

      return [...mutation.addedNodes, ...mutation.removedNodes].some(
        (node) =>
          node instanceof Element &&
          !node.matches(PROXY_SELECTOR) &&
          (node.matches(STRUCTURAL_SELECTOR) || Boolean(node.querySelector(STRUCTURAL_SELECTOR)))
      );
    });

    if (relevant) scheduleSync();
  });
  bodyObserver.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["class", "aria-label", "data-testid", "aria-pressed", "data-active"],
  });
}

function stopObservers() {
  sidebarObserver?.disconnect();
  sidebarObserver = null;
  delete observedSidebar?.dataset.spotifyPlusPeekHidden;
  observedSidebar = null;
  observedControls = null;
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
  document.addEventListener("click", onQueueClick, true);

  window.addEventListener(SETTINGS_CHANGED_EVENT, (event) => {
    const key = (event as CustomEvent<{ key?: string }>).detail?.key;
    if (key && key !== "disablePeek") return;
    syncDisablePeekMode();
  });
}
