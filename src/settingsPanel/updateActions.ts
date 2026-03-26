import {
  checkForUpdatesNow,
  getAvailableRelease,
  getCurrentVersion,
  openUpdatePrompt,
} from "../features/updatePrompt";

export function makeCheckNowButton() {
  const checkNowButton = document.createElement("button");
  checkNowButton.className = "sl-btn";
  checkNowButton.type = "button";
  checkNowButton.textContent = getAvailableRelease() ? "Update Now" : "Check Now";
  checkNowButton.addEventListener("click", () => {
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

  return checkNowButton;
}

export function getVersionLabel() {
  return `Version ${getCurrentVersion()}`;
}
