export function normalizeText(value: string | null | undefined) {
  return (value ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}

export function isElementVisible(element: HTMLElement) {
  return !!(element.offsetParent || element.getClientRects().length);
}

export function toggleElementDisplay(element: HTMLElement, hidden: boolean) {
  if (hidden) {
    if (!element.dataset.spotifyPlusOriginalDisplay) {
      element.dataset.spotifyPlusOriginalDisplay = element.style.display || "";
    }
    element.style.display = "none";
    return;
  }

  if ("spotifyPlusOriginalDisplay" in element.dataset) {
    element.style.display = element.dataset.spotifyPlusOriginalDisplay ?? "";
    delete element.dataset.spotifyPlusOriginalDisplay;
  } else if (element.style.display === "none") {
    element.style.display = "";
  }
}
