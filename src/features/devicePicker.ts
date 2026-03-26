type ConnectDevice = {
  id: string;
  name?: string;
  type?: string;
  isGroup?: boolean;
  [key: string]: unknown;
};

import { SETTINGS_CHANGED_EVENT, getSettings } from "../config";

const CONNECT_BUTTON_SELECTOR =
  'button[aria-label="Connect to a device"], button[data-restore-focus-key="device_picker"]';
const CONNECT_SIDEBAR_SELECTOR = 'aside[aria-label="Connect to a device"]';
const CONNECT_TOOLTIP_LABEL = "Connect to a device";
const CONNECT_PROXY_SELECTOR = 'button[data-spotify-plus-device-picker-proxy="true"]';

let popupRoot: HTMLDivElement | null = null;
let popupButton: HTMLElement | null = null;
let openRefreshHandle = 0;
let isOpening = false;

function isEnabled() {
  return getSettings().restoreOldDevicePicker;
}

function getConnectDevicesApi() {
  return Spicetify.Platform?.ConnectDevicesAPI as
    | {
        getDevices?: () => Promise<ConnectDevice[]>;
        getActiveDevice?: () => Promise<ConnectDevice | null>;
      }
    | undefined;
}

function getConnectTransferApi() {
  return (
    (Spicetify.Platform?.ConnectAPI as
      | {
          transferPlayback?: (deviceId: string, loggingParams?: Record<string, unknown>) => Promise<void>;
        }
      | undefined) ??
    (Spicetify.Platform?.ConnectTransferAPI as
      | {
          transferPlayback?: (deviceId: string, loggingParams?: Record<string, unknown>) => Promise<void>;
        }
      | undefined)
  );
}

function isConnectSidebar(element: Element) {
  return element.matches(CONNECT_SIDEBAR_SELECTOR);
}

function hideConnectSidebar() {
  const sidebars = Array.from(document.querySelectorAll<HTMLElement>(CONNECT_SIDEBAR_SELECTOR));
  for (const sidebar of sidebars) {
    sidebar.style.display = "none";
  }
}

