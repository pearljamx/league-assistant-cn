import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { AppError } from "./errors";

export interface Credentials {
  port: number;
  token: string;
  pid: number;
}
export function parseCommandLine(
  line: string,
): Pick<Credentials, "port" | "token"> | null {
  const args = Array.from(
    line.matchAll(/"([^"]*)"|(\S+)/g),
    (match) => match[1] ?? match[2],
  );
  const port = args
    .find((arg) => arg.startsWith("--app-port="))
    ?.slice("--app-port=".length);
  const token = args
    .find((arg) => arg.startsWith("--remoting-auth-token="))
    ?.slice("--remoting-auth-token=".length);
  const number = Number(port);
  return token && Number.isInteger(number) && number > 0 && number <= 65535
    ? { port: number, token }
    : null;
}
export function parseLockfile(
  text: string,
): Pick<Credentials, "port" | "token"> | null {
  const [name, , port, token, protocol] = text.trim().split(":");
  return name === "LeagueClient" &&
    protocol === "https" &&
    token &&
    Number.isInteger(Number(port)) &&
    Number(port) > 0 &&
    Number(port) <= 65535
    ? { port: Number(port), token }
    : null;
}

// This queries client process metadata with limited rights. No process-memory read is requested.
export async function discover(): Promise<Credentials | null> {
  if (process.platform !== "win32" || process.arch !== "x64")
    throw new AppError(
      "客户端连接目前支持 Windows x64。",
      "UNSUPPORTED_PLATFORM",
    );
  const { default: koffi } = await import("koffi");
  const kernel = koffi.load("kernel32.dll"),
    nt = koffi.load("ntdll.dll");
  const snapshot = kernel.func(
    "void * __stdcall CreateToolhelp32Snapshot(uint32_t flags, uint32_t pid)",
  );
  const first = kernel.func(
    "int __stdcall Process32FirstW(void * snapshot, void * entry)",
  );
  const next = kernel.func(
    "int __stdcall Process32NextW(void * snapshot, void * entry)",
  );
  const open = kernel.func(
    "void * __stdcall OpenProcess(uint32_t access, int inherit, uint32_t pid)",
  );
  const close = kernel.func("int __stdcall CloseHandle(void * handle)");
  const image = kernel.func(
    "int __stdcall QueryFullProcessImageNameW(void * process, uint32_t flags, void * name, _Inout_ uint32_t * size)",
  );
  const query = nt.func(
    "int32_t __stdcall NtQueryInformationProcess(void * process, uint32_t infoClass, void * info, uint32_t length, _Out_ uint32_t * returnLength)",
  );
  const handle = snapshot(2, 0);
  if (!handle || koffi.address(handle) === 0xffffffffffffffffn) return null;
  const entry = Buffer.alloc(568);
  entry.writeUInt32LE(568);
  const processes: { pid: number; name: string }[] = [];
  try {
    let more = first(handle, entry);
    while (more) {
      const name = entry.subarray(44, 564).toString("utf16le").split("\0")[0];
      if (/^LeagueClient(Ux)?\.exe$/i.test(name))
        processes.push({ pid: entry.readUInt32LE(8), name });
      more = next(handle, entry);
    }
  } finally {
    close(handle);
  }
  processes.sort(
    (a, b) => Number(/Ux/i.test(b.name)) - Number(/Ux/i.test(a.name)),
  );
  let denied = false;
  for (const proc of processes) {
    const processHandle = open(0x1000, 0, proc.pid);
    if (!processHandle) {
      denied = true;
      continue;
    }
    try {
      const needed = [0];
      query(processHandle, 60, null, 0, needed);
      if (needed[0] > 0 && needed[0] < 256 * 1024) {
        const buffer = Buffer.alloc(needed[0]);
        const status = query(processHandle, 60, buffer, buffer.length, needed);
        if (status >= 0) {
          const length = buffer.readUInt16LE(0);
          // The returned UNICODE_STRING points into this allocation, after its 16-byte header.
          // Copying the inline UTF-16 data avoids dereferencing any remote address.
          if (length > 0 && length <= buffer.length - 16) {
            const credentials = parseCommandLine(
              buffer.subarray(16, 16 + length).toString("utf16le"),
            );
            if (credentials) return { ...credentials, pid: proc.pid };
          }
        } else denied = true;
      }
      const buffer = Buffer.alloc(65536),
        length = [32768];
      if (image(processHandle, 0, buffer, length)) {
        const path = buffer.subarray(0, length[0] * 2).toString("utf16le");
        try {
          const credentials = parseLockfile(
            await readFile(join(dirname(path), "lockfile"), "utf8"),
          );
          if (credentials) return { ...credentials, pid: proc.pid };
        } catch {
          /* A Tencent lockfile may be absent or empty. */
        }
      }
    } finally {
      close(processHandle);
    }
  }
  if (processes.length && denied)
    throw new AppError(
      "检测到客户端，但无法读取连接信息。请尝试以与客户端相同的权限运行助手。",
      "CLIENT_PERMISSION",
    );
  return null;
}
