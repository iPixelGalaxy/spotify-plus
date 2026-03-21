import { CURRENT_VERSION } from "../version";

const UPDATE_CHECK_CACHE_KEY_PREFIX = "spotify-plus.update-check-cache";
const UPDATE_DISMISSED_VERSION_KEY = "spotify-plus.update-dismissed-version";
const VERSION_OVERRIDE_KEY = "spotify-plus.debug-version-override";
const UPDATE_STYLE_ID = "spotify-plus-update-prompt-style";
const UPDATE_DIALOG_CLASS = "SpotifyPlusUpdateDialog";
const UPDATE_OVERLAY_CLASS = "SpotifyPlusUpdateOverlay";
const UPDATE_CHECK_INTERVAL_MS = 1000 * 60 * 60 * 12;
export const UPDATE_AVAILABILITY_CHANGED_EVENT = "spotify-plus:update-availability-changed";
const REPO_OWNER = "iPixelGalaxy";
const REPO_NAME = "spotify-plus";

let availableRelease: LatestRelease | null = null;

type LatestRelease = {
  version: string;
  htmlUrl: string;
};

function ensureUpdatePromptStyles() {
  if (document.getElementById(UPDATE_STYLE_ID)) {
    return;
  }

  const style = document.createElement("style");
  style.id = UPDATE_STYLE_ID;
  style.textContent = `
.${UPDATE_OVERLAY_CLASS} {
  position: fixed;
  inset: 0;
  z-index: 10001;
  background: rgba(0, 0, 0, 0.58);
}

.${UPDATE_DIALOG_CLASS} {
  position: fixed;
  z-index: 10002;
  width: min(560px, calc(100vw - 48px));
  background: #121212;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 14px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.55);
  color: #fff;
  overflow: hidden;
}

.${UPDATE_DIALOG_CLASS}Header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 18px 20px 12px;
}

.${UPDATE_DIALOG_CLASS}Title {
  font-size: 1rem;
  font-weight: 700;
}

.${UPDATE_DIALOG_CLASS}Close {
  border: 0;
  background: transparent;
  color: rgba(255, 255, 255, 0.65);
  cursor: pointer;
  font-size: 1.2rem;
  line-height: 1;
}

.${UPDATE_DIALOG_CLASS}Body {
  padding: 0 20px 20px;
}

.${UPDATE_DIALOG_CLASS}Body p {
  margin: 0 0 12px;
  color: rgba(255, 255, 255, 0.82);
  line-height: 1.45;
}

.${UPDATE_DIALOG_CLASS}Command {
  margin: 14px 0 16px;
  padding: 12px 14px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.92);
  font-family: Consolas, "Courier New", monospace;
  font-size: 0.8rem;
  white-space: pre-wrap;
  word-break: break-word;
}

.${UPDATE_DIALOG_CLASS}Actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
}

.${UPDATE_DIALOG_CLASS}Button {
  border: 1px solid rgba(255, 255, 255, 0.14);
  background: rgba(255, 255, 255, 0.06);
  color: #fff;
  padding: 8px 14px;
  border-radius: 999px;
  cursor: pointer;
  font-size: 0.84rem;
}

.${UPDATE_DIALOG_CLASS}Button:hover {
  background: rgba(255, 255, 255, 0.12);
  color: #fff;
}

.${UPDATE_DIALOG_CLASS}ButtonPrimary {
  border-color: #1ed760;
  background: #1ed760;
  color: #000;
  font-weight: 700;
}

.${UPDATE_DIALOG_CLASS}ButtonPrimary:hover {
  background: rgba(30, 215, 96, 0.5);
  border-color: rgba(30, 215, 96, 0.5);
  color: #fff;
}
`;

  document.head.appendChild(style);
}

function parseVersionParts(version: string) {
  return version
    .replace(/^v/i, "")
    .split(".")
    .map((part) => Number.parseInt(part, 10) || 0);
}

function isVersionNewer(latestVersion: string, currentVersion: string) {
  const latestParts = parseVersionParts(latestVersion);
  const currentParts = parseVersionParts(currentVersion);
  const maxLength = Math.max(latestParts.length, currentParts.length);

  for (let index = 0; index < maxLength; index += 1) {
    const latestPart = latestParts[index] ?? 0;
    const currentPart = currentParts[index] ?? 0;
    if (latestPart > currentPart) return true;
    if (latestPart < currentPart) return false;
  }

  return false;
}

