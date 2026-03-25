import "../styles.css";
import { startExperimentalFeaturesController } from "./experimentalFeatures";
import { startCopyMenuController } from "./copyMenu";
import { startDevicePickerController } from "./devicePicker";
import { startPlayerControlsController } from "./playerControls";
import { startPlaylistMenuController } from "./playlistMenu";
import { startProfileMenuController } from "./profileMenu";
import { startUpdatePromptController } from "./updatePrompt";

export function startFeatureControllers() {
  startCopyMenuController();
  startDevicePickerController();
  startExperimentalFeaturesController();
  startPlayerControlsController();
  startProfileMenuController();
  startPlaylistMenuController();
  void startUpdatePromptController();
}
