import { normalizeText } from "../../dom";
import {
  ACTION_MATCH_MAX_ATTEMPTS,
  ACTION_MATCH_RETRY_DELAY_MS,
  FOLDER_OPEN_MAX_ATTEMPTS,
  FOLDER_OPEN_RETRY_DELAY_MS,
  getItemLabel,
  getMenuChildren,
  getMenuContentContainer,
  isBlockedPlaylistName,
  isConnectedElement,
  isDivider,
  isSearchRow,
  normalizePlaylistMatchText,
  wait,
  type NativePlaylistEntry,
  type RootFolderSource,
} from "./helpers";

const playlistMetadataEligibilityCache = new Map<string, Promise<boolean>>();
const playlistContentsUriCache = new Map<string, Promise<Set<string>>>();

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

export function getSelectedTrackUrisFromContextMenu(rootMenu: HTMLElement) {
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

export function closeContextMenu(rootMenu: HTMLElement) {
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

export async function getPlaylistTrackUriSet(playlistUri: string) {
  const cached = playlistContentsUriCache.get(playlistUri);
  if (cached) {
    return cached;
  }

  const pending = (async () => {
    try {
      const items =
        (await Spicetify.Platform?.PlaylistAPI?.getContents?.(playlistUri, {
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

export function getPlaylistUriFromRow(row: HTMLElement | null | undefined): string | null {
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
      const metadata = await Spicetify.Platform?.PlaylistAPI?.getMetadata?.(uri);
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

export function getNestedPopup(parentItem: HTMLElement | null | undefined) {
  if (!parentItem || typeof parentItem.querySelectorAll !== "function") {
    return null;
  }

  const popupMenu = Array.from(
    parentItem.querySelectorAll<HTMLElement>(".main-contextMenu-menu")
  ).find((menu) => Number(menu.getAttribute("data-depth") ?? "0") >= 2);
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

export async function ensureNestedPopupReady(parentItem: HTMLElement, button: HTMLElement) {
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

export async function findNativeActionMatchWithRetry(
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

export function findMenuItemByLabel(scope: ParentNode | null | undefined, label: string) {
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

export function collectMenuDebugDetails(scope: ParentNode | null | undefined) {
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

export async function resolveFolderSourceInMenu(
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

export async function extractDirectAddablePlaylistEntries(popupMenu: HTMLElement) {
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
    if (normalizedActionLabel === "new playlist" || isBlockedPlaylistName(normalizedActionLabel)) {
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
