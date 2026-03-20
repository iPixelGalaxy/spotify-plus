import {
  getCachedPlaylistFolders,
  setCachedPlaylistFolders,
  type PlaylistFolderEntry,
  type PlaylistFolderPlaylistEntry,
} from "./config";

function normalizeLabel(value: string | null | undefined) {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function toFolderEntry(
  label: string,
  path: string,
  playlists: PlaylistFolderPlaylistEntry[] = []
): PlaylistFolderEntry {
  return {
    id: slugify(path || label),
    label,
    path: path || label,
    playlists,
  };
}

function readString(value: unknown) {
  return typeof value === "string" ? normalizeLabel(value) : "";
}

function looksLikeFolder(node: Record<string, unknown>) {
  const type = readString(node.type);
  const uri = readString(node.uri);
  const hasChildren =
    Array.isArray(node.items) ||
    Array.isArray(node.children) ||
    Array.isArray(node.rows) ||
    Array.isArray(node.entries);

  return type.includes("folder") || uri.includes(":folder:") || hasChildren;
}

function collectChildren(node: Record<string, unknown>) {
  const keys = ["items", "children", "rows", "entries"];

  for (const key of keys) {
    const value = node[key];
    if (Array.isArray(value)) return value as unknown[];
  }

  return [];
}

function extractName(node: Record<string, unknown>) {
  return (
    readString(node.name) ||
    readString(node.title) ||
    readString(node.label) ||
    readString(node.text)
  );
}

type PlaylistCandidate = {
  name: string;
  uri: string;
};

const PLAYLIST_METADATA_CONCURRENCY = 8;
const playlistMetadataCache = new Map<string, Promise<PlaylistFolderPlaylistEntry | null>>();

function collectDirectPlaylistCandidates(
  node: Record<string, unknown>,
  target: PlaylistCandidate[] = []
) {
  const children = collectChildren(node);

  for (const child of children) {
    if (!child || typeof child !== "object") continue;
    const entry = child as Record<string, unknown>;
    const type = readString(entry.type);
    const uri = readString(entry.uri);
    const name = extractName(entry);

    if (
      name &&
      (type.includes("playlist") || uri.includes("spotify:playlist:") || uri.includes(":playlist:"))
    ) {
      target.push({ name, uri });
    }
  }

  return target;
}

async function filterAddablePlaylists(candidates: PlaylistCandidate[]) {
  const playlistApi = (Spicetify.Platform as any)?.PlaylistAPI;
  const results: Array<PlaylistFolderPlaylistEntry | null> = Array.from(
    { length: candidates.length },
    () => null
  );
  let nextIndex = 0;

  const resolveCandidate = async (candidate: PlaylistCandidate) => {
    if (!candidate.uri || !playlistApi?.getMetadata) {
      return { name: candidate.name, uri: candidate.uri || null };
    }

    const cached = playlistMetadataCache.get(candidate.uri);
    if (cached) {
      return cached;
    }

    const pending = (async () => {
      try {
        const metadata = await playlistApi.getMetadata(candidate.uri);
        if (!metadata) {
          return { name: candidate.name, uri: candidate.uri };
        }

        if (metadata.madeFor) {
          return null;
        }

        if (metadata.canAdd === false || metadata.canEditItems === false) {
          return null;
        }

        const formatType = readString(metadata.formatListData?.type);
        if (formatType.includes("daylist")) {
          return null;
        }

        return { name: candidate.name, uri: candidate.uri };
      } catch {
        return { name: candidate.name, uri: candidate.uri };
      }
    })();

    playlistMetadataCache.set(candidate.uri, pending);
    return pending;
  };

  const workers = Array.from(
    { length: Math.min(PLAYLIST_METADATA_CONCURRENCY, candidates.length) },
    async () => {
      while (nextIndex < candidates.length) {
        const currentIndex = nextIndex;
        nextIndex += 1;
        results[currentIndex] = await resolveCandidate(candidates[currentIndex]);
      }
    }
  );

  await Promise.all(workers);
  return results.filter((playlist): playlist is PlaylistFolderPlaylistEntry => playlist !== null);
}

async function traverseFolderNodes(
  node: unknown,
  folders: Map<string, PlaylistFolderEntry>,
  path: string[] = []
) {
  if (!node || typeof node !== "object") return;

  const entry = node as Record<string, unknown>;
  const name = extractName(entry);
  const children = collectChildren(entry);
  const isRealNamedFolder = Boolean(name) && name !== "<root>";
  const nextPath = isRealNamedFolder ? [...path, name] : path;

  if (isRealNamedFolder && looksLikeFolder(entry)) {
    const folderPath = nextPath.join(" / ");
    const directPlaylists = await filterAddablePlaylists(
      collectDirectPlaylistCandidates(entry)
    );
    folders.set(
      slugify(folderPath),
      toFolderEntry(name, folderPath, directPlaylists)
    );
  }

  for (const child of children) {
    await traverseFolderNodes(child, folders, nextPath);
  }
}

async function scanPlaylistFoldersFromApi(): Promise<PlaylistFolderEntry[]> {
  const rootlistApi = (Spicetify.Platform as any)?.RootlistAPI;
  if (!rootlistApi) return [];

  const candidateCalls = [
    () => rootlistApi.getContents?.(),
    () => rootlistApi.getRootContents?.(),
    () => rootlistApi.getContents?.({}),
  ];

  for (const getData of candidateCalls) {
    try {
      const data = await getData();
      if (!data) continue;

      const folders = new Map<string, PlaylistFolderEntry>();
      await traverseFolderNodes(data, folders);
      if (folders.size > 0) return Array.from(folders.values());
    } catch {
      continue;
    }
  }

  return [];
}

function getTextFromRow(row: HTMLElement) {
  const texts = Array.from(row.querySelectorAll<HTMLElement>("span, div, a, button"))
    .map((element) => normalizeLabel(element.textContent))
    .filter(Boolean);

  return texts.find((text) => text.length > 1) ?? "";
}

function scanPlaylistFoldersFromSidebar(): PlaylistFolderEntry[] {
  const roots = Array.from(
    document.querySelectorAll<HTMLElement>(
      [
        '[aria-label*="Your Library" i]',
        '[data-testid*="library" i]',
        'nav[aria-label]',
        ".main-yourLibraryX-libraryRootlist",
        ".main-yourLibraryX-entryPoints",
      ].join(",")
    )
  );

  const uniqueFolders = new Map<string, PlaylistFolderEntry>();

  for (const root of roots) {
    const rows = Array.from(
      root.querySelectorAll<HTMLElement>(
        [
          '[role="treeitem"]',
          '[role="button"]',
          "button",
          "a",
          '[data-testid*="folder" i]',
          '[aria-expanded]',
        ].join(",")
      )
    );

    for (const row of rows) {
      const name =
        normalizeLabel(row.getAttribute("aria-label")) ||
        normalizeLabel(row.getAttribute("title")) ||
        getTextFromRow(row);

      if (!name) continue;

      const blob = normalizeLabel(
        [
          row.getAttribute("aria-label"),
          row.getAttribute("data-testid"),
          row.className,
          row.outerHTML.slice(0, 300),
        ].join(" ")
      );

      const looksFolderish =
        blob.includes("folder") ||
        row.hasAttribute("aria-expanded") ||
        row.querySelector('[aria-label*="folder" i], [data-testid*="folder" i]') !== null;

      if (!looksFolderish) continue;

      const id = slugify(name);
      if (uniqueFolders.has(id)) continue;
      uniqueFolders.set(id, toFolderEntry(name, name));
    }
  }

  return Array.from(uniqueFolders.values());
}

export async function refreshPlaylistFolderCache() {
  const apiFolders = await scanPlaylistFoldersFromApi();
  const folders = apiFolders.length > 0 ? apiFolders : scanPlaylistFoldersFromSidebar();
  setCachedPlaylistFolders(folders);
  return folders;
}

export function getPlaylistFolderOptions() {
  const folders = getCachedPlaylistFolders();

  return [
    { label: "Disabled", value: "" },
    ...folders.map((folder) => ({
      label: folder.label,
      value: folder.id,
    })),
  ];
}
