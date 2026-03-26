import { normalizeText } from "../dom";

const NOW_PLAYING_ARTIST_SELECTORS = [
  ".main-trackInfo-artists",
  "[data-testid='context-item-info-artist']",
];
const NOW_PLAYING_TEXT_SELECTOR =
  ":scope > a[href], :scope > span, :scope > div, a[href], span, div, [data-encore-id='text']";
const LOCAL_FILES_GRID_SELECTOR = '[role="grid"][aria-label="Local Files"]';
const LOCAL_FILES_ARTIST_TEXT_SELECTOR =
  ".main-trackList-rowMainContent .E9JgwDpGYa2eLpMz0ehe";
const LOCAL_ARTIST_LINK_ATTR = "data-spotify-plus-local-artist-link";

type LocalArtistInfo = {
  rawText: string;
  names: string[];
};

let observer: MutationObserver | null = null;
let scheduledSync = 0;
let pendingRetryTimeouts: number[] = [];
const topArtistMatchCache = new Map<string, Promise<string | null>>();
const originalTrackArtistState = new WeakMap<
  Spicetify.PlayerTrack,
  { artistName: string; artistUri: string; artistNames: string[] }
>();
const originalQueueArtistState = new WeakMap<
  Record<string, string>,
  { artistName: string; artistUri: string }
>();

function parseUri(value: string | null | undefined) {
  if (!value) return null;

  try {
    return Spicetify.URI.fromString(value);
  } catch {
    return null;
  }
}

function isLocalUri(value: string | null | undefined) {
  const uri = parseUri(value);
  if (!uri) return false;

  return [
    Spicetify.URI.Type.LOCAL,
    Spicetify.URI.Type.LOCAL_TRACK,
    Spicetify.URI.Type.LOCAL_ALBUM,
    Spicetify.URI.Type.LOCAL_ARTIST,
  ].includes(uri.type);
}

function splitArtistNames(value: string | null | undefined) {
  return (value ?? "")
    .split(/[;,]/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function dedupeArtistNames(names: string[]) {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const name of names) {
    const normalized = normalizeText(name);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(name.trim());
  }

  return result;
}

function readLocalUriArtist(uriValue: string | null | undefined) {
  const uri = parseUri(uriValue);
  if (uri?.artist) {
    return uri.artist;
  }

  if (!uriValue?.startsWith("spotify:local:")) {
    return "";
  }

  const [, , rawArtist = ""] = uriValue.split(":");
  try {
    return decodeURIComponent(rawArtist);
  } catch {
    return rawArtist;
  }
}

function buildLocalArtistInfo(rawText: string, extraNames: string[] = []): LocalArtistInfo | null {
  const names = dedupeArtistNames([
    ...splitArtistNames(rawText),
    ...extraNames.flatMap((name) => splitArtistNames(name)),
  ]);
  if (names.length === 0) {
    return null;
  }

  return {
    rawText: rawText.trim() || names.join("; "),
    names,
  };
}

function getPreferredLocalArtistNames(info: LocalArtistInfo, metadata?: Record<string, string>) {
  const albumArtistName = metadata?.album_artist_name?.trim() ?? "";
  const normalizedAlbumArtist = normalizeText(albumArtistName);

  if (!normalizedAlbumArtist) {
    return info.names;
  }

  const allMatchAlbumArtist =
    info.names.length > 0 &&
    info.names.every((name) => normalizeText(name) === normalizedAlbumArtist);

  if (allMatchAlbumArtist) {
    return [albumArtistName];
  }

  return info.names;
}

function getLocalArtistInfoFromVisibleText(text: string | null | undefined) {
  const rawText = text?.trim() ?? "";
  if (!rawText) {
    return null;
  }

  const info = buildLocalArtistInfo(rawText);
  if (!info) {
    return null;
  }

  if (info.names.join(", ") === rawText && info.names.length <= 1) {
    return null;
  }

  return info;
}

function getLocalArtistInfoFromTrack(track: Spicetify.PlayerTrack | null | undefined) {
  if (!track || !(track.isLocal || isLocalUri(track.uri) || isLocalUri(track.metadata?.entity_uri))) {
    return null;
  }

  const metadata = track.metadata ?? {};
  const originalState = originalTrackArtistState.get(track);
  if (originalState) {
    return buildLocalArtistInfo(originalState.artistName, [
      ...originalState.artistNames,
      readLocalUriArtist(track.uri || metadata.entity_uri),
      metadata.album_artist_name ?? "",
    ]);
  }

  const indexedNames = Object.entries(metadata)
    .filter(([key, value]) => /^artist_name(?::\d+)?$/.test(key) && Boolean(value))
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, value]) => value);
  const artistNames = Array.isArray(track.artists)
    ? track.artists.map((artist) => artist?.name).filter(Boolean)
    : [];
  const uriArtist = readLocalUriArtist(track.uri || metadata.entity_uri);
  const rawText = metadata.artist_name || uriArtist || indexedNames[0] || artistNames[0] || "";

  originalTrackArtistState.set(track, {
    artistName: rawText,
    artistUri: metadata.artist_uri || uriArtist,
    artistNames,
  });

  return buildLocalArtistInfo(rawText, [...indexedNames, ...artistNames, uriArtist]);
}

