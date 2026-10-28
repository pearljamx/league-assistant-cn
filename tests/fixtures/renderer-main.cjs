// Isolated renderer harness. It never loads the real main process or LCU client.
const { app, BrowserWindow, session } = require("electron");
const path = require("node:path");
const root = path.resolve(__dirname, "../..");
app.setPath("userData", path.join(root, "artifacts/renderer-fixture-profile"));
app.whenReady().then(async () => {
  session.defaultSession.webRequest.onBeforeRequest((details, done) =>
    done({ cancel: /^https?:/.test(details.url) }),
  );
  const window = new BrowserWindow({
    show: false,
    width: 1380,
    height: 900,
    webPreferences: {
      preload: path.join(__dirname, "renderer-preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });
  await window.loadFile(path.join(root, "out/renderer/index.html"));
});
app.on("window-all-closed", () => app.quit());
