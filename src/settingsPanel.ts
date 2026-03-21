import {
  defaultSettings,
  getCachedPlaylistFolders,
  getSetting,
  setSetting,
} from "./config";
import {
  checkForUpdatesNow,
  getAvailableRelease,
  getCurrentVersion,
  openUpdatePrompt,
} from "./features/updatePrompt";
import { refreshPlaylistFolderCache } from "./playlistFolders";

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

function makeButton(label: string, onClick: () => void) {
  const button = document.createElement("button");
  button.className = "sl-btn";
  button.type = "button";
  button.textContent = label;
  button.addEventListener("click", onClick);
  return button;
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

  const modalHorizontalPadding = 64;
  const modalTopPadding = 88;
  const modalBottomPadding = 136;
  const preferredWidth = 980;
  const minimumHeight = 280;

  const backdrop = document.createElement("div");
  backdrop.className = "SpotifyPlusSettingsOverlay";

  const container = document.createElement("div");
  container.className = "SpotifyPlusSettingsContainer";

  const onDocumentClick = (event: MouseEvent) => {
    if (!container.contains(event.target as Node | null)) {
      event.preventDefault();
      event.stopPropagation();
      closePanel();
    }
  };

  const applyPanelBounds = () => {
    const maxHeight = window.innerHeight - modalTopPadding - modalBottomPadding;
    const width = Math.min(
      preferredWidth,
      window.innerWidth - modalHorizontalPadding * 2
    );
    const naturalHeight =
      header.getBoundingClientRect().height + scroll.scrollHeight + 8;
    const height = Math.min(Math.max(minimumHeight, naturalHeight), maxHeight);
    const maxTop = Math.max(modalTopPadding, window.innerHeight - modalBottomPadding - height);
    const top = Math.min(
      Math.max((window.innerHeight - height) / 2, modalTopPadding),
      maxTop
    );

    container.style.width = `${width}px`;
    container.style.height = `${height}px`;
    container.style.left = `${Math.max(modalHorizontalPadding, (window.innerWidth - width) / 2)}px`;
    container.style.top = `${top}px`;
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      closePanel();
    }
  };

  const closePanel = () => {
    window.removeEventListener("resize", applyPanelBounds);
    window.removeEventListener("keydown", onKeyDown);
    document.removeEventListener("click", onDocumentClick, true);
    backdrop.remove();
  };

  window.addEventListener("resize", applyPanelBounds);
  window.addEventListener("keydown", onKeyDown);
  document.addEventListener("click", onDocumentClick, true);
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

  const refreshButton = makeButton("Refresh Folders", () => {
    void (async () => {
      const folders = await refreshPlaylistFolderCache();
      refillFolderChecklist(folderChecklist, !overrideToggle.checked);

      if (folders.length > 0) {
        Spicetify.showNotification(`Spotify+: found ${folders.length} folder candidates`);
      } else {
        Spicetify.showNotification("Spotify+: no folder candidates found", true);
      }
    })();
  });

  const folderChecklist = document.createElement("div");
  folderChecklist.className = "sl-folderChecklist";
  refillFolderChecklist(folderChecklist, !overrideToggle.checked);

  overrideToggle.addEventListener("change", () => {
    refillFolderChecklist(folderChecklist, !overrideToggle.checked);
  });

  makeRow(scroll, "Scan playlist folders", refreshButton);
  makeRow(scroll, "Folders to show in Add to playlist", folderChecklist, true);

  makeGroup(scroll, "About");
  const checkNowButton = makeButton("Check Now", () => {
    const availableRelease = getAvailableRelease();
    if (availableRelease) {
      openUpdatePrompt(availableRelease);
      return;
    }

    void (async () => {
      checkNowButton.disabled = true;
      checkNowButton.textContent = "Checking...";

      const release = await checkForUpdatesNow(false);

      if (release) {
        checkNowButton.textContent = "Update Now";
      } else {
        checkNowButton.textContent = "No Updates Found";
      }

      window.setTimeout(() => {
        checkNowButton.disabled = false;
      }, 150);
    })();
  });

  if (getAvailableRelease()) {
    checkNowButton.textContent = "Update Now";
  }

  makeRow(scroll, `Version ${getCurrentVersion()}`, checkNowButton);

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
