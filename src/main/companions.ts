import type { CompanionState, ConnectionState } from "../shared/types";

/** picker 为常驻 Mini 小窗，info 为仅在英雄选择阶段出现的英雄信息窗。 */
export type CompanionRole = "picker" | "info";
export interface WindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}
export type CompanionSizes = Record<
  CompanionRole,
  { width: number; height: number }
>;
export const companionSizes: CompanionSizes = {
  picker: { width: 340, height: 420 },
  info: { width: 360, height: 600 },
};
/** 用户拖动边缘调整大小时的下限与上限（DIP）。 */
export const companionLimits = {
  picker: { minWidth: 300, minHeight: 340 },
  info: { minWidth: 320, minHeight: 420 },
  maxWidth: 1200,
  maxHeight: 1400,
};
const hiddenPhases = [
  "GameStart",
  "InProgress",
  "Reconnect",
  "WaitingForStats",
];

/** All coordinates here are Electron device-independent pixels, including negative monitors. */
export function companionBounds(
  area: WindowBounds,
  sizes: CompanionSizes = companionSizes,
): Record<CompanionRole, WindowBounds> {
  const margin = Math.min(
    16,
    Math.floor(area.width / 8),
    Math.floor(area.height / 8),
  );
  const size = (role: CompanionRole) => ({
    width: Math.min(sizes[role].width, area.width - margin * 2),
    height: Math.min(sizes[role].height, area.height - margin * 2),
  });
  const info = size("info"),
    picker = size("picker");
  const infoX = area.x + area.width - info.width - margin;
  return {
    picker: {
      x: Math.max(area.x + margin, infoX - picker.width - 12),
      y: area.y + margin,
      ...picker,
    },
    info: { x: infoX, y: area.y + margin, ...info },
  };
}

/**
 * 参考 Akari 的贴靠方式：两个小窗始终放在客户端同一侧（优先右侧）。
 * 并排放得下就并排；只够一个窗宽时上下叠放（Mini 在上、英雄推荐在下）；
 * 都放不下时退回工作区右上角。结果始终限制在工作区内。
 */
export function alignToClient(
  client: WindowBounds,
  area: WindowBounds,
  sizes: CompanionSizes = companionSizes,
): Record<CompanionRole, WindowBounds> {
  const gap = 8;
  const fallback = companionBounds(area, sizes);
  const picker = fallback.picker,
    info = fallback.info;
  const clamp = (bounds: WindowBounds): WindowBounds => ({
    ...bounds,
    x: Math.min(Math.max(bounds.x, area.x), area.x + area.width - bounds.width),
    y: Math.min(
      Math.max(bounds.y, area.y),
      area.y + area.height - bounds.height,
    ),
  });
  const rightStart = client.x + client.width + gap;
  const rightSpace = area.x + area.width - rightStart;
  const leftSpace = client.x - gap - area.x;
  const y = client.y;
  const row = picker.width + gap + info.width;
  const column = Math.max(picker.width, info.width);
  const stackedHeight = picker.height + gap + info.height;
  const stack = (x: number, alignRight: boolean) => {
    // 叠放时整体上移以完整显示两个窗。
    const top = Math.max(
      area.y,
      Math.min(y, area.y + area.height - stackedHeight),
    );
    const left = (width: number) => (alignRight ? x + column - width : x);
    return {
      picker: clamp({ ...picker, x: left(picker.width), y: top }),
      info: clamp({
        ...info,
        x: left(info.width),
        y: top + picker.height + gap,
      }),
    };
  };
  if (rightSpace >= row)
    return {
      picker: clamp({ ...picker, x: rightStart, y }),
      info: clamp({ ...info, x: rightStart + picker.width + gap, y }),
    };
  if (leftSpace >= row) {
    const x = client.x - gap - row;
    return {
      picker: clamp({ ...picker, x, y }),
      info: clamp({ ...info, x: x + picker.width + gap, y }),
    };
  }
  if (stackedHeight <= area.height) {
    if (rightSpace >= column) return stack(rightStart, false);
    if (leftSpace >= column) return stack(client.x - gap - column, true);
  }
  return fallback;
}

/** Pure session state: dismissals last until the next client phase/account, not each poll. */
export class CompanionController {
  state: CompanionState = { championId: null, followingClient: true };
  private context = "";
  private lastChampion: number | null = null;
  private clientChampion: number | null = null;
  private eligible = false;
  private phase = "None";
  private dismissed = new Set<CompanionRole>();
  update(client: ConnectionState) {
    const context = `${client.status}:${client.region}:${client.summoner?.puuid}:${client.phase}`;
    if (context !== this.context) {
      this.context = context;
      this.dismissed.clear();
      this.state.followingClient = true;
    }
    const champion = client.status === "connected" ? client.championId : null;
    if (champion !== this.lastChampion) this.state.followingClient = true;
    this.lastChampion = this.clientChampion = champion;
    if (this.state.followingClient) this.state.championId = champion;
    this.phase = client.phase;
    // 客户端一连接（包括刚打开、尚未进房间）就显示 Mini 窗；进入游戏后收起。
    this.eligible =
      client.status === "connected" &&
      client.region === "TENCENT" &&
      !hiddenPhases.includes(client.phase);
    return this.snapshot();
  }
  select(championId: number | null) {
    this.state = {
      championId: championId ?? this.clientChampion,
      followingClient: championId === null,
    };
    return this.snapshot();
  }
  snapshot(): CompanionState {
    return { ...this.state };
  }
  visible(role: CompanionRole, enabled: boolean) {
    return (
      this.eligible &&
      enabled &&
      !this.dismissed.has(role) &&
      (role === "picker" || this.phase === "ChampSelect")
    );
  }
  dismiss(role: CompanionRole) {
    this.dismissed.add(role);
  }
  reopen() {
    this.dismissed.clear();
  }
}
