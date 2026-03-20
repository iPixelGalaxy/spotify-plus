import {
  SETTINGS_CHANGED_EVENT,
  getCachedPlaylistFolders,
  getSettings,
  type PlaylistFolderEntry,
} from "../config";
import { isElementVisible, normalizeText } from "../dom";

let observer: MutationObserver | null = null;
let hasAppliedCleanup = false;

const PLAYLIST_MENU_STYLE_ID = "spotify-plus-playlist-menu-style";
const CUSTOM_ROOT_CLASS = "spotify-plus-custom-playlist-root";
const CUSTOM_SOURCE_CLASS = "spotify-plus-custom-playlist-source";
const CUSTOM_CONTAINER_CLASS = "spotify-plus-custom-playlist-container";
const FOLDER_OPEN_RETRY_DELAY_MS = 75;
const FOLDER_OPEN_MAX_ATTEMPTS = 8;

type DividerMenuNode = {
  kind: "divider";
  template: HTMLElement | null;
};

type ActionMenuNode = {
  kind: "action";
  displayLabel: string;
  actionLabel: string;
  normalizedActionLabel: string;
  rootFolderLabel: string;
  path: string[];
  target: "root" | "folder";
  template: HTMLElement | null;
};

type MenuNode = DividerMenuNode | ActionMenuNode;

type RootFolderSource = {
  folder: PlaylistFolderEntry;
  sourceKey: string;
  pathSegments: string[];
};

type NativePlaylistEntry = {
  displayLabel: string;
  actionLabel: string;
  template: HTMLElement | null;
};

type CustomMenuState = {
  rootMenu: HTMLElement;
  sourceContainer: HTMLElement;
  customContainer: HTMLElement;
  selectedFolderIdsKey: string;
  folderSources: RootFolderSource[];
  nodes: MenuNode[];
  nativePlaylistsByFolder: Map<string, NativePlaylistEntry[]>;
  nativeFoldersLoaded: boolean;
  nativeLoadPromise: Promise<void> | null;
};

const customMenuStates = new Map<HTMLElement, CustomMenuState>();
const playlistMetadataEligibilityCache = new Map<string, Promise<boolean>>();

const BLOCKED_PLAYLIST_PATTERNS = [
  "dj",
  "dj on repeat",
  "discover weekly",
  "on repeat",
  "repeat rewind",
  "daylist",
  "your episodes",
];

function isBlockedPlaylistName(value: string) {
  const normalizedValue = normalizeText(value);
  return BLOCKED_PLAYLIST_PATTERNS.some((pattern) => normalizedValue.includes(pattern));
}

function findPlaylistUriInValue(value: unknown): string | null {
  if (typeof value === "string" && value.includes("spotify:playlist:")) {
    const match = value.match(/spotify:playlist:[A-Za-z0-9]+/);
    return match?.[0] ?? null;
  }

  if (!value || typeof value !== "object") {
    return null;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const uri = findPlaylistUriInValue(item);
      if (uri) return uri;
    }
    return null;
  }

  for (const nestedValue of Object.values(value as Record<string, unknown>)) {
    const uri = findPlaylistUriInValue(nestedValue);
    if (uri) return uri;
  }

  return null;
}

function getPlaylistUriFromRow(row: HTMLElement): string | null {
  const candidates = [row, ...row.querySelectorAll<HTMLElement>("*")];

  for (const element of candidates) {
    for (const attributeName of element.getAttributeNames()) {
      const attributeValue = element.getAttribute(attributeName);
      const uri = findPlaylistUriInValue(attributeValue);
      if (uri) return uri;
    }

    for (const value of Object.values(element.dataset)) {
      const uri = findPlaylistUriInValue(value);
      if (uri) return uri;
    }

    for (const key of Object.keys(element)) {
      if (!key.startsWith("__reactProps")) {
        continue;
      }

      const uri = findPlaylistUriInValue((element as Record<string, unknown>)[key]);
      if (uri) return uri;
    }
  }

  return null;
}

async function isEligiblePlaylistUri(uri: string | null) {
  if (!uri) {
    return true;
  }

  const cached = playlistMetadataEligibilityCache.get(uri);
  if (cached) {
    return cached;
  }

  const pending = (async () => {
    try {
      const metadata = await (Spicetify.Platform as any)?.PlaylistAPI?.getMetadata?.(uri);
      if (!metadata) {
        return true;
      }

      if (metadata.madeFor) {
        return false;
      }

      if (metadata.canAdd === false || metadata.canEditItems === false) {
        return false;
      }

      const formatType = normalizeText(metadata.formatListData?.type);
      if (formatType.includes("daylist")) {
        return false;
      }

      return true;
    } catch {
      return true;
    }
  })();

  playlistMetadataEligibilityCache.set(uri, pending);
  return pending;
}

function ensurePlaylistMenuStyles() {
  if (document.getElementById(PLAYLIST_MENU_STYLE_ID)) return;

  const style = document.createElement("style");
  style.id = PLAYLIST_MENU_STYLE_ID;
  style.textContent = `
.main-contextMenu-menu.${CUSTOM_ROOT_CLASS} {
  position: relative !important;
}

.main-contextMenu-menu.${CUSTOM_ROOT_CLASS} > .${CUSTOM_SOURCE_CLASS} {
  position: absolute !important;
  inset: 0 !important;
  width: 0 !important;
  height: 0 !important;
  min-width: 0 !important;
  min-height: 0 !important;
  margin: 0 !important;
  padding: 0 !important;
  overflow: hidden !important;
  opacity: 0 !important;
  pointer-events: none !important;
}

.main-contextMenu-menu.${CUSTOM_ROOT_CLASS} > .${CUSTOM_SOURCE_CLASS} * {
  pointer-events: none !important;
}

.main-contextMenu-menu.${CUSTOM_ROOT_CLASS} > .${CUSTOM_CONTAINER_CLASS} {
  position: relative !important;
}
`;

  document.head.appendChild(style);
}

