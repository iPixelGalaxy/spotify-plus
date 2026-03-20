import { defineConfig } from "@spicemod/creator";

export default defineConfig({
  name: "spotify-plus",
  version: "0.1.0",
  framework: "react",
  linter: "oxlint",
  template: "extension",
  packageManager: "npm",
  cssId: "spotify-plus",
  esbuildOptions: {
    legalComments: "none",
  },
});
