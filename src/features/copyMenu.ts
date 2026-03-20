import { normalizeText } from "../dom";

const COPY_MENU_ICON_CLASS = "spotify-plus-copy-menu-icon";
const COPY_MENU_STYLE_ID = "spotify-plus-copy-menu-style";
const COPY_MENU_WRAPPER_CLASS = "spotify-plus-copy-menu-wrapper";
const COPY_ICON_PATH =
  "M5 1.25h4.55c1 0 1.8.8 1.8 1.8V4.1H9.9V3.2a.45.45 0 0 0-.45-.45H5.2a.45.45 0 0 0-.45.45v6.1c0 .25.2.45.45.45h.95v1.45H5A1.7 1.7 0 0 1 3.3 9.5V2.95c0-.94.76-1.7 1.7-1.7m3.35 3.55h3.7c.91 0 1.65.74 1.65 1.65v6.25c0 .91-.74 1.65-1.65 1.65h-3.7c-.91 0-1.65-.74-1.65-1.65V6.45c0-.91.74-1.65 1.65-1.65m.1 1.4a.35.35 0 0 0-.35.35v5.95c0 .19.16.35.35.35h3.5a.35.35 0 0 0 .35-.35V6.55a.35.35 0 0 0-.35-.35zm.8 1.35h2.4V8.7h-2.4zm0 1.9h2.4V10.6h-2.4z";
const COPY_SONG_ARTIST_ICON_PATH =
  '<path fill="currentColor" d="M11.6 2.95A4.28 4.28 0 0 0 7.56.05a4.28 4.28 0 0 0-4.03 2.9A5.1 5.1 0 0 0 3.3 4.8c.05 1.26.5 2.42 1.33 3.37l.13.16c.2.24.14.6-.13.76L2.5 10.32A4.65 4.65 0 0 0 0 14.4V16h8.35v-1.4H1.5v-.2c0-1.17.62-2.24 1.64-2.82l2.14-1.22a2.13 2.13 0 0 0 .56-3.2l-.12-.15A3.66 3.66 0 0 1 4.8 4.74c.02-.42.1-.82.23-1.2a2.73 2.73 0 0 1 1.5-1.63 2.8 2.8 0 0 1 3.17.66c.25.28.44.6.56.96.12.4.16.82.14 1.24-.05.88-.39 1.7-.95 2.34l-.13.16a2.13 2.13 0 0 0-.34 2.33 3.85 3.85 0 0 1 1.05-.76 3.55 3.55 0 0 1 .46-2.02l.12-.15a5.2 5.2 0 0 0 1.31-3.2 5.1 5.1 0 0 0-.2-1.75m.56 7.83.83-.83a1.9 1.9 0 0 1 2.68 2.68l-.92.92-.98-.98.92-.92a.5.5 0 0 0-.7-.71l-.83.83zm-2.98 2.98.92-.92.98.98-.83.83a.5.5 0 1 0 .7.71l.83-.83.98.98-.92.92a1.9 1.9 0 1 1-2.68-2.68m1.13-1.85.98-.98 2.73 2.73-.98.98z"></path>';
const COPY_LABELS = new Set(["copy", "copy ids"]);
let syncTimeouts: number[] = [];
const trackSummaryCache = new Map<string, Promise<{ name: string; artists: string[] } | null>>();

function isTrackUri(uri: string) {
  try {
    return Spicetify.URI.fromString(uri).type === Spicetify.URI.Type.TRACK;
  } catch {
    return false;
  }
}

function shouldAddCopyMenu(uris: string[]) {
  return Array.isArray(uris) && uris.length > 0 && uris.every(isTrackUri);
}

function shouldAddCopySubMenu(uris: string[]) {
  return shouldAddCopyMenu(uris) && uris.length === 1;
}

function shouldAddCopyIdsItem(uris: string[]) {
  return shouldAddCopyMenu(uris) && uris.length > 1;
}

function getTrackIds(uris: string[]) {
  return uris
    .map((uri) => {
      try {
        return Spicetify.URI.fromString(uri).id ?? null;
      } catch {
        return null;
      }
    })
    .filter((id): id is string => Boolean(id));
}

