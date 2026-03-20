import { normalizeText } from "../dom";

const EXPERIMENTAL_FEATURES_STYLE_ID = "spotify-plus-experimental-features-style";
const EXPERIMENTAL_FEATURES_DIALOG_CLASS = "SpotifyPlusExperimentalFeaturesDialog";
const EXPERIMENTAL_FEATURES_OVERLAY_CLASS = "SpotifyPlusExperimentalFeaturesOverlay";
const EXPERIMENTAL_FEATURES_ROOT_CLASS = "SpotifyPlusExperimentalFeaturesRoot";

function ensureExperimentalFeaturesStyles() {
  if (document.getElementById(EXPERIMENTAL_FEATURES_STYLE_ID)) return;

  const style = document.createElement("style");
  style.id = EXPERIMENTAL_FEATURES_STYLE_ID;
  style.textContent = `
.${EXPERIMENTAL_FEATURES_OVERLAY_CLASS} {
  background:
    radial-gradient(circle at top left, rgba(30, 215, 96, 0.08), transparent 32%),
    rgba(2, 6, 12, 0.58);
}

.${EXPERIMENTAL_FEATURES_DIALOG_CLASS} {
  width: min(680px, calc(100vw - 224px));
  max-width: 680px;
  max-height: calc(100vh - 160px);
  border-radius: 22px;
  overflow: hidden;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.04), transparent 18%),
    linear-gradient(135deg, rgba(10, 18, 28, 0.98), rgba(9, 13, 18, 0.96));
  box-shadow:
    0 28px 90px rgba(0, 0, 0, 0.55),
    inset 0 1px 0 rgba(255, 255, 255, 0.04);
}

.${EXPERIMENTAL_FEATURES_DIALOG_CLASS} .main-embedWidgetGenerator-container {
  display: flex;
  flex-direction: column;
  min-height: 0;
  width: 680px;
  max-width: 100%;
  height: min(762px, calc(100vh - 160px));
}

.${EXPERIMENTAL_FEATURES_DIALOG_CLASS} .main-trackCreditsModal-header {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 14px;
  padding: 22px 22px 18px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.03), rgba(255, 255, 255, 0));
}

.${EXPERIMENTAL_FEATURES_DIALOG_CLASS} .SpotifyPlusExperimentalFeaturesHeaderTop {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
}

.${EXPERIMENTAL_FEATURES_DIALOG_CLASS} .main-trackCreditsModal-header h1 {
  margin: 0;
  font-size: clamp(1.5rem, 2vw, 1.9rem);
  line-height: 1.1;
  font-weight: 800;
  letter-spacing: -0.03em;
  color: #f7fbff;
}

.${EXPERIMENTAL_FEATURES_DIALOG_CLASS} .main-trackCreditsModal-closeBtn {
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: rgba(255, 255, 255, 0.04);
  color: rgba(255, 255, 255, 0.74);
  width: 36px;
  height: 36px;
  border-radius: 999px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition:
    background 120ms ease,
    border-color 120ms ease,
    color 120ms ease,
    transform 120ms ease;
}

.${EXPERIMENTAL_FEATURES_DIALOG_CLASS} .main-trackCreditsModal-closeBtn:hover {
  background: rgba(255, 255, 255, 0.09);
  border-color: rgba(255, 255, 255, 0.18);
  color: #ffffff;
  transform: scale(1.03);
}

.${EXPERIMENTAL_FEATURES_DIALOG_CLASS} .SpotifyPlusExperimentalFeaturesHeaderSearch {
  position: relative;
  width: 100%;
  display: block;
}

.${EXPERIMENTAL_FEATURES_DIALOG_CLASS} .SpotifyPlusExperimentalFeaturesHeaderSearch .search-container {
  position: relative;
  width: 100%;
}

.${EXPERIMENTAL_FEATURES_DIALOG_CLASS} .SpotifyPlusExperimentalFeaturesHeaderSearch .search-container > svg {
  position: absolute;
  left: 18px;
  top: 50%;
  transform: translateY(-50%);
  color: rgba(255, 255, 255, 0.45);
  pointer-events: none;
  z-index: 1;
  margin: 0;
  display: block;
}

.${EXPERIMENTAL_FEATURES_DIALOG_CLASS} .SpotifyPlusExperimentalFeaturesHeaderSearch input.search {
  display: block;
  width: 100%;
  height: 46px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 14px;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.045), rgba(255, 255, 255, 0.025));
  color: #f3f7fb;
  font-size: 0.92rem;
  letter-spacing: -0.01em;
  padding: 0 16px 0 46px;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.025);
}

.${EXPERIMENTAL_FEATURES_DIALOG_CLASS} .SpotifyPlusExperimentalFeaturesHeaderSearch input.search::placeholder {
  color: rgba(255, 255, 255, 0.42);
}

.${EXPERIMENTAL_FEATURES_DIALOG_CLASS} .SpotifyPlusExperimentalFeaturesHeaderSearch input.search:focus {
  outline: none;
  border-color: rgba(30, 215, 96, 0.55);
  box-shadow:
    0 0 0 3px rgba(30, 215, 96, 0.12),
    inset 0 1px 0 rgba(255, 255, 255, 0.025);
}

.${EXPERIMENTAL_FEATURES_DIALOG_CLASS} .main-trackCreditsModal-mainSection {
  min-height: 0;
  flex: 1;
  padding: 0;
  overflow: hidden;
}

.${EXPERIMENTAL_FEATURES_DIALOG_CLASS} .main-trackCreditsModal-originalCredits {
  height: 100%;
  overflow: hidden;
}

.${EXPERIMENTAL_FEATURES_ROOT_CLASS} {
  height: 100%;
  overflow: auto;
  width: 100%;
  padding: 14px 0 22px 20px;
  max-width: none;
  margin: 0;
  scrollbar-width: thin;
  scrollbar-color: rgba(255, 255, 255, 0.18) transparent;
}

.${EXPERIMENTAL_FEATURES_ROOT_CLASS}::-webkit-scrollbar {
  width: 8px;
}

.${EXPERIMENTAL_FEATURES_ROOT_CLASS}::-webkit-scrollbar-track {
  background: transparent;
}

.${EXPERIMENTAL_FEATURES_ROOT_CLASS}::-webkit-scrollbar-thumb {
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.16);
}

.${EXPERIMENTAL_FEATURES_ROOT_CLASS} .setting-row {
  position: relative;
  display: grid !important;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 14px;
  align-items: center;
  margin: 0;
  padding: 13px 14px;
  width: calc(100% - 20px);
  box-sizing: border-box;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 16px;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.035), rgba(255, 255, 255, 0.02));
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.025);
  transition:
    background 120ms ease,
    border-color 120ms ease,
    transform 120ms ease;
}

.${EXPERIMENTAL_FEATURES_ROOT_CLASS} .setting-row.SpotifyPlusExperimentalFeaturesHidden {
  display: none !important;
}

.${EXPERIMENTAL_FEATURES_ROOT_CLASS} .setting-row + .setting-row {
  margin-top: 12px;
}

.${EXPERIMENTAL_FEATURES_ROOT_CLASS} .setting-row:hover {
  border-color: rgba(255, 255, 255, 0.13);
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.05), rgba(255, 255, 255, 0.028));
  transform: translateY(-1px);
}

.${EXPERIMENTAL_FEATURES_ROOT_CLASS} .setting-row .col {
  padding: 0;
}

.${EXPERIMENTAL_FEATURES_ROOT_CLASS} .setting-row .col.description {
  float: none;
  width: auto !important;
  min-width: 0;
  padding: 0 !important;
}

.${EXPERIMENTAL_FEATURES_ROOT_CLASS} .setting-row .col.action {
  float: none;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  min-width: max-content;
  padding: 0 !important;
}

.${EXPERIMENTAL_FEATURES_ROOT_CLASS} .setting-row label.col.description {
  color: rgba(247, 251, 255, 0.9);
  font-size: 0.92rem;
  line-height: 1.35;
  letter-spacing: -0.01em;
}

.${EXPERIMENTAL_FEATURES_ROOT_CLASS} .setting-row.is-search {
  display: none !important;
  visibility: hidden !important;
  height: 0 !important;
  min-height: 0 !important;
  margin: 0 !important;
  padding: 0 !important;
  border: 0 !important;
  overflow: hidden !important;
}

.${EXPERIMENTAL_FEATURES_ROOT_CLASS} button.switch {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 20px;
  margin-inline-start: 0;
  padding: 0;
  border-radius: 999px;
  border: none;
  background: transparent;
  transition:
    transform 120ms ease;
}

.${EXPERIMENTAL_FEATURES_ROOT_CLASS} button.switch::before {
  content: "";
  position: absolute;
  inset: 0;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.15);
  transition: background 120ms ease;
}

.${EXPERIMENTAL_FEATURES_ROOT_CLASS} button.switch::after {
  content: "";
  position: absolute;
  top: 3px;
  left: 3px;
  width: 14px;
  height: 14px;
  border-radius: 999px;
  background: #ffffff;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.24);
  transition: transform 120ms ease;
}

.${EXPERIMENTAL_FEATURES_ROOT_CLASS} button.switch svg {
  display: none;
}

.${EXPERIMENTAL_FEATURES_ROOT_CLASS} .setting-row.is-switch .col.action {
  min-width: 36px;
}

.${EXPERIMENTAL_FEATURES_ROOT_CLASS} .setting-row.is-switch button.switch:not(.disabled):not([disabled]) {
  background: transparent;
}

.${EXPERIMENTAL_FEATURES_ROOT_CLASS} .setting-row.is-switch button.switch:not(.disabled):not([disabled])::before {
  background: #1ed760;
}

.${EXPERIMENTAL_FEATURES_ROOT_CLASS} .setting-row.is-switch button.switch:not(.disabled):not([disabled])::after {
  transform: translateX(14px);
}

.${EXPERIMENTAL_FEATURES_ROOT_CLASS} button.switch.disabled,
.${EXPERIMENTAL_FEATURES_ROOT_CLASS} button.switch[disabled] {
  color: rgba(255, 255, 255, 0.3);
}

.${EXPERIMENTAL_FEATURES_ROOT_CLASS} .setting-row.is-switch button.switch.disabled::before,
.${EXPERIMENTAL_FEATURES_ROOT_CLASS} .setting-row.is-switch button.switch[disabled]::before {
  background: rgba(255, 255, 255, 0.15);
}

.${EXPERIMENTAL_FEATURES_ROOT_CLASS} .setting-row.is-switch button.switch.disabled::after,
.${EXPERIMENTAL_FEATURES_ROOT_CLASS} .setting-row.is-switch button.switch[disabled]::after {
  transform: translateX(0);
}

.${EXPERIMENTAL_FEATURES_ROOT_CLASS} button.switch:hover,
.${EXPERIMENTAL_FEATURES_ROOT_CLASS} .reset:hover,
.${EXPERIMENTAL_FEATURES_ROOT_CLASS} .dropdown:hover {
  transform: translateY(-1px);
}

.${EXPERIMENTAL_FEATURES_ROOT_CLASS} .dropdown,
.${EXPERIMENTAL_FEATURES_ROOT_CLASS} .reset {
  min-height: 38px;
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.05), rgba(255, 255, 255, 0.03));
  color: rgba(247, 251, 255, 0.92);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.025);
}

.${EXPERIMENTAL_FEATURES_ROOT_CLASS} .dropdown {
  min-width: 148px;
  padding: 0 36px 0 14px;
  appearance: none;
  -webkit-appearance: none;
  background-image:
    linear-gradient(45deg, transparent 50%, rgba(255, 255, 255, 0.62) 50%),
    linear-gradient(135deg, rgba(255, 255, 255, 0.62) 50%, transparent 50%);
  background-position:
    calc(100% - 18px) calc(50% - 1px),
    calc(100% - 13px) calc(50% - 1px);
  background-size: 5px 5px, 5px 5px;
  background-repeat: no-repeat;
}

.${EXPERIMENTAL_FEATURES_ROOT_CLASS} .dropdown:focus,
.${EXPERIMENTAL_FEATURES_ROOT_CLASS} .reset:focus {
  outline: none;
  border-color: rgba(30, 215, 96, 0.55);
  box-shadow: 0 0 0 3px rgba(30, 215, 96, 0.12);
}

.${EXPERIMENTAL_FEATURES_ROOT_CLASS} .reset {
  padding-inline: 16px;
  font-size: 0.86rem;
  font-weight: 700;
  letter-spacing: -0.01em;
}

@media (max-width: 760px) {
  .${EXPERIMENTAL_FEATURES_DIALOG_CLASS} {
    width: calc(100vw - 48px);
    max-height: calc(100vh - 48px);
    border-radius: 18px;
  }

  .${EXPERIMENTAL_FEATURES_DIALOG_CLASS} .main-embedWidgetGenerator-container {
    height: calc(100vh - 48px);
  }

  .${EXPERIMENTAL_FEATURES_DIALOG_CLASS} .main-trackCreditsModal-header {
    padding: 18px 18px 14px;
  }

  .${EXPERIMENTAL_FEATURES_ROOT_CLASS} {
    padding: 12px 12px 18px;
    max-width: none;
  }

  .${EXPERIMENTAL_FEATURES_ROOT_CLASS} .setting-row {
    grid-template-columns: 1fr;
    align-items: stretch;
  }

  .${EXPERIMENTAL_FEATURES_ROOT_CLASS} .setting-row .col.action {
    justify-content: flex-start;
  }

  .${EXPERIMENTAL_FEATURES_DIALOG_CLASS} .SpotifyPlusExperimentalFeaturesHeaderTop {
    align-items: flex-start;
  }
}
`;

  document.head.appendChild(style);
}

