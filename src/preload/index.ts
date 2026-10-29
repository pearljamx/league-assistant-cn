import { contextBridge, ipcRenderer } from "electron";
import type { AssistantApi } from "../shared/types";

const invoke = (name: string, ...args: unknown[]) =>
  ipcRenderer.invoke("assistant:" + name, ...args);
const subscribe = (event: string, callback: (value: any) => void) => {
  const handler = (_: unknown, value: any) => callback(value);
  ipcRenderer.on(event, handler);
  return () => ipcRenderer.removeListener(event, handler);
};
const api: AssistantApi = {
  getState: () => invoke("state"),
  getSettings: () => invoke("settings"),
  saveSettings: (patch) => invoke("settings-save", patch),
  getCatalog: () => invoke("catalog"),
  getSelection: () => invoke("selection"),
  getLiveGame: () => invoke("live-game"),
  getChampionChoices: () => invoke("champion-choices"),
  chooseChampion: (id) => invoke("champion-choose", id),
  getCompanionState: () => invoke("companion-state"),
  selectCompanionChampion: (id) => invoke("companion-select", id),
  companionWindow: (action) => invoke("companion-window", action),
  getOverview: (query) => invoke("overview", query),
  getRecommendation: (championId, query) =>
    invoke("recommendation", championId, query),
  getAugments: (championId, band) => invoke("augments", championId, band),
  getHistory: (puuid, start) => invoke("history", puuid, start),
  getMatch: (id) => invoke("match", id),
  findSummoner: (id) => invoke("summoner", id),
  getRanked: (puuid) => invoke("ranked", puuid),
  applyRunes: (championId, query, index, expectedPerks) =>
    invoke("runes", championId, query, index, expectedPerks),
  getRating: (riotId) => invoke("rating", riotId),
  openExternal: (target) => invoke("open", target),
  getRecognition: () => invoke("recognition"),
  scanAugments: () => invoke("scan"),
  setManualAugments: (ids) => invoke("manual", ids),
  getDisplays: () => invoke("displays"),
  mainWindow: (action) => invoke("main-window", action),
  getPlayerNote: (puuid) => invoke("player-note", puuid),
  savePlayerNote: (note) => invoke("player-note-save", note),
  listPlayerNotes: () => invoke("player-notes"),
  deletePlayerNote: (puuid) => invoke("player-note-delete", puuid),
  getEncounters: (puuid) => invoke("encounters", puuid),
  clearEncounters: () => invoke("encounters-clear"),
  onState: (callback) => subscribe("assistant:state", callback),
  onSelection: (callback) => subscribe("assistant:selection", callback),
  onSettings: (callback) => subscribe("assistant:settings", callback),
  onRecognition: (callback) => subscribe("assistant:recognition", callback),
  onCompanionState: (callback) => subscribe("assistant:companion", callback),
  onCloseRequest: (callback) =>
    subscribe("assistant:close-request", () => callback()),
};
contextBridge.exposeInMainWorld("assistant", api);
