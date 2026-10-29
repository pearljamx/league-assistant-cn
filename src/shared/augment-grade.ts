// 海克斯强化评级：在同一英雄、同一分组的强化里按平滑胜率排名分档。
// 这是相对排名，不是获胜概率；低样本强化不参与排名也不定级。
export type AugmentGrade = "S" | "A" | "B" | "C" | "D";
export const gradeThresholds: [AugmentGrade, number][] = [
  ["S", 0.1],
  ["A", 0.3],
  ["B", 0.6],
  ["C", 0.85],
  ["D", 1],
];
/** 可定级的强化少于该数量时全部不定级，避免少量样本下排名失真。 */
export const minimumGraded = 3;

export function augmentGrades<
  T extends {
    augment: { id: number };
    smoothedWinRate: number | null;
    lowSample: boolean;
  },
>(rows: T[]): Map<number, AugmentGrade> {
  const ranked = rows
    .filter((row) => !row.lowSample && row.smoothedWinRate !== null)
    .sort((a, b) => b.smoothedWinRate! - a.smoothedWinRate!);
  const grades = new Map<number, AugmentGrade>();
  if (ranked.length < minimumGraded) return grades;
  ranked.forEach((row, index) => {
    const position = index / (ranked.length - 1);
    grades.set(
      row.augment.id,
      gradeThresholds.find(([, limit]) => position <= limit)![0],
    );
  });
  return grades;
}
