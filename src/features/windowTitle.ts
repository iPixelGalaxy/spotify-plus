import { SETTINGS_CHANGED_EVENT, getSettings } from "../config";

const TITLE_APPLY_INTERVAL_MS = 1000;
const APP_TITLE_READY_RETRY_MS = 250;
const SONG_CHANGE_GUARD_MS = 1200;
const SONG_CHANGE_GUARD_FRAME_COUNT = 90;

let titleApplyInterval = 0;
let readyRetryTimeout = 0;
let titleObserver: MutationObserver | null = null;
let activeTitle = "";
let appTitleClear: (() => void) | null = null;
let applySequence = 0;
let allowTitleWrite = false;
let appTitleAppliedFor = "";
let documentTitlePatched = false;
let appTitlePatched = false;
let originalDocumentTitleDescriptor: PropertyDescriptor | null = null;
let originalAppTitleSet: typeof Spicetify.AppTitle.set | null = null;
let originalAppTitleReset: typeof Spicetify.AppTitle.reset | null = null;
let domTitlePatched = false;
let playerListenerRegistered = false;
const originalDomTitleDescriptors = new Map<object, Map<PropertyKey, PropertyDescriptor>>();

function isTitleNode(node: unknown) {
  return (
    node instanceof HTMLTitleElement ||
    (node instanceof Node && node.parentElement instanceof HTMLTitleElement)
  );
}

function getPropertyDescriptor(target: object, key: PropertyKey) {
  let current: object | null = target;
  while (current) {
    const descriptor = Object.getOwnPropertyDescriptor(current, key);
    if (descriptor) {
      return descriptor;
    }
    current = Object.getPrototypeOf(current);
  }

  return null;
}

function rememberDescriptor(target: object, key: PropertyKey, descriptor: PropertyDescriptor) {
  const descriptors = originalDomTitleDescriptors.get(target) ?? new Map();
  if (!descriptors.has(key)) {
    descriptors.set(key, descriptor);
  }
  originalDomTitleDescriptors.set(target, descriptors);
}

function patchTitleDomSetter(target: object, key: PropertyKey) {
  const descriptor = getPropertyDescriptor(target, key);
  if (!descriptor?.set || !descriptor.configurable) {
    return;
  }

  rememberDescriptor(target, key, descriptor);

  Object.defineProperty(target, key, {
    configurable: true,
    enumerable: descriptor.enumerable,
    get() {
      return descriptor.get?.call(this);
    },
    set(value: string) {
      if (activeTitle && !allowTitleWrite && isTitleNode(this)) {
        return;
      }

      descriptor.set?.call(this, value);
    },
  });
}

function patchTitleDomMethod<T extends keyof Node>(
  target: Node,
  key: T,
  replacement: (original: Node[T], thisArg: Node, args: unknown[]) => unknown
) {
  const original = target[key];
  if (typeof original !== "function") {
    return;
  }

  rememberDescriptor(target, key, {
    configurable: true,
    enumerable: true,
    writable: true,
    value: original,
  });

  Object.defineProperty(target, key, {
    configurable: true,
    enumerable: true,
    writable: true,
    value(this: Node, ...args: unknown[]) {
      return replacement(original, this, args);
    },
  });
}

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

function withAllowedTitleWrite<T>(callback: () => T) {
  allowTitleWrite = true;
  try {
    return callback();
  } finally {
    allowTitleWrite = false;
  }
}

async function withAllowedTitleWriteAsync<T>(callback: () => Promise<T>) {
  allowTitleWrite = true;
  try {
    return await callback();
  } finally {
    allowTitleWrite = false;
  }
}

function setDocumentTitle(title: string) {
  withAllowedTitleWrite(() => {
    document.title = title;
    const titleElement = document.querySelector("title");
    if (titleElement && titleElement.textContent !== title) {
      titleElement.textContent = title;
    }
  });
}

function forceTitleNow() {
  if (!activeTitle) {
    return;
  }

  setDocumentTitle(activeTitle);
  void applyForcedTitle();
}

function startSongChangeGuard() {
  if (!activeTitle) {
    return;
  }

  const startedAt = Date.now();
  let framesLeft = SONG_CHANGE_GUARD_FRAME_COUNT;

  const tick = () => {
    forceTitleNow();
    framesLeft -= 1;

    if (
      activeTitle &&
      framesLeft > 0 &&
      Date.now() - startedAt < SONG_CHANGE_GUARD_MS
    ) {
      requestAnimationFrame(tick);
    }
  };

  tick();
}

function ensurePlayerListener() {
  if (playerListenerRegistered || !Spicetify.Player?.addEventListener) {
    return;
  }

  Spicetify.Player.addEventListener("songchange", startSongChangeGuard);
  playerListenerRegistered = true;
}

function patchDocumentTitle() {
  if (documentTitlePatched) {
    return;
  }

  originalDocumentTitleDescriptor =
    Object.getOwnPropertyDescriptor(document, "title") ??
    Object.getOwnPropertyDescriptor(Document.prototype, "title") ??
    null;

  if (!originalDocumentTitleDescriptor?.get || !originalDocumentTitleDescriptor.set) {
    return;
  }

  Object.defineProperty(document, "title", {
    configurable: true,
    enumerable: originalDocumentTitleDescriptor.enumerable ?? true,
    get() {
      return originalDocumentTitleDescriptor?.get?.call(document) ?? "";
    },
    set(value: string) {
      if (activeTitle && !allowTitleWrite) {
        return;
      }

      originalDocumentTitleDescriptor?.set?.call(document, value);
    },
  });

  documentTitlePatched = true;
}

