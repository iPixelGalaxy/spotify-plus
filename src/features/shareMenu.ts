import { getSetting, SETTINGS_CHANGED_EVENT } from "../config";
import { isElementVisible, normalizeText, toggleElementDisplay } from "../dom";

const MARKER_ATTRIBUTE = "data-spotify-plus-share-menu";
const NATIVE_ATTRIBUTE = "data-spotify-plus-native-share";
const SHARE_LABEL = "share";
const PLUGIN_SHARE_LABEL = "share\u2063";
const SHARE_ICON_PATH =
  '<path d="M1 5.75A.75.75 0 0 1 1.75 5H4v1.5H2.5v8h11v-8H12V5h2.25a.75.75 0 0 1 .75.75v9.5a.75.75 0 0 1-.75.75H1.75a.75.75 0 0 1-.75-.75z"></path><path d="M8 9.576a.75.75 0 0 0 .75-.75V2.903l1.454 1.454a.75.75 0 0 0 1.06-1.06L8 .03 4.735 3.296a.75.75 0 0 0 1.06 1.061L7.25 2.903v5.923c0 .414.336.75.75.75"></path>';
const EMBED_ICON_PATH =
  '<path d="M5.53 2.47a.75.75 0 0 1 0 1.06L2.06 8l3.47 3.47a.75.75 0 1 1-1.06 1.06L.47 8l4-4a.75.75 0 0 1 1.06 0m4.94 0a.75.75 0 0 1 1.06 0l4 4-4 4a.75.75 0 1 1-1.06-1.06L13.94 8l-3.47-3.47a.75.75 0 0 1 0-1.06"></path>';
const EMBED_TYPES = new Set(["track", "album", "artist", "playlist", "show", "episode", "audiobook"]);
const SHARE_LABELS = ["Song", "Album", "artist", "playlist", "Podcast", "Episode", "Audiobook", "profile", "concert", "venue", "Link"];
let syncTimeouts: number[] = [];

type ShareTarget = { uri: string; url: string; type: string; label: string };

function getShareTarget(uris: string[]): ShareTarget | null {
  if (!Array.isArray(uris) || uris.length !== 1) return null;

  try {
    const parsed = Spicetify.URI.fromString(uris[0]);
    const url = new URL(parsed.toURLPath(true), "https://open.spotify.com");
    if (url.origin !== "https://open.spotify.com") return null;
    url.search = "";
    url.hash = "";
    return { uri: uris[0], url: url.toString(), type: String(parsed.type).toLowerCase(), label: getShareLabel(parsed.type) };
  } catch {
    return null;
  }
}

function getShareLabel(type: string) {
  const labels: Record<string, string> = {
    track: "Song", album: "Album", artist: "artist", playlist: "playlist", show: "Podcast",
    episode: "Episode", audiobook: "Audiobook", user: "profile", concert: "concert", venue: "venue",
  };
  return labels[String(type).toLowerCase()] ?? "Link";
}

function matchesShareLabel(uris: string[], label: string) {
  const target = getShareTarget(uris);
  return getSetting("restoreOldShareMenu") && target !== null && target.label === label;
}

function shouldAddShareMenu(uris: string[]) {
  return getSetting("restoreOldShareMenu") && getShareTarget(uris) !== null;
}

async function copyLink(uris: string[]) {
  const target = getShareTarget(uris);
  if (!target) return;
  try {
    if (Spicetify.Platform?.ClipboardAPI?.copy) Spicetify.Platform.ClipboardAPI.copy(target.url);
    else await navigator.clipboard.writeText(target.url);
    Spicetify.showNotification(`Spotify+: copied ${target.label.toLowerCase()} link`);
  } catch {
    Spicetify.showNotification("Spotify+: failed to copy link", true);
  }
}

function rootMenu() {
  return Array.from(
    document.querySelectorAll<HTMLElement>("[role='menu'][data-depth='0']")
  ).find(isElementVisible) ?? null;
}

function immediateItems(menu: HTMLElement) {
  return Array.from(menu.children).filter(
    (item): item is HTMLElement => item instanceof HTMLElement && item.getAttribute("role") === "presentation" && item.querySelector(":scope > [role='menuitem']") !== null
  );
}

function itemLabel(item: HTMLElement) {
  return normalizeText(item.textContent);
}

function findNativeShare() {
  const menu = rootMenu();
  if (!menu) return null;
  return immediateItems(menu).find((item) => itemLabel(item) === SHARE_LABEL && !item.hasAttribute(MARKER_ATTRIBUTE)) ?? null;
}

function clickNativeShare() {
  const nativeShare = document.querySelector<HTMLElement>(`[${NATIVE_ATTRIBUTE}]`) ?? findNativeShare();
  const button = nativeShare?.querySelector<HTMLElement>("button") ?? nativeShare;
  if (!button) {
    Spicetify.showNotification("Spotify+: Share action unavailable", true);
    return false;
  }
  button.click();
  return true;
}

