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
  getRating: () => invoke("rating"),
  openExternal: (target) => invoke("open", target),
  getRecognition: () => invoke("recognition"),
  scanAugments: () => invoke("scan"),
  setManualAugments: (ids) => invoke("manual", ids),
  getDisplays: () => invoke("displays"),
  onState: (callback) => subscribe("assistant:state", callback),
  onSettings: (callback) => subscribe("assistant:settings", callback),
  onRecognition: (callback) => subscribe("assistant:recognition", callback),
};
contextBridge.exposeInMainWorld("assistant", api);