function showConnectSidebar() {
  const sidebars = Array.from(document.querySelectorAll<HTMLElement>(CONNECT_SIDEBAR_SELECTOR));
  for (const sidebar of sidebars) {
    if (sidebar.style.display === "none") {
      sidebar.style.display = "";
    }
  }
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function isConnectTooltipRoot(element: Element) {
  if (!element.matches("[data-tippy-root]")) {
    return false;
  }

  const tooltip = element.querySelector<HTMLElement>('[role="tooltip"]');
  return tooltip?.textContent?.trim() === CONNECT_TOOLTIP_LABEL;
}

function hideConnectTooltips() {
  const tooltipRoots = Array.from(
    document.querySelectorAll<HTMLElement>("[data-tippy-root]")
  ).filter((element) => isConnectTooltipRoot(element));

  for (const tooltipRoot of tooltipRoots) {
    tooltipRoot.style.display = "none";
    window.setTimeout(() => {
      tooltipRoot.remove();
    }, 0);
  }
}

function getDeviceIconPath(type: string | undefined) {
  const normalized = (type ?? "").toLowerCase();
  if (normalized.includes("phone")) {
    return "M6 2.75C6 1.784 6.784 1 7.75 1h6.5c.966 0 1.75.784 1.75 1.75v10.5A1.75 1.75 0 0 1 14.25 15h-6.5A1.75 1.75 0 0 1 6 13.25zm1.75-.25a.25.25 0 0 0-.25.25v10.5c0 .138.112.25.25.25h6.5a.25.25 0 0 0 .25-.25V2.75a.25.25 0 0 0-.25-.25z";
  }
  if (normalized.includes("speaker")) {
    return "M8.825.12a.75.75 0 0 1 .75.75v1.694a4.25 4.25 0 0 1 2.29 7.66l.785 1.362A5.75 5.75 0 0 0 11.075 2V.87a.75.75 0 0 1 .75-.75M5.53 2.47A.75.75 0 0 1 6.59 3.53a5.24 5.24 0 1 0 0 7.41.75.75 0 0 1 1.06 1.06A6.74 6.74 0 1 1 5.53 2.47m1.06 2.12a.75.75 0 0 1 1.06 0 2.24 2.24 0 1 1-3.17 0 .75.75 0 0 1 1.06 1.06.74.74 0 1 0 1.05-1.06";
  }
  return "M0 21a1 1 0 0 1 1-1h22a1 1 0 1 1 0 2H1a1 1 0 0 1-1-1zM3 5a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3v9a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V5zm3-1a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V5a1 1 0 0 0-1-1H6z";
}

function getDeviceLabel(device: ConnectDevice | null | undefined) {
  if (!device) return "This computer";
  if (device.id === "local_device") {
    return "This computer";
  }
  return device.name ?? "Unknown device";
}

function setButtonOpenState(button: HTMLElement, open: boolean) {
  button.classList.toggle("main-genericButton-buttonActive", open);
  button.classList.toggle("main-genericButton-buttonActiveDot", open);
  button.setAttribute("aria-pressed", open ? "true" : "false");
  button.dataset.spotifyPlusDevicePickerOpen = open ? "true" : "false";
  const tooltip = button.querySelector<HTMLElement>(".SpotifyPlusManagedDeviceTooltipRoot");

  if (open) {
    button.removeAttribute("aria-label");
    button.removeAttribute("title");
    button.removeAttribute("aria-describedby");
    if (tooltip) {
      tooltip.style.display = "none";
    }
    return;
  }

  button.setAttribute("aria-label", CONNECT_TOOLTIP_LABEL);
  if (tooltip) {
    tooltip.style.display = "none";
  }
}

function createManagedButton(sourceButton: HTMLElement) {
  const sourceStyle = window.getComputedStyle(sourceButton);
  const button = document.createElement("button");
  button.type = "button";
  button.dataset.spotifyPlusDevicePickerProxy = "true";
  button.dataset.encoreId = sourceButton.getAttribute("data-encore-id") ?? "buttonTertiary";
  button.className = sourceButton.className;
  button.innerHTML = sourceButton.innerHTML;

  const tooltip = document.createElement("div");
  tooltip.className = "SpotifyPlusManagedDeviceTooltipRoot";
  tooltip.setAttribute("aria-hidden", "true");
  tooltip.style.position = "absolute";
  tooltip.style.left = "50%";
  tooltip.style.bottom = "calc(100% + 10px)";
  tooltip.style.transform = "translateX(-50%)";
  tooltip.style.display = "none";
  tooltip.style.width = "max-content";
  tooltip.style.maxWidth = "none";
  tooltip.style.pointerEvents = "none";
  tooltip.style.zIndex = "9999";
  tooltip.innerHTML = `
    <div
      role="tooltip"
      style="
        display: inline-block;
        width: max-content;
        max-width: none;
        white-space: nowrap;
        background: #282828;
        color: rgb(255, 255, 255);
        border-radius: 4px;
        padding: 7px 8px;
        font-size: ${sourceStyle.fontSize};
        line-height: 1;
        font-weight: ${sourceStyle.fontWeight};
        font-family: ${sourceStyle.fontFamily};
        letter-spacing: normal;
        text-rendering: auto;
        -webkit-font-smoothing: auto;
        border: 0;
        box-shadow: none;
      "
    >
      ${CONNECT_TOOLTIP_LABEL}
    </div>
  `;

  button.style.position = "relative";
  button.style.overflow = "visible";
  button.appendChild(tooltip);

  setButtonOpenState(button, false);
  button.addEventListener("mouseover", () => {
    if (button.dataset.spotifyPlusDevicePickerOpen !== "true") {
      tooltip.style.display = "inline-block";
    }
  });
  button.addEventListener("mouseout", () => {
    tooltip.style.display = "none";
  });
  button.addEventListener("focus", () => {
    if (button.dataset.spotifyPlusDevicePickerOpen !== "true") {
      tooltip.style.display = "inline-block";
    }
  });
  button.addEventListener("blur", () => {
    tooltip.style.display = "none";
  });
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    tooltip.style.display = "none";
    void openDevicePicker(button);
  });
  return button;
}

function installManagedButton(sourceButton: HTMLElement) {
  if (sourceButton.dataset.spotifyPlusDevicePickerManaged === "true") {
    return;
  }

  const parent = sourceButton.parentElement;
  if (!parent) {
    return;
  }

  const managedButton = createManagedButton(sourceButton);
  sourceButton.dataset.spotifyPlusDevicePickerManaged = "true";
  sourceButton.style.display = "none";
  sourceButton.setAttribute("aria-hidden", "true");
  sourceButton.tabIndex = -1;
  parent.insertBefore(managedButton, sourceButton);
}

