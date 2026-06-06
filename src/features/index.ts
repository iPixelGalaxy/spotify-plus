import "../styles.css";
import { startExperimentalFeaturesController } from "./experimentalFeatures";
import { startCopyMenuController } from "./copyMenu";
import { startDevicePickerController } from "./devicePicker";
import { startLocalFilesController } from "./localFiles";
import { startLocalFilesPlaybackFixController } from "./localFilesPlaybackFix";
import { startPlayerControlsController } from "./playerControls";
import { startPlaylistMenuController } from "./playlistMenu";
import { startProfileMenuController } from "./profileMenu";
import { startUpdatePromptController } from "./updatePrompt";
import { startWindowTitleController } from "./windowTitle";

export function startFeatureControllers() {
  startCopyMenuController();
  startDevicePickerController();
  startExperimentalFeaturesController();
  startLocalFilesController();
  startLocalFilesPlaybackFixController();
  startPlayerControlsController();
  startProfileMenuController();
  startPlaylistMenuController();
  startWindowTitleController();
  void startUpdatePromptController();
}
