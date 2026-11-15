import { runtime, setRuntimeState, shouldStandDown } from "./integration";
import { getGitHubBundle, importGitHubBundle } from "./release-loader.mjs";

async function load() {
  if (runtime.loaderStarted) return;
  runtime.loaderStarted = true;
  while (!window.Spicetify?.LocalStorage || !Spicetify.Platform?.History) await new Promise(resolve => setTimeout(resolve, 100));
  if (await shouldStandDown()) {
    setRuntimeState("standby");
    return;
  }
  const bundle = await getGitHubBundle("spotify-plus", (version: string) => {
    const [major, minor, patch] = version.split(".").map(Number);
    return major === 0 && (minor < 3 || (minor === 3 && patch < 6)) ? "spotify-plus.js" : "spotify-plus-runtime.js";
  });
  const [major, minor, patch] = bundle.version.split(".").map(Number);
  if (major === 0 && (minor < 3 || (minor === 3 && patch < 6))) setRuntimeState("active");
  await importGitHubBundle(bundle);
}

void load().catch(error => {
  console.error("[Spotify+] Could not load the latest release:", error);
  Spicetify.showNotification?.("Spotify+ could not load. Check your connection and reload Spotify.", true);
});
