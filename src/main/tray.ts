import { Menu, Tray, nativeImage } from "electron";
import type { Settings } from "../shared/types";

export interface TrayActions {
  show(): void;
  toggleAutoAccept(): void;
  toggleCompanions(): void;
  quit(): void;
}

/** 托盘菜单只提供显示、两个已有开关和退出，不新增任何客户端写操作。 */
export function trayMenu(settings: Settings, actions: TrayActions) {
  return Menu.buildFromTemplate([
    { label: "显示主窗口", click: actions.show },
    { type: "separator" },
    {
      label: "自动接受对局",
      type: "checkbox",
      checked: settings.autoAccept,
      click: actions.toggleAutoAccept,
    },
    {
      label: "客户端小窗",
      type: "checkbox",
      checked: settings.companionWindows !== false,
      click: actions.toggleCompanions,
    },
    { type: "separator" },
    { label: "退出英雄联盟助手", click: actions.quit },
  ]);
}

export function createTray(
  iconPath: string,
  settings: Settings,
  actions: TrayActions,
) {
  const icon = nativeImage
    .createFromPath(iconPath)
    .resize({ width: 16, height: 16 });
  const tray = new Tray(icon);
  tray.setToolTip("英雄联盟助手");
  tray.setContextMenu(trayMenu(settings, actions));
  tray.on("click", actions.show);
  return {
    update(next: Settings) {
      if (!tray.isDestroyed()) tray.setContextMenu(trayMenu(next, actions));
    },
    destroy() {
      if (!tray.isDestroyed()) tray.destroy();
    },
  };
}