function getPlatform() {
  const globalWindow = window as Window & {
    require?: (id: string) => unknown;
    process?: { platform?: string };
    navigator?: Navigator & {
      userAgentData?: { platform?: string };
      userAgent?: string;
      platform?: string;
    };
  };

  const runtimePlatform =
    globalWindow.process?.platform ??
    (typeof globalWindow.require === "function"
      ? ((globalWindow.require("process") as { platform?: string })?.platform ?? "")
      : "");
  if (typeof runtimePlatform === "string" && runtimePlatform) {
    return runtimePlatform;
  }

  const navigatorPlatform =
    globalWindow.navigator?.userAgentData?.platform ??
    globalWindow.navigator?.platform ??
    globalWindow.navigator?.userAgent ??
    "";
  const normalizedNavigatorPlatform =
    typeof navigatorPlatform === "string" ? navigatorPlatform.toLowerCase() : "";

  if (normalizedNavigatorPlatform.includes("win")) {
    return "win32";
  }
  if (normalizedNavigatorPlatform.includes("mac")) {
    return "darwin";
  }
  if (
    normalizedNavigatorPlatform.includes("linux") ||
    normalizedNavigatorPlatform.includes("x11")
  ) {
    return "linux";
  }

  return "";
}

function getUpdateInstallCommand() {
  const platform = getPlatform();
  if (platform === "win32") {
    return "irm https://raw.githubusercontent.com/iPixelGalaxy/spotify-plus/master/install.ps1 | iex";
  }

  return "curl -fsSL https://raw.githubusercontent.com/iPixelGalaxy/spotify-plus/master/install.sh | bash";
}

async function copyCommand(command: string) {
  try {
    if (Spicetify.Platform?.ClipboardAPI?.copy) {
      Spicetify.Platform.ClipboardAPI.copy(command);
    } else {
      await navigator.clipboard.writeText(command);
    }
    Spicetify.showNotification("Spotify+: copied update command");
  } catch {
    Spicetify.showNotification("Spotify+: failed to copy update command", true);
  }
}

function closeExistingPrompt() {
  document.querySelector(`.${UPDATE_OVERLAY_CLASS}`)?.remove();
  document.querySelector(`.${UPDATE_DIALOG_CLASS}`)?.remove();
}

function emitUpdateAvailabilityChanged() {
  window.dispatchEvent(
    new CustomEvent(UPDATE_AVAILABILITY_CHANGED_EVENT, {
      detail: { release: availableRelease },
    })
  );
}

export function hasUpdateAvailable() {
  return availableRelease !== null;
}

export function getAvailableRelease() {
  return availableRelease;
}

export function getCurrentVersion() {
  const override = Spicetify.LocalStorage.get(VERSION_OVERRIDE_KEY) ?? "";
  return override || CURRENT_VERSION;
}

export function openUpdatePrompt(release: LatestRelease | null = availableRelease) {
  if (!release) {
    Spicetify.showNotification("Spotify+: no update available");
    return;
  }

  closeExistingPrompt();
  ensureUpdatePromptStyles();

  const overlay = document.createElement("div");
  overlay.className = UPDATE_OVERLAY_CLASS;

  const dialog = document.createElement("div");
  dialog.className = UPDATE_DIALOG_CLASS;

  const closePrompt = () => {
    overlay.remove();
    dialog.remove();
  };

  const command = getUpdateInstallCommand();

  const header = document.createElement("div");
  header.className = `${UPDATE_DIALOG_CLASS}Header`;

  const title = document.createElement("div");
  title.className = `${UPDATE_DIALOG_CLASS}Title`;
  title.textContent = `Spotify+ update available (${release.version})`;

  const closeButton = document.createElement("button");
  closeButton.className = `${UPDATE_DIALOG_CLASS}Close`;
  closeButton.type = "button";
  closeButton.textContent = "×";
  closeButton.addEventListener("click", closePrompt);

  header.append(title, closeButton);

  const body = document.createElement("div");
  body.className = `${UPDATE_DIALOG_CLASS}Body`;

  const message = document.createElement("p");
  message.textContent = `You're running ${getCurrentVersion()}. Install ${release.version} with:`;

  const commandBlock = document.createElement("div");
  commandBlock.className = `${UPDATE_DIALOG_CLASS}Command`;
  commandBlock.textContent = command;

  const actions = document.createElement("div");
  actions.className = `${UPDATE_DIALOG_CLASS}Actions`;

  const skipButton = document.createElement("button");
  skipButton.className = `${UPDATE_DIALOG_CLASS}Button`;
  skipButton.type = "button";
  skipButton.textContent = "Skip This Version";
  skipButton.addEventListener("click", () => {
    Spicetify.LocalStorage.set(UPDATE_DISMISSED_VERSION_KEY, release.version);
    availableRelease = null;
    emitUpdateAvailabilityChanged();
    closePrompt();
  });

  const releaseButton = document.createElement("button");
  releaseButton.className = `${UPDATE_DIALOG_CLASS}Button`;
  releaseButton.type = "button";
  releaseButton.textContent = "Open Release";
  releaseButton.addEventListener("click", () => {
    window.open(release.htmlUrl, "_blank", "noopener,noreferrer");
  });

  const copyButton = document.createElement("button");
  copyButton.className = `${UPDATE_DIALOG_CLASS}Button ${UPDATE_DIALOG_CLASS}ButtonPrimary`;
  copyButton.type = "button";
  copyButton.textContent = "Copy Command";
  copyButton.addEventListener("click", () => {
    void copyCommand(command);
  });

  actions.append(skipButton, releaseButton, copyButton);
  body.append(message, commandBlock, actions);
  dialog.append(header, body);

  overlay.addEventListener("click", closePrompt);
  dialog.addEventListener("click", (event) => event.stopPropagation());

  document.body.append(overlay, dialog);

  const width = Math.min(560, window.innerWidth - 48);
  const height = dialog.getBoundingClientRect().height || 240;
  dialog.style.left = `${Math.max(24, (window.innerWidth - width) / 2)}px`;
  dialog.style.top = `${Math.max(24, (window.innerHeight - height) / 2)}px`;
}

