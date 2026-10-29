import type { Storage } from "./storage";
import type {
  EncounterGame,
  EncounterSummary,
  Match,
  PlayerNote,
  PlayerTag,
} from "../shared/types";

// 玩家备注与“遇到过的玩家”只保存在本机用户目录，不上传。
// 遇到记录只来自本人的战绩，按账号与大区分开保存。
const notesKey = "player-notes-v1";
const encountersKey = (platform: string | null, owner: string) =>
  `encounters-v1:${platform}:${owner}`;
const maxPlayers = 3000;
const maxGamesPerPlayer = 30;
export const playerTags: PlayerTag[] = ["good", "watch", "avoid", "friend"];
const publicPuuid = (value: string) =>
  /^[\w-]{1,128}$/.test(value) && !/^0+$/.test(value.replace(/-/g, ""));

type EncounterBook = Record<string, { name: string; games: EncounterGame[] }>;

export class PlayerStore {
  private notes: Record<string, PlayerNote> | null = null;
  private books = new Map<string, EncounterBook>();
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private storage: Storage) {}

  /** 串行执行读改写，避免并发的战绩请求互相覆盖。 */
  private serial<T>(task: () => Promise<T>): Promise<T> {
    const next = this.queue.catch(() => {}).then(task);
    this.queue = next;
    return next;
  }
  private async loadNotes() {
    if (!this.notes)
      this.notes =
        (await this.storage.cache<Record<string, PlayerNote>>(notesKey))
          ?.data ?? {};
    return this.notes;
  }
  private async loadBook(key: string) {
    let book = this.books.get(key);
    if (!book) {
      book = (await this.storage.cache<EncounterBook>(key))?.data ?? {};
      this.books.set(key, book);
    }
    return book;
  }

  async note(puuid: string) {
    return (await this.loadNotes())[puuid] ?? null;
  }
  async listNotes() {
    return Object.values(await this.loadNotes()).sort((a, b) =>
      b.updatedAt.localeCompare(a.updatedAt),
    );
  }
  /** 标签与备注都为空时视为删除。 */
  saveNote(input: {
    puuid: string;
    name: string;
    platform: string | null;
    tag: PlayerTag | null;
    note: string;
  }) {
    return this.serial(async () => {
      const notes = await this.loadNotes();
      const note = input.note.trim();
      if (!input.tag && !note) {
        delete notes[input.puuid];
        await this.storage.put(notesKey, notes);
        return null;
      }
      const value: PlayerNote = {
        puuid: input.puuid,
        name: input.name || notes[input.puuid]?.name || "公开玩家",
        platform: input.platform,
        tag: input.tag,
        note,
        updatedAt: new Date().toISOString(),
      };
      notes[input.puuid] = value;
      await this.storage.put(notesKey, notes);
      return value;
    });
  }
  deleteNote(puuid: string) {
    return this.serial(async () => {
      const notes = await this.loadNotes();
      delete notes[puuid];
      await this.storage.put(notesKey, notes);
    });
  }

  /** 从本人战绩记录同局的公开玩家；私密、重开和缺少本人的对局不记录。 */
  record(owner: string, platform: string | null, matches: Match[]) {
    return this.serial(async () => {
      const key = encountersKey(platform, owner);
      const book = await this.loadBook(key);
      let changed = false;
      for (const match of matches) {
        if (match.private || match.remake) continue;
        const self = match.players.find((player) => player.puuid === owner);
        if (!self) continue;
        for (const player of match.players) {
          if (player.puuid === owner || !publicPuuid(player.puuid)) continue;
          const entry = (book[player.puuid] ??= {
            name: player.name,
            games: [],
          });
          if (player.name) entry.name = player.name;
          if (entry.games.some((game) => game.matchId === match.id)) continue;
          entry.games.push({
            matchId: match.id,
            date: match.date,
            queueId: match.queueId,
            mode: match.mode,
            sameTeam: player.teamId === self.teamId,
            win: self.win,
            myChampionId: self.championId,
            theirChampionId: player.championId,
          });
          entry.games.sort((a, b) => b.date.localeCompare(a.date));
          entry.games.splice(maxGamesPerPlayer);
          changed = true;
        }
      }
      if (!changed) return;
      const ids = Object.keys(book);
      if (ids.length > maxPlayers) {
        ids
          .sort((a, b) =>
            (book[b].games[0]?.date ?? "").localeCompare(
              book[a].games[0]?.date ?? "",
            ),
          )
          .slice(maxPlayers)
          .forEach((id) => delete book[id]);
      }
      await this.storage.put(key, book);
    });
  }
  async encounters(
    owner: string,
    platform: string | null,
    puuid: string,
  ): Promise<EncounterSummary> {
    await this.queue.catch(() => {});
    const entry = (await this.loadBook(encountersKey(platform, owner)))[puuid];
    return {
      puuid,
      name: entry?.name ?? "",
      total: entry?.games.length ?? 0,
      games: entry?.games ?? [],
    };
  }
  clearEncounters(owner: string, platform: string | null) {
    return this.serial(async () => {
      const key = encountersKey(platform, owner);
      this.books.set(key, {});
      await this.storage.put(key, {});
    });
  }
}