function updateArtistUri(metadata: Record<string, string>, displayText: string) {
  if (!metadata.artist_uri?.startsWith("spotify:local:")) {
    return;
  }

  const encodedArtist = encodeURIComponent(displayText).replace(/%20/g, "+");
  metadata.artist_uri = `spotify:local:${encodedArtist}`;
}

function sanitizeLocalMetadata(metadata: Record<string, string> | undefined, info: LocalArtistInfo) {
  if (!metadata) {
    return;
  }

  const displayText = getPreferredLocalArtistNames(info, metadata).join(", ");
  if (!displayText) {
    return;
  }

  metadata.artist_name = displayText;
  updateArtistUri(metadata, displayText);
}

function sanitizeLocalTrackObject(track: Spicetify.PlayerTrack | null | undefined) {
  const info = getLocalArtistInfoFromTrack(track);
  if (!track || !info) {
    return info;
  }

  const displayNames = getPreferredLocalArtistNames(info, track.metadata);
  const displayText = displayNames.join(", ");
  if (!displayText) {
    return info;
  }

  sanitizeLocalMetadata(track.metadata, info);

  if (Array.isArray(track.artists)) {
    if (track.artists.length === 1) {
      track.artists[0].name = displayText;
      if (track.metadata?.artist_uri) {
        track.artists[0].uri = track.metadata.artist_uri;
      }
    } else if (track.artists.length > 1) {
      track.artists = displayNames.map((name, index) => ({
        type: "artist",
        uri: index === 0 ? (track.metadata?.artist_uri ?? "") : "",
        name,
      }));
    }
  } else if (displayNames.length > 0) {
    track.artists = displayNames.map((name, index) => ({
      type: "artist",
      uri: index === 0 ? (track.metadata?.artist_uri ?? "") : "",
      name,
    }));
  }

  return {
    rawText: info.rawText,
    names: displayNames,
  };
}

function sanitizeLocalQueueTrack() {
  const contextTrack = Spicetify.Queue?.track?.contextTrack as
    | { metadata?: Record<string, string>; uri?: string }
    | undefined;
  if (!contextTrack) {
    return;
  }

  const metadata = contextTrack.metadata;
  const originalState = metadata ? originalQueueArtistState.get(metadata) : null;
  const rawArtistName =
    originalState?.artistName ?? metadata?.artist_name ?? readLocalUriArtist(contextTrack.uri);
  const info = buildLocalArtistInfo(rawArtistName, [metadata?.album_artist_name ?? ""]);
  if (!info) {
    return;
  }

  if (metadata && !originalState) {
    originalQueueArtistState.set(metadata, {
      artistName: metadata.artist_name ?? rawArtistName,
      artistUri: metadata.artist_uri ?? "",
    });
  }

  sanitizeLocalMetadata(metadata, info);
}

