import type { RuneOption, StatsQuery } from "../shared/types";
import type { Client } from "./client";
import type { Storage } from "./storage";
import { AppError } from "./errors";
import type { TencentProvider } from "./providers/tencent";

export function managedPage(
  pages: any[],
  remembered: { id: number; puuid: string } | null,
  puuid: string,
) {
  if (!remembered || remembered.puuid !== puuid) return null;
  return (
    pages.find(
      (page) =>
        page.id === remembered.id &&
        page.isEditable &&
        page.name?.startsWith("联盟助手 · "),
    ) ?? null
  );
}
export function runePayload(option: RuneOption, championId: number) {
  if (
    option.perks.length !== 9 ||
    !option.primaryStyleId ||
    !option.subStyleId ||
    option.primaryStyleId === option.subStyleId
  )
    throw new AppError("符文方案不完整，未应用任何修改。", "INVALID_RUNES");
  return {
    name: `联盟助手 · ${championId}`,
    primaryStyleId: option.primaryStyleId,
    subStyleId: option.subStyleId,
    selectedPerkIds: option.perks,
    current: true,
  };
}
export class RuneService {
  private busy = false;
  constructor(
    private client: Client,
    private storage: Storage,
    private recommendations: TencentProvider,
  ) {}
  async apply(
    championId: number,
    query: StatsQuery,
    index: number,
    expectedPerks: number[],
  ) {
    if (this.busy) throw new AppError("正在应用符文，请稍候。", "RUNES_BUSY");
    this.busy = true;
    try {
      const puuid = this.client.state.summoner?.puuid;
      const phase = this.client.state.phase;
      const platform = this.client.state.platform;
      const sessionGeneration = this.client.sessionGeneration;
      if (
        !puuid ||
        this.client.state.status !== "connected" ||
        !["None", "Lobby", "ChampSelect"].includes(phase)
      )
        throw new AppError("请在大厅或选人阶段应用符文。", "INVALID_PHASE");
      const assertSession = () => {
        if (
          this.client.state.status !== "connected" ||
          this.client.state.summoner?.puuid !== puuid ||
          this.client.state.platform !== platform ||
          this.client.sessionGeneration !== sessionGeneration ||
          this.client.state.phase !== phase ||
          (phase === "ChampSelect" &&
            this.client.state.championId !== championId)
        )
          throw new AppError(
            "账号、英雄或阶段已变化，请重新确认方案。",
            "SESSION_CHANGED",
          );
      };
      const rec = await this.recommendations.recommendation(championId, query);
      const option = rec.runes[index];
      if (!option)
        throw new AppError("该方案已失效，请重新加载推荐。", "INVALID_RUNES");
      if (
        expectedPerks.length !== 9 ||
        option.perks.some((id, i) => id !== expectedPerks[i])
      )
        throw new AppError(
          "推荐数据已更新，请重新预览符文后再应用。",
          "RUNES_PREVIEW_CHANGED",
        );
      const body = runePayload(option, championId);
      const pages = await this.client.request<any[]>("/lol-perks/v1/pages");
      const managed = managedPage(
        pages,
        this.storage.getSettings().managedRunePage,
        puuid,
      );
      if (!managed) {
        const inventory = await this.client.request("/lol-perks/v1/inventory");
        if (
          typeof inventory.ownedPageCount !== "number" ||
          pages.filter((page) => page.isEditable).length >=
            inventory.ownedPageCount
        )
          throw new AppError(
            "没有可确认的空余符文槽位，请先在客户端留出一个空位；已有页面未修改。",
            "RUNE_SLOTS_FULL",
          );
      }
      assertSession();
      if (managed) await this.storage.put(`rune-backup:${puuid}`, managed);
      // Saving a backup is asynchronous too: recheck after it, immediately before writing.
      assertSession();
      const response = await this.client.request<any>(
        managed ? `/lol-perks/v1/pages/${managed.id}` : "/lol-perks/v1/pages",
        managed ? "PUT" : "POST",
        managed ? { ...body, id: managed.id } : body,
      );
      const pageId = Number(response?.id || managed?.id);
      assertSession();
      if (!pageId)
        throw new AppError(
          "客户端未返回页面编号，请在客户端检查应用结果。",
          "RUNE_WRITE_UNCONFIRMED",
        );
      await this.storage.rememberRunePage({ id: pageId, puuid });
      return { pageId };
    } finally {
      this.busy = false;
    }
  }
}
