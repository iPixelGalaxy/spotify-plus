import {
  defaultSettings,
  getCachedPlaylistFolders,
  getSetting,
  setSetting,
} from "./config";
import { getCurrentVersion } from "./features/updatePrompt";
import { refreshPlaylistFolderCache } from "./playlistFolders";

const PANEL_STYLE_ID = "spotify-plus-settings-panel-style";

function ensureSettingsPanelStyles() {
  if (document.getElementById(PANEL_STYLE_ID)) return;

  const style = document.createElement("style");
  style.id = PANEL_STYLE_ID;
  style.textContent = `
.SpotifyPlusSettingsOverlay {
  position: fixed;
  inset: 0;
  z-index: 9998;
  background: rgba(0, 0, 0, 0.55);
}

.SpotifyPlusSettingsContainer {
  position: fixed;
  z-index: 9999;
  background: #0e0e0e;
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 12px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-height: 0;
  box-shadow: 0 8px 40px rgba(0, 0, 0, 0.7);
}

.SpotifyPlusSettingsHeader {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 18px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  flex-shrink: 0;
}

.SpotifyPlusSettingsHeader span {
  font-size: 0.95rem;
  font-weight: 600;
  color: #fff;
  letter-spacing: 0.01em;
}

.SpotifyPlusSettingsHeaderClose {
  background: none;
  border: none;
  color: rgba(255, 255, 255, 0.5);
  cursor: pointer;
  padding: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  transition: color 0.15s, background 0.15s;
}

.SpotifyPlusSettingsHeaderClose:hover {
  color: #fff;
  background: rgba(255, 255, 255, 0.08);
}

.SpotifyPlusSettingsScroll {
  flex: 1;
  overflow-y: auto;
  padding: 8px 16px 16px;
  overscroll-behavior: contain;
}

.SpotifyPlusSettingsScroll::-webkit-scrollbar {
  width: 4px;
}

.SpotifyPlusSettingsScroll::-webkit-scrollbar-track {
  background: transparent;
}

.SpotifyPlusSettingsScroll::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.14);
  border-radius: 999px;
}

.sl-settings-group {
  font-size: 0.72rem;
  font-weight: 700;
  color: rgba(255, 255, 255, 0.4);
  text-transform: uppercase;
  letter-spacing: 0.1em;
  margin-top: 20px;
  margin-bottom: 4px;
  padding-bottom: 6px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}

.sl-settings-group:first-child {
  margin-top: 8px;
}

.sl-settings-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 8px 6px;
  border-radius: 6px;
}

.sl-settings-row:hover {
  background: rgba(255, 255, 255, 0.06);
}

.sl-settings-row-stack {
  align-items: stretch;
  flex-direction: column;
}

.sl-settings-row-stack .sl-settings-label {
  flex: 0 0 auto;
}

.sl-settings-label {
  font-size: 0.875rem;
  color: rgba(255, 255, 255, 0.85);
  flex: 1;
}

.sl-toggle {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 20px;
  flex-shrink: 0;
  cursor: pointer;
}

.sl-toggle input {
  position: absolute;
  inset: 0;
  opacity: 0;
  width: 100%;
  height: 100%;
  margin: 0;
  appearance: none;
  -webkit-appearance: none;
  pointer-events: none;
}

.sl-toggle span {
  position: absolute;
  inset: 0;
  background: rgba(255, 255, 255, 0.15);
  border-radius: 999px;
  transition: background 0.15s ease;
}

.sl-toggle span::before {
  content: "";
  position: absolute;
  width: 14px;
  height: 14px;
  top: 3px;
  left: 2px;
  border-radius: 50%;
  background: #fff;
  transition: transform 0.15s ease;
}

.sl-toggle input:checked + span {
  background: #1ed760;
}

.sl-toggle input:checked + span::before {
  transform: translateX(18px);
}

.sl-select,
.sl-input,
.sl-btn {
  background: rgba(255, 255, 255, 0.07);
  color: rgba(255, 255, 255, 0.85);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 6px;
  font-size: 0.8rem;
  flex-shrink: 0;
}

.sl-select {
  appearance: none;
  padding: 6px 28px 6px 10px;
  min-width: 220px;
  cursor: pointer;
}

.sl-input {
  padding: 6px 10px;
  min-width: 220px;
}

.sl-btn {
  padding: 6px 14px;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
}

.sl-btn:hover,
.sl-select:hover {
  background: rgba(255, 255, 255, 0.13);
}

.sl-btn.is-muted {
  background: transparent;
  color: rgba(255, 255, 255, 0.6);
  border-color: rgba(255, 255, 255, 0.08);
  cursor: default;
}

.sl-btn.is-muted:hover {
  background: transparent;
  color: rgba(255, 255, 255, 0.9);
  border-color: rgba(255, 255, 255, 0.14);
}

.sl-folderChecklist {
  width: 100%;
  max-height: 240px;
  overflow-y: auto;
  padding: 8px;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: rgba(255, 255, 255, 0.04);
}

.sl-folderChecklist.is-disabled {
  opacity: 0.45;
}

.sl-folderChecklistEmpty {
  font-size: 0.8rem;
  color: rgba(255, 255, 255, 0.55);
  padding: 6px 4px;
}

.sl-folderOption {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 4px;
  border-radius: 6px;
}

.sl-folderOption:hover {
  background: rgba(255, 255, 255, 0.06);
}

.sl-folderOption input {
  margin: 0;
}

.sl-folderOptionText {
  font-size: 0.82rem;
  color: rgba(255, 255, 255, 0.88);
}
`;

  document.head.appendChild(style);
}