function isExperimentalFeaturesDialog(dialog: HTMLElement) {
  const ariaLabel = normalizeText(dialog.getAttribute("aria-label"));
  if (ariaLabel === "experimental features") return true;

  const heading = dialog.querySelector<HTMLElement>("h1, h2, [data-encore-id='type']");
  return normalizeText(heading?.textContent) === "experimental features";
}

function decorateExperimentalFeaturesDialog(dialog: HTMLElement) {
  if (!isExperimentalFeaturesDialog(dialog)) return;

  if (dialog.dataset.spotifyPlusExperimentalStyled !== "true") {
    dialog.classList.add(EXPERIMENTAL_FEATURES_DIALOG_CLASS);
    dialog
      .closest<HTMLElement>(".GenericModal__overlay")
      ?.classList.add(EXPERIMENTAL_FEATURES_OVERLAY_CLASS);
  }

  const root = dialog.querySelector<HTMLElement>(".spicetify-exp-features");
  if (!root) return;

  root.classList.add(EXPERIMENTAL_FEATURES_ROOT_CLASS);

  const updateVisibleRows = (query: string) => {
    const needle = normalizeText(query);
    const rows = Array.from(root.querySelectorAll<HTMLElement>(".setting-row")).filter(
      (row) => row.id !== "search"
    );

    for (const row of rows) {
      const haystack = normalizeText(
        [
          row.id,
          row.querySelector<HTMLElement>(".col.description")?.textContent,
          row.textContent,
          Array.from(row.querySelectorAll<HTMLOptionElement>("option"))
            .map((option) => option.textContent)
            .join(" "),
        ]
          .filter(Boolean)
          .join(" ")
      );
      row.classList.toggle(
        "SpotifyPlusExperimentalFeaturesHidden",
        Boolean(needle) && !haystack.includes(needle)
      );
    }
  };

  for (const styleElement of Array.from(root.querySelectorAll(":scope > style"))) {
    styleElement.remove();
  }

  const header = dialog.querySelector<HTMLElement>(".main-trackCreditsModal-header");
  const searchRow = root.querySelector<HTMLElement>(".setting-row#search");
  const sourceSearchContainer = searchRow?.querySelector<HTMLElement>(".search-container");
  if (header && searchRow && sourceSearchContainer) {
    let topRow = header.querySelector<HTMLElement>(".SpotifyPlusExperimentalFeaturesHeaderTop");
    const title = header.querySelector<HTMLElement>("h1");
    const closeButton = header.querySelector<HTMLElement>(".main-trackCreditsModal-closeBtn");

    if (!topRow && title && closeButton) {
      topRow = document.createElement("div");
      topRow.className = "SpotifyPlusExperimentalFeaturesHeaderTop";
      header.insertBefore(topRow, header.firstChild);
      topRow.appendChild(title);
      topRow.appendChild(closeButton);
    }

    let headerSearch = header.querySelector<HTMLElement>(".SpotifyPlusExperimentalFeaturesHeaderSearch");
    if (!headerSearch) {
      headerSearch = document.createElement("div");
      headerSearch.className = "SpotifyPlusExperimentalFeaturesHeaderSearch";
      header.appendChild(headerSearch);
    }

    headerSearch.innerHTML = "";

    const clonedSearchContainer = sourceSearchContainer.cloneNode(true) as HTMLElement;
    const sourceInput = sourceSearchContainer.querySelector<HTMLInputElement>("input.search");
    const clonedInput = clonedSearchContainer.querySelector<HTMLInputElement>("input.search");
    if (sourceInput) {
      sourceInput.value = "";
      sourceInput.dispatchEvent(new Event("input", { bubbles: true }));
    }
    if (clonedInput) {
      clonedInput.value = "";
      const syncSearch = () => {
        if (sourceInput) {
          sourceInput.value = clonedInput.value;
          sourceInput.dispatchEvent(new Event("input", { bubbles: true }));
        }
        updateVisibleRows(clonedInput.value);
      };

      clonedInput.addEventListener("input", syncSearch);
      clonedInput.addEventListener("keyup", syncSearch);
      clonedInput.addEventListener("search", syncSearch);
    }

    updateVisibleRows("");

    headerSearch.appendChild(clonedSearchContainer);

    if (!dialog.dataset.spotifyPlusExperimentalCloseBound && closeButton) {
      closeButton.addEventListener("click", () => {
        const originalSearch = searchRow.querySelector<HTMLInputElement>("input.search");
        const headerSearchInput = dialog.querySelector<HTMLInputElement>(
          ".SpotifyPlusExperimentalFeaturesHeaderSearch input.search"
        );
        if (originalSearch) {
          originalSearch.value = "";
          originalSearch.dispatchEvent(new Event("input", { bubbles: true }));
        }
        if (headerSearchInput) {
          headerSearchInput.value = "";
        }
        updateVisibleRows("");
      });
      dialog.dataset.spotifyPlusExperimentalCloseBound = "true";
    }
  }

  const rows = Array.from(root.querySelectorAll<HTMLElement>(".setting-row"));
  for (const row of rows) {
    row.classList.toggle("is-search", row.id === "search" || row.querySelector("input.search") !== null);
    row.classList.toggle("is-switch", row.querySelector("button.switch") !== null);
    row.classList.toggle("is-select", row.querySelector("select.dropdown") !== null);
    row.classList.toggle("is-reset", row.id === "reset" || row.querySelector("button.reset") !== null);
  }

  dialog.dataset.spotifyPlusExperimentalStyled = "true";
}

function applyExperimentalFeaturesRedesign() {
  const dialogs = Array.from(document.querySelectorAll<HTMLElement>(".GenericModal[role='dialog']"));
  for (const dialog of dialogs) {
    decorateExperimentalFeaturesDialog(dialog);
  }
}

export function startExperimentalFeaturesController() {
  ensureExperimentalFeaturesStyles();
  applyExperimentalFeaturesRedesign();

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (!(node instanceof HTMLElement)) continue;

        if (node.matches?.(".GenericModal[role='dialog']")) {
          decorateExperimentalFeaturesDialog(node);
          continue;
        }

        const dialog = node.querySelector?.<HTMLElement>(".GenericModal[role='dialog']");
        if (dialog) {
          decorateExperimentalFeaturesDialog(dialog);
        }
      }
    }
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });
}