function sanitizeNowPlayingAria(info: LocalArtistInfo | null | undefined) {
  const nowPlayingWidget = document.querySelector<HTMLElement>("[data-testid='now-playing-widget']");
  if (!nowPlayingWidget) {
    return;
  }

  const label = nowPlayingWidget.getAttribute("aria-label");
  if (!label?.includes(" by ")) {
    return;
  }

  if (!info) {
    return;
  }

  const title = Spicetify.Player.data?.item?.name?.trim();
  const artistText = info.names.join(", ");
  if (!title || !artistText) {
    return;
  }

  nowPlayingWidget.setAttribute("aria-label", `Now playing: ${title} by ${artistText}`);
}

function getCandidateScore(text: string, info: LocalArtistInfo) {
  const normalizedText = normalizeText(text);
  const normalizedRaw = normalizeText(info.rawText);
  const normalizedJoined = normalizeText(info.names.join(", "));

  if (!normalizedText) return 0;
  if (info.names.length === 1 && normalizedText === normalizeText(info.names[0])) {
    return 4;
  }
  if (normalizedText === normalizedRaw) {
    return 3;
  }
  if (normalizedText === normalizedJoined) {
    return 2;
  }

  return 0;
}

function getLeafTextCandidates(root: ParentNode) {
  const anchorCandidates = root.querySelectorAll<HTMLElement>("a[href]");
  if (anchorCandidates.length > 0) {
    return Array.from(anchorCandidates);
  }

  const unique = new Set<HTMLElement>();

  if (root instanceof HTMLElement && root.matches(NOW_PLAYING_TEXT_SELECTOR)) {
    unique.add(root);
  }

  for (const element of root.querySelectorAll<HTMLElement>(NOW_PLAYING_TEXT_SELECTOR)) {
    if (element.children.length > 0 && !(element instanceof HTMLAnchorElement)) continue;
    unique.add(element);
  }

  return Array.from(unique);
}

async function findTopArtistProfileUri(name: string) {
  const cacheKey = normalizeText(name);
  const cached = topArtistMatchCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const pending = (async () => {
    try {
      const response = await Spicetify.CosmosAsync.get(
        `https://api.spotify.com/v1/search?q=${encodeURIComponent(name)}&type=artist&limit=1&market=from_token`
      );
      const items = Array.isArray(response?.artists?.items) ? response.artists.items : [];
      const topMatch = items.find((item: { uri?: string; id?: string }) => item?.uri || item?.id);
      if (!topMatch) {
        return null;
      }

      return topMatch.uri || Spicetify.URI.artistURI(topMatch.id!).toURI();
    } catch {
      return null;
    }
  })();

  topArtistMatchCache.set(cacheKey, pending);
  return pending;
}

function setAnchorHref(anchor: HTMLAnchorElement, artistUri: string) {
  const parsed = parseUri(artistUri);
  const href = parsed?.toURLPath(true);
  if (!href) {
    return;
  }

  anchor.href = href;
  anchor.dataset.spotifyPlusLinkedArtistUri = artistUri;
}

function setAnchorSearchHref(anchor: HTMLAnchorElement, artistName: string) {
  const searchUri = Spicetify.URI.searchURI(artistName);
  const href = searchUri.toURLPath(true);
  anchor.href = href;
  anchor.dataset.spotifyPlusLocalArtistLink = artistName;
}

function navigateToUri(uri: string) {
  const path = parseUri(uri)?.toURLPath(true);
  if (!path) {
    return;
  }

  Spicetify.Platform?.History?.push?.(path);
}

function navigateToArtistSearch(artistName: string) {
  const path = Spicetify.URI.searchURI(artistName).toURLPath(true);
  Spicetify.Platform?.History?.push?.(path);
}

