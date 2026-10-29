import { expect, it } from "vitest";
import { augmentGrades } from "../src/shared/augment-grade";

const row = (id: number, rate: number | null, lowSample = false) => ({
  augment: { id },
  smoothedWinRate: rate,
  lowSample,
});
it("按英雄内平滑胜率排名分档，最高为 S、最低为 D", () => {
  const rows = Array.from({ length: 11 }, (_, index) =>
    row(index + 1, 0.6 - index * 0.01),
  );
  const grades = augmentGrades(rows);
  expect(grades.get(1)).toBe("S");
  expect(grades.get(2)).toBe("S");
  expect(grades.get(4)).toBe("A");
  expect(grades.get(7)).toBe("B");
  expect(grades.get(9)).toBe("C");
  expect(grades.get(11)).toBe("D");
});
it("低样本或无胜率的强化不定级，也不影响其他强化的排名", () => {
  const grades = augmentGrades([
    row(1, 0.9, true),
    row(2, null),
    row(3, 0.55),
    row(4, 0.5),
    row(5, 0.45),
  ]);
  expect(grades.has(1)).toBe(false);
  expect(grades.has(2)).toBe(false);
  expect(grades.get(3)).toBe("S");
  expect(grades.get(5)).toBe("D");
});
it("可定级的强化太少时全部不定级", () => {
  expect(augmentGrades([row(1, 0.6), row(2, 0.5)]).size).toBe(0);
});

it("aramgg 顺序换算分档，三张都在 C 以下才提示刷新", async () => {
  const { gradeFromRank, shouldConsiderRefresh } = await import(
    "../src/shared/augment-grade"
  );
  expect(gradeFromRank(1, 50)).toBe("S");
  expect(gradeFromRank(50, 50)).toBe("D");
  expect(gradeFromRank(30, 50)).toBe("B");
  expect(gradeFromRank(null, 50)).toBeNull();
  expect(gradeFromRank(3, 2)).toBeNull();
  expect(shouldConsiderRefresh(["C", "D", "D"])).toBe(true);
  expect(shouldConsiderRefresh(["C", "B", "D"])).toBe(false);
  expect(shouldConsiderRefresh(["C", null, "D"])).toBe(false);
});
