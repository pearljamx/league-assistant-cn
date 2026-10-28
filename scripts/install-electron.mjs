import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
if (existsSync(resolve("node_modules/electron/install.js"))) {
  const { configureDevelopmentProxy } = await import("./network.mjs");
  configureDevelopmentProxy();
  await import(pathToFileURL(resolve("node_modules/electron/install.js")).href);
}