function unpatchDocumentTitle() {
  if (!documentTitlePatched || !originalDocumentTitleDescriptor) {
    return;
  }

  Object.defineProperty(document, "title", originalDocumentTitleDescriptor);
  documentTitlePatched = false;
  originalDocumentTitleDescriptor = null;
}

function patchAppTitle() {
  if (appTitlePatched || !Spicetify.AppTitle?.set || !Spicetify.AppTitle.reset) {
    return;
  }

  originalAppTitleSet = Spicetify.AppTitle.set.bind(Spicetify.AppTitle);
  originalAppTitleReset = Spicetify.AppTitle.reset.bind(Spicetify.AppTitle);

  Spicetify.AppTitle.set = ((title: string) => {
    if (activeTitle && !allowTitleWrite) {
      return Promise.resolve({ clear: () => undefined });
    }

    return originalAppTitleSet?.(title) ?? Promise.resolve({ clear: () => undefined });
  }) as typeof Spicetify.AppTitle.set;

  Spicetify.AppTitle.reset = (() => {
    if (activeTitle && !allowTitleWrite) {
      return Promise.resolve();
    }

    return originalAppTitleReset?.() ?? Promise.resolve();
  }) as typeof Spicetify.AppTitle.reset;

  appTitlePatched = true;
}

function unpatchAppTitle() {
  if (!appTitlePatched) {
    return;
  }

  if (originalAppTitleSet) {
    Spicetify.AppTitle.set = originalAppTitleSet;
  }
  if (originalAppTitleReset) {
    Spicetify.AppTitle.reset = originalAppTitleReset;
  }

  appTitlePatched = false;
  originalAppTitleSet = null;
  originalAppTitleReset = null;
}

function patchTitleDomWrites() {
  if (domTitlePatched) {
    return;
  }

  patchTitleDomSetter(Node.prototype, "textContent");
  patchTitleDomSetter(Node.prototype, "nodeValue");
  patchTitleDomSetter(HTMLTitleElement.prototype, "text");
  patchTitleDomSetter(CharacterData.prototype, "data");

  patchTitleDomMethod(Node.prototype, "appendChild", (original, thisArg, args) => {
    if (activeTitle && !allowTitleWrite && thisArg instanceof HTMLTitleElement) {
      return args[0] ?? null;
    }

    return (original as (...methodArgs: unknown[]) => unknown).apply(thisArg, args);
  });

  patchTitleDomMethod(Node.prototype, "replaceChild", (original, thisArg, args) => {
    if (activeTitle && !allowTitleWrite && thisArg instanceof HTMLTitleElement) {
      return args[1] ?? null;
    }

    return (original as (...methodArgs: unknown[]) => unknown).apply(thisArg, args);
  });

  patchTitleDomMethod(Node.prototype, "insertBefore", (original, thisArg, args) => {
    if (activeTitle && !allowTitleWrite && thisArg instanceof HTMLTitleElement) {
      return args[0] ?? null;
    }

    return (original as (...methodArgs: unknown[]) => unknown).apply(thisArg, args);
  });

  domTitlePatched = true;
}

function unpatchTitleDomWrites() {
  if (!domTitlePatched) {
    return;
  }

  for (const [target, descriptors] of originalDomTitleDescriptors) {
    for (const [key, descriptor] of descriptors) {
      Object.defineProperty(target, key, descriptor);
    }
  }

  originalDomTitleDescriptors.clear();
  domTitlePatched = false;
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

  if (appTitleAppliedFor === title) {
    setDocumentTitle(title);
    return;
  }

  const sequence = ++applySequence;
  try {
    const handle = await withAllowedTitleWriteAsync(async () => {
      await appTitle.reset();
      return appTitle.set(title);
    });
    if (sequence !== applySequence || activeTitle !== title) {
      handle?.clear?.();
      return;
    }

    clearAppTitleHandle();
    appTitleClear = handle?.clear ?? null;
    appTitleAppliedFor = title;
    setDocumentTitle(title);
  } catch {
    setDocumentTitle(title);
  }
}

function stopForcingTitle() {
  window.clearInterval(titleApplyInterval);
  window.clearTimeout(readyRetryTimeout);
  titleApplyInterval = 0;
  readyRetryTimeout = 0;
  activeTitle = "";
  appTitleAppliedFor = "";
  applySequence += 1;
  clearAppTitleHandle();
  titleObserver?.disconnect();
  titleObserver = null;
  unpatchDocumentTitle();
  unpatchAppTitle();
  unpatchTitleDomWrites();
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
  ensurePlayerListener();
  ensureTitleObserver();
  void applyForcedTitle();

  if (!titleApplyInterval) {
    titleApplyInterval = window.setInterval(() => {
      if (document.title !== activeTitle) {
        setDocumentTitle(activeTitle);
      }
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
    patchDocumentTitle();
    patchAppTitle();
    patchTitleDomWrites();
    startForcingTitle(title);
    return;
  }

  patchDocumentTitle();
  patchAppTitle();
  patchTitleDomWrites();
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
