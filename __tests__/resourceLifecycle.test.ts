import { afterEach, beforeEach, expect, it, vi } from "vitest";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Transport } from "../src/Transport";
import { EventQueue, utf8Bytes } from "../src/EventQueue";
import { configure } from "../src/protocol";

const config = configure({
  baseUrl: "https://primary.test",
  appScheme: "test",
  attributionAppId: "app",
  appToken: "public",
  attributionFallbackURLs: ["https://replica.test"],
});
beforeEach(async () => {
  await AsyncStorage.clear();
  vi.clearAllMocks();
});
afterEach(() => vi.unstubAllGlobals());

it("UTF-8 byte counts match native encoding including malformed surrogate pairs", () => {
  const encoder = new TextEncoder();
  for (const value of [
    "abc",
    "中文",
    "😀",
    "\ud800",
    "\udc00",
    "\ud800a",
    "\ud800\ud800\udc00",
    "a".repeat(16384),
  ])
    expect(utf8Bytes(value)).toBe(encoder.encode(value).byteLength);
  for (let i = 0; i <= 65535; i++) {
    const value = String.fromCharCode(i) + "😀";
    expect(utf8Bytes(value)).toBe(encoder.encode(value).byteLength);
  }
});

it("failover serializes once and sends the same snapshot to both servers", async () => {
  let encodes = 0;
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce({ ok: false, status: 503 })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) });
  vi.stubGlobal("fetch", fetcher);
  await new Transport(config).request("/api/sdk/v2/install", {
    toJSON: () => ({ value: ++encodes }),
  });
  expect(encodes).toBe(1);
  expect(fetcher.mock.calls.map((call) => call[1].body)).toEqual([
    '{"value":1}',
    '{"value":1}',
  ]);
});

it("dispose aborts transport work and never starts a fallback", async () => {
  const fetcher = vi.fn(
    (_url: string, options: RequestInit) =>
      new Promise((_resolve, reject) => {
        options.signal!.addEventListener("abort", () =>
          reject(new Error("aborted")),
        );
      }),
  );
  vi.stubGlobal("fetch", fetcher);
  const transport = new Transport(config);
  const pending = expect(
    transport.request("/api/sdk/v2/install", {}),
  ).rejects.toThrow();
  transport.close();
  await pending;
  await expect(transport.request("/api/sdk/v2/install", {})).rejects.toThrow(
    "closed",
  );
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it("drain releases queued memory but durable events survive a new instance", async () => {
  const transport = {
    request: vi.fn().mockResolvedValue({ acknowledged: true }),
  } as unknown as Transport;
  const queue = new EventQueue("events", transport);
  await queue.load("install");
  await queue.add({
    installId: "install",
    eventName: "signup",
    timestamp: new Date().toISOString(),
  });
  await queue.drain();
  expect(queue.count).toBe(0);
  const restored = new EventQueue("events", transport);
  await restored.load("install");
  expect(restored.count).toBe(1);
  await restored.flush();
  expect(restored.count).toBe(0);
  expect(transport.request).toHaveBeenCalledTimes(1);
});
