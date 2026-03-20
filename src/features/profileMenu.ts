import { SETTINGS_CHANGED_EVENT, getSettings } from "../config";
import { isElementVisible, normalizeText, toggleElementDisplay } from "../dom";
import { showSettingsPanel } from "../settingsPanel";

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
      showSettingsPanel();
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

function applyProfileMenuCleanup() {
  const settings = getSettings();
  const menus = Array.from(
    document.querySelectorAll<HTMLElement>(
      '#context-menu[data-placement="bottom-end"] .main-contextMenu-menu'
    )
  ).filter((menu) => isElementVisible(menu) && isProfileMenu(menu));

  for (const menu of menus) {
    injectSpotifyPlusMenuItem(menu);

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

    const updatesDivider = directChildren.find(
      (child) =>
        child.classList.contains("main-contextMenu-dividerAfter") &&
        (!updatesContainer || child.nextElementSibling === updatesContainer)
    );
    if (updatesDivider) {
      toggleElementDisplay(updatesDivider, settings.hideYourUpdatesSection);
    }
  }
}

export function startProfileMenuController() {
  applyProfileMenuCleanup();

  const observer = new MutationObserver(() => {
    applyProfileMenuCleanup();
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });

  window.addEventListener(SETTINGS_CHANGED_EVENT, applyProfileMenuCleanup);
}
