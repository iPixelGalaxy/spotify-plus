import { ensureDefaultSettings } from "./config";
import { runtime, setRuntimeState, shouldStandDown } from "./integration";

async function waitForSpicetify() {
  while (
    !Spicetify?.Platform?.History ||
    !Spicetify?.LocalStorage ||
    !Spicetify?.React ||
    !Spicetify?.ReactDOM
  ) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

async function main() {
  if (runtime.bundleStarted) return;
  runtime.bundleStarted = true;
  await waitForSpicetify();

  if (await shouldStandDown()) {
    setRuntimeState("standby");
    return;
  }

  ensureDefaultSettings();
  const [{ startToolsController }, { startFeatureControllers }] = await Promise.all([import("./tools"), import("./features")]);
  setRuntimeState("active");
  startToolsController();
  startFeatureControllers();

  console.info("[spotify-plus] initialized");
}

main().catch(error => console.error("[spotify-plus] Could not start:", error));
