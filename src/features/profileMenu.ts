import { SETTINGS_CHANGED_EVENT, getSettings } from "../config";
import { isElementVisible, normalizeText, toggleElementDisplay } from "../dom";
import { showSettingsPanel } from "../settingsPanel";
import {
  UPDATE_AVAILABILITY_CHANGED_EVENT,
  hasUpdateAvailable,
  getAvailableRelease,
  openUpdatePrompt,
} from "./updatePrompt";

const menuItemSettings: Array<{
  label: string;
  key: keyof Pick<
    ReturnType<typeof getSettings>,
    | "hideHomeConfigMenuItem"
    | "hideAccountMenuItem"
    | "hideProfileMenuItem"
    | "hideSupportMenuItem"
    | "hidePrivateSessionMenuItem"
    | "hideLogOutMenuItem"
  >;
}> = [
  { label: "home config", key: "hideHomeConfigMenuItem" },
  { label: "account", key: "hideAccountMenuItem" },
  { label: "profile", key: "hideProfileMenuItem" },
  { label: "support", key: "hideSupportMenuItem" },
  { label: "private session", key: "hidePrivateSessionMenuItem" },
  { label: "log out", key: "hideLogOutMenuItem" },
];

const profileMenuIdentityLabels = [
  "account",
  "profile",
  "support",
  "home config",
  "private session",
  "log out",
  "settings",
];

function getMenuLabels(menu: HTMLElement) {
  return Array.from(
    menu.querySelectorAll<HTMLElement>(".main-contextMenu-menuItemLabel, [data-encore-id='text']")
  ).map((element) => normalizeText(element.textContent));
}

function isProfileMenu(menu: HTMLElement) {
  const host = menu.closest<HTMLElement>("#context-menu");
  if (host?.getAttribute("data-placement") !== "bottom-end") {
    return false;
  }

  const labels = getMenuLabels(menu);
  const hasKnownProfileItems = labels.some((label) =>
    profileMenuIdentityLabels.includes(label)
  );
  const hasYourUpdates = normalizeText(menu.textContent).includes("your updates");

  return (
    hasYourUpdates ||
    (labels.includes("settings") && hasKnownProfileItems)
  );
}

function createSpotifyPlusMenuItem() {
  const item = document.createElement("li");
  item.role = "presentation";
  item.className = "main-contextMenu-menuItem";
  item.dataset.spotifyPlusInjected = "true";

  const button = document.createElement("button");
  button.className = "main-contextMenu-menuItemButton";
  button.setAttribute("role", "menuitem");
  button.tabIndex = -1;

  const label = document.createElement("span");
  label.className =
    "e-91000-text encore-text-body-small ellipsis-one-line main-contextMenu-menuItemLabel";
  label.setAttribute("data-encore-id", "text");
  label.dir = "auto";
  label.textContent = "Spotify+";

  const labelWrap = document.createElement("span");
  labelWrap.className = "spotify-plus-profile-menu-label";
  labelWrap.appendChild(label);
  button.appendChild(labelWrap);
  button.addEventListener("click", (event) => {
    const tippyRoot = (event.currentTarget as HTMLElement).closest("[data-tippy-root]");
    const hostMenu = (event.currentTarget as HTMLElement).closest("#context-menu");

    (document.activeElement as HTMLElement | null)?.blur?.();
    if (hostMenu instanceof HTMLElement) {
      hostMenu.style.display = "none";
    }
    if (tippyRoot instanceof HTMLElement) {
      tippyRoot.style.display = "none";
      window.setTimeout(() => tippyRoot.remove(), 0);
    }

    window.setTimeout(() => {
      showSettingsPanel();
    }, 0);
  });

  item.appendChild(button);
  return item;
}

