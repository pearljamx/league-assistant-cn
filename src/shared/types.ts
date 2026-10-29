import type { AramHexSkillPosition } from "./rating";
export type Mode = "rift" | "aram" | "hex";
export type Position =
  | "ALL"
  | "TOP"
  | "JUNGLE"
  | "MIDDLE"
  | "BOTTOM"
  | "SUPPORT";
export type Band = "all" | "casual" | "mid" | "high";
export type Phase =
  | "None"
  | "Lobby"
  | "Matchmaking"
  | "ReadyCheck"
  | "ChampSelect"
  | "GameStart"
  | "InProgress"
  | "WaitingForStats"
  | "EndOfGame"
  | "Reconnect"
  | string;
export interface Champion {
  id: number;
  name: string;
  title: string;
  alias: string;
  icon: string;
}
export interface Summoner {
  puuid: string;
  summonerId: number;
  gameName: string;
  tagLine: string;
  level: number;
  iconId: number;
}
export interface RankedEntry {
  queue: string;
  tier: string;
  division: string;
  wins: number;
  losses: number;
  lp: number;
}
export interface ConnectionState {
  status: "searching" | "connected" | "disconnected" | "error";
  message: string;
  phase: Phase;
  region: string | null;
  platform: string | null;
  mode: Mode;
  queueId: number | null;
  summoner: Summoner | null;
  ranked: RankedEntry[];
  championId: number | null;
  updatedAt: string;
}
export interface SourceInfo {
  id: "tencent" | "aramhex" | "aramgg";
  name: string;
  url: string;
  mode: Mode;
  patch: string | null;
  date: string | null;
  band: Band | null;
  license: string | null;
  stale?: boolean;
  position?: Position;
}
export interface Rates {
  winRate: number | null;
  pickRate: number | null;
  games: number | null;
}
export interface HeroStat extends Rates {
  championId: number;
  rank: number | null;
  position?: Position;
}
export interface Overview {
  source: SourceInfo;
  heroes: HeroStat[];
  bands: { id: Band; name: string }[];
}
export interface ItemOption extends Rates {
  ids: number[];
}
export interface RuneOption extends Rates {
  perks: number[];
  primaryStyleId: number;
  subStyleId: number;
  label: string;
}
export interface SkillOption extends Rates {
  order: number[];
  priority: number[];
}
export interface Recommendation {
  source: SourceInfo;
  championId: number;
  position: Position;
  starting: ItemOption[];
  boots: ItemOption[];
  core: ItemOption[];
  later: ItemOption[];
  runes: RuneOption[];
  skills: SkillOption[];
  /** 召唤师技能组合（目前只有 aramgg 极地大乱斗提供）。 */
  spells?: (ItemOption & { names: string[] })[];
  unavailable: string[];
}
export interface Augment {
  id: number;
  name: string;
  rarity: string;
  description?: string;
  icon?: string;
}
export interface AugmentStat extends Rates {
  augment: Augment;
  wins: number;
  smoothedWinRate: number;
  delta: number;
  lowSample: boolean;
}
export interface AugmentRanking {
  source: SourceInfo;
  championId: number | null;
  baseline: number;
  augments: AugmentStat[];
  catalog: Augment[];
  exposure: string;
}
export interface TeamMember {
  cellId: number;
  puuid: string | null;
  summonerId: number | null;
  name: string | null;
  championId: number;
  position: string;
}
export interface Selection {
  members: TeamMember[];
  bench: number[];
  localCellId: number | null;
  championId: number | null;
}
export interface ChampionChoices {
  championIds: number[];
  /** subset：海克斯/大乱斗的英雄卡片；bench：备选席；pick：峡谷本人预选。 */
  kind: "subset" | "bench" | "pick" | "none";
  reason: string;
  /** 本人的英雄卡片（显示角标），可能同时在 championIds 中。 */
  cards?: number[];
  /** 已在备选席但客户端暂不允许换用的英雄（如队友留下的，需等选人结束）。 */
  waiting?: number[];
}
export interface CompanionState {
  championId: number | null;
  followingClient: boolean;
}
export interface LivePlayer {
  key: string;
  puuid: string | null;
  riotId: string | null;
  championId: number;
  teamId: number;
  kills: number | null;
  deaths: number | null;
  assists: number | null;
  level: number | null;
  items: number[];
  isSelf: boolean;
  identityHidden: boolean;
}
export interface LiveGame {
  status: "idle" | "selection" | "live" | "unavailable";
  mode: Mode;
  phase: string;
  gameTime: number | null;
  players: LivePlayer[];
  message: string;
  updatedAt: string;
}
export interface MatchPlayer {
  puuid: string;
  name: string;
  championId: number;
  teamId: number;
  win: boolean;
  kills: number;
  deaths: number;
  assists: number;
  items: number[];
  damage: number;
  gold: number;
  cs: number;
  /** 以下字段来自较新的对局数据，旧缓存可能没有。 */
  level?: number;
  damageTaken?: number;
  /** 海克斯/斗魂等模式选择的强化编号，按选择顺序。 */
  augments?: number[];
}
export interface Match {
  id: string;
  queueId: number;
  mode: string;
  date: string;
  duration: number;
  players: MatchPlayer[];
  private: boolean;
  remake: boolean;
}
export interface MatchPage {
  matches: Match[];
  nextIndex: number;
  hasMore: boolean;
  source: "sgp" | "lcu" | "cache";
  warning: string | null;
  fetchedAt: string;
}
/** aramgg.com 数据 API（data.dtodo.cn）的海克斯大乱斗数据，已在主进程校验与精简。 */
export interface AramggSource {
  name: string;
  gamePatch: string | null;
  dataVersion: string | null;
  date: string | null;
  stale: boolean;
  /** 公共数据包当前的最新版本；与 dataVersion 不同表示该英雄仍是旧版本数据。 */
  latestVersion?: string | null;
  fetchedAt?: string | null;
  /** public：PEARLJAM HEX 公共数据；key：用户自己的 aramgg Key。 */
  via?: "public" | "key";
}
export interface AramggAugment {
  id: number;
  name: string;
  rarity: string;
  iconUrl: string | null;
  /** 腾讯国服推荐分级 1–5，1 最强。 */
  tier: number | null;
  /** 腾讯国服推荐顺序，从 1 开始。 */
  rank: number | null;
  total: number | null;
  /** aramgg 客户端上传的全球胜率，不足 255 场时为空。 */
  winRate: number | null;
  games: number | null;
  pickRate: number | null;
}
export interface AramggOption {
  ids: number[];
  names: string[];
  games: number | null;
  winRate: number | null;
  pickRate: number | null;
}
export interface AramggBuild {
  tags: string;
  games: number | null;
  winRate: number | null;
  pickRate: number | null;
  core: AramggOption[];
  starting: AramggOption[];
  situational: AramggOption[];
  spells: AramggOption[];
  skills: { keys: string[]; games: number | null; winRate: number | null }[];
  /** 完整出装：核心三件 + 该核心之后最常见的补装（最多 6 件）。 */
  full?: AramggOption[];
}
/** 单个符文/碎片在该英雄极地大乱斗对局中的选取统计（不是整页统计）。 */
export interface AramggRuneStat {
  id: number;
  tree: number | null;
  games: number | null;
  pickRate: number | null;
  winRate: number | null;
}
export interface AramggRuneStats {
  games: number | null;
  keystones: AramggRuneStat[];
  runes: AramggRuneStat[];
  shards: {
    offense: AramggRuneStat[];
    flex: AramggRuneStat[];
    defense: AramggRuneStat[];
  };
}
export interface AramggChampion {
  source: AramggSource;
  championId: number;
  tier: number | null;
  winRate: number | null;
  pickRate: number | null;
  augments: AramggAugment[];
  trios: AramggOption[];
  builds: AramggBuild[];
  /** 极地大乱斗（队列 450）符文单项统计；旧数据包或额度不足时为空。 */
  runeStats?: AramggRuneStats | null;
}
export interface AramggStatus {
  configured: boolean;
  masked: string | null;
  gamePatch: string | null;
  dataVersion: string | null;
  creditsRemaining: number | null;
  creditsDaily: number | null;
  error: string | null;
  public: PublicDataStatus | null;
}
/** PEARLJAM HEX 公共数据包状态（无需 Key）。 */
export interface PublicDataStatus {
  available: boolean;
  dataVersion: string | null;
  generatedAt: string | null;
  /** 已同步为最新版本的英雄数 / 英雄总数。 */
  current: number;
  synced: number;
  total: number;
  host: string | null;
  stale: boolean;
  error: string | null;
}
/** 玩家标记只保存在本机：好队友 / 需留意 / 不想再遇 / 朋友。 */
export type PlayerTag = "good" | "watch" | "avoid" | "friend";
export interface PlayerNote {
  puuid: string;
  name: string;
  platform: string | null;
  tag: PlayerTag | null;
  note: string;
  updatedAt: string;
}
/** 本人对局中与某位公开玩家同局的一场记录（只来自本人战绩）。 */
export interface EncounterGame {
  matchId: string;
  date: string;
  queueId: number;
  mode: string;
  sameTeam: boolean;
  /** 本人在这一局是否获胜。 */
  win: boolean;
  myChampionId: number;
  theirChampionId: number;
}
export interface EncounterSummary {
  puuid: string;
  name: string;
  total: number;
  games: EncounterGame[];
}
export interface Catalog {
  champions: Champion[];
  items: Record<string, { name: string; icon: string }>;
  perks: Record<string, { name: string; icon: string }>;
  version: string | null;
}
export interface Settings {
  autoAccept: boolean;
  acceptDelayMs: number;
  band: Band;
  mode: Mode;
  position: Position;
  tier: number;
  autoRecognize: boolean;
  monitor: number;
  overlay: boolean;
  companionWindows?: boolean;
  /** 用户调整过的客户端小窗尺寸（DIP）。 */
  companionSize?: Partial<
    Record<"picker" | "info", { width: number; height: number }>
  >;
  /** 用户拖动后两个小窗的位置（DIP）；下次显示时放回原处，不再自动贴靠。 */
  companionPosition?: Partial<
    Record<"picker" | "info", { x: number; y: number }>
  > | null;
  closeAction?: CloseAction;
  /** 海克斯数据来源：默认 aramgg（需 API Key），可切回国服 AramHex 样本。 */
  hexSource?: "aramgg" | "aramhex";
  /** 自动选人/禁用/抢备选席，全部默认关闭。 */
  autoSelect?: AutoSelectSettings;
  managedRunePage: { id: number; puuid: string } | null;
}
export interface AutoSelectSettings {
  /** 峡谷：轮到本人时按列表预选；大乱斗：打开锁定时自动拿列表中的卡片。 */
  pick: boolean;
  pickChampions: number[];
  /** 峡谷：轮到本人禁用时按列表预禁，不禁队友想选的英雄。 */
  ban: boolean;
  banChampions: number[];
  /** 预选/预禁后延时自动锁定。默认关闭。 */
  lock: boolean;
  lockDelayMs: number;
  /** 大乱斗：备选席出现列表中更靠前的英雄时自动交换。 */
  bench: boolean;
  benchChampions: number[];
}
export type CloseAction = "ask" | "tray" | "quit";
/** 工具集 */
export type ChatAvailability = "chat" | "away" | "mobile" | "offline";
export interface ChatStatus {
  availability: ChatAvailability;
  statusMessage: string;
}
export interface FriendEntry {
  puuid: string;
  name: string;
  availability: string;
  inGame: boolean;
  gameStatus: string;
  queue: string;
  championId: number | null;
  statusMessage: string;
  spectatable: boolean;
}
export interface RerollState {
  available: boolean;
  remaining: number | null;
  current: number | null;
  reason: string;
}
export interface SkillRating {
  provider: "hexdata";
  status: "ready" | "error" | "unavailable" | "needs-authorization";
  score: number | null;
  percentile: number | null;
  date: string | null;
  message: string;
  url: string;
  aramhex?: AramHexSkillPosition;
}
export interface Recognition {
  gameWindow?: { x: number; y: number; width: number; height: number };
  status:
    | "unavailable"
    | "idle"
    | "scanning"
    | "recognized"
    | "uncertain"
    | "error";
  message: string;
  augmentIds: number[];
  rawTexts: string[];
  captureId: number;
  monitor: number;
  updatedAt: string;
}
export interface Result<T> {
  ok: boolean;
  data?: T;
  error?: string;
  code?: string;
}
export interface StatsQuery {
  mode: Mode;
  band: Band;
  tier: number;
  position: Position;
}
export interface AssistantApi {
  getState(): Promise<Result<ConnectionState>>;
  getSettings(): Promise<Result<Settings>>;
  saveSettings(patch: Partial<Settings>): Promise<Result<Settings>>;
  getCatalog(): Promise<Result<Catalog>>;
  getSelection(): Promise<Result<Selection>>;
  getLiveGame(): Promise<Result<LiveGame>>;
  getChampionChoices(): Promise<Result<ChampionChoices>>;
  chooseChampion(championId: number): Promise<Result<void>>;
  getCompanionState(): Promise<Result<CompanionState>>;
  selectCompanionChampion(
    championId: number | null,
  ): Promise<Result<CompanionState>>;
  companionWindow(action: "hide" | "show" | "main"): Promise<Result<void>>;
  getOverview(query: StatsQuery): Promise<Result<Overview>>;
  getRecommendation(
    championId: number,
    query: StatsQuery,
  ): Promise<Result<Recommendation>>;
  getAugments(
    championId: number | null,
    band: Band,
  ): Promise<Result<AugmentRanking>>;
  getHistory(puuid: string, start: number): Promise<Result<MatchPage>>;
  getMatch(id: string): Promise<Result<Match>>;
  findSummoner(riotId: string): Promise<Result<Summoner>>;
  getRanked(puuid: string): Promise<Result<RankedEntry[]>>;
  applyRunes(
    championId: number,
    query: StatsQuery,
    index: number,
    expectedPerks: number[],
  ): Promise<Result<{ pageId: number }>>;
  getRating(riotId?: string): Promise<Result<SkillRating>>;
  openExternal(
    target: "hexdata" | "github" | "data-license" | "aramgg-developer",
  ): Promise<Result<void>>;
  getRecognition(): Promise<Result<Recognition>>;
  scanAugments(): Promise<Result<Recognition>>;
  setManualAugments(ids: number[]): Promise<Result<Recognition>>;
  getDisplays(): Promise<
    Result<{ id: number; name: string; width: number; height: number }[]>
  >;
  mainWindow(action: "tray" | "quit"): Promise<Result<void>>;
  getPlayerNote(puuid: string): Promise<Result<PlayerNote | null>>;
  savePlayerNote(note: {
    puuid: string;
    name: string;
    tag: PlayerTag | null;
    note: string;
  }): Promise<Result<PlayerNote | null>>;
  listPlayerNotes(): Promise<Result<PlayerNote[]>>;
  deletePlayerNote(puuid: string): Promise<Result<void>>;
  getEncounters(puuid: string): Promise<Result<EncounterSummary>>;
  getAramggStatus(): Promise<Result<AramggStatus>>;
  saveAramggKey(key: string | null): Promise<Result<AramggStatus>>;
  getAramggChampion(championId: number): Promise<Result<AramggChampion>>;
  getAramggAugments(): Promise<
    Result<
      Record<number, { name: string; rarity: string; iconUrl: string | null }>
    >
  >;
  clearEncounters(): Promise<Result<void>>;
  getRerollState(): Promise<Result<RerollState>>;
  reroll(): Promise<Result<{ previous: number | null }>>;
  restartClientUx(): Promise<Result<void>>;
  fixClientWindow(): Promise<Result<{ width: number; height: number }>>;
  getFriends(): Promise<Result<FriendEntry[]>>;
  spectateFriend(puuid: string): Promise<Result<void>>;
  getChatStatus(): Promise<Result<ChatStatus>>;
  setChatStatus(patch: Partial<ChatStatus>): Promise<Result<ChatStatus>>;
  onCloseRequest(callback: () => void): () => void;
  onState(callback: (state: ConnectionState) => void): () => void;
  onSelection(callback: (selection: Selection) => void): () => void;
  onSettings(callback: (settings: Settings) => void): () => void;
  onRecognition(callback: (state: Recognition) => void): () => void;
  onCompanionState(callback: (state: CompanionState) => void): () => void;
}
