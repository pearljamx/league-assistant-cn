import type { CompanionState, ConnectionState } from "../shared/types";

export type CompanionRole = "picker" | "info";
export interface WindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** All coordinates here are Electron device-independent pixels, including negative monitors. */
export function companionBounds(
  area: WindowBounds,
): Record<CompanionRole, WindowBounds> {
  const margin = Math.min(
    16,
    Math.floor(area.width / 8),
    Math.floor(area.height / 8),
  );
  const infoWidth = Math.min(400, area.width - margin * 2);
  const pickerWidth = Math.min(344, area.width - margin * 2);
  const infoHeight = Math.min(620, area.height - margin * 2);
  const pickerHeight = Math.min(560, area.height - margin * 2);
  const infoX = area.x + area.width - infoWidth - margin;
  return {
    picker: {
      x: Math.max(area.x + margin, infoX - pickerWidth - 12),
      y: area.y + margin,
      width: pickerWidth,
      height: pickerHeight,
    },
    info: {
      x: infoX,
      y: area.y + margin,
      width: infoWidth,
      height: infoHeight,
    },
  };
}

/** Pure session state: dismissals last until the next client phase/account, not each poll. */
export class CompanionController {
  state: CompanionState = { championId: null, followingClient: true };
  private context = "";
  private lastChampion: number | null = null;
  private clientChampion: number | null = null;
  private eligible = false;
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
    this.eligible =
      client.status === "connected" &&
      client.region === "TENCENT" &&
      !["GameStart", "InProgress", "Reconnect"].includes(client.phase);
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
    return this.eligible && enabled && !this.dismissed.has(role);
  }
  dismiss(role: CompanionRole) {
    this.dismissed.add(role);
  }
  reopen() {
    this.dismissed.clear();
  }
}
