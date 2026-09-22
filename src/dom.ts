export function normalizeText(value: string | null | undefined) {
  return (value ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}

export function isElementVisible(element: HTMLElement) {
  return !!(element.offsetParent || element.getClientRects().length);
}

export function toggleElementDisplay(element: HTMLElement, hidden: boolean) {
  if (hidden) {
    if (!("spotifyPlusOriginalDisplay" in element.dataset)) {
      element.dataset.spotifyPlusOriginalDisplay = element.style.display || "";
      element.dataset.spotifyPlusOriginalDisplayPriority = element.style.getPropertyPriority("display");
    }
    if (element.style.display !== "none") element.style.display = "none";
    return;
  }

  if ("spotifyPlusOriginalDisplay" in element.dataset) {
    // Leave subsequent changes made by Spotify or other extensions alone.
    if (element.style.display === "none" && !element.style.getPropertyPriority("display")) {
      const original = element.dataset.spotifyPlusOriginalDisplay ?? "";
      if (original) {
        element.style.setProperty("display", original, element.dataset.spotifyPlusOriginalDisplayPriority ?? "");
      } else {
        element.style.removeProperty("display");
      }
    }
    delete element.dataset.spotifyPlusOriginalDisplay;
    delete element.dataset.spotifyPlusOriginalDisplayPriority;
  }
}
