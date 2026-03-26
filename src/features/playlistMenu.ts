import {
  SETTINGS_CHANGED_EVENT,
  getCachedPlaylistFolders,
  getSettings,
  type PlaylistFolderEntry,
} from "../config";
import { isElementVisible } from "../dom";
import {
  cleanupDetachedStates,
  customMenuStates,
  ensureCustomMenuState,
  releaseCustomMenuState,
} from "./playlistMenu/customMenu";
import { CUSTOM_ROOT_CLASS, getItemLabel, getMenuDepth, normalizePlaylistMatchText } from "./playlistMenu/helpers";

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
  if (
    getMenuDepth(menu) !== 1 ||
    menu.querySelector(".x-filterBox-filterInputContainer, .x-filterBox-filterInput") ===
      null
  ) {
    return false;
  }

  const hostItem = menu.closest<HTMLElement>(".main-contextMenu-menuItem");
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