function makeGroup(scroll: HTMLElement, name: string) {
  const heading = document.createElement("h3");
  heading.className = "sl-settings-group";
  heading.textContent = name;
  scroll.appendChild(heading);
}

function makeRow(scroll: HTMLElement, label: string, control: HTMLElement, stacked = false) {
  const row = document.createElement("div");
  row.className = "sl-settings-row";
  if (stacked) {
    row.classList.add("sl-settings-row-stack");
  }

  const labelWrap = document.createElement("span");
  labelWrap.className = "sl-settings-label";
  labelWrap.textContent = label;

  row.appendChild(labelWrap);
  row.appendChild(control);
  scroll.appendChild(row);
}

function makeValue(scroll: HTMLElement, label: string, value: string) {
  const text = document.createElement("span");
  text.className = "sl-settings-label";
  text.textContent = value;
  makeRow(scroll, label, text);
}

function makeToggle(
  scroll: HTMLElement,
  label: string,
  settingKey: keyof typeof defaultSettings
) {
  const wrapper = document.createElement("div");
  wrapper.className = "sl-toggle";

  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = Boolean(getSetting(settingKey));

  const indicator = document.createElement("span");

  input.addEventListener("change", () => {
    setSetting(settingKey, input.checked as never);
  });

  wrapper.addEventListener("click", (event) => {
    event.preventDefault();
    input.checked = !input.checked;
    input.dispatchEvent(new Event("change"));
  });

  wrapper.appendChild(input);
  wrapper.appendChild(indicator);
  makeRow(scroll, label, wrapper);
  return input;
}

function getSelectedFolderIds() {
  const ids = getSetting("playlistOverrideFolderIds");
  if (Array.isArray(ids) && ids.length > 0) {
    return ids;
  }

  const legacyId = String(getSetting("playlistBaseFolderId") ?? "");
  return legacyId ? [legacyId] : [];
}

function refillFolderChecklist(container: HTMLElement, disabled: boolean) {
  const selectedIds = new Set(getSelectedFolderIds());
  const folders = getCachedPlaylistFolders()
    .slice()
    .sort((left, right) => left.path.localeCompare(right.path));

  container.innerHTML = "";
  container.classList.toggle("is-disabled", disabled);

  if (folders.length === 0) {
    const empty = document.createElement("div");
    empty.className = "sl-folderChecklistEmpty";
    empty.textContent = "No folders cached yet. Refresh to scan your library folders.";
    container.appendChild(empty);
    return;
  }

  for (const folder of folders) {
    const option = document.createElement("label");
    option.className = "sl-folderOption";

    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = selectedIds.has(folder.id);
    input.disabled = disabled;
    input.addEventListener("change", () => {
      if (input.checked) {
        selectedIds.add(folder.id);
      } else {
        selectedIds.delete(folder.id);
      }

      setSetting(
        "playlistOverrideFolderIds",
        folders.filter((entry) => selectedIds.has(entry.id)).map((entry) => entry.id)
      );
    });

    const text = document.createElement("span");
    text.className = "sl-folderOptionText";
    text.textContent = folder.label;

    option.appendChild(input);
    option.appendChild(text);
    container.appendChild(option);
  }
}

