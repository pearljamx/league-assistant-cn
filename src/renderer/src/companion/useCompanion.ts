import { computed, ref } from "vue";
import { api, unwrap } from "../api";
import type {
  Catalog,
  CompanionState,
  ConnectionState,
  Overview,
  Settings,
  SkillRating,
  StatsQuery,
} from "../../../shared/types";

// 两个客户端小窗共用的状态；每个窗口是独立页面，各自持有一份。
export const state = ref<ConnectionState>({
  status: "searching",
  message: "正在连接客户端",
  phase: "None",
  region: null,
  platform: null,
  mode: "rift",
  queueId: null,
  summoner: null,
  ranked: [],
  championId: null,
  updatedAt: "",
});
export const settings = ref<Settings>({
  autoAccept: false,
  acceptDelayMs: 1000,
  band: "all",
  mode: "rift",
  position: "ALL",
  tier: 255,
  autoRecognize: false,
  monitor: 0,
  overlay: true,
  managedRunePage: null,
});
export const companion = ref<CompanionState>({
  championId: null,
  followingClient: true,
});
export const catalog = ref<Catalog>({
  champions: [],
  items: {},
  perks: {},
  version: null,
});
export const overview = ref<Overview | null>(null);
export const rating = ref<SkillRating | null>(null);
export const error = ref("");
export const message = ref("");
export const loadingCatalog = ref(false);
let overviewEpoch = 0,
  ratingEpoch = 0,
  viewEpoch = 0;

export const heroes = computed(
  () => new Map(catalog.value.champions.map((hero) => [hero.id, hero])),
);
export const hero = computed(() =>
  heroes.value.get(companion.value.championId || 0),
);
export const modeName = computed(
  () =>
    ({ rift: "召唤师峡谷", aram: "极地大乱斗", hex: "海克斯大乱斗" })[
      state.value.mode
    ],
);
export const query = computed<StatsQuery>(() => ({
  mode: state.value.mode,
  band: settings.value.band,
  tier: settings.value.tier,
  position: settings.value.position,
}));
export const stats = computed(
  () =>
    new Map((overview.value?.heroes || []).map((row) => [row.championId, row])),
);
export const percent = (value: number | null | undefined) =>
  value == null ? "—" : `${(value * 100).toFixed(1)}%`;
export const sessionContext = () =>
  `${state.value.status}:${state.value.platform}:${state.value.summoner?.puuid}:${state.value.phase}`;

export async function act(action: "hide" | "show" | "main") {
  try {
    await unwrap(api.companionWindow(action));
  } catch (e) {
    error.value = (e as Error).message;
  }
}
export async function save(patch: Partial<Settings>) {
  try {
    settings.value = await unwrap(api.saveSettings(patch));
  } catch (e) {
    error.value = (e as Error).message;
  }
}
/** 只改变两个小窗正在查看的英雄，不会向客户端写入。 */
export async function view(id: number | null) {
  const version = ++viewEpoch,
    context = sessionContext();
  try {
    const response = await unwrap(api.selectCompanionChampion(id));
    if (version === viewEpoch && context === sessionContext())
      companion.value = response;
  } catch (e) {
    if (version === viewEpoch && context === sessionContext())
      error.value = (e as Error).message;
  }
}
async function loadCatalog() {
  loadingCatalog.value = true;
  try {
    catalog.value = await unwrap(api.getCatalog());
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loadingCatalog.value = false;
  }
}
export async function loadOverview() {
  const version = ++overviewEpoch;
  overview.value = null;
  try {
    const response = await unwrap(api.getOverview({ ...query.value }));
    if (version === overviewEpoch) overview.value = response;
  } catch {
    /* 胜率缺失时显示“—”，不影响其余内容 */
  }
}
async function loadRating() {
  const version = ++ratingEpoch;
  rating.value = null;
  if (!state.value.summoner || state.value.status !== "connected") return;
  try {
    const value = await unwrap(api.getRating());
    if (version === ratingEpoch) rating.value = value;
  } catch {
    /* 评分失败保持“待接入”，不显示旧账号结果 */
  }
}

/** 订阅状态并完成首次读取；onChange 在阶段或账号变化后调用。 */
export function startCompanion(
  onChange: (account: boolean, previous: ConnectionState) => void,
  options: { rating: boolean },
) {
  function accept(value: ConnectionState) {
    const previous = state.value;
    if (
      previous.phase !== value.phase ||
      previous.summoner?.puuid !== value.summoner?.puuid ||
      previous.platform !== value.platform
    )
      viewEpoch++;
    const account =
      previous.summoner?.puuid !== value.summoner?.puuid ||
      previous.platform !== value.platform ||
      previous.status !== value.status;
    state.value = value;
    if (account) {
      ratingEpoch++;
      rating.value = null;
      message.value = "";
      error.value = "";
      if (options.rating) void loadRating();
    }
    onChange(account, previous);
  }
  const stops = [
    api.onState(accept),
    api.onSettings((value) => (settings.value = value)),
    api.onCompanionState((value) => (companion.value = value)),
  ];
  void (async () => {
    try {
      const [s, p, c] = await Promise.all([
        unwrap(api.getState()),
        unwrap(api.getSettings()),
        unwrap(api.getCompanionState()),
      ]);
      settings.value = p;
      companion.value = c;
      accept(s);
    } catch (e) {
      error.value = (e as Error).message;
    }
    void loadCatalog();
    void loadOverview();
  })();
  return () => {
    overviewEpoch++;
    ratingEpoch++;
    viewEpoch++;
    stops.forEach((stop) => stop());
  };
}