async function openEmbed(uris: string[]) {
  const target = getShareTarget(uris);
  if (!target || !EMBED_TYPES.has(target.type)) return;
  if (!clickNativeShare()) return;

  const deadline = Date.now() + 2000;
  while (Date.now() < deadline) {
    const embed = Array.from(document.querySelectorAll<HTMLElement>("button, [role='button'], a")).find(
      (element) => isElementVisible(element) && normalizeText(element.textContent) === "embed"
    );
    if (embed) {
      embed.click();
      return;
    }
    await new Promise((resolve) => window.setTimeout(resolve, 50));
  }
  Spicetify.showNotification("Spotify+: Embed action unavailable", true);
}

function restoreNativeShare() {
  for (const nativeShare of document.querySelectorAll<HTMLElement>(`[${NATIVE_ATTRIBUTE}]`)) {
    toggleElementDisplay(nativeShare, false);
    nativeShare.removeAttribute(NATIVE_ATTRIBUTE);
  }
}

function syncShareMenu() {
  if (!getSetting("restoreOldShareMenu")) {
    restoreNativeShare();
    return;
  }

  const menu = rootMenu();
  if (!menu) return;
  const items = immediateItems(menu);
  const pluginShare =
    items.find((item) => item.hasAttribute(MARKER_ATTRIBUTE)) ??
    items.find((item) => itemLabel(item) === PLUGIN_SHARE_LABEL);
  const nativeShare = items.find((item) => itemLabel(item) === SHARE_LABEL);
  if (!pluginShare || !nativeShare || !pluginShare.parentElement) return;

  pluginShare.setAttribute(MARKER_ATTRIBUTE, "");
  nativeShare.setAttribute(NATIVE_ATTRIBUTE, "");
  pluginShare.className = nativeShare.className;
  const pluginButton = pluginShare.querySelector<HTMLElement>("button");
  const nativeButton = nativeShare.querySelector<HTMLElement>("button");
  if (pluginButton && nativeButton) {
    pluginButton.className = nativeButton.className;
    const labelWrapper = pluginButton.querySelector<HTMLElement>(
      ":scope > div:not(.main-contextMenu-menuItemIconWrapper)"
    );
    const nativeIconWrapper = nativeButton.querySelector<HTMLElement>(
      ":scope > div > div:has([data-encore-id='icon'])"
    );
    if (labelWrapper && nativeIconWrapper) {
      labelWrapper.querySelector(":scope > div:has([data-encore-id='icon'])")?.remove();
      const iconWrapper = nativeIconWrapper.cloneNode(true) as HTMLElement;
      iconWrapper.dataset.spotifyPlusShareIcon = "true";
      labelWrapper.insertBefore(iconWrapper, labelWrapper.firstChild);
    }
  }
  pluginShare.parentElement.insertBefore(pluginShare, nativeShare);
  toggleElementDisplay(nativeShare, true);
}

function scheduleSync() {
  for (const timeout of syncTimeouts) window.clearTimeout(timeout);
  syncTimeouts = [0, 25, 75, 150, 300, 600].map((delay) => window.setTimeout(syncShareMenu, delay));
}

export function startShareMenuController() {
  const copyItems = SHARE_LABELS.map(
    (label) =>
      new Spicetify.ContextMenu.Item(
        `Copy link to ${label}`,
        (uris) => void copyLink(uris),
        (uris) => matchesShareLabel(uris, label),
        Spicetify.SVGIcons?.copy ?? "copy"
      )
  );
  const embedItems = SHARE_LABELS.map(
    (label) =>
      new Spicetify.ContextMenu.Item(
        `Embed ${label}`,
        (uris) => {
          void openEmbed(uris);
        },
        (uris) => {
          const target = getShareTarget(uris);
          return matchesShareLabel(uris, label) && EMBED_TYPES.has(target?.type ?? "");
        },
        EMBED_ICON_PATH
      )
  );
  const dialogItem = new Spicetify.ContextMenu.Item(
    "Open new Share dialog",
    () => void clickNativeShare(),
    shouldAddShareMenu,
    SHARE_ICON_PATH
  );
  const shareMenu = new Spicetify.ContextMenu.SubMenu(
    `Share\u2063`,
    [...copyItems, ...embedItems, dialogItem],
    shouldAddShareMenu
  );
  shareMenu.register();

  document.addEventListener("contextmenu", scheduleSync, true);
  window.addEventListener(SETTINGS_CHANGED_EVENT, (event) => {
    if ((event as CustomEvent<{ key?: string }>).detail?.key === "restoreOldShareMenu") scheduleSync();
  });
}
