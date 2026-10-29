import type { WindowBounds } from "./companions";

// 只读查询英雄联盟客户端主窗口的屏幕位置，用于把小窗贴在旁边；不读取内存、不注入、不改动窗口。
let native: {
  find: (className: string, title: string | null) => unknown;
  rect: (window: unknown, rect: Buffer) => number;
  visible: (window: unknown) => number;
  iconic: (window: unknown) => number;
  address: (pointer: unknown) => bigint | number;
} | null = null;

async function load() {
  if (native) return native;
  const { default: koffi } = await import("koffi");
  const user = koffi.load("user32.dll");
  native = {
    find: user.func(
      "void * __stdcall FindWindowW(str16 className, str16 windowName)",
    ),
    rect: user.func("int __stdcall GetWindowRect(void * window, void * rect)"),
    visible: user.func("int __stdcall IsWindowVisible(void * window)"),
    iconic: user.func("int __stdcall IsIconic(void * window)"),
    address: koffi.address,
  };
  return native;
}

/** 返回客户端窗口的物理像素矩形；找不到、最小化或不可见时返回 null。 */
export async function clientWindowRect(): Promise<WindowBounds | null> {
  if (process.platform !== "win32") return null;
  try {
    const api = await load();
    const window = api.find("RCLIENT", null);
    if (!window || Number(api.address(window)) === 0) return null;
    if (!api.visible(window) || api.iconic(window)) return null;
    const rect = Buffer.alloc(16);
    if (!api.rect(window, rect)) return null;
    const left = rect.readInt32LE(0),
      top = rect.readInt32LE(4),
      right = rect.readInt32LE(8),
      bottom = rect.readInt32LE(12);
    if (right - left < 200 || bottom - top < 150) return null;
    return { x: left, y: top, width: right - left, height: bottom - top };
  } catch {
    return null;
  }
}
