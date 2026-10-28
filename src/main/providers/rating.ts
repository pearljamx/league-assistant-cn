import type { SkillRating } from "../../shared/types";
export class SkillRatingProvider {
  query(): SkillRating {
    return {
      provider: "hexdata",
      status: "needs-authorization",
      score: null,
      percentile: null,
      date: null,
      message:
        "Hexdata 海斗分直连待正式接入资料与授权。可前往官方查分页查询；助手不会生成替代分数。",
      url: "https://hexdata.com.cn/matchmaking-position",
    };
  }
}