function wait(ms: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function getSelectedFolders() {
  const settings = getSettings();
  if (!settings.overridePlaylistFolderBehavior) {
    return [];
  }

  const selectedIds = Array.isArray(settings.playlistOverrideFolderIds)
    ? settings.playlistOverrideFolderIds
    : [];
  if (selectedIds.length === 0) {
    return [];
  }

  const foldersById = new Map(
    getCachedPlaylistFolders().map((folder) => [folder.id, folder] as const)
  );

  return selectedIds
    .map((id) => foldersById.get(id) ?? null)
    .filter((folder): folder is PlaylistFolderEntry => folder !== null);
}

function getSelectedFolderIdsKey(folders: PlaylistFolderEntry[]) {
  return folders.map((folder) => folder.id).join("|");
}

function getMenuDepth(menu: HTMLElement) {
  return Number(menu.getAttribute("data-depth") ?? "0");
}

function getMenuContentContainer(menu: HTMLElement) {
  return menu.querySelector<HTMLElement>(":scope > div") ?? menu;
}

function getMenuChildren(target: HTMLElement) {
  return Array.from(target.children).filter(
    (child): child is HTMLElement => child instanceof HTMLElement
  );
}

function getItemLabel(item: HTMLElement) {
  const labelElement = item.querySelector<HTMLElement>(
    ".main-contextMenu-menuItemLabel, [data-encore-id='text'], .TypeElement-type-mesto"
  );
  return normalizeText(labelElement?.textContent);
}

function isSearchRow(item: HTMLElement) {
  return (
    item.classList.contains("NYplcvf1o79tewx0Wc83") ||
    item.querySelector(".x-filterBox-filterInputContainer, .x-filterBox-filterInput") !==
      null
  );
}

function isDivider(item: HTMLElement) {
  return (
    item.classList.contains("main-contextMenu-dividerAfter") ||
    item.classList.contains("main-contextMenu-dividerBefore")
  );
}

function isAddToPlaylistRootMenu(menu: HTMLElement) {
  if (
    getMenuDepth(menu) !== 1 ||
    menu.querySelector(".x-filterBox-filterInputContainer, .x-filterBox-filterInput") ===
      null
  ) {
    return false;
  }

  const hostItem = menu.closest<HTMLElement>(".main-contextMenu-menuItem");
  if (!hostItem) return false;

  return getItemLabel(hostItem) === "add to playlist";
}

function isTrackedRootMenu(menu: HTMLElement) {
  return (
    isAddToPlaylistRootMenu(menu) &&
    (isElementVisible(menu) ||
      menu.classList.contains(CUSTOM_ROOT_CLASS) ||
      Boolean(menu.dataset.spotifyPlusCustomFolders))
  );
}

function getFolderSource(folder: PlaylistFolderEntry) {
  return {
    folder,
    sourceKey: folder.id,
    pathSegments: folder.path
      .split("/")
      .map((segment) => segment.trim())
      .filter(Boolean),
  };
}

function getNestedPopup(parentItem: HTMLElement) {
  const popupMenu = Array.from(
    parentItem.querySelectorAll<HTMLElement>(".main-contextMenu-menu")
  ).find((menu) => getMenuDepth(menu) >= 2);
  const popupRoot = popupMenu?.closest<HTMLElement>("[data-tippy-root]");

  if (!popupMenu || !popupRoot) {
    return null;
  }

  return { popupMenu, popupRoot };
}

function dispatchFolderOpenEvents(parentItem: HTMLElement, button: HTMLElement, attempt: number) {
  const hoverEvents = [
    new MouseEvent("mouseenter", { bubbles: true }),
    new MouseEvent("mouseover", { bubbles: true }),
    new MouseEvent("mousemove", { bubbles: true }),
    new PointerEvent("pointerenter", { bubbles: true }),
    new PointerEvent("pointerover", { bubbles: true }),
    new PointerEvent("pointermove", { bubbles: true }),
  ];

  for (const event of hoverEvents) {
    button.dispatchEvent(event);
    parentItem.dispatchEvent(event);
  }

  button.focus();

  if (attempt < 1) {
    return;
  }

  const clickEvents = [
    new PointerEvent("pointerdown", { bubbles: true }),
    new MouseEvent("mousedown", { bubbles: true }),
    new PointerEvent("pointerup", { bubbles: true }),
    new MouseEvent("mouseup", { bubbles: true }),
    new MouseEvent("click", { bubbles: true }),
  ];

  for (const event of clickEvents) {
    button.dispatchEvent(event);
  }
}

async function ensureNestedPopupReady(parentItem: HTMLElement, button: HTMLElement) {
  const existingPopup = getNestedPopup(parentItem);
  if (existingPopup) {
    return existingPopup;
  }

  for (let attempt = 0; attempt <= FOLDER_OPEN_MAX_ATTEMPTS; attempt += 1) {
    if (!parentItem.isConnected || !button.isConnected) {
      return null;
    }

    dispatchFolderOpenEvents(parentItem, button, attempt);

    const popup = getNestedPopup(parentItem);
    if (popup) {
      return popup;
    }

    await wait(FOLDER_OPEN_RETRY_DELAY_MS);
  }

  return getNestedPopup(parentItem);
}

function findMenuItemByLabel(scope: ParentNode, label: string) {
  const items = Array.from(scope.querySelectorAll<HTMLElement>(".main-contextMenu-menuItem"));

  for (const item of items) {
    if (isSearchRow(item) || getItemLabel(item) !== label) {
      continue;
    }

    const button = item.querySelector<HTMLElement>(".main-contextMenu-menuItemButton");
    if (button) {
      return { item, button };
    }
  }

  return null;
}

async function resolveFolderSourceInMenu(
  rootMenu: HTMLElement,
  source: RootFolderSource
): Promise<{ folderItem: HTMLElement; folderButton: HTMLElement } | null> {
  let currentMenu = rootMenu;
  let currentMatch: { item: HTMLElement; button: HTMLElement } | null = null;

  for (const segment of source.pathSegments) {
    const match = findMenuItemByLabel(currentMenu, segment);
    if (!match) {
      return null;
    }

    currentMatch = match;

    if (segment !== source.pathSegments[source.pathSegments.length - 1]) {
      const popup = await ensureNestedPopupReady(match.item, match.button);
      if (!popup) {
        return null;
      }

      currentMenu = popup.popupMenu;
    }
  }

  return currentMatch;
}

function getFirstDividerTemplate(target: HTMLElement) {
  return getMenuChildren(target).find((child) => isDivider(child)) ?? null;
}

function createFallbackMenuRow(label: string) {
  const row = document.createElement("li");
  row.setAttribute("role", "presentation");
  row.className = "main-contextMenu-menuItem";

  const button = document.createElement("button");
  button.className = "main-contextMenu-menuItemButton";
  button.setAttribute("role", "menuitem");
  button.tabIndex = -1;

  const text = document.createElement("span");
  text.className =
    "e-91000-text encore-text-body-small ellipsis-one-line main-contextMenu-menuItemLabel";
  text.setAttribute("data-encore-id", "text");
  text.setAttribute("dir", "auto");
  text.textContent = label;

  button.appendChild(text);
  row.appendChild(button);
  return row;
}

function createDividerClone(template: HTMLElement | null) {
  if (template) {
    return template.cloneNode(true) as HTMLElement;
  }

  const divider = document.createElement("div");
  divider.className = "main-contextMenu-dividerAfter";
  return divider;
}

function scrubClonedNode(node: HTMLElement) {
  const nestedMenus = [
    ...node.querySelectorAll<HTMLElement>(".main-contextMenu-menu"),
    ...node.querySelectorAll<HTMLElement>("[data-tippy-root]"),
  ];

  for (const nestedMenu of nestedMenus) {
    nestedMenu.remove();
  }

  const attributedNodes = [
    node,
    ...node.querySelectorAll<HTMLElement>("[aria-describedby], [data-context-menu-open], [id]"),
  ];

  for (const element of attributedNodes) {
    element.removeAttribute("aria-describedby");
    element.removeAttribute("data-context-menu-open");
    element.removeAttribute("id");
  }

  const button = node.querySelector<HTMLElement>(".main-contextMenu-menuItemButton");
  if (button) {
    button.tabIndex = -1;
    button.removeAttribute("aria-expanded");
  }
}

function trimMenuDividers(container: HTMLElement) {
  const children = getMenuChildren(container);

  for (const child of children) {
    const previous = child.previousElementSibling;
    const next = child.nextElementSibling;
    const isEmptyDivider =
      isDivider(child) &&
      (!previous || !next || isDivider(previous as HTMLElement) || isDivider(next as HTMLElement));

    if (isEmptyDivider) {
      child.remove();
    }
  }
}

function createDividerNode(template: HTMLElement | null): DividerMenuNode {
  return { kind: "divider", template };
}

function createActionNode(
  displayLabel: string,
  actionLabel: string,
  rootFolderLabel: string,
  path: string[],
  target: "root" | "folder",
  template: HTMLElement | null
): ActionMenuNode {
  return {
    kind: "action",
    displayLabel,
    actionLabel,
    normalizedActionLabel: normalizeText(actionLabel),
    rootFolderLabel,
    path: [...path],
    target,
    template,
  };
}

function getFallbackPlaylistEntries(folder: PlaylistFolderEntry) {
  return folder.playlists
    .filter((playlist) => !isBlockedPlaylistName(playlist.name))
    .map((playlist) => ({
      displayLabel: playlist.name,
      actionLabel: playlist.name,
      template: null,
    }));
}

function getEligiblePlaylistNameSet(folder: PlaylistFolderEntry) {
  return new Set(
    folder.playlists
      .filter((playlist) => !isBlockedPlaylistName(playlist.name))
      .map((playlist) => normalizeText(playlist.name))
  );
}

function buildMenuNodes(state: CustomMenuState) {
  const nodes: MenuNode[] = [];
  const newPlaylistMatch = findMenuItemByLabel(state.sourceContainer, "new playlist");
  const newPlaylistRow = newPlaylistMatch?.item ?? null;
  const dividerTemplate = getFirstDividerTemplate(state.sourceContainer);
  const playlists = state.nativeFoldersLoaded
    ? state.folderSources.flatMap((source) =>
        (
          state.nativePlaylistsByFolder.get(source.sourceKey) ??
          getFallbackPlaylistEntries(source.folder)
        ).map((playlist) => ({
          displayLabel: playlist.displayLabel,
          actionLabel: playlist.actionLabel,
          rootFolderLabel: source.sourceKey,
          path: [] as string[],
          template: playlist.template,
        }))
      )
    : state.folderSources.flatMap((source) =>
        getFallbackPlaylistEntries(source.folder).map((playlist) => ({
          displayLabel: playlist.displayLabel,
          actionLabel: playlist.actionLabel,
          rootFolderLabel: source.sourceKey,
          path: [] as string[],
          template: playlist.template,
        }))
      )
    ;

  if (newPlaylistRow) {
    nodes.push(
      createActionNode(
        "New playlist",
        "new playlist",
        "",
        [],
        "root",
        newPlaylistRow.cloneNode(true) as HTMLElement
      )
    );
  }

  if (newPlaylistRow && playlists.length > 0) {
    nodes.push(createDividerNode(createDividerClone(dividerTemplate)));
  }

  for (const playlist of playlists) {
    nodes.push(
      createActionNode(
        playlist.displayLabel,
        playlist.actionLabel,
        playlist.rootFolderLabel,
        playlist.path,
        "folder",
        null
      )
    );
  }

  return nodes;
}

async function extractDirectAddablePlaylistEntries(
  popupMenu: HTMLElement,
  _includeRootFolderLabel: boolean
) {
  const entries: NativePlaylistEntry[] = [];
  const popupContainer = getMenuContentContainer(popupMenu);

  for (const row of getMenuChildren(popupContainer)) {
    if (isSearchRow(row) || isDivider(row) || !row.classList.contains("main-contextMenu-menuItem")) {
      continue;
    }

    const button = row.querySelector<HTMLElement>(".main-contextMenu-menuItemButton");
    if (!button) {
      continue;
    }

    const hasSubmenu =
      button.getAttribute("aria-expanded") === "true" ||
      button.querySelector(".main-contextMenu-subMenuIcon") !== null;
    if (hasSubmenu) {
      continue;
    }

    const actionLabel = row
      .querySelector<HTMLElement>(
        ".main-contextMenu-menuItemLabel, [data-encore-id='text'], .TypeElement-type-mesto"
      )
      ?.textContent?.replace(/\s+/g, " ")
      .trim();

    if (!actionLabel) {
      continue;
    }

    const normalizedActionLabel = normalizeText(actionLabel);
    if (
      normalizedActionLabel === "new playlist" ||
      isBlockedPlaylistName(normalizedActionLabel)
    ) {
      continue;
    }

    const playlistUri = getPlaylistUriFromRow(row);
    if (!(await isEligiblePlaylistUri(playlistUri))) {
      continue;
    }

    entries.push({
      displayLabel: actionLabel,
      actionLabel,
      template: row.cloneNode(true) as HTMLElement,
    });
  }

  return entries;
}

function clearCustomContainer(state: CustomMenuState) {
  state.customContainer.replaceChildren();
}

function createRenderedRow(node: ActionMenuNode) {
  const row = node.template
    ? (node.template.cloneNode(true) as HTMLElement)
    : createFallbackMenuRow(node.displayLabel);
  scrubClonedNode(row);

  if (!node.template) {
    const label = row.querySelector<HTMLElement>(".main-contextMenu-menuItemLabel");
    if (label) {
      label.textContent = node.displayLabel;
    }
  }

  return row;
}

async function resolveNativePopupForNode(state: CustomMenuState, node: ActionMenuNode) {
  const source = state.folderSources.find(
    (folderSource) => folderSource.sourceKey === node.rootFolderLabel
  );
  if (!source) {
    return null;
  }

  const resolvedSource = await resolveFolderSourceInMenu(state.rootMenu, source);
  if (!resolvedSource) {
    return null;
  }

  let popup = await ensureNestedPopupReady(resolvedSource.folderItem, resolvedSource.folderButton);
  if (!popup) {
    return null;
  }

  for (const segment of node.path) {
    const match = findMenuItemByLabel(popup.popupMenu, segment);
    if (!match) {
      return null;
    }

    popup = await ensureNestedPopupReady(match.item, match.button);
    if (!popup) {
      return null;
    }
  }

  return popup;
}

async function triggerNativeAction(state: CustomMenuState, node: ActionMenuNode) {
  if (
    !state.rootMenu.isConnected ||
    !state.sourceContainer.isConnected ||
    state.folderSources.length === 0
  ) {
    return;
  }

  if (node.target === "root") {
    const match = findMenuItemByLabel(state.sourceContainer, node.normalizedActionLabel);
    if (!match) {
      Spicetify.showNotification(
        `Spotify+: couldn't find "${node.actionLabel}" in Add to playlist`,
        true
      );
      return;
    }

    match.button.click();
    return;
  }

  const popup = await resolveNativePopupForNode(state, node);
  const match = popup ? findMenuItemByLabel(popup.popupMenu, node.normalizedActionLabel) : null;
  if (!match) {
    Spicetify.showNotification(
      `Spotify+: couldn't find "${node.actionLabel}" in Add to playlist`,
      true
    );
    return;
  }

  match.button.click();
}

function renderCustomMenu(state: CustomMenuState) {
  clearCustomContainer(state);

  for (const node of state.nodes) {
    if (node.kind === "divider") {
      state.customContainer.appendChild(
        node.template ? (node.template.cloneNode(true) as HTMLElement) : createDividerClone(null)
      );
      continue;
    }

    const row = createRenderedRow(node);
    const button = row.querySelector<HTMLElement>(".main-contextMenu-menuItemButton");
    if (button) {
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        void triggerNativeAction(state, node);
      });
    }

    state.customContainer.appendChild(row);
  }

  trimMenuDividers(state.customContainer);

  if (state.customContainer.childElementCount === 0) {
    const emptyRow = createFallbackMenuRow("No playlists found");
    const emptyButton = emptyRow.querySelector<HTMLElement>(".main-contextMenu-menuItemButton");
    if (emptyButton) {
      emptyButton.setAttribute("aria-disabled", "true");
    }
    state.customContainer.appendChild(emptyRow);
  }
}

