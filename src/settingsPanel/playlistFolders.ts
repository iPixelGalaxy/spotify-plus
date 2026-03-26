import { getCachedPlaylistFolders, getSetting, setSetting } from "../config";

function getSelectedFolderIds() {
  const ids = getSetting("playlistOverrideFolderIds");
  if (Array.isArray(ids) && ids.length > 0) {
    return ids;
  }

  const legacyId = String(getSetting("playlistBaseFolderId") ?? "");
  return legacyId ? [legacyId] : [];
}

export function refillFolderChecklist(container: HTMLElement, disabled: boolean) {
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
