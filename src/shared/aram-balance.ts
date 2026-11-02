/** 大乱斗平衡调整的显示：倍率转为百分比，标出对该英雄是增强还是削弱。 */
export interface BalanceChip {
  key: string;
  text: string;
  /** true 增强，false 削弱。 */
  buff: boolean;
}
const labels: Record<string, { name: string; lowerIsBuff?: boolean }> = {
  dmg_dealt: { name: "伤害" },
  dmg_taken: { name: "承伤", lowerIsBuff: true },
  healing: { name: "治疗" },
  shielding: { name: "护盾" },
  tenacity: { name: "韧性" },
  energyregen_mod: { name: "回能" },
  total_as: { name: "攻速" },
  ms_mod: { name: "移速" },
  ability_haste: { name: "急速" },
};
const order = Object.keys(labels);

export function balanceChips(
  modifiers: Record<string, number> | undefined | null,
): BalanceChip[] {
  if (!modifiers) return [];
  return Object.entries(modifiers)
    .filter(([key]) => key in labels)
    .sort(([a], [b]) => order.indexOf(a) - order.indexOf(b))
    .map(([key, value]) => {
      const label = labels[key];
      if (key === "ability_haste")
        return {
          key,
          text: `${label.name} ${value > 0 ? "+" : ""}${value}`,
          buff: value > 0,
        };
      const percent = Math.round((value - 1) * 1000) / 10;
      return {
        key,
        text: `${label.name} ${percent > 0 ? "+" : ""}${percent}%`,
        buff: label.lowerIsBuff ? value < 1 : value > 1,
      };
    });
}
/** 汇总方向：多数调整为增强记 1，多数削弱记 -1，持平或没有调整记 0。 */
export function balanceTrend(chips: BalanceChip[]) {
  const score = chips.reduce((sum, chip) => sum + (chip.buff ? 1 : -1), 0);
  return Math.sign(score);
}