async function loadNativePlaylistsForState(state: CustomMenuState) {
  if (state.nativeLoadPromise) {
    return state.nativeLoadPromise;
  }

  state.nativeLoadPromise = (async () => {
    const includeRootFolderLabel = state.folderSources.length > 1;
    const nativePlaylistsByFolder = new Map<string, NativePlaylistEntry[]>();

    for (const source of state.folderSources) {
      const resolvedSource = await resolveFolderSourceInMenu(state.rootMenu, source);
      if (!resolvedSource || customMenuStates.get(state.rootMenu) !== state) {
        continue;
      }

      const popup = await ensureNestedPopupReady(
        resolvedSource.folderItem,
        resolvedSource.folderButton
      );
      if (!popup || customMenuStates.get(state.rootMenu) !== state) {
        continue;
      }

      nativePlaylistsByFolder.set(
        source.sourceKey,
        (await extractDirectAddablePlaylistEntries(popup.popupMenu, includeRootFolderLabel)).filter(
          (playlist) =>
            getEligiblePlaylistNameSet(source.folder).has(normalizeText(playlist.actionLabel))
        )
      );
    }

    if (customMenuStates.get(state.rootMenu) !== state) {
      return;
    }

    state.nativePlaylistsByFolder = nativePlaylistsByFolder;
    state.nativeFoldersLoaded = true;
    state.nodes = buildMenuNodes(state);
    renderCustomMenu(state);
  })().finally(() => {
    if (customMenuStates.get(state.rootMenu) === state) {
      state.nativeLoadPromise = null;
    }
  });

  return state.nativeLoadPromise;
}