async function copyTextToClipboard(text: string, successMessage: string) {
  try {
    if (Spicetify.Platform?.ClipboardAPI?.copy) {
      Spicetify.Platform.ClipboardAPI.copy(text);
    } else {
      await navigator.clipboard.writeText(text);
    }
    Spicetify.showNotification(successMessage);
  } catch {
    Spicetify.showNotification("Spotify+: failed to copy to clipboard", true);
  }
}

async function fetchTrackSummary(uri: string) {
  const cached = trackSummaryCache.get(uri);
  if (cached) {
    return cached;
  }

  const pending = (async () => {
    const graphQl = Spicetify.GraphQL;
    const nameDefinition = graphQl?.Definitions?.getTrackName;
    const artistsDefinition = graphQl?.Definitions?.queryTrackArtists;
    if (!nameDefinition || !artistsDefinition || typeof graphQl?.Request !== "function") {
      return null;
    }

    try {
      const [nameResponse, artistResponse] = await Promise.all([
        graphQl.Request(nameDefinition, { uri, offset: 0, limit: 1 }),
        graphQl.Request(artistsDefinition, { uri, trackUri: uri, offset: 0, limit: 10 }),
      ]);

      const name = nameResponse?.data?.trackUnion?.name;
      const artists = artistResponse?.data?.trackUnion?.artists?.items
        ?.map((item: { profile?: { name?: string } }) => item?.profile?.name)
        .filter(Boolean);

      if (!name || !Array.isArray(artists) || artists.length === 0) {
        return null;
      }

      return { name, artists };
    } catch {
      return null;
    }
  })();

  trackSummaryCache.set(uri, pending);
  return pending;
}

async function copySongAndArtistNames(uris: string[]) {
  if (uris.length === 0) {
    Spicetify.showNotification("Spotify+: no track selected", true);
    return;
  }

  const summaries = await Promise.all(uris.map((uri) => fetchTrackSummary(uri)));
  const lines = summaries
    .filter((summary): summary is NonNullable<typeof summary> => Boolean(summary))
    .map((summary) => `${summary.name} - ${summary.artists.join(", ")}`);

  if (lines.length === 0) {
    Spicetify.showNotification("Spotify+: couldn't resolve track metadata", true);
    return;
  }

  await copyTextToClipboard(
    lines.join("\n"),
    `Spotify+: copied ${lines.length} song${lines.length === 1 ? "" : "s"}`
  );
}

async function copyTrackIds(uris: string[]) {
  const ids = getTrackIds(uris);
  if (ids.length === 0) {
    Spicetify.showNotification("Spotify+: no track IDs found", true);
    return;
  }

  await copyTextToClipboard(
    ids.join(", "),
    `Spotify+: copied ${ids.length} track ID${ids.length === 1 ? "" : "s"}`
  );
}

function ensureCopyMenuStyles() {
  if (document.getElementById(COPY_MENU_STYLE_ID)) {
    return;
  }

  const style = document.createElement("style");
  style.id = COPY_MENU_STYLE_ID;
  style.textContent = `
.${COPY_MENU_WRAPPER_CLASS} {
  display: inline-flex !important;
  align-items: center !important;
  gap: 10px !important;
}

.${COPY_MENU_WRAPPER_CLASS}::before {
  content: "";
  width: calc(var(--encore-graphic-size-decorative-smaller) + 3px);
  height: calc(var(--encore-graphic-size-decorative-smaller) + 3px);
  flex: 0 0 calc(var(--encore-graphic-size-decorative-smaller) + 3px);
  background-color: var(--text-subdued, #656565);
  -webkit-mask-repeat: no-repeat;
  -webkit-mask-position: center;
  -webkit-mask-size: 100% 100%;
  -webkit-mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath d='${COPY_ICON_PATH}'/%3E%3C/svg%3E");
}

.main-contextMenu-menu [data-encore-id="icon"] {
  color: var(--text-subdued, #656565);
}
`;

  document.head.appendChild(style);
}

function getItemLabel(item: HTMLElement) {
  const labelElement = item.querySelector<HTMLElement>(
    ".main-contextMenu-menuItemLabel, [data-encore-id='text'], [data-encore-id='type'], .TypeElement-type-mesto"
  );
  return normalizeText(labelElement?.textContent);
}

