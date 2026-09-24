import { readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const webDir = resolve(fileURLToPath(new URL("../artifacts/watchtime/", import.meta.url)));
const manifest = JSON.parse(readFileSync(resolve(webDir, "package.json"), "utf8"));
const requireFromWeb = createRequire(resolve(webDir, "package.json"));

for (const dependency of ["vitest", "jsdom"]) {
  if (!manifest.devDependencies?.[dependency] && !manifest.dependencies?.[dependency]) {
    throw new Error(`@workspace/watchtime must declare ${dependency} directly`);
  }

  try {
    // Check the artifact's own install, not a package inherited from the workspace root.
    statSync(resolve(webDir, "node_modules", dependency, "package.json"));
    requireFromWeb.resolve(`${dependency}/package.json`);
  } catch {
    throw new Error(`@workspace/watchtime must resolve its own ${dependency} installation`);
  }
}