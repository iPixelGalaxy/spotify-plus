import {
  SETTINGS_CHANGED_EVENT,
  getCachedPlaylistFolders,
  getSettings,
  type PlaylistFolderEntry,
} from "../config";
import { isElementVisible } from "../dom";
import {
  addPlaylistImage,
  cleanupDetachedStates,
  customMenuStates,
  ensureCustomMenuState,
  releaseCustomMenuState,
} from "./playlistMenu/customMenu";
import {
  CUSTOM_ROOT_CLASS,
  getItemLabel,
  getMenuChildren,
  getMenuContentContainer,
  getMenuDepth,
  getMenuItemButton,
  isDivider,
  isSearchRow,
  normalizePlaylistMatchText,
} from "./playlistMenu/helpers";
import { getPlaylistUriFromRow } from "./playlistMenu/nativeMenu";

let observer: MutationObserver | null = null;
let hasAppliedCleanup = false;

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

function isAddToPlaylistRootMenu(menu: HTMLElement) {
  if (getMenuDepth(menu) < 1) {
    return false;
  }

  const hostItem = menu.closest<HTMLElement>(".main-contextMenu-menuItem, [role='presentation']");
  if (!hostItem) return false;

  return normalizePlaylistMatchText(getItemLabel(hostItem)) === "add to playlist";
}

function isTrackedRootMenu(menu: HTMLElement) {
  return (
    isAddToPlaylistRootMenu(menu) &&
    (isElementVisible(menu) ||
      menu.classList.contains(CUSTOM_ROOT_CLASS) ||
      Boolean(menu.dataset.spotifyPlusCustomFolders))
  );
}

function syncNativePlaylistCoverArt(rootMenus: HTMLElement[]) {
  if (!getSettings().showPlaylistMenuCoverArt) return;

  for (const menu of rootMenus) {
    if (menu.classList.contains(CUSTOM_ROOT_CLASS)) continue;

    for (const row of getMenuChildren(getMenuContentContainer(menu))) {
      const button = getMenuItemButton(row);
      if (!button || isSearchRow(row) || isDivider(row)) continue;
      if (normalizePlaylistMatchText(getItemLabel(row)) === "new playlist") continue;
      if (button.getAttribute("aria-haspopup") === "menu") continue;

      addPlaylistImage(row, getPlaylistUriFromRow(row));
    }
  }
}

function applyPlaylistMenuCleanup() {
  const folders = getSelectedFolders();
  const rootMenus = Array.from(
    document.querySelectorAll<HTMLElement>(".main-contextMenu-menu, [role='menu']")
  ).filter((menu) => isTrackedRootMenu(menu));

  syncNativePlaylistCoverArt(rootMenus);

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
    settings.showPlaylistMenuCoverArt ||
    (settings.overridePlaylistFolderBehavior &&
      Array.isArray(settings.playlistOverrideFolderIds) &&
      settings.playlistOverrideFolderIds.length > 0);

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
    key !== "playlistOverrideFolderIds" &&
    key !== "showPlaylistMenuCoverArt"
  ) {
    return;
  }

  if (key === "showPlaylistMenuCoverArt") {
    resetPlaylistMenuCleanup();
    if (!getSettings().showPlaylistMenuCoverArt) {
      document
        .querySelectorAll<HTMLElement>(".spotify-plus-playlist-menu-image-slot")
        .forEach((slot) => slot.remove());
    }
  }

  refreshPlaylistMenuController();
}

export function startPlaylistMenuController() {
  refreshPlaylistMenuController();
  window.addEventListener(SETTINGS_CHANGED_EVENT, onSettingsChanged);
}
