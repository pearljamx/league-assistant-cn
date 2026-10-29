import { safeStorage } from "electron";
import { readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { AppError } from "./errors";

// 第三方数据 API Key 只在主进程使用：用 Windows 加密存储（DPAPI）落盘，
// 不进入 settings.json、不发给界面、不写日志。
export class SecretStore {
  private value: string | null = null;
  private loaded = false;
  constructor(
    private directory: string,
    private name = "aramgg-key.bin",
  ) {}
  private get file() {
    return join(this.directory, this.name);
  }
  async get() {
    if (this.loaded) return this.value;
    this.loaded = true;
    try {
      const data = await readFile(this.file);
      this.value = safeStorage.decryptString(data);
    } catch {
      this.value = null;
    }
    return this.value;
  }
  async set(value: string | null) {
    if (value === null) {
      this.value = null;
      this.loaded = true;
      await rm(this.file, { force: true });
      return;
    }
    if (!safeStorage.isEncryptionAvailable())
      throw new AppError(
        "系统加密存储不可用，无法安全保存 API Key。",
        "SECRET_UNAVAILABLE",
      );
    const data = safeStorage.encryptString(value);
    await writeFile(this.file + ".tmp", data);
    await rename(this.file + ".tmp", this.file);
    this.value = value;
    this.loaded = true;
  }
  /** 只给界面展示末 4 位，用于确认已配置的是哪一个 Key。 */
  async masked() {
    const value = await this.get();
    return value ? `••••${value.slice(-4)}` : null;
  }
}
