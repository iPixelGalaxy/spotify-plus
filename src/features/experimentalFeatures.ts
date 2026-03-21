import { normalizeText } from "../dom";

const EXPERIMENTAL_FEATURES_DIALOG_CLASS = "SpotifyPlusExperimentalFeaturesDialog";
const EXPERIMENTAL_FEATURES_OVERLAY_CLASS = "SpotifyPlusExperimentalFeaturesOverlay";
const EXPERIMENTAL_FEATURES_ROOT_CLASS = "SpotifyPlusExperimentalFeaturesRoot";

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
