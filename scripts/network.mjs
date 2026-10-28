import { execFileSync } from "node:child_process";
import { EnvHttpProxyAgent, setGlobalDispatcher } from "undici";

export function configureDevelopmentProxy() {
  if (
    process.platform === "win32" &&
    !process.env.HTTPS_PROXY &&
    !process.env.https_proxy
  ) {
    try {
      const key =
        "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings";
      const enabled = execFileSync(
        "reg.exe",
        ["query", key, "/v", "ProxyEnable"],
        {
          windowsHide: true,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
        },
      );
      const server = execFileSync(
        "reg.exe",
        ["query", key, "/v", "ProxyServer"],
        {
          windowsHide: true,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
        },
      );
      const local = server.match(/127\.0\.0\.1:\d+/)?.[0];
      if (/0x1\s*$/m.test(enabled) && local)
        process.env.HTTPS_PROXY = "http://" + local;
    } catch {
      /* No active local system proxy. Existing environment variables still apply. */
    }
  }
  setGlobalDispatcher(new EnvHttpProxyAgent());
  process.env.ELECTRON_GET_USE_PROXY = "1";
}
