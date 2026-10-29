/** AramHex's own public rank; never a Hexdata score or official matchmaking MMR. */
export interface AramHexSkillPosition {
  provider: "aramhex";
  status:
    | "ready"
    | "unavailable"
    | "needs-authorization"
    | "rate-limited"
    | "error";
  /** Source top fraction in [0, 1]. A smaller value means nearer the top. */
  percentile: number | null;
  date: string | null;
  region: string | null;
  regionName: string | null;
  band: string | null;
  bandName: string | null;
  games: number | null;
  soloPercentile: number | null;
  soloGames: number | null;
  message: string;
  url: string;
}
