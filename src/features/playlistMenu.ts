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
const ACTION_MATCH_RETRY_DELAY_MS = 50;
const ACTION_MATCH_MAX_ATTEMPTS = 8;
const ACTION_TRIGGER_DEBOUNCE_MS = 750;

type DividerMenuNode = {
  kind: "divider";
  template: HTMLElement | null;
};

type ActionMenuNode = {
  kind: "action";
  displayLabel: string;
  actionLabel: string;
  normalizedActionLabel: string;
  playlistUri: string | null;
  rootFolderLabel: string;
  path: string[];
  target: "root" | "folder";
  template: HTMLElement | null;
  liveButton: HTMLElement | null;
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
  playlistUri: string | null;
  template: HTMLElement | null;
  liveButton: HTMLElement | null;
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

type PlaylistLookupDebugDetails = {
  stage:
    | "root-source-disconnected"
    | "root-match-missing"
    | "folder-popup-missing"
    | "folder-match-missing";
  actionLabel: string;
  playlistUri: string | null;
  rootFolderLabel: string;
  path: string[];
  availableLabels?: string[];
  availableUris?: string[];
};

const customMenuStates = new Map<HTMLElement, CustomMenuState>();
const playlistMetadataEligibilityCache = new Map<string, Promise<boolean>>();
const playlistContentsUriCache = new Map<string, Promise<Set<string>>>();

const BLOCKED_PLAYLIST_PATTERNS = [
  "dj",
  "dj on repeat",
  "discover weekly",
  "on repeat",
  "repeat rewind",
  "daylist",
  "your episodes",
];

function normalizePlaylistMatchText(value: string | null | undefined) {
  return normalizeText(value)
    .normalize("NFKD")
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
    .replace(/[`´]/g, "'")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function logPlaylistLookupFailure(details: PlaylistLookupDebugDetails) {
  console.warn("[Spotify+] Add to playlist lookup failed", details);
}

function isBlockedPlaylistName(value: string) {
  const normalizedValue = normalizeText(value);
  return BLOCKED_PLAYLIST_PATTERNS.some((pattern) => normalizedValue.includes(pattern));
}

function isTrackUri(value: unknown): value is string {
  return typeof value === "string" && /^spotify:track:[A-Za-z0-9]+$/.test(value);
}

function collectTrackUriCandidates(
  value: unknown,
  candidates: string[][],
  seen: Set<object>
) {
  if (!value || typeof value !== "object") {
    return;
  }

  if (seen.has(value)) {
    return;
  }
  seen.add(value);

  if (Array.isArray(value)) {
    const directTrackUris = value.filter(isTrackUri);
    if (directTrackUris.length > 0 && directTrackUris.length === value.length) {
      candidates.push([...new Set(directTrackUris)]);
      return;
    }

    for (const item of value) {
      collectTrackUriCandidates(item, candidates, seen);
    }
    return;
  }

  const record = value as Record<string, unknown>;

  for (const [key, nestedValue] of Object.entries(record)) {
    if (!nestedValue) {
      continue;
    }

    if (
      Array.isArray(nestedValue) &&
      ["uris", "selectedUris", "tracks", "trackUris"].includes(key)
    ) {
      const directTrackUris = nestedValue.filter(isTrackUri);
      if (directTrackUris.length > 0) {
        candidates.push([...new Set(directTrackUris)]);
        continue;
      }
    }

    if (isTrackUri(nestedValue)) {
      candidates.push([nestedValue]);
      continue;
    }

    collectTrackUriCandidates(nestedValue, candidates, seen);
  }
}

function getSelectedTrackUrisFromContextMenu(rootMenu: HTMLElement) {
  const menuHost = rootMenu.closest<HTMLElement>("#context-menu");
  if (!menuHost) {
    return [];
  }

  const trackUriCandidates: string[][] = [];
  const seen = new Set<object>();
  const elements = [menuHost, ...menuHost.querySelectorAll<HTMLElement>("*")];

  for (const element of elements) {
    for (const key of Object.keys(element)) {
      if (!key.startsWith("__reactProps") && !key.startsWith("__reactFiber")) {
        continue;
      }

      collectTrackUriCandidates(
        (element as Record<string, unknown>)[key],
        trackUriCandidates,
        seen
      );
    }
  }

  const sortedCandidates = trackUriCandidates
    .filter((candidate) => candidate.length > 0)
    .sort((left, right) => left.length - right.length);

  return sortedCandidates[0] ?? [];
}

function closeContextMenu(rootMenu: HTMLElement) {
  const hostMenu = rootMenu.closest<HTMLElement>("#context-menu");
  const tippyRoot = rootMenu.closest<HTMLElement>("[data-tippy-root]");

  (document.activeElement as HTMLElement | null)?.blur?.();
  if (hostMenu) {
    hostMenu.style.display = "none";
  }
  if (tippyRoot) {
    tippyRoot.style.display = "none";
    window.setTimeout(() => {
      tippyRoot.remove();
    }, 0);
  }
}

async function getPlaylistTrackUriSet(playlistUri: string) {
  const cached = playlistContentsUriCache.get(playlistUri);
  if (cached) {
    return cached;
  }

  const pending = (async () => {
    try {
      const items =
        (await (Spicetify.Platform as any)?.PlaylistAPI?.getContents?.(playlistUri, {
          limit: 100000,
        }))?.items ?? [];

      const uris = new Set<string>();
      for (const item of items) {
        const uri =
          typeof item?.uri === "string"
            ? item.uri
            : typeof item?.link === "string"
              ? item.link
              : null;
        if (isTrackUri(uri)) {
          uris.add(uri);
        }
      }

      return uris;
    } catch {
      return new Set<string>();
    }
  })();

  playlistContentsUriCache.set(playlistUri, pending);
  return pending;
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

function getPlaylistUriFromRow(row: HTMLElement | null | undefined): string | null {
  if (!row || typeof row.querySelectorAll !== "function") {
    return null;
  }

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

function isConnectedElement(element: Node | null | undefined) {
  return Boolean(element && "isConnected" in element && element.isConnected);
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

function getNestedPopup(parentItem: HTMLElement | null | undefined) {
  if (!parentItem || typeof parentItem.querySelectorAll !== "function") {
    return null;
  }

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
    if (!isConnectedElement(parentItem) || !isConnectedElement(button)) {
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

async function findNativeActionMatchWithRetry(
  scope: ParentNode | null | undefined,
  playlistUri: string | null,
  normalizedActionLabel: string
) {
  for (let attempt = 0; attempt <= ACTION_MATCH_MAX_ATTEMPTS; attempt += 1) {
    const match =
      findMenuItemByUri(scope, playlistUri) ??
      findMenuItemByLabel(scope, normalizedActionLabel);
    if (match) {
      return match;
    }

    if (attempt < ACTION_MATCH_MAX_ATTEMPTS) {
      await wait(ACTION_MATCH_RETRY_DELAY_MS);
    }
  }

  return null;
}

function findMenuItemByLabel(scope: ParentNode | null | undefined, label: string) {
  if (!scope || typeof (scope as ParentNode).querySelectorAll !== "function") {
    return null;
  }

  const items = Array.from(scope.querySelectorAll<HTMLElement>(".main-contextMenu-menuItem"));
  const normalizedLabel = normalizePlaylistMatchText(label);

  for (const item of items) {
    if (isSearchRow(item) || normalizePlaylistMatchText(getItemLabel(item)) !== normalizedLabel) {
      continue;
    }

    const button = item.querySelector<HTMLElement>(".main-contextMenu-menuItemButton");
    if (button) {
      return { item, button };
    }
  }

  return null;
}

function findMenuItemByUri(scope: ParentNode | null | undefined, playlistUri: string | null) {
  if (!scope || typeof (scope as ParentNode).querySelectorAll !== "function" || !playlistUri) {
    return null;
  }

  const items = Array.from(scope.querySelectorAll<HTMLElement>(".main-contextMenu-menuItem"));

  for (const item of items) {
    if (isSearchRow(item)) {
      continue;
    }

    if (getPlaylistUriFromRow(item) !== playlistUri) {
      continue;
    }

    const button = item.querySelector<HTMLElement>(".main-contextMenu-menuItemButton");
    if (button) {
      return { item, button };
    }
  }

  return null;
}

function collectMenuDebugDetails(scope: ParentNode | null | undefined) {
  if (!scope || typeof (scope as ParentNode).querySelectorAll !== "function") {
    return { availableLabels: [], availableUris: [] };
  }

  const items = Array.from(scope.querySelectorAll<HTMLElement>(".main-contextMenu-menuItem"));
  const availableLabels: string[] = [];
  const availableUris: string[] = [];

  for (const item of items) {
    if (isSearchRow(item) || isDivider(item)) {
      continue;
    }

    const label = getItemLabel(item);
    if (label) {
      availableLabels.push(label);
    }

    const uri = getPlaylistUriFromRow(item);
    if (uri) {
      availableUris.push(uri);
    }
  }

  return { availableLabels, availableUris };
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

function scrubClonedNode(node: HTMLElement | null | undefined) {
  if (!node || typeof node.querySelectorAll !== "function") {
    return;
  }

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
  playlistUri: string | null,
  rootFolderLabel: string,
  path: string[],
  target: "root" | "folder",
  template: HTMLElement | null,
  liveButton: HTMLElement | null
): ActionMenuNode {
  return {
    kind: "action",
    displayLabel,
    actionLabel,
    normalizedActionLabel: normalizePlaylistMatchText(actionLabel),
    playlistUri,
    rootFolderLabel,
    path: [...path],
    target,
    template,
    liveButton,
  };
}

function getFallbackPlaylistEntries(folder: PlaylistFolderEntry) {
  return folder.playlists
    .filter((playlist) => !isBlockedPlaylistName(playlist.name))
    .map((playlist) => ({
      displayLabel: playlist.name,
      actionLabel: playlist.name,
      playlistUri: playlist.uri,
      template: null,
      liveButton: null,
    }));
}

function getEligiblePlaylistNameSet(folder: PlaylistFolderEntry) {
  return new Set(
    folder.playlists
      .filter((playlist) => !isBlockedPlaylistName(playlist.name))
      .map((playlist) => normalizePlaylistMatchText(playlist.name))
  );
}

function getEligiblePlaylistUriByName(folder: PlaylistFolderEntry) {
  const urisByName = new Map<string, string>();

  for (const playlist of folder.playlists) {
    if (!playlist.uri || isBlockedPlaylistName(playlist.name)) {
      continue;
    }

    const key = normalizePlaylistMatchText(playlist.name);
    if (!urisByName.has(key)) {
      urisByName.set(key, playlist.uri);
    }
  }

  return urisByName;
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
            playlistUri: playlist.playlistUri,
            rootFolderLabel: source.sourceKey,
            path: [] as string[],
            template: playlist.template,
            liveButton: playlist.liveButton,
          }))
        )
      : state.folderSources.flatMap((source) =>
        getFallbackPlaylistEntries(source.folder).map((playlist) => ({
          displayLabel: playlist.displayLabel,
          actionLabel: playlist.actionLabel,
          playlistUri: playlist.playlistUri,
          rootFolderLabel: source.sourceKey,
          path: [] as string[],
          template: playlist.template,
          liveButton: playlist.liveButton,
        }))
      )
    ;

  if (newPlaylistRow) {
    nodes.push(
        createActionNode(
          "New playlist",
          "new playlist",
          null,
          "",
          [],
          "root",
          newPlaylistRow.cloneNode(true) as HTMLElement,
          newPlaylistMatch?.button ?? null
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
        playlist.playlistUri ?? null,
        playlist.rootFolderLabel,
        playlist.path,
        "folder",
        playlist.template,
        playlist.liveButton ?? null
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
      playlistUri,
      template: row.cloneNode(true) as HTMLElement,
      liveButton: button,
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
    !isConnectedElement(state.rootMenu) ||
    !isConnectedElement(state.sourceContainer) ||
    state.folderSources.length === 0
  ) {
    logPlaylistLookupFailure({
      stage: "root-source-disconnected",
      actionLabel: node.actionLabel,
      playlistUri: node.playlistUri,
      rootFolderLabel: node.rootFolderLabel,
      path: node.path,
    });
    return;
  }

  if (node.target === "root") {
    if (isConnectedElement(node.liveButton)) {
      node.liveButton.click();
      return;
    }

    const match = await findNativeActionMatchWithRetry(
      state.sourceContainer,
      node.playlistUri,
      node.normalizedActionLabel
    );
    if (!match) {
      logPlaylistLookupFailure({
        stage: "root-match-missing",
        actionLabel: node.actionLabel,
        playlistUri: node.playlistUri,
        rootFolderLabel: node.rootFolderLabel,
        path: node.path,
        ...collectMenuDebugDetails(state.sourceContainer),
      });
      Spicetify.showNotification(
        `Spotify+: couldn't find "${node.actionLabel}" in Add to playlist`,
        true
      );
      return;
    }

    match.button.click();
    return;
  }

  if (node.playlistUri) {
    const selectedTrackUris = getSelectedTrackUrisFromContextMenu(state.rootMenu);
    if (selectedTrackUris.length > 0) {
      try {
        const existingTrackUris = await getPlaylistTrackUriSet(node.playlistUri);
        const trackUrisToAdd = selectedTrackUris.filter((uri) => !existingTrackUris.has(uri));

        closeContextMenu(state.rootMenu);

        if (trackUrisToAdd.length === 0) {
          Spicetify.showNotification("Spotify+: selected track already exists in playlist");
          return;
        }

        await (Spicetify.Platform as any)?.PlaylistAPI?.add?.(
          node.playlistUri,
          trackUrisToAdd,
          {}
        );
        for (const uri of trackUrisToAdd) {
          existingTrackUris.add(uri);
        }
        return;
      } catch {
        // Fall through to the native menu path below.
      }
    }
  }

  if (isConnectedElement(node.liveButton)) {
    node.liveButton.click();
    return;
  }

  const popup = await resolveNativePopupForNode(state, node);
  if (!popup) {
    logPlaylistLookupFailure({
      stage: "folder-popup-missing",
      actionLabel: node.actionLabel,
      playlistUri: node.playlistUri,
      rootFolderLabel: node.rootFolderLabel,
      path: node.path,
    });
  }
  const match = popup
    ? await findNativeActionMatchWithRetry(
        popup.popupMenu,
        node.playlistUri,
        node.normalizedActionLabel
      )
    : null;
  if (!match) {
    logPlaylistLookupFailure({
      stage: "folder-match-missing",
      actionLabel: node.actionLabel,
      playlistUri: node.playlistUri,
      rootFolderLabel: node.rootFolderLabel,
      path: node.path,
      ...(popup ? collectMenuDebugDetails(popup.popupMenu) : {}),
    });
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
        const triggerAction = (event: Event) => {
          event.preventDefault();
          event.stopPropagation();

          const now = Date.now();
          const lastTriggeredAt = Number(button.dataset.spotifyPlusTriggeredAt ?? "0");
          if (now - lastTriggeredAt < ACTION_TRIGGER_DEBOUNCE_MS) {
            return;
          }

          button.dataset.spotifyPlusTriggeredAt = String(now);
          closeContextMenu(state.rootMenu);
          void triggerNativeAction(state, node);
        };

        button.addEventListener("pointerdown", triggerAction);
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
        (await extractDirectAddablePlaylistEntries(popup.popupMenu, includeRootFolderLabel))
          .filter((playlist) =>
            getEligiblePlaylistNameSet(source.folder).has(
              normalizePlaylistMatchText(playlist.actionLabel)
            )
          )
          .map((playlist) => ({
            ...playlist,
            playlistUri:
              playlist.playlistUri ??
              getEligiblePlaylistUriByName(source.folder).get(
                normalizePlaylistMatchText(playlist.actionLabel)
              ) ??
              null,
          }))
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
      isConnectedElement(rootMenu) &&
      activeRootMenus.includes(rootMenu) &&
      isConnectedElement(state.sourceContainer) &&
      isConnectedElement(state.customContainer)
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
    isConnectedElement(existingState.sourceContainer) &&
    isConnectedElement(existingState.customContainer)
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
