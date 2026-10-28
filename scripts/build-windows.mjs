import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { configureDevelopmentProxy } from "./network.mjs";
configureDevelopmentProxy();
const child = spawn(
  process.execPath,
  [
    resolve("node_modules/electron-builder/cli.js"),
    "--win",
    "nsis",
    "portable",
    "--x64",
    "--publish",
    "never",
  ],
  {
    stdio: "inherit",
    windowsHide: true,
    env: process.env,
  },
);
child.on("error", (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
