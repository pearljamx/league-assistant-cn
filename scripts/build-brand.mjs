// 由用户提供的原画 resources/brand/pearljam-art.jpg 生成品牌素材：
// 程序图标 icon.png（512）/ icon.ico（16–256）、界面标志 brand-mark.png 与压缩后的原画 brand-art.jpg。
// 用法：node_modules\electron\dist\electron.exe scripts/build-brand.mjs
import { app, BrowserWindow } from "electron";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const art = await readFile(resolve(root, "resources/brand/pearljam-art.jpg"));
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

/**
 * 在页面内用 canvas 绘制：六边形裁出原画中的猫脸，外圈紫粉渐变描边 + 金色内线。
 * 小尺寸单独绘制（裁得更近、描边更粗），保证 16px 也能认出猫脸。
 */
const draw = String.raw`
async function brand(src) {
  const image = new Image();
  image.src = src;
  await image.decode();
  const hex = (ctx, c, r) => {
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = Math.PI / 6 + (i * Math.PI) / 3;
      const x = c + r * Math.cos(a), y = c + r * Math.sin(a);
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.closePath();
  };
  const icon = (size) => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext("2d");
    const small = size <= 48;
    const c = size / 2, r = size * 0.485;
    const rim = size * (small ? 0.09 : 0.055);
    ctx.lineJoin = "round";
    // 猫脸裁切区域（原画 1254×1254 坐标）。
    const crop = small ? [500, 400, 420] : [450, 300, 560];
    ctx.save();
    hex(ctx, c, r - rim / 2);
    ctx.clip();
    ctx.fillStyle = "#2a1838";
    ctx.fillRect(0, 0, size, size);
    ctx.drawImage(image, crop[0], crop[1], crop[2], crop[2], 0, 0, size, size);
    // 紫色暗角，呼应原画的漫画背景。
    const vignette = ctx.createRadialGradient(c, c * 0.95, r * 0.45, c, c, r);
    vignette.addColorStop(0, "#00000000");
    vignette.addColorStop(1, "#3b1a5acc");
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, size, size);
    ctx.restore();
    const outer = ctx.createLinearGradient(0, 0, size, size);
    outer.addColorStop(0, "#f07ab8");
    outer.addColorStop(0.5, "#9a55e0");
    outer.addColorStop(1, "#5b2b9a");
    hex(ctx, c, r - rim / 2);
    ctx.strokeStyle = outer;
    ctx.lineWidth = rim;
    ctx.stroke();
    if (size >= 32) {
      hex(ctx, c, r - rim * 1.05);
      ctx.strokeStyle = "#f2c766";
      ctx.lineWidth = Math.max(1, size * 0.012);
      ctx.stroke();
    }
    return canvas.toDataURL("image/png");
  };
  const scaled = (width, quality) => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = width;
    canvas.getContext("2d").drawImage(image, 0, 0, width, width);
    return canvas.toDataURL("image/jpeg", quality);
  };
  const sizes = ${JSON.stringify([...new Set([...icoSizes, 512, 1024])])};
  return {
    icons: Object.fromEntries(sizes.map((size) => [size, icon(size)])),
    art: scaled(960, 0.86),
  };
}`;

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const window = new BrowserWindow({
    show: false,
    webPreferences: { offscreen: true },
  });
  await window.loadURL(
    "data:text/html;charset=utf-8,<!doctype html><body></body>",
  );
  const result = await window.webContents.executeJavaScript(
    `${draw}; brand(${JSON.stringify("data:image/jpeg;base64," + art.toString("base64"))})`,
  );
  const decode = (url) =>
    Buffer.from(url.slice(url.indexOf(",") + 1), "base64");
  const assets = resolve(root, "src/renderer/src/assets");
  await mkdir(assets, { recursive: true });
  await writeFile(
    resolve(root, "resources/icon.png"),
    decode(result.icons[512]),
  );
  await writeFile(
    resolve(root, "resources/brand/pearljam-hex-1024.png"),
    decode(result.icons[1024]),
  );
  await writeFile(
    resolve(root, "resources/icon.ico"),
    ico(icoSizes.map((size) => ({ size, png: decode(result.icons[size]) }))),
  );
  await writeFile(resolve(assets, "brand-mark.png"), decode(result.icons[256]));
  await writeFile(
    resolve(assets, "brand-mark-small.png"),
    decode(result.icons[48]),
  );
  await writeFile(resolve(assets, "brand-art.jpg"), decode(result.art));
  console.log("brand assets written");
  app.quit();
});
