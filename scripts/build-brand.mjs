// 由 resources/brand/pearljam-hex.svg 生成程序图标：icon.png（512）与多尺寸 icon.ico。
// 用法：node_modules\electron\dist\electron.exe scripts/build-brand.mjs
import { app, BrowserWindow } from "electron";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const svg = await readFile(
  resolve(root, "resources/brand/pearljam-hex.svg"),
  "utf8",
);
const render = 1024;
const icoSizes = [16, 24, 32, 48, 64, 128, 256];

/** ICO 容器：每个尺寸直接内嵌 PNG（Windows Vista 起支持）。 */
function ico(images) {
  const header = Buffer.alloc(6 + 16 * images.length);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach(({ size, png }, index) => {
    const entry = 6 + index * 16;
    header.writeUInt8(size >= 256 ? 0 : size, entry);
    header.writeUInt8(size >= 256 ? 0 : size, entry + 1);
    header.writeUInt8(0, entry + 2);
    header.writeUInt8(0, entry + 3);
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(png.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += png.length;
  });
  return Buffer.concat([header, ...images.map((item) => item.png)]);
}

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  // 离屏渲染：不显示窗口，直接取得带透明通道的帧。
  const window = new BrowserWindow({
    width: render,
    height: render,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    webPreferences: { offscreen: true },
  });
  const page = `<!doctype html><html><head><style>html,body{margin:0;overflow:hidden;background:transparent}svg{display:block}</style></head><body>${svg.replace(
    'width="256" height="256"',
    `width="${render}" height="${render}"`,
  )}</body></html>`;
  let shot = null;
  window.webContents.on("paint", (_event, _dirty, image) => {
    if (!image.isEmpty()) shot = image;
  });
  window.webContents.setFrameRate(10);
  await window.loadURL(
    "data:text/html;charset=utf-8," + encodeURIComponent(page),
  );
  for (let i = 0; i < 30 && !shot; i++)
    await new Promise((done) => setTimeout(done, 100));
  await new Promise((done) => setTimeout(done, 300));
  if (!shot) throw new Error("no frame rendered");
  const base = shot.resize({ width: render, height: render, quality: "best" });
  const png = (size) =>
    base.resize({ width: size, height: size, quality: "best" }).toPNG();
  await writeFile(resolve(root, "resources/icon.png"), png(512));
  await writeFile(
    resolve(root, "resources/brand/pearljam-hex-1024.png"),
    base.toPNG(),
  );
  await writeFile(
    resolve(root, "resources/icon.ico"),
    ico(icoSizes.map((size) => ({ size, png: png(size) }))),
  );
  console.log(
    "brand icons written:",
    ["icon.png", "icon.ico", "brand/pearljam-hex-1024.png"].join(", "),
  );
  app.quit();
});