function createUpdateMenuItem() {
  const release = getAvailableRelease();
  if (!release) {
    return null;
  }

  const item = document.createElement("li");
  item.role = "presentation";
  item.className = "main-contextMenu-menuItem";
  item.dataset.spotifyPlusUpdateInjected = "true";

  const button = document.createElement("button");
  button.className = "main-contextMenu-menuItemButton";
  button.setAttribute("role", "menuitem");
  button.tabIndex = -1;

  const label = document.createElement("span");
  label.className =
    "e-91000-text encore-text-body-small ellipsis-one-line main-contextMenu-menuItemLabel";
  label.setAttribute("data-encore-id", "text");
  label.dir = "auto";
  label.textContent = "Update Spotify+";

  button.appendChild(label);
  button.addEventListener("click", (event) => {
    const tippyRoot = (event.currentTarget as HTMLElement).closest("[data-tippy-root]");
    const hostMenu = (event.currentTarget as HTMLElement).closest("#context-menu");

    (document.activeElement as HTMLElement | null)?.blur?.();
    if (hostMenu instanceof HTMLElement) {
      hostMenu.style.display = "none";
    }
    if (tippyRoot instanceof HTMLElement) {
      tippyRoot.style.display = "none";
      window.setTimeout(() => tippyRoot.remove(), 0);
    }

    window.setTimeout(() => {
      openUpdatePrompt();
    }, 0);
  });

  item.appendChild(button);
  return item;
}

function injectSpotifyPlusMenuItem(menu: HTMLElement) {
  const existing = menu.querySelector<HTMLElement>('[data-spotify-plus-injected="true"]');
  if (existing) return;

  const settingsItem = Array.from(menu.querySelectorAll<HTMLElement>(".main-contextMenu-menuItem")).find(
    (item) => getItemLabel(item) === "settings"
  );

  const spotifyPlusItem = createSpotifyPlusMenuItem();
  if (settingsItem?.parentElement) {
    settingsItem.parentElement.insertBefore(spotifyPlusItem, settingsItem);
    return;
  }

  menu.appendChild(spotifyPlusItem);
}

function injectUpdateMenuItem(menu: HTMLElement) {
  const existing = menu.querySelector<HTMLElement>('[data-spotify-plus-update-injected="true"]');
  if (!hasUpdateAvailable()) {
    existing?.remove();
    return;
  }

  if (existing) {
    return;
  }

  const spotifyPlusItem = menu.querySelector<HTMLElement>('[data-spotify-plus-injected="true"]');
  const updateItem = createUpdateMenuItem();
  if (!updateItem) {
    return;
  }

  if (spotifyPlusItem?.parentElement) {
    spotifyPlusItem.parentElement.insertBefore(updateItem, spotifyPlusItem.nextElementSibling);
    return;
  }

  menu.appendChild(updateItem);
}

function getProfileAvatarCandidates() {
  const selectors = [
    "button.main-userWidget-box",
    'button[aria-label*="account" i]',
    'button[aria-label*="profile" i]',
    'button[aria-label*="user" i]',
    '[data-testid*="user-widget" i]',
    '[data-testid*="account" i]',
  ];

  return Array.from(document.querySelectorAll<HTMLElement>(selectors.join(","))).filter(
    (element) =>
      isElementVisible(element) &&
      !element.closest("#context-menu") &&
      (element.querySelector("img, svg") !== null || element.getAttribute("aria-label") !== null)
  );
}

