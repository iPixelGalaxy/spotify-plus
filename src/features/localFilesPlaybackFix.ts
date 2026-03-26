const INITIAL_CHECK_DELAY_MS = 2000;
const RETRY_CHECK_DELAY_MS = 800;
const POST_SEEK_DELAY_MS = 200;
const MAX_FIX_ATTEMPTS = 2;

let currentLocalTrackUri: string | null = null;
let pendingCheckTimeout: number | null = null;
let fixAttempts = 0;

function clearPendingCheck() {
  if (pendingCheckTimeout !== null) {
    window.clearTimeout(pendingCheckTimeout);
    pendingCheckTimeout = null;
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function isLocalTrack(item: Spicetify.PlayerTrack | null | undefined) {
  const uri = item?.uri ?? item?.metadata?.entity_uri ?? "";
  return item?.isLocal === true || uri.startsWith("spotify:local:");
}

function getPlayerState() {
  return Spicetify.Player.data;
}

function isCurrentTrackStuck(state: Spicetify.PlayerState | null | undefined) {
  return Boolean(state && !state.isPaused && state.isBuffering && state.positionAsOfTimestamp === 0);
}

function scheduleTrackCheck(delayMs: number) {
  clearPendingCheck();

  pendingCheckTimeout = window.setTimeout(() => {
    pendingCheckTimeout = null;

    const state = getPlayerState();
    if (!state?.item || state.item.uri !== currentLocalTrackUri) {
      return;
    }

    if (!isCurrentTrackStuck(state)) {
      fixAttempts = 0;
      return;
    }

    void applyPlaybackFix();
  }, delayMs);
}

async function applyPlaybackFix() {
  const state = getPlayerState();
  if (!state?.item || state.item.uri !== currentLocalTrackUri) {
    return;
  }

  fixAttempts += 1;

  try {
    const playerApi = (Spicetify.Platform as any)?.PlayerAPI;
    await playerApi?.seekTo?.(0);
    await sleep(POST_SEEK_DELAY_MS);

    if (getPlayerState()?.isPaused) {
      await playerApi?.resume?.();
    }
  } catch (error) {
    console.warn("[spotify-plus] local files playback fix failed", error);
  }

  if (fixAttempts >= MAX_FIX_ATTEMPTS) {
    fixAttempts = 0;
    return;
  }

  scheduleTrackCheck(RETRY_CHECK_DELAY_MS);
}

function onSongChange(event?: Event & { data?: Spicetify.PlayerState }) {
  clearPendingCheck();
  fixAttempts = 0;

  const item = event?.data?.item ?? getPlayerState()?.item;
  if (!isLocalTrack(item)) {
    currentLocalTrackUri = null;
    return;
  }

  currentLocalTrackUri = item?.uri ?? null;
  scheduleTrackCheck(INITIAL_CHECK_DELAY_MS);
}

export function startLocalFilesPlaybackFixController() {
  const playerApi = (Spicetify.Platform as any)?.PlayerAPI;
  if (!Spicetify.Player?.addEventListener || !playerApi?.seekTo || !playerApi?.resume) {
    window.setTimeout(startLocalFilesPlaybackFixController, 300);
    return;
  }

  Spicetify.Player.addEventListener("songchange", onSongChange);
}