function releaseCustomMenuState(rootMenu: HTMLElement) {
  const state = customMenuStates.get(rootMenu);
  if (!state) return;

  state.rootMenu.classList.remove(CUSTOM_ROOT_CLASS);
  state.sourceContainer.classList.remove(CUSTOM_SOURCE_CLASS);
  state.customContainer.remove();
  delete state.rootMenu.dataset.spotifyPlusCustomFolders;

  customMenuStates.delete(rootMenu);
}

function cleanupDetachedStates(activeRootMenus: HTMLElement[]) {
  for (const [rootMenu, state] of customMenuStates) {
    if (
      rootMenu.isConnected &&
      activeRootMenus.includes(rootMenu) &&
      state.sourceContainer.isConnected &&
      state.customContainer.isConnected
    ) {
      continue;
    }

    releaseCustomMenuState(rootMenu);
  }
}

function ensureCustomMenuState(rootMenu: HTMLElement, folders: PlaylistFolderEntry[]) {
  const selectedFolderIdsKey = getSelectedFolderIdsKey(folders);
  const existingState = customMenuStates.get(rootMenu) ?? null;

  if (
    existingState &&
    existingState.selectedFolderIdsKey === selectedFolderIdsKey &&
    existingState.sourceContainer.isConnected &&
    existingState.customContainer.isConnected
  ) {
    return existingState;
  }

  if (existingState) {
    releaseCustomMenuState(rootMenu);
  }

  const sourceContainer = getMenuContentContainer(rootMenu);
  const folderSources = folders.map((folder) => getFolderSource(folder));

  if (folderSources.length === 0) {
    return null;
  }

  ensurePlaylistMenuStyles();

  const customContainer = document.createElement("div");
  customContainer.className = `${sourceContainer.className} ${CUSTOM_CONTAINER_CLASS}`.trim();

  const state: CustomMenuState = {
    rootMenu,
    sourceContainer,
    customContainer,
    selectedFolderIdsKey,
    folderSources,
    nodes: [],
    nativePlaylistsByFolder: new Map<string, NativePlaylistEntry[]>(),
    nativeFoldersLoaded: false,
    nativeLoadPromise: null,
  };

  state.nodes = buildMenuNodes(state);

  sourceContainer.classList.add(CUSTOM_SOURCE_CLASS);
  rootMenu.classList.add(CUSTOM_ROOT_CLASS);
  rootMenu.dataset.spotifyPlusCustomFolders = selectedFolderIdsKey;
  rootMenu.appendChild(customContainer);
  customMenuStates.set(rootMenu, state);

  renderCustomMenu(state);
  void loadNativePlaylistsForState(state);
  return state;
}

