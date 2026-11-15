import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";

const require = createRequire(import.meta.url);
const creator = require.resolve("@spicemod/creator/bin");
const result = spawnSync(process.execPath, [creator, "build", "--no-copy"], { stdio: "inherit", windowsHide: true });
if (result.status !== 0) process.exit(result.status ?? 1);
copyFileSync("dist/spotify-plus.js", "dist/spotify-plus-runtime.js");
const esbuild = require(require.resolve("esbuild", { paths: [dirname(creator)] }));
await esbuild.build({ entryPoints: ["src/loader.ts"], bundle: true, format: "iife", target: "es2022", minify: true, outfile: "dist/spotify-plus.js", legalComments: "none" });
if (!process.env.CI) {
  const destination = spawnSync("spicetify", ["path", "-e", "root"], { encoding: "utf8", windowsHide: true });
  if (destination.status === 0 && destination.stdout.trim()) {
    const extensionRoot = resolve(destination.stdout.trim());
    mkdirSync(extensionRoot, { recursive: true });
    copyFileSync("dist/spotify-plus.js", join(extensionRoot, "spotify-plus.js"));
  }
}
console.log("Built spotify-plus.js launcher and spotify-plus-runtime.js release bundle.");
