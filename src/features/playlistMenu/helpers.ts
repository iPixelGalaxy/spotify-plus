import { normalizeText } from "../../dom";

export const CUSTOM_ROOT_CLASS = "spotify-plus-custom-playlist-root";
export const CUSTOM_SOURCE_CLASS = "spotify-plus-custom-playlist-source";
export const CUSTOM_CONTAINER_CLASS = "spotify-plus-custom-playlist-container";
export const FOLDER_OPEN_RETRY_DELAY_MS = 75;
export const FOLDER_OPEN_MAX_ATTEMPTS = 8;
export const ACTION_MATCH_RETRY_DELAY_MS = 50;
export const ACTION_MATCH_MAX_ATTEMPTS = 8;
export const ACTION_TRIGGER_DEBOUNCE_MS = 750;

export type DividerMenuNode = {
  kind: "divider";
  template: HTMLElement | null;
};

export type ActionMenuNode = {
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

export type MenuNode = DividerMenuNode | ActionMenuNode;

export type RootFolderSource = {
  folder: {
    id: string;
    label: string;
    path: string;
    playlists: Array<{ name: string; uri: string | null }>;
  };
  sourceKey: string;
  pathSegments: string[];
};

export type NativePlaylistEntry = {
  displayLabel: string;
  actionLabel: string;
  playlistUri: string | null;
  template: HTMLElement | null;
  liveButton: HTMLElement | null;
};

export type CustomMenuState = {
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

export type PlaylistLookupDebugDetails = {
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

const BLOCKED_PLAYLIST_PATTERNS = [
  "dj",
  "dj on repeat",
  "discover weekly",
  "on repeat",
  "repeat rewind",
  "daylist",
  "your episodes",
];

export function normalizePlaylistMatchText(value: string | null | undefined) {
  return normalizeText(value)
    .normalize("NFKD")
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
    .replace(/[`´]/g, "'")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export function logPlaylistLookupFailure(details: PlaylistLookupDebugDetails) {
  console.warn("[Spotify+] Add to playlist lookup failed", details);
}

export function isBlockedPlaylistName(value: string) {
  const normalizedValue = normalizeText(value);
  return BLOCKED_PLAYLIST_PATTERNS.some((pattern) => normalizedValue.includes(pattern));
}

export function wait(ms: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

export function isConnectedElement(element: Node | null | undefined) {
  return Boolean(element && "isConnected" in element && element.isConnected);
}

export function getMenuDepth(menu: HTMLElement) {
  return Number(menu.getAttribute("data-depth") ?? "0");
}

export function getMenuContentContainer(menu: HTMLElement) {
  return menu.querySelector<HTMLElement>(":scope > div") ?? menu;
}

export function getMenuChildren(target: HTMLElement) {
  return Array.from(target.children).filter(
    (child): child is HTMLElement => child instanceof HTMLElement
  );
}

export function getItemLabel(item: HTMLElement) {
  const labelElement = item.querySelector<HTMLElement>(
    ".main-contextMenu-menuItemLabel, [data-encore-id='text'], .TypeElement-type-mesto"
  );
  return normalizeText(labelElement?.textContent);
}

export function isSearchRow(item: HTMLElement) {
  return (
    item.classList.contains("NYplcvf1o79tewx0Wc83") ||
    item.querySelector(".x-filterBox-filterInputContainer, .x-filterBox-filterInput") !==
      null
  );
}

export function isDivider(item: HTMLElement) {
  return (
    item.classList.contains("main-contextMenu-dividerAfter") ||
    item.classList.contains("main-contextMenu-dividerBefore")
  );
}

export function getFolderSource(folder: RootFolderSource["folder"]): RootFolderSource {
  return {
    folder,
    sourceKey: folder.id,
    pathSegments: folder.path
      .split("/")
      .map((segment) => segment.trim())
      .filter(Boolean),
  };
}

export function getFirstDividerTemplate(target: HTMLElement) {
  return getMenuChildren(target).find((child) => isDivider(child)) ?? null;
}

export function createFallbackMenuRow(label: string) {
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

export function createDividerClone(template: HTMLElement | null) {
  if (template) {
    return template.cloneNode(true) as HTMLElement;
  }

  const divider = document.createElement("div");
  divider.className = "main-contextMenu-dividerAfter";
  return divider;
}

export function scrubClonedNode(node: HTMLElement | null | undefined) {
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

export function trimMenuDividers(container: HTMLElement) {
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

export function createDividerNode(template: HTMLElement | null): DividerMenuNode {
  return { kind: "divider", template };
}

export function createActionNode(
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