function createArtistAnchor(artistName: string) {
  const anchor = document.createElement("a");
  anchor.className = "SpotifyPlusLocalArtistLink";
  anchor.textContent = artistName;
  anchor.dataset.spotifyPlusLocalArtistLink = artistName;
  setAnchorSearchHref(anchor, artistName);
  return anchor;
}

function getRenderTarget(element: HTMLElement) {
  if (element instanceof HTMLAnchorElement) {
    const wrapper = element.parentElement;
    if (wrapper instanceof HTMLElement && (wrapper.tagName === "SPAN" || wrapper.tagName === "DIV")) {
      return wrapper;
    }
  }

  return element;
}

function renderArtistLinks(element: HTMLElement, info: LocalArtistInfo) {
  const target = getRenderTarget(element);
  const currentSignature = target.textContent?.trim() ?? "";
  const nextSignature = info.names.join(", ");
  const alreadyManagedLinks =
    target.querySelectorAll(`a[${LOCAL_ARTIST_LINK_ATTR}]`).length === info.names.length &&
    info.names.length > 0;

  if (!nextSignature) {
    return;
  }

  if (currentSignature === nextSignature && alreadyManagedLinks) {
    return;
  }

  target.replaceChildren();

  info.names.forEach((name, index) => {
    if (index > 0) {
      target.appendChild(document.createTextNode(", "));
    }
    target.appendChild(createArtistAnchor(name));
  });

  for (const name of info.names) {
    void findTopArtistProfileUri(name).then((artistUri) => {
      if (!artistUri || !target.isConnected) {
        return;
      }

      const anchor = target.querySelector<HTMLAnchorElement>(
        `a[${LOCAL_ARTIST_LINK_ATTR}="${CSS.escape(name)}"]`
      );
      if (anchor) {
        setAnchorHref(anchor, artistUri);
      }
    });
  }
}

function renderArtistText(element: HTMLElement, info: LocalArtistInfo) {
  const displayText = info.names.join(", ");
  if (!displayText) {
    return;
  }

  if (element.textContent?.trim() !== displayText) {
    element.textContent = displayText;
  }
}

function sanitizeLocalFilesRowLabels(row: HTMLElement, info: LocalArtistInfo) {
  const displayText = info.names.join(", ");
  if (!displayText) {
    return;
  }

  const title =
    row.querySelector<HTMLElement>(".main-trackList-rowMainContent [dir='auto']")?.textContent?.trim() ?? "";
  if (!title) {
    return;
  }

  const playButton = row.querySelector<HTMLElement>(".main-trackList-rowImagePlayButton");
  if (playButton) {
    const current = playButton.getAttribute("aria-label") ?? "";
    if (current.includes(" by ")) {
      const prefix = current.startsWith("Pause") ? "Pause" : "Play";
      playButton.setAttribute("aria-label", `${prefix} ${title} by ${displayText}`);
    }
  }

  const moreButton = row.querySelector<HTMLElement>("[aria-haspopup='menu']");
  if (moreButton) {
    const current = moreButton.getAttribute("aria-label") ?? "";
    if (current.includes("More options for")) {
      moreButton.setAttribute("aria-label", `More options for ${title} by ${displayText}`);
    }
  }
}

async function onDocumentClick(event: MouseEvent) {
  const target = event.target;
  if (!(target instanceof Element)) {
    return;
  }

  const anchor = target.closest<HTMLAnchorElement>(`a[${LOCAL_ARTIST_LINK_ATTR}]`);
  if (!(anchor instanceof HTMLAnchorElement)) {
    return;
  }

  const artistName = anchor.dataset.spotifyPlusLocalArtistLink?.trim();
  if (!artistName) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();
  anchor.blur();

  const artistUri = await findTopArtistProfileUri(artistName);
  if (artistUri) {
    navigateToUri(artistUri);
    return;
  }

  navigateToArtistSearch(artistName);
}

