import { describe, expect, it } from "vitest";
import {
  payload,
  itemRows,
  runeRows,
  skillRows,
  parseHex,
  rate,
} from "../src/main/providers/tencent";
import { availableBands, smoothedRate } from "../src/main/providers/aramhex";
import { runeStyles } from "../src/main/providers/catalog";
const styles = [
  { id: 8000, slots: [[8005], [9111], [9104], [8014]] },
  { id: 8100, slots: [[8128], [8139], [8140], [8135]] },
];
describe("统计来源与单位", () => {
  it("腾讯动态字段名称不硬编码，空统计不伪造", () => {
    expect(
      payload({
        code: 0,
        data: { _fieldValues: { R99999: '{"dtstatdate":"20261027"}' } },
      }),
    ).toEqual({ dtstatdate: "20261027" });
    expect(
      payload({ code: 0, data: { _fieldValues: { R10000: "" } } }),
    ).toEqual({});
    expect(() => payload({ code: 500 })).toThrow();
  });
  it("百分数、比例、基点分别转换，缺失仍为空", () => {
    expect(rate(53.43, 100)).toBeCloseTo(0.5343);
    expect(rate(4874, 10000)).toBeCloseTo(0.4874);
    expect(rate(0.5343)).toBeCloseTo(0.5343);
    expect(rate(null, 100)).toBeNull();
    expect(rate("")).toBeNull();
    expect(rate(120, 100)).toBeNull();
  });
  it("装备的选取率与胜率不颠倒", () => {
    expect(itemRows("1055,2003_1_62.23_49.93")[0]).toEqual({
      ids: [1055, 2003],
      pickRate: 0.6223,
      winRate: 0.4993,
      games: null,
    });
  });
  it("只接受完整、合法的符文树和不同副系槽位", () => {
    const perks = [8005, 9111, 9104, 8014, 8139, 8140, 5008, 5008, 5011];
    expect(runeStyles(perks, styles)).toEqual({
      primaryStyleId: 8000,
      subStyleId: 8100,
    });
    expect(runeStyles(perks.slice(0, 8), styles)).toBeNull();
    expect(
      runeStyles(
        [8005, 9111, 9104, 8014, 8139, 8139, 5008, 5008, 5011],
        styles,
      ),
    ).toBeNull();
    const row = runeRows(
      "1_8005_jj_" + perks.join(",") + "_10_51.5_2000",
      styles,
    )[0];
    expect(row.games).toBe(2000);
    expect(row.winRate).toBe(0.515);
  });
  it("加点优先级和逐级顺序分别解析", () => {
    const row = skillRows(
      "1,2,3:91.84:60.17@1,2,3,1,1,4_50.79_60.19@2,1,3,1,1,4_15.52_60.19",
    )[0];
    expect(row.priority).toEqual([1, 2, 3]);
    expect(row.order).toEqual([1, 2, 3, 1, 1, 4]);
    expect(row.winRate).toBe(0.6017);
  });
  it("海克斯装备不会用峡谷的百分数口径解析", () => {
    const rec = parseHex(202, {
      itemout: "1055,2003$0.65$0.5",
      itemcore_json:
        '{"1":{"itemcore":"6676&3031&3036","winrate":4874,"showrate":1725}}',
      dtstatdate: "20261027",
    });
    expect(rec.core[0].winRate).toBe(0.4874);
    expect(rec.starting[0].pickRate).toBe(0.65);
    expect(rec.runes).toEqual([]);
    expect(rec.source.mode).toBe("hex");
  });
  it("高分与顶尖兼容别名不变成两个独立水平组", () => {
    expect(
      availableBands({
        bands: {
          bands: {
            casual: { label: "娱乐" },
            high: { label: "前5%" },
            top: { alias_of: "high" },
          },
        },
      }),
    ).toEqual([
      { id: "all", name: "全部样本" },
      { id: "casual", name: "娱乐" },
      { id: "high", name: "前5%" },
    ]);
  });
  it("低样本极端胜率向英雄基准收缩", () => {
    expect(smoothedRate(1, 1, 0.5)).toBeLessThan(smoothedRate(600, 1000, 0.5));
    expect(smoothedRate(0, 0, 0.55)).toBe(0.55);
  });
});
