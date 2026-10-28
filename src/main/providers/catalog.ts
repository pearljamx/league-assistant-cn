import type { Catalog, Champion } from "../../shared/types";
import { jsonRequest } from "../http";
import type { Storage } from "../storage";
import { CachedProvider } from "./cache";

export interface RuneStyle {
  id: number;
  slots: number[][];
}
export class CatalogProvider extends CachedProvider {
  styles: RuneStyle[] = [];
  private value: Catalog | null = null;
  constructor(storage: Storage) {
    super(storage);
  }
  async get(): Promise<Catalog> {
    if (this.value) return this.value;
    const { data } = await this.cached<{
      catalog: Catalog;
      styles: RuneStyle[];
    }>("catalog-v4", 6 * 3600000, async () => {
      const [heroList, versions] = await Promise.all([
        jsonRequest(
          "https://game.gtimg.cn/images/lol/act/img/js/heroList/hero_list.js",
        ),
        jsonRequest<string[]>(
          "https://ddragon.leagueoflegends.com/api/versions.json",
        ),
      ]);
      const version = versions[0];
      const [items, trees, tencentItems, tencentRunes] = await Promise.all([
        jsonRequest(
          `https://ddragon.leagueoflegends.com/cdn/${version}/data/zh_CN/item.json`,
        ),
        jsonRequest<any[]>(
          `https://ddragon.leagueoflegends.com/cdn/${version}/data/zh_CN/runesReforged.json`,
        ),
        jsonRequest(
          "https://game.gtimg.cn/images/lol/act/img/js/items/items.js",
        ).catch(() => ({ items: [] })),
        jsonRequest(
          "https://game.gtimg.cn/images/lol/act/img/js/runeList/rune_list2.js",
        ).catch(() => ({ rune: {} })),
      ]);
      const champions: Champion[] = (heroList.hero ?? [])
        .filter(
          (hero: any) => Number(hero.heroId) > 0 && Number(hero.heroId) < 60000,
        )
        .map((hero: any) => ({
          id: Number(hero.heroId),
          name: String(hero.title || hero.name),
          title: String(hero.name || ""),
          alias: String(hero.alias),
          icon: `https://game.gtimg.cn/images/lol/act/img/champion/${hero.alias}.png`,
        }));
      const itemMap: Catalog["items"] = {},
        perks: Catalog["perks"] = {};
      for (const [id, raw] of Object.entries(items.data ?? {}) as [
        string,
        any,
      ][])
        itemMap[id] = {
          name: raw.name,
          icon: `https://ddragon.leagueoflegends.com/cdn/${version}/img/item/${raw.image.full}`,
        };
      for (const item of tencentItems.items ?? [])
        if (
          Number(item.itemId) > 0 &&
          item.name &&
          /^https:\/\/game\.gtimg\.cn\//.test(item.iconPath)
        )
          itemMap[String(item.itemId)] = {
            name: item.name,
            icon: item.iconPath,
          };
      const styles: RuneStyle[] = [];
      for (const tree of trees) {
        styles.push({
          id: tree.id,
          slots: tree.slots.map((slot: any) =>
            slot.runes.map((rune: any) => rune.id),
          ),
        });
        perks[String(tree.id)] = {
          name: tree.name,
          icon: "https://ddragon.leagueoflegends.com/cdn/img/" + tree.icon,
        };
        for (const slot of tree.slots)
          for (const rune of slot.runes)
            perks[String(rune.id)] = {
              name: rune.name,
              icon: "https://ddragon.leagueoflegends.com/cdn/img/" + rune.icon,
            };
      }
      for (const [id, name] of Object.entries({
        5001: "生命值",
        5002: "护甲",
        5003: "魔法抗性",
        5005: "攻击速度",
        5007: "技能急速",
        5008: "适应之力",
        5010: "移动速度",
        5011: "生命值",
        5013: "韧性与减速抗性",
      }))
        perks[id] = { name, icon: "" };
      function domesticPerks(entries: any) {
        for (const [id, rune] of Object.entries(entries ?? {}) as [
          string,
          any,
        ][]) {
          if (rune.name && /^https:\/\/game\.gtimg\.cn\//.test(rune.icon))
            perks[id] = { name: rune.name, icon: rune.icon };
          if (rune.childs && typeof rune.childs === "object")
            domesticPerks(rune.childs);
        }
      }
      domesticPerks(tencentRunes.rune);
      return { catalog: { champions, items: itemMap, perks, version }, styles };
    });
    this.styles = data.styles;
    this.value = data.catalog;
    return data.catalog;
  }
}
export function runeStyles(
  perks: number[],
  styles: RuneStyle[],
): { primaryStyleId: number; subStyleId: number } | null {
  if (perks.length !== 9 || new Set(perks.slice(0, 6)).size !== 6) return null;
  const primary = styles.find(
    (style) =>
      style.slots.length === 4 &&
      style.slots.every((slot, index) => slot.includes(perks[index])),
  );
  const secondary = styles.find(
    (style) =>
      style.id !== primary?.id &&
      perks
        .slice(4, 6)
        .every((id) =>
          style.slots.slice(1).some((slot) => slot.includes(id)),
        ) &&
      !style.slots
        .slice(1)
        .some((slot) => slot.includes(perks[4]) && slot.includes(perks[5])),
  );
  if (
    !primary ||
    !secondary ||
    perks
      .slice(6)
      .some(
        (id) =>
          ![5001, 5002, 5003, 5005, 5007, 5008, 5010, 5011, 5013].includes(id),
      )
  )
    return null;
  return { primaryStyleId: primary.id, subStyleId: secondary.id };
}