function syncSpotifyPlusUpdateIndicators() {
  const shouldShow = hasUpdateAvailable();

  for (const candidate of getProfileAvatarCandidates()) {
    candidate.classList.add("spotify-plus-profile-avatar-anchor");
    const avatarFigure =
      candidate.querySelector<HTMLElement>("figure") ??
      candidate.querySelector<HTMLElement>("[data-testid*='avatar' i]") ??
      candidate.querySelector<HTMLElement>("img")?.parentElement ??
      candidate;

    avatarFigure.classList.add("spotify-plus-profile-avatar-figure");

    let dot = avatarFigure.querySelector<HTMLElement>(".spotify-plus-profile-avatar-update-dot");
    if (!dot) {
      dot = document.createElementNS("http://www.w3.org/2000/svg", "svg") as unknown as HTMLElement;
      dot.setAttribute("data-encore-id", "icon");
      dot.setAttribute("role", "img");
      dot.setAttribute("aria-hidden", "true");
      dot.setAttribute(
        "class",
        "spotify-plus-profile-avatar-update-dot e-91000-icon e-91000-baseline aytVBHQR2dzGmQeWYrnu tvDNkVcq1njXGXjsZuAY"
      );
      dot.setAttribute("viewBox", "0 0 24 24");
      dot.setAttribute(
        "style",
        "--encore-icon-height: 14px; --encore-icon-width: 14px;"
      );
      dot.innerHTML = "<title>Update available</title><circle cx=\"50%\" cy=\"50%\" r=\"6\"></circle>";
      avatarFigure.appendChild(dot);
    }

    dot.toggleAttribute("hidden", !shouldShow);
  }
}

function getItemLabel(item: HTMLElement) {
  const labelElement = item.querySelector<HTMLElement>(
    ".main-contextMenu-menuItemLabel, [data-encore-id='text']"
  );
  return normalizeText(labelElement?.textContent);
}

function isYourUpdatesContainer(element: HTMLElement) {
  const hasYourUpdatesHeading = Array.from(
    element.querySelectorAll<HTMLElement>("[data-encore-id='text']")
  ).some((node) => normalizeText(node.textContent) === "your updates");

  const hasLoadingSpinner =
    element.querySelector('[role="progressbar"], [data-encore-id="progressCircle"]') !== null;

  return hasYourUpdatesHeading || hasLoadingSpinner;
}

function isDivider(element: HTMLElement) {
  return (
    element.classList.contains("main-contextMenu-dividerAfter") ||
    element.classList.contains("main-contextMenu-dividerBefore")
  );
}

function applyProfileMenuCleanup() {
  const settings = getSettings();
  const menus = Array.from(
    document.querySelectorAll<HTMLElement>(
      '#context-menu[data-placement="bottom-end"] .main-contextMenu-menu'
    )
  ).filter((menu) => isElementVisible(menu) && isProfileMenu(menu));

  for (const menu of menus) {
    injectSpotifyPlusMenuItem(menu);
    injectUpdateMenuItem(menu);

    const items = Array.from(menu.querySelectorAll<HTMLElement>(".main-contextMenu-menuItem"));

    for (const item of items) {
      const label = getItemLabel(item);

      for (const target of menuItemSettings) {
        if (label === target.label) {
          toggleElementDisplay(item, settings[target.key]);
        }
      }
    }

    const directChildren = Array.from(menu.children).filter(
      (child): child is HTMLElement => child instanceof HTMLElement
    );
    const updatesContainer = directChildren.find((child) => isYourUpdatesContainer(child));

    if (updatesContainer) {
      toggleElementDisplay(updatesContainer, settings.hideYourUpdatesSection);
    }

    if (updatesContainer) {
      const adjacentDividers = [updatesContainer.previousElementSibling, updatesContainer.nextElementSibling]
        .filter((child): child is HTMLElement => child instanceof HTMLElement)
        .filter((child) => isDivider(child));

      for (const divider of adjacentDividers) {
        toggleElementDisplay(divider, settings.hideYourUpdatesSection);
      }
    }
  }
}

export function startProfileMenuController() {
  applyProfileMenuCleanup();
  syncSpotifyPlusUpdateIndicators();

  const observer = new MutationObserver(() => {
    applyProfileMenuCleanup();
    syncSpotifyPlusUpdateIndicators();
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });

  window.addEventListener(SETTINGS_CHANGED_EVENT, applyProfileMenuCleanup);
  window.addEventListener(UPDATE_AVAILABILITY_CHANGED_EVENT, () => {
    applyProfileMenuCleanup();
    syncSpotifyPlusUpdateIndicators();
  });
}