function installManagedButtons(root: ParentNode = document) {
  const sourceButtons = Array.from(
    root.querySelectorAll<HTMLElement>(CONNECT_BUTTON_SELECTOR)
  ).filter((button) => !button.matches(CONNECT_PROXY_SELECTOR));

  for (const sourceButton of sourceButtons) {
    installManagedButton(sourceButton);
  }
}

function restoreManagedButtons() {
  const sourceButtons = Array.from(
    document.querySelectorAll<HTMLElement>(
      `${CONNECT_BUTTON_SELECTOR}[data-spotify-plus-device-picker-managed="true"]`
    )
  );

  for (const sourceButton of sourceButtons) {
    const proxyButton = sourceButton.previousElementSibling;
    if (proxyButton instanceof HTMLElement && proxyButton.matches(CONNECT_PROXY_SELECTOR)) {
      if (popupButton === proxyButton) {
        popupButton = null;
      }
      proxyButton.remove();
    }

    sourceButton.style.display = "";
    sourceButton.removeAttribute("aria-hidden");
    sourceButton.removeAttribute("data-spotify-plus-device-picker-managed");
    sourceButton.tabIndex = 0;
  }
}

function positionPopup() {
  if (!popupRoot || !popupButton?.isConnected) return;

  const rect = popupButton.getBoundingClientRect();
  const width = 336;
  const popupHeight = popupRoot.getBoundingClientRect().height || 320;
  const left = Math.min(
    window.innerWidth - width - 16,
    Math.max(16, rect.left + rect.width / 2 - width / 2)
  );
  const top = Math.max(16, rect.top - popupHeight - 14);

  popupRoot.style.left = `${left}px`;
  popupRoot.style.top = `${top}px`;
}

function closeDevicePicker() {
  window.clearInterval(openRefreshHandle);
  openRefreshHandle = 0;
  popupRoot?.remove();
  popupRoot = null;
  if (popupButton?.isConnected) {
    setButtonOpenState(popupButton, false);
  }
  popupButton = null;
}

function syncDevicePickerMode() {
  if (isEnabled()) {
    hideConnectSidebar();
    installManagedButtons();
    return;
  }

  closeDevicePicker();
  showConnectSidebar();
  restoreManagedButtons();
}

async function transferPlayback(deviceId: string) {
  const transferApi = getConnectTransferApi();
  if (!transferApi?.transferPlayback) {
    throw new Error("transferPlayback unavailable");
  }

  await transferApi.transferPlayback(deviceId, {});
}

function createPopupRoot() {
  const root = document.createElement("div");
  root.className = "SpotifyPlusDevicePickerPopover";
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-label", "Connect to a device");
  root.innerHTML = `
    <div class="SpotifyPlusDevicePickerCard">
      <div class="SpotifyPlusDevicePickerContent">
        <div class="SpotifyPlusDevicePickerCurrent"></div>
        <div class="SpotifyPlusDevicePickerSection">
          <div class="SpotifyPlusDevicePickerSectionHeading">Select another device</div>
          <div class="SpotifyPlusDevicePickerList"></div>
        </div>
        <div class="SpotifyPlusDevicePickerFooter">
          <a href="https://support.spotify.com/article/spotify-connect/" target="_blank" rel="noreferrer noopener">Don’t see your device?</a>
          <a href="https://www.spotify.com/connect?utm_campaign=connect&utm_medium=app&utm_source=desktop" target="_blank" rel="noreferrer noopener">What can I connect to?</a>
        </div>
      </div>
    </div>
    <div class="SpotifyPlusDevicePickerArrowPill" aria-hidden="true">
      <div class="SpotifyPlusDevicePickerArrow"></div>
    </div>
  `;
  return root;
}

