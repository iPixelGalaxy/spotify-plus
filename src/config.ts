const SETTINGS_STORAGE_PREFIX = "spotify-plus-settings";
export const PLAYLIST_FOLDER_CACHE_KEY = "spotify-plus.playlist-folders";
export const SETTINGS_CHANGED_EVENT = "spotify-plus:settings-changed";

export interface PlaylistFolderPlaylistEntry {
  name: string;
  uri: string | null;
}

function emitSettingsChanged<Key extends keyof SpotifyPlusSettings>(
  key: Key,
  value: SpotifyPlusSettings[Key]
) {
  const dispatch = () =>
    window.dispatchEvent(
      new CustomEvent(SETTINGS_CHANGED_EVENT, {
        detail: { key, value },
      })
    );

  dispatch();
  requestAnimationFrame(dispatch);
}

export interface PlaylistFolderEntry {
  id: string;
  label: string;
  path: string;
  playlists: PlaylistFolderPlaylistEntry[];
}

export interface SpotifyPlusSettings {
  enableDevtoolsOnStartup: boolean;
  hideFriendActivityButton: boolean;
  hideLyricsButton: boolean;
  hideMiniplayerButton: boolean;
  restoreOldDevicePicker: boolean;
  hideYourUpdatesSection: boolean;
  hideHomeConfigMenuItem: boolean;
  hideAccountMenuItem: boolean;
  hideProfileMenuItem: boolean;
  hideSupportMenuItem: boolean;
  hidePrivateSessionMenuItem: boolean;
  hideLogOutMenuItem: boolean;
  overridePlaylistFolderBehavior: boolean;
  playlistOverrideFolderIds: string[];
  playlistBaseFolderId: string;
}

export const defaultSettings: SpotifyPlusSettings = {
  enableDevtoolsOnStartup: true,
  hideFriendActivityButton: false,
  hideLyricsButton: false,
  hideMiniplayerButton: false,
  restoreOldDevicePicker: false,
  hideYourUpdatesSection: false,
  hideHomeConfigMenuItem: false,
  hideAccountMenuItem: false,
  hideProfileMenuItem: false,
  hideSupportMenuItem: false,
  hidePrivateSessionMenuItem: false,
  hideLogOutMenuItem: false,
  overridePlaylistFolderBehavior: false,
  playlistOverrideFolderIds: [],
  playlistBaseFolderId: "",
};

const legacySettingKeys = [
  "reloadAppWithF5",
  "pauseAppWithF8",
  "windowTitleOverride",
  "restorePreviousSession",
] as const;

function storageKey(name: keyof SpotifyPlusSettings) {
  return `${SETTINGS_STORAGE_PREFIX}.${name}`;
}

function parseStoredValue<T>(rawValue: string | null, fallback: T): T {
  if (!rawValue) return fallback;

  try {
    const parsed = JSON.parse(rawValue) as { value?: T };
    return parsed.value ?? fallback;
  } catch {
    return fallback;
  }
}

export function getSetting<Key extends keyof SpotifyPlusSettings>(
  key: Key
): SpotifyPlusSettings[Key] {
  return parseStoredValue(
    Spicetify.LocalStorage.get(storageKey(key)),
    defaultSettings[key]
  );
}

export function setSetting<Key extends keyof SpotifyPlusSettings>(
  key: Key,
  value: SpotifyPlusSettings[Key]
) {
  setSettingValue(key, value, true);
}

function setSettingValue<Key extends keyof SpotifyPlusSettings>(
  key: Key,
  value: SpotifyPlusSettings[Key],
  emit: boolean
) {
  Spicetify.LocalStorage.set(storageKey(key), JSON.stringify({ value }));
  if (emit) {
    emitSettingsChanged(key, value);
  }
}

export function ensureDefaultSettings() {
  if (typeof Spicetify.LocalStorage.remove === "function") {
    for (const key of legacySettingKeys) {
      Spicetify.LocalStorage.remove(`${SETTINGS_STORAGE_PREFIX}.${key}`);
    }
  }

  for (const [key, value] of Object.entries(defaultSettings) as Array<
    [keyof SpotifyPlusSettings, SpotifyPlusSettings[keyof SpotifyPlusSettings]]
  >) {
    if (Spicetify.LocalStorage.get(storageKey(key)) === null) {
      setSettingValue(key, value, false);
    }
  }

  const legacyFolderId = parseStoredValue(
    Spicetify.LocalStorage.get(storageKey("playlistBaseFolderId")),
    ""
  );
  const hasOverrideSetting =
    Spicetify.LocalStorage.get(storageKey("overridePlaylistFolderBehavior")) !== null;
  const hasFolderOverrideIds =
    Spicetify.LocalStorage.get(storageKey("playlistOverrideFolderIds")) !== null;

  if (legacyFolderId) {
    if (!hasOverrideSetting) {
      setSettingValue("overridePlaylistFolderBehavior", true, false);
    }

    if (!hasFolderOverrideIds) {
      setSettingValue("playlistOverrideFolderIds", [legacyFolderId], false);
    }
  }
}

export function getSettings(): SpotifyPlusSettings {
  return {
    enableDevtoolsOnStartup: getSetting("enableDevtoolsOnStartup"),
    hideFriendActivityButton: getSetting("hideFriendActivityButton"),
    hideLyricsButton: getSetting("hideLyricsButton"),
    hideMiniplayerButton: getSetting("hideMiniplayerButton"),
    restoreOldDevicePicker: getSetting("restoreOldDevicePicker"),
    hideYourUpdatesSection: getSetting("hideYourUpdatesSection"),
    hideHomeConfigMenuItem: getSetting("hideHomeConfigMenuItem"),
    hideAccountMenuItem: getSetting("hideAccountMenuItem"),
    hideProfileMenuItem: getSetting("hideProfileMenuItem"),
    hideSupportMenuItem: getSetting("hideSupportMenuItem"),
    hidePrivateSessionMenuItem: getSetting("hidePrivateSessionMenuItem"),
    hideLogOutMenuItem: getSetting("hideLogOutMenuItem"),
    overridePlaylistFolderBehavior: getSetting("overridePlaylistFolderBehavior"),
    playlistOverrideFolderIds: getSetting("playlistOverrideFolderIds"),
    playlistBaseFolderId: getSetting("playlistBaseFolderId"),
  };
}

export function getCachedPlaylistFolders(): PlaylistFolderEntry[] {
  const folders = parseStoredValue(Spicetify.LocalStorage.get(PLAYLIST_FOLDER_CACHE_KEY), []);

  return Array.isArray(folders)
    ? folders.map((folder) => ({
        ...folder,
        playlists: Array.isArray(folder?.playlists)
          ? folder.playlists.map((playlist) =>
              typeof playlist === "string"
                ? { name: playlist, uri: null }
                : {
                    name:
                      typeof playlist?.name === "string" ? playlist.name : String(playlist?.name ?? ""),
                    uri: typeof playlist?.uri === "string" ? playlist.uri : null,
                  }
            )
          : [],
      }))
    : [];
}

export function setCachedPlaylistFolders(folders: PlaylistFolderEntry[]) {
  Spicetify.LocalStorage.set(PLAYLIST_FOLDER_CACHE_KEY, JSON.stringify({ value: folders }));
}