function applyPlaylistMenuCleanup() {
  const folders = getSelectedFolders();
  const rootMenus = Array.from(
    document.querySelectorAll<HTMLElement>(".main-contextMenu-menu")
  ).filter((menu) => isTrackedRootMenu(menu));

  if (folders.length === 0 || rootMenus.length === 0) {
    if (hasAppliedCleanup || customMenuStates.size > 0) {
      resetPlaylistMenuCleanup();
    }
    return;
  }

  cleanupDetachedStates(rootMenus);

  for (const menu of rootMenus) {
    ensureCustomMenuState(menu, folders);
  }

  hasAppliedCleanup = true;
}

function resetPlaylistMenuCleanup() {
  for (const rootMenu of Array.from(customMenuStates.keys())) {
    releaseCustomMenuState(rootMenu);
  }

  hasAppliedCleanup = false;
}

function refreshPlaylistMenuController() {
  const settings = getSettings();
  const active =
    settings.overridePlaylistFolderBehavior &&
    Array.isArray(settings.playlistOverrideFolderIds) &&
    settings.playlistOverrideFolderIds.length > 0;

  if (active) {
    applyPlaylistMenuCleanup();
    if (observer) return;

    observer = new MutationObserver(() => {
      applyPlaylistMenuCleanup();
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });
    return;
  }

  observer?.disconnect();
  observer = null;

  if (hasAppliedCleanup || customMenuStates.size > 0) {
    resetPlaylistMenuCleanup();
  }
}

function onSettingsChanged(event: Event) {
  const key = (event as CustomEvent<{ key?: string }>).detail?.key;
  if (
    key !== "overridePlaylistFolderBehavior" &&
    key !== "playlistOverrideFolderIds"
  ) {
    return;
  }

  refreshPlaylistMenuController();
}

export function startPlaylistMenuController() {
  refreshPlaylistMenuController();
  window.addEventListener(SETTINGS_CHANGED_EVENT, onSettingsChanged);
}