function injectCopyMenuIcon(item: HTMLElement) {
  const button = item.querySelector<HTMLElement>(":scope > .main-contextMenu-menuItemButton");
  if (!button) {
    return;
  }
  for (const misplacedIcon of button.querySelectorAll<HTMLElement>(
    `:scope > .${COPY_MENU_ICON_CLASS}, .${COPY_MENU_ICON_CLASS}`
  )) {
    misplacedIcon.remove();
  }

  const leadingGroup =
    button.querySelector<HTMLElement>(":scope > .NmDvKwRDGCojAFsFCOu1") ??
    button.querySelector<HTMLElement>(":scope > div:not(.Ewi6k41lmVvG1mxXoCx4)");
  if (!(leadingGroup instanceof HTMLElement)) {
    return;
  }

  const label =
    leadingGroup.querySelector<HTMLElement>("[data-encore-id='type']") ??
    leadingGroup.querySelector<HTMLElement>("[data-encore-id='text']") ??
    leadingGroup.querySelector<HTMLElement>(".main-contextMenu-menuItemLabel");
  if (!(label instanceof HTMLElement)) {
    return;
  }
  leadingGroup.classList.add(COPY_MENU_WRAPPER_CLASS);
}

function getImmediateMenuItems(menu: HTMLElement) {
  return Array.from(menu.querySelectorAll<HTMLElement>(".main-contextMenu-menuItem")).filter(
    (item) => item.closest(".main-contextMenu-menu") === menu
  );
}

function getVisibleRootContextMenu() {
  return document.querySelector<HTMLElement>(
    '#context-menu .main-contextMenu-menu[data-depth="0"], #context-menu .main-contextMenu-menu:not([data-depth])'
  );
}

function syncCopyMenuPlacement() {
  const menu = getVisibleRootContextMenu();
  if (!menu) {
    return;
  }

  const items = getImmediateMenuItems(menu);
  const copyItems = items.filter((item) => COPY_LABELS.has(getItemLabel(item)));
  if (copyItems.length === 0) {
    return;
  }

  const shareItem = items.find((item) => getItemLabel(item) === "share");
  for (const copyItem of copyItems) {
    injectCopyMenuIcon(copyItem);

    if (!shareItem || shareItem === copyItem || !shareItem.parentElement) {
      continue;
    }

    shareItem.parentElement.insertBefore(copyItem, shareItem);
  }
}

function scheduleCopyMenuSync() {
  for (const timeoutId of syncTimeouts) {
    window.clearTimeout(timeoutId);
  }
  syncTimeouts = [];

  const delays = [0, 25, 75, 150, 300, 600];
  for (const delay of delays) {
    syncTimeouts.push(
      window.setTimeout(() => {
        syncCopyMenuPlacement();
      }, delay)
    );
  }
}

export function startCopyMenuController() {
  ensureCopyMenuStyles();

  const copySongArtistItem = new Spicetify.ContextMenu.Item(
    "Copy Song & Artist Name",
    (uris: string[]) => {
      void copySongAndArtistNames(uris);
    },
    shouldAddCopySubMenu,
    COPY_SONG_ARTIST_ICON_PATH,
    false
  );

  const copyIdItem = new Spicetify.ContextMenu.Item(
    "Copy ID",
    (uris: string[]) => {
      void copyTrackIds(uris);
    },
    shouldAddCopySubMenu,
    Spicetify.SVGIcons?.copy ?? "copy",
    false
  );

  const copyIdsItem = new Spicetify.ContextMenu.Item(
    "Copy IDs",
    (uris: string[]) => {
      void copyTrackIds(uris);
    },
    shouldAddCopyIdsItem,
    Spicetify.SVGIcons?.copy ?? "copy",
    false
  );

  const copySubMenu = new Spicetify.ContextMenu.SubMenu(
    "Copy",
    [copySongArtistItem, copyIdItem],
    shouldAddCopySubMenu,
    false
  );

  copyIdsItem.register();
  copySubMenu.register();

  document.addEventListener("contextmenu", scheduleCopyMenuSync, true);
}