function applyManagedArtistDisplay(element: HTMLElement, info: LocalArtistInfo) {
  renderArtistLinks(element, info);
}

function syncLocalArtistText(root: ParentNode, info: LocalArtistInfo) {
  const preferredAnchor =
    root instanceof HTMLElement
      ? root.querySelector<HTMLElement>("a[href]") ??
        root.querySelector<HTMLElement>("[data-encore-id='text'] > span") ??
        root.querySelector<HTMLElement>("[data-encore-id='text']")
      : null;

  if (preferredAnchor) {
    applyManagedArtistDisplay(preferredAnchor, info);
    return;
  }

  let bestMatch: HTMLElement | null = null;
  let bestScore = 0;

  for (const element of getLeafTextCandidates(root)) {
    const score = getCandidateScore(element.textContent?.trim() ?? "", info);
    if (score <= bestScore) continue;
    bestScore = score;
    bestMatch = element;
  }

  if (!bestMatch) {
    return;
  }

  applyManagedArtistDisplay(bestMatch, info);
}

function syncCurrentLocalTrackArtists() {
  const info = sanitizeLocalTrackObject(Spicetify.Player.data?.item);
  sanitizeLocalQueueTrack();

  for (const selector of NOW_PLAYING_ARTIST_SELECTORS) {
    for (const container of document.querySelectorAll<HTMLElement>(selector)) {
      if (!info) continue;

      syncLocalArtistText(container, info);
    }
  }
}

function syncLocalFilesGridArtists() {
  for (const grid of document.querySelectorAll<HTMLElement>(LOCAL_FILES_GRID_SELECTOR)) {
    for (const textElement of grid.querySelectorAll<HTMLElement>(LOCAL_FILES_ARTIST_TEXT_SELECTOR)) {
      const info = getLocalArtistInfoFromVisibleText(textElement.textContent);
      if (!info) {
        continue;
      }

      const displayText = info.names.join(", ");
      if (!displayText) {
        continue;
      }

      const existing = textElement.textContent?.trim() ?? "";
      if (existing !== displayText) {
        textElement.textContent = displayText;
      }

      const row = textElement.closest<HTMLElement>('[role="row"]');
      if (row) {
        sanitizeLocalFilesRowLabels(row, info);
      }
    }
  }
}

function syncLocalFileArtists() {
  const info = sanitizeLocalTrackObject(Spicetify.Player.data?.item);
  sanitizeLocalQueueTrack();
  syncCurrentLocalTrackArtists();
  syncLocalFilesGridArtists();
  sanitizeNowPlayingAria(info);
}

function scheduleSyncLocalFileArtists() {
  if (scheduledSync) {
    cancelAnimationFrame(scheduledSync);
  }

  scheduledSync = requestAnimationFrame(() => {
    scheduledSync = 0;
    syncLocalFileArtists();
  });
}

function scheduleFollowupSyncs() {
  for (const timeoutId of pendingRetryTimeouts) {
    window.clearTimeout(timeoutId);
  }
  pendingRetryTimeouts = [];

  for (const delay of [50, 150, 350, 750]) {
    pendingRetryTimeouts.push(
      window.setTimeout(() => {
        scheduleSyncLocalFileArtists();
      }, delay)
    );
  }
}

export function startLocalFilesController() {
  scheduleSyncLocalFileArtists();
  scheduleFollowupSyncs();
  Spicetify.Player.addEventListener("songchange", () => {
    scheduleSyncLocalFileArtists();
    scheduleFollowupSyncs();
  });
  Spicetify.Player.addEventListener("appchange", () => {
    scheduleSyncLocalFileArtists();
    scheduleFollowupSyncs();
  });

  observer?.disconnect();
  observer = new MutationObserver(() => {
    scheduleSyncLocalFileArtists();
    scheduleFollowupSyncs();
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
  });

  document.addEventListener("click", onDocumentClick, true);
}
