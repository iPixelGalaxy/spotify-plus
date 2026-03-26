import type { PlaylistFolderEntry } from "../../config";
import {
  ACTION_TRIGGER_DEBOUNCE_MS,
  CUSTOM_CONTAINER_CLASS,
  CUSTOM_ROOT_CLASS,
  CUSTOM_SOURCE_CLASS,
  createActionNode,
  createDividerClone,
  createDividerNode,
  createFallbackMenuRow,
  getFirstDividerTemplate,
  getFolderSource,
  getMenuContentContainer,
  isBlockedPlaylistName,
  isConnectedElement,
  logPlaylistLookupFailure,
  normalizePlaylistMatchText,
  scrubClonedNode,
  trimMenuDividers,
  type ActionMenuNode,
  type CustomMenuState,
  type MenuNode,
  type NativePlaylistEntry,
} from "./helpers";
import {
  closeContextMenu,
  collectMenuDebugDetails,
  ensureNestedPopupReady,
  extractDirectAddablePlaylistEntries,
  findMenuItemByLabel,
  findNativeActionMatchWithRetry,
  getPlaylistTrackUriSet,
  getSelectedTrackUrisFromContextMenu,
  resolveFolderSourceInMenu,
} from "./nativeMenu";

export const customMenuStates = new Map<HTMLElement, CustomMenuState>();

function getSelectedFolderIdsKey(folders: PlaylistFolderEntry[]) {
  return folders.map((folder) => folder.id).join("|");
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
      );

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

        await Spicetify.Platform?.PlaylistAPI?.add?.(node.playlistUri, trackUrisToAdd, {});
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
        (await extractDirectAddablePlaylistEntries(popup.popupMenu))
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

export function releaseCustomMenuState(rootMenu: HTMLElement) {
  const state = customMenuStates.get(rootMenu);
  if (!state) return;

  state.rootMenu.classList.remove(CUSTOM_ROOT_CLASS);
  state.sourceContainer.classList.remove(CUSTOM_SOURCE_CLASS);
  state.customContainer.remove();
  delete state.rootMenu.dataset.spotifyPlusCustomFolders;

  customMenuStates.delete(rootMenu);
}

export function cleanupDetachedStates(activeRootMenus: HTMLElement[]) {
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

export function ensureCustomMenuState(rootMenu: HTMLElement, folders: PlaylistFolderEntry[]) {
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