async function renderPopupContents(root: HTMLDivElement) {
  const devicesApi = getConnectDevicesApi();
  const listElement = root.querySelector<HTMLElement>(".SpotifyPlusDevicePickerList");
  const currentElement = root.querySelector<HTMLElement>(".SpotifyPlusDevicePickerCurrent");
  if (!devicesApi || !listElement || !currentElement) return;

  const [devicesRaw, activeDevice] = await Promise.all([
    devicesApi.getDevices?.() ?? Promise.resolve([]),
    devicesApi.getActiveDevice?.() ?? Promise.resolve(null),
  ]);

  const devices = Array.isArray(devicesRaw) ? devicesRaw : [];
  const activeId = activeDevice?.id ?? "";
  const activeName = getDeviceLabel(activeDevice);
  const activePath = getDeviceIconPath(activeDevice?.type);

  currentElement.innerHTML = `
    <div class="SpotifyPlusDevicePickerHeading">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="${activePath}"></path>
      </svg>
      <div class="SpotifyPlusDevicePickerHeadingContent">
        <div class="SpotifyPlusDevicePickerHeadingTitle">Current device</div>
        <div class="SpotifyPlusDevicePickerHeadingSubtitle">${escapeHtml(activeName)}</div>
      </div>
    </div>
  `;

  const otherDevices = devices.filter(
    (device) => device?.id && device.id !== activeId && device.name
  );

  if (otherDevices.length === 0) {
    listElement.innerHTML =
      '<div class="SpotifyPlusDevicePickerEmpty">No other available devices right now.</div>';
    return;
  }

  listElement.innerHTML = otherDevices
    .map((device) => {
      const path = getDeviceIconPath(device.type);
      return `
        <button class="SpotifyPlusDevicePickerRow" type="button" data-device-id="${escapeHtml(device.id)}">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="${path}"></path>
          </svg>
          <span>${escapeHtml(getDeviceLabel(device))}</span>
        </button>
      `;
    })
    .join("");

  for (const button of listElement.querySelectorAll<HTMLButtonElement>(".SpotifyPlusDevicePickerRow")) {
    button.addEventListener("click", async () => {
      const deviceId = button.dataset.deviceId;
      if (!deviceId) return;

      button.disabled = true;
      try {
        await transferPlayback(deviceId);
        closeDevicePicker();
      } catch {
        button.disabled = false;
        Spicetify.showNotification("Spotify+: failed to transfer playback", true);
      }
    });
  }
}

async function openDevicePicker(button: HTMLElement) {
  if (isOpening) return;
  if (popupRoot && popupButton === button) {
    closeDevicePicker();
    return;
  }

  isOpening = true;
  closeDevicePicker();
  hideConnectSidebar();
  hideConnectTooltips();

  popupButton = button;
  setButtonOpenState(button, true);
  const root = createPopupRoot();
  popupRoot = root;
  document.body.appendChild(root);
  positionPopup();

  try {
    await renderPopupContents(root);
    positionPopup();
  } catch {
    closeDevicePicker();
    Spicetify.showNotification("Spotify+: failed to open device picker", true);
  } finally {
    isOpening = false;
  }

  openRefreshHandle = window.setInterval(() => {
    if (!popupRoot) return;
    void renderPopupContents(popupRoot).then(positionPopup);
  }, 2500);
}

function onDocumentClick(event: MouseEvent) {
  if (!isEnabled()) return;

  const target = event.target;
  if (!(target instanceof Node)) return;

  const button = target instanceof Element
    ? target.closest<HTMLElement>(CONNECT_PROXY_SELECTOR)
    : null;

  if (button) {
    event.preventDefault();
    event.stopPropagation();
    void openDevicePicker(button);
    return;
  }

  if (popupRoot && !popupRoot.contains(target)) {
    closeDevicePicker();
  }
}

function onDocumentKeydown(event: KeyboardEvent) {
  if (event.key === "Escape" && popupRoot) {
    closeDevicePicker();
  }
}

function onWindowChanged() {
  positionPopup();
}

export function startDevicePickerController() {
  syncDevicePickerMode();

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (!(node instanceof Element)) continue;
        if (isEnabled() && (isConnectSidebar(node) || node.querySelector(CONNECT_SIDEBAR_SELECTOR))) {
          hideConnectSidebar();
        }
        if (isEnabled()) {
          if (node.matches(CONNECT_BUTTON_SELECTOR) && !node.matches(CONNECT_PROXY_SELECTOR)) {
            installManagedButton(node);
          }

          if (node.querySelector(CONNECT_BUTTON_SELECTOR)) {
            installManagedButtons(node);
          }
        }
        if (popupRoot && (isConnectTooltipRoot(node) || node.querySelector("[data-tippy-root]"))) {
          hideConnectTooltips();
        }
      }
    }

    if (popupRoot && popupButton && !popupButton.isConnected) {
      closeDevicePicker();
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });

  document.addEventListener("click", onDocumentClick, true);
  document.addEventListener("keydown", onDocumentKeydown, true);
  window.addEventListener("resize", onWindowChanged);
  window.addEventListener("scroll", onWindowChanged, true);
  window.addEventListener(SETTINGS_CHANGED_EVENT, (event) => {
    const key = (event as CustomEvent<{ key?: string }>).detail?.key;
    if (key && key !== "restoreOldDevicePicker") return;
    syncDevicePickerMode();
  });
}
