import { refreshPlaylistFolderCache } from "../playlistFolders";
import { makeButton, makeGroup, makeRow, makeToggle } from "./controls";
import { refillFolderChecklist } from "./playlistFolders";
import { getVersionLabel, makeCheckNowButton } from "./updateActions";

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
  makeToggle(scroll, "Restore old device picker", "restoreOldDevicePicker");

  makeGroup(scroll, "Tools");
  makeToggle(
    scroll,
    "Toggle me a few times while dev tools are enabled to keep them on",
    "enableDevtoolsOnStartup"
  );

  makeGroup(scroll, "Playlist Menu");
  const overrideToggle = makeToggle(
    scroll,
    "Override Folder Behavior",
    "overridePlaylistFolderBehavior"
  );

  const folderChecklist = document.createElement("div");
  folderChecklist.className = "sl-folderChecklist";
  refillFolderChecklist(folderChecklist, !overrideToggle.checked);

  overrideToggle.addEventListener("change", () => {
    refillFolderChecklist(folderChecklist, !overrideToggle.checked);
  });

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

  makeRow(scroll, "Scan playlist folders", refreshButton);
  makeRow(scroll, "Folders to show in Add to playlist", folderChecklist, true);

  makeGroup(scroll, "About");
  makeRow(scroll, getVersionLabel(), makeCheckNowButton());

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