async function fetchLatestRelease() {
  const response = await fetch(
    `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases/latest`,
    {
      headers: { "User-Agent": "spotify-plus-update-check" },
    }
  );
  if (!response.ok) {
    throw new Error(`Update check failed with ${response.status}`);
  }

  const release = (await response.json()) as { tag_name?: string; html_url?: string };
  if (!release.tag_name || !release.html_url) {
    throw new Error("Latest release payload was incomplete");
  }

  return {
    version: release.tag_name.replace(/^v/i, ""),
    htmlUrl: release.html_url,
  };
}

function getUpdateCheckCacheKey() {
  return `${UPDATE_CHECK_CACHE_KEY_PREFIX}.${getCurrentVersion()}`;
}

export async function startUpdatePromptController() {
  const now = Date.now();
  const lastCheckedAt = Number(Spicetify.LocalStorage.get(getUpdateCheckCacheKey()) ?? "0");
  if (now - lastCheckedAt < UPDATE_CHECK_INTERVAL_MS) {
    emitUpdateAvailabilityChanged();
    return;
  }

  Spicetify.LocalStorage.set(getUpdateCheckCacheKey(), String(now));

  try {
    const latestRelease = await fetchLatestRelease();
    const dismissedVersion = Spicetify.LocalStorage.get(UPDATE_DISMISSED_VERSION_KEY) ?? "";
    if (!isVersionNewer(latestRelease.version, getCurrentVersion())) {
      availableRelease = null;
      emitUpdateAvailabilityChanged();
      return;
    }

    if (dismissedVersion === latestRelease.version) {
      availableRelease = null;
      emitUpdateAvailabilityChanged();
      return;
    }

    availableRelease = latestRelease;
    emitUpdateAvailabilityChanged();
  } catch {
    // Best effort only.
  }
}

function installDebugHelpers() {
  const globalWindow = window as Window & {
    SpotifyPlusDebug?: {
      version?: string;
      overrideVersion?: (version: string) => void;
      clearVersionOverride?: () => void;
      forceUpdatePrompt?: (version?: string) => void;
      resetUpdateCheck?: () => void;
    };
  };

  globalWindow.SpotifyPlusDebug ??= {};
  Object.defineProperty(globalWindow.SpotifyPlusDebug, "version", {
    configurable: true,
    enumerable: true,
    get: () => getCurrentVersion(),
  });
  globalWindow.SpotifyPlusDebug.overrideVersion = (version: string) => {
    Spicetify.LocalStorage.set(VERSION_OVERRIDE_KEY, version);
    availableRelease = null;
    emitUpdateAvailabilityChanged();
  };
  globalWindow.SpotifyPlusDebug.clearVersionOverride = () => {
    Spicetify.LocalStorage.remove?.(VERSION_OVERRIDE_KEY);
    availableRelease = null;
    emitUpdateAvailabilityChanged();
  };
  globalWindow.SpotifyPlusDebug.forceUpdatePrompt = (version = "9.9.9") => {
    availableRelease = {
      version,
      htmlUrl: `https://github.com/${REPO_OWNER}/${REPO_NAME}/releases/latest`,
    };
    emitUpdateAvailabilityChanged();
    openUpdatePrompt(availableRelease);
  };
  globalWindow.SpotifyPlusDebug.resetUpdateCheck = () => {
    Spicetify.LocalStorage.remove?.(getUpdateCheckCacheKey());
    Spicetify.LocalStorage.remove?.("spotify-plus.update-check-cache");
    Spicetify.LocalStorage.remove?.(UPDATE_DISMISSED_VERSION_KEY);
    availableRelease = null;
    emitUpdateAvailabilityChanged();
  };
}

installDebugHelpers();
