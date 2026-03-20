import { startExperimentalFeaturesController } from "./experimentalFeatures";
import { startCopyMenuController } from "./copyMenu";
import { startPlayerControlsController } from "./playerControls";
import { startPlaylistMenuController } from "./playlistMenu";
import { startProfileMenuController } from "./profileMenu";

export function startFeatureControllers() {
  startCopyMenuController();
  startExperimentalFeaturesController();
  startPlayerControlsController();
  startProfileMenuController();
  startPlaylistMenuController();
}
