import { ensureDefaultSettings } from "./config";
import { startFeatureControllers } from "./features";
import { startToolsController } from "./tools";

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
  await waitForSpicetify();

  ensureDefaultSettings();
  startToolsController();
  startFeatureControllers();

  console.info("[spotify-plus] initialized");
}

main();
