import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { spawn } from "node:child_process";
import { RecognitionService } from "../src/main/recognition";
import { defaults } from "../src/main/storage";

vi.mock("node:child_process", () => ({ spawn: vi.fn() }));
vi.mock("node:fs", async (original) => ({
  ...(await original<typeof import("node:fs")>()),
  existsSync: () => true,
}));

function child() {
  const requests: any[] = [];
  return Object.assign(new EventEmitter(), {
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    requests,
    stdin: {
      write: vi.fn((text: string, done: (error: null) => void) => {
        requests.push(JSON.parse(text));
        done(null);
        return true;
      }),
    },
    kill: vi.fn(),
  });
}
const services: RecognitionService[] = [];
beforeEach(() => {
  vi.mocked(spawn).mockReset();
});
afterEach(() => {
  for (const service of services.splice(0)) service.stop();
  vi.useRealTimers();
});
function setup() {
  const client = Object.assign(new EventEmitter(), {
    state: {
      status: "connected",
      phase: "InProgress",
      mode: "hex",
      championId: 202,
      summoner: { puuid: "a" },
    },
  });
  const data = {
    catalog: async () =>
      [1, 2, 3, 4].map((id) => ({ id, name: `强化${id}`, rarity: "gold" })),
  };
  const service = new RecognitionService(
    client as any,
    { getSettings: () => ({ ...defaults, autoRecognize: false }) } as any,
    data as any,
    "",
    "",
    false,
  );
  services.push(service);
  return { service, client };
}
function reply(process: ReturnType<typeof child>, request: any, body: any) {
  process.stdout.write(
    JSON.stringify({ requestId: request.requestId, ...body }) + "\n",
  );
}
it("退出对局后迟到的画面变化事件不能重新进入识别中", async () => {
  const process = child();
  vi.mocked(spawn).mockReturnValue(process as any);
  const { service, client } = setup();
  service.start();
  const scanning = service.scan();
  await vi.waitFor(() => expect(process.requests).toHaveLength(1));
  const request = process.requests[0];
  client.state.phase = "EndOfGame";
  client.emit("state");
  reply(process, request, { event: "changed" });
  expect(service.state.status).toBe("idle");
  reply(process, request, {
    result: {
      status: "recognized",
      cards: [1, 2, 3].map((id) => ({ id, text: `强化${id}` })),
    },
  });
  await scanning;
  expect(service.state.augmentIds).toEqual([]);
});
it("当前画面变化先清空旧三卡，再接受新的识别结果", async () => {
  const process = child();
  vi.mocked(spawn).mockReturnValue(process as any);
  const { service } = setup();
  service.start();
  const first = service.scan();
  await vi.waitFor(() => expect(process.requests).toHaveLength(1));
  reply(process, process.requests[0], {
    result: {
      status: "recognized",
      cards: [1, 2, 3].map((id) => ({ id, text: String(id) })),
    },
  });
  await first;
  const scanning = service.scan(false);
  await vi.waitFor(() => expect(process.requests).toHaveLength(2));
  const request = process.requests[1];
  expect(service.state.augmentIds).toEqual([1, 2, 3]);
  const gameWindow = { x: -1920, y: 0, width: 1920, height: 1080 };
  reply(process, request, { event: "changed", gameWindow });
  expect(service.state.status).toBe("scanning");
  expect(service.state.gameWindow).toEqual(gameWindow);
  expect(service.state.augmentIds).toEqual([]);
  reply(process, request, {
    result: {
      status: "recognized",
      cards: [4, 2, 3].map((id) => ({ id, text: `强化${id}` })),
    },
  });
  await scanning;
  expect(service.state.augmentIds).toEqual([4, 2, 3]);
});
it("超时进程迟到退出不能终止新进程的请求", async () => {
  vi.useFakeTimers();
  const old = child(),
    current = child();
  vi.mocked(spawn)
    .mockReturnValueOnce(old as any)
    .mockReturnValueOnce(current as any);
  const { service } = setup();
  const expired = expect(service.displays()).rejects.toMatchObject({
    code: "OCR_TIMEOUT",
  });
  await vi.advanceTimersByTimeAsync(18010);
  await expired;
  const pending = service.displays();
  const result = expect(pending).resolves.toEqual([
    { id: 0, name: "自动", width: 0, height: 0 },
  ]);
  old.emit("exit", 0);
  reply(current, current.requests[0], {
    displays: [{ id: 0, name: "自动", width: 0, height: 0 }],
  });
  await result;
});