export function showSettingsPanel() {
  if (document.querySelector(".SpotifyPlusSettingsOverlay")) return;

  ensureSettingsPanelStyles();

  const modalPadding = 64;
  const preferredWidth = 980;
  const minimumHeight = 280;

  const backdrop = document.createElement("div");
  backdrop.className = "SpotifyPlusSettingsOverlay";

  const container = document.createElement("div");
  container.className = "SpotifyPlusSettingsContainer";

  const applyPanelBounds = () => {
    const maxHeight = window.innerHeight - modalPadding * 2;
    const width = Math.min(preferredWidth, window.innerWidth - modalPadding * 2);
    const naturalHeight =
      header.getBoundingClientRect().height + scroll.scrollHeight + 8;
    const height = Math.min(Math.max(minimumHeight, naturalHeight), maxHeight);

    container.style.width = `${width}px`;
    container.style.height = `${height}px`;
    container.style.left = `${Math.max(modalPadding, (window.innerWidth - width) / 2)}px`;
    container.style.top = `${Math.max(modalPadding, (window.innerHeight - height) / 2)}px`;
  };

  const closePanel = () => {
    window.removeEventListener("resize", applyPanelBounds);
    backdrop.remove();
  };

  window.addEventListener("resize", applyPanelBounds);
  backdrop.addEventListener("click", closePanel);
  container.addEventListener("click", (event) => event.stopPropagation());

  const header = document.createElement("div");
  header.className = "SpotifyPlusSettingsHeader";

  const title = document.createElement("span");
  title.textContent = "Spotify+ Settings";

  const closeBtn = document.createElement("button");
  closeBtn.className = "SpotifyPlusSettingsHeaderClose";
  closeBtn.innerHTML =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="18" height="18"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
  closeBtn.addEventListener("click", closePanel);

  header.appendChild(title);
  header.appendChild(closeBtn);

  const scroll = document.createElement("div");
  scroll.className = "SpotifyPlusSettingsScroll";
  scroll.tabIndex = 0;

  makeGroup(scroll, "Profile Menu");
  makeToggle(scroll, 'Hide the "Your Updates" section', "hideYourUpdatesSection");
  makeToggle(scroll, "Hide Home config", "hideHomeConfigMenuItem");
  makeToggle(scroll, "Hide Account", "hideAccountMenuItem");
  makeToggle(scroll, "Hide Profile", "hideProfileMenuItem");
  makeToggle(scroll, "Hide Support", "hideSupportMenuItem");
  makeToggle(scroll, "Hide Private Session", "hidePrivateSessionMenuItem");
  makeToggle(scroll, "Hide Log out", "hideLogOutMenuItem");

  makeGroup(scroll, "Player Controls");
  makeToggle(scroll, "Hide Friend Activity button", "hideFriendActivityButton");
  makeToggle(scroll, "Hide Lyrics button", "hideLyricsButton");
  makeToggle(scroll, "Hide Miniplayer button", "hideMiniplayerButton");

  makeGroup(scroll, "Playlist Menu");
  const overrideToggle = makeToggle(
    scroll,
    "Override Folder Behavior",
    "overridePlaylistFolderBehavior"
  );

  const refreshButton = document.createElement("button");
  refreshButton.className = "sl-btn";
  refreshButton.textContent = "Refresh Folders";

  const folderChecklist = document.createElement("div");
  folderChecklist.className = "sl-folderChecklist";
  refillFolderChecklist(folderChecklist, !overrideToggle.checked);

  overrideToggle.addEventListener("change", () => {
    refillFolderChecklist(folderChecklist, !overrideToggle.checked);
  });

  refreshButton.addEventListener("click", async () => {
    const folders = await refreshPlaylistFolderCache();
    refillFolderChecklist(folderChecklist, !overrideToggle.checked);

    if (folders.length > 0) {
      Spicetify.showNotification(`Spotify+: found ${folders.length} folder candidates`);
    } else {
      Spicetify.showNotification("Spotify+: no folder candidates found", true);
    }
  });

  makeRow(scroll, "Scan playlist folders", refreshButton);
  makeRow(scroll, "Folders to show in Add to playlist", folderChecklist, true);

  makeGroup(scroll, "About");
  makeValue(scroll, "Version", getCurrentVersion());

  container.addEventListener("wheel", (event) => event.stopPropagation(), { passive: false });

  container.appendChild(header);
  container.appendChild(scroll);
  backdrop.appendChild(container);
  document.body.appendChild(backdrop);
  applyPanelBounds();
  requestAnimationFrame(() => {
    scroll.focus({ preventScroll: true });
  });
}
