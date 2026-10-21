import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { native, rn } from "./__mocks__/native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Sources } from "../src/Sources";
import { AttributionManager } from "../src/AttributionManager";
import { FingerprintCollector } from "../src/FingerprintCollector";
import { Transport, HttpError } from "../src/Transport";
import { configure } from "../src/protocol";
import { AppInstallSDK } from "../src/AppInstallSDK";
import { EventQueue } from "../src/EventQueue";
import { DeepLinkHandler } from "../src/DeepLinkHandler";
import { createDesktopAdapter } from "../src/desktop";
import { createHash } from "node:crypto";
const config = {
  baseUrl: "https://example.com",
  appScheme: "myapp",
  attributionAppId: "app",
  appToken: "public-token",
};
const finalResult = {
  installId: "11111111-1111-4111-8111-111111111111",
  attributed: true,
  attributionStatus: "matched" as const,
  attributionMethod: "click_token",
  attributionScope: "click",
  isFinal: true,
  resultVersion: 1,
  deepLinkData: {
    shortCode: "abc",
    linkId: "11111111-1111-4111-8111-111111111112",
    customParameters: { inviter: "alice" },
  },
};
const managers: AttributionManager[] = [],
  sdks: AppInstallSDK[] = [];
beforeEach(async () => {
  vi.useRealTimers();
  vi.clearAllMocks();
  native.states.clear();
  await AsyncStorage.clear();
  rn.Platform.OS = "android";
  rn.AppState.currentState = "active";
  native.readState.mockImplementation(
    async (scope) => native.states.get(scope) ?? null,
  );
  native.writeState.mockImplementation(async (scope, value) => {
    native.states.set(scope, value);
  });
  native.readClipboard.mockResolvedValue(null);
  native.readPackageSource.mockResolvedValue(null);
  native.readReferrer.mockResolvedValue({ status: "unavailable" });
  rn.Linking.getInitialURL.mockResolvedValue(null);
});
afterEach(() => {
  managers.splice(0).forEach((m) => m.dispose());
  sdks.splice(0).forEach((s) => s.dispose());
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
function manager(
  request = vi.fn().mockResolvedValue(finalResult),
  scope = "app",
) {
  const transport = { request } as unknown as Transport,
    source = new Sources(config, scope),
    accept = vi.fn(async () => {});
  const m = new AttributionManager(
    configure(config),
    source,
    transport,
    () => FingerprintCollector.collect(),
    accept,
  );
  managers.push(m);
  return { m, source, request, accept };
}
it("concurrent requests coalesce, commit precedes response, final data survives restart without HTTP", async () => {
  const { m, request } = manager();
  const values = await Promise.all([m.refresh(), m.refresh(), m.refresh()]);
  expect(values[0]).toEqual(finalResult);
  expect(request).toHaveBeenCalledTimes(1);
  const saved = JSON.parse(native.states.get("app")!);
  expect(saved.response).toEqual(finalResult);
  expect(saved.body).toBeUndefined();
  expect(saved.sourceSnapshot).toBeUndefined();
  values[0].deepLinkData!.customParameters!.inviter = "mutated";
  expect((await m.refresh()).deepLinkData!.customParameters!.inviter).toBe(
    "alice",
  );
  const restart = manager();
  await restart.m.refresh();
  expect(restart.request).not.toHaveBeenCalled();
});
it("pending results retry and reuse the same persisted installation ID", async () => {
  vi.useFakeTimers();
  const request = vi
    .fn()
    .mockResolvedValueOnce({
      ...finalResult,
      attributed: false,
      deepLinkData: null,
      attributionStatus: "pending",
      isFinal: false,
      retryAfterMs: 30000,
    })
    .mockResolvedValue(finalResult);
  const { m } = manager(request);
  expect((await m.refresh()).isFinal).toBe(false);
  expect((await m.refresh()).isFinal).toBe(false);
  expect(request).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(36001);
  expect((await m.refresh()).isFinal).toBe(true);
  expect(request.mock.calls[0][1].installInstanceId).toBe(
    request.mock.calls[1][1].installInstanceId,
  );
});
it("first write failure never sends or mints a committed server install", async () => {
  vi.useFakeTimers();
  native.writeState.mockRejectedValueOnce(new Error("disk full"));
  const { m, request } = manager();
  expect((await m.refresh()).reason).toBe("temporarily_unavailable");
  expect(request).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1201);
  expect((await m.refresh()).isFinal).toBe(true);
});
it("corrupt or cross-scope state is not silently replaced with a new identity", async () => {
  native.states.set(
    "app",
    JSON.stringify({ scope: "other", instanceId: crypto.randomUUID() }),
  );
  const { m, request } = manager();
  expect((await m.refresh()).isFinal).toBe(false);
  expect(request).not.toHaveBeenCalled();
  expect(native.newInstanceId).not.toHaveBeenCalled();
});
it("initial response is bounded while slow network completes in background", async () => {
  vi.useFakeTimers();
  let resolve!: (r: unknown) => void;
  const { m } = manager(
    vi.fn(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    ),
  );
  const starting = m.start();
  await vi.advanceTimersByTimeAsync(1501);
  expect((await starting).reason).toBe("initial_response_pending");
  resolve(finalResult);
  await vi.advanceTimersByTimeAsync(1);
  expect(m.current?.isFinal).toBe(true);
});
it("clear drains late network replies and prevents state recreation or callbacks", async () => {
  let resolve!: (r: unknown) => void;
  const { m, accept, request } = manager(
    vi.fn(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    ),
  );
  const reading = m.refresh();
  await vi.waitFor(() => expect(request).toHaveBeenCalled());
  const clearing = m.clear();
  resolve(finalResult);
  await Promise.all([reading, clearing]);
  expect(native.states.size).toBe(0);
  expect(accept).not.toHaveBeenCalled();
});
it("background collection does not touch clipboard or Play", async () => {
  rn.AppState.currentState = "background";
  const source = new Sources({ ...config, clipboardAttribution: true }, "app");
  const result = await source.collect();
  expect(result.sourceStates.clipboard).toBe("pending");
  expect(native.readClipboard).not.toHaveBeenCalled();
  expect(native.readReferrer).not.toHaveBeenCalled();
});
it("slow source uses a pending first snapshot and is read once", async () => {
  vi.useFakeTimers();
  let resolve!: (value: string | null) => void;
  native.readClipboard.mockReturnValue(
    new Promise((r) => {
      resolve = r;
    }),
  );
  const source = new Sources({ ...config, clipboardAttribution: true }, "app");
  const reading = source.collect();
  await vi.advanceTimersByTimeAsync(201);
  expect((await reading).sourceStates.clipboard).toBe("pending");
  resolve("unrelated clipboard");
  await vi.advanceTimersByTimeAsync(1);
  const second = await source.collect();
  expect(second.evidence).toEqual([]);
  expect(second.sourceStates.clipboard).toBe("complete");
  expect(native.readClipboard).toHaveBeenCalledTimes(1);
});
it("duplicate Play token is invalid explicit evidence, retries are capped", async () => {
  native.readReferrer.mockResolvedValue({
    status: "complete",
    referrer: "lf_token=a&lf_token=b",
  } as never);
  expect((await new Sources(config, "a").collect()).invalidSource).toBe(true);
  native.readReferrer.mockResolvedValue({ status: "pending" });
  const source = new Sources(config, "b");
  for (let i = 0; i < 3; i++) await source.collect();
  expect((await source.collect()).sourceStates.play_referrer).toBe(
    "unavailable",
  );
});
it("fingerprint uses full physical display and current optional signals", async () => {
  const fp = await FingerprintCollector.collect();
  expect(fp.screenWidth).toBe(1080);
  expect(fp.screenHeight).toBe(2400);
  expect(fp.signals).toMatchObject({
    screenUnit: "physical",
    pixelRatio: 3,
    cpuArchitecture: "arm",
    deviceModel: "Pixel 8",
  });
  expect(fp.timezone).toBe("Asia/Shanghai");
  expect(fp.language).toBe("zh-CN");
});
it("HTTP failover is install-only and permanent client errors never fail over", async () => {
  const fetcher = vi
    .fn()
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValue({ ok: true, json: async () => finalResult });
  vi.stubGlobal("fetch", fetcher);
  const t = new Transport(
    configure({
      ...config,
      attributionFallbackURLs: ["https://replica.example.com"],
    }),
  );
  expect(await t.request("/api/sdk/v2/install", {})).toEqual(finalResult);
  expect(fetcher).toHaveBeenCalledTimes(2);
  fetcher.mockReset().mockResolvedValue({ ok: false, status: 401 });
  await expect(t.request("/api/sdk/v2/install", {})).rejects.toBeInstanceOf(
    HttpError,
  );
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it("event queue is bounded, persisted, retried and uses current acknowledgement", async () => {
  const request = vi.fn().mockRejectedValue(new Error("offline"));
  const q = new EventQueue("events", { request } as unknown as Transport);
  for (let i = 0; i < 100; i++)
    expect(
      await q.add({ eventName: "event", timestamp: new Date().toISOString() }),
    ).toBe(true);
  expect(await q.add({ eventName: "extra" })).toBe(false);
  await q.flush();
  expect(q.count).toBe(100);
  const restored = new EventQueue("events", {
    request,
  } as unknown as Transport);
  await restored.load();
  expect(restored.count).toBe(100);
  request.mockResolvedValue({ acknowledged: true });
  await restored.flush();
  expect(restored.count).toBe(0);
});
it("direct links use exact origin checks and never expose credential fields", async () => {
  const h = new DeepLinkHandler(config.baseUrl, "myapp", async () => null);
  expect(h.parseURL("https://example.com.evil/abc")).toBeNull();
  expect(h.parseURL("https://example.com@evil/abc")).toBeNull();
  expect(
    h.parseURL("myapp://open?shortCode=abc&lf_token=secret&inviter=bob")
      ?.customParameters,
  ).toEqual({ inviter: "bob" });
});
it("public SDK final cache, callbacks, scope isolation and event contract work together", async () => {
  const fetcher = vi.fn(async (url: string) => ({
    ok: true,
    json: async () =>
      url.endsWith("/event") ? { acknowledged: true } : finalResult,
  }));
  vi.stubGlobal("fetch", fetcher);
  const sdk = new AppInstallSDK();
  sdks.push(sdk);
  const callback = vi.fn();
  sdk.onDeferredDeepLink(callback);
  expect((await sdk.init(config)).isFinal).toBe(true);
  expect(callback).toHaveBeenCalledTimes(1);
  await sdk.getInstallData();
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(await sdk.trackEvent("signup", { source: "app" })).toBe(true);
  expect(fetcher.mock.calls[1][0]).toContain("/api/sdk/v2/event");
  await expect(sdk.init({ ...config, appScheme: "other" })).rejects.toThrow();
  await sdk.clearData();
  expect(native.states.size).toBe(0);
});
it("desktop adapter chooses the bootstrap scope path and bounds file reads", async () => {
  const hash = createHash("sha256").update("app\0myapp").digest("hex");
  const read = vi.fn(
    async () => "appinstall-desktop:v1:YXBw:" + "a".repeat(43),
  );
  const stat = vi.fn(async () => ({ size: 100 }));
  const adapter = createDesktopAdapter({
    platform: "windows",
    localAppData: "C:/Users/test/AppData/Local",
    applicationSupportDirectory: "C:/app/support",
    exists: async () => true,
    stat,
    read,
    readClipboard: async () => null,
    sha256: (text) => createHash("sha256").update(text).digest("hex"),
  });
  await adapter.readReceipt("app", "myapp");
  expect(read.mock.calls[0]).toEqual([
    `C:/Users/test/AppData/Local/AppInstall/Install/${hash}/install.receipt`,
    2049,
    0,
    "utf8",
  ]);
  stat.mockResolvedValue({ size: 2049 });
  await expect(adapter.readReceipt("app", "myapp")).rejects.toThrow();
  expect(read).toHaveBeenCalledTimes(1);
});
it("dispose and reinitialize wait for old network work without exposing old results", async () => {
  let resolve!: (r: unknown) => void;
  const fetcher = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    )
    .mockResolvedValue({ ok: true, json: async () => finalResult });
  vi.stubGlobal("fetch", fetcher);
  const sdk = new AppInstallSDK();
  sdks.push(sdk);
  const first = sdk.init(config);
  await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
  sdk.dispose();
  const second = sdk.init(config);
  resolve({ ok: true, json: async () => finalResult });
  await first;
  expect((await second).isFinal).toBe(true);
  expect(fetcher).toHaveBeenCalledTimes(2);
});
it("callback failures do not change successful attribution and direct context wins", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => ({
      ok: true,
      json: async () =>
        url.includes("/resolve/")
          ? { shortCode: "new", linkId: "22222222-2222-4222-8222-222222222222" }
          : finalResult,
    })),
  );
  rn.Linking.getInitialURL.mockResolvedValue("myapp://open?shortCode=new");
  const sdk = new AppInstallSDK();
  sdks.push(sdk);
  sdk.onDeferredDeepLink(() => {
    throw new Error("host callback");
  });
  expect((await sdk.init(config)).isFinal).toBe(true);
  await vi.waitFor(() =>
    expect(sdk.getActiveAttribution()?.linkId).toBe(
      "22222222-2222-4222-8222-222222222222",
    ),
  );
  expect((await sdk.getAttribution()).isFinal).toBe(true);
});
it("no final response is published until durable result persistence succeeds", async () => {
  const original = native.writeState.getMockImplementation()!;
  native.writeState.mockImplementation(async (scope, value) => {
    if (JSON.parse(value).response) throw new Error("disk full");
    await original(scope, value);
  });
  const { m, accept } = manager();
  expect((await m.refresh()).isFinal).toBe(false);
  expect(accept).not.toHaveBeenCalled();
  expect(JSON.parse(native.states.get("app")!).response).toBeUndefined();
});
it("expired retry windows and invalid responses are never treated as immutable finals", async () => {
  vi.useFakeTimers();
  const request = vi
    .fn()
    .mockResolvedValue({ ...finalResult, reason: "retry_window_expired" });
  const { m } = manager(request);
  await m.refresh();
  await vi.advanceTimersByTimeAsync(6001);
  await m.refresh();
  expect(request).toHaveBeenCalledTimes(2);
  request.mockResolvedValue({ installId: "broken", attributed: false });
  await vi.advanceTimersByTimeAsync(6001);
  expect((await m.refresh()).reason).toBe("temporarily_unavailable");
});
it("two controllers in the same runtime share the persisted instance identity", async () => {
  const first = manager(),
    second = manager();
  await Promise.all([first.m.refresh(), second.m.refresh()]);
  expect(native.newInstanceId).toHaveBeenCalledTimes(1);
  expect(first.request.mock.calls[0][1].installInstanceId).toBe(
    second.request.mock.calls[0][1].installInstanceId,
  );
});
it("iOS reports APK and Play as unavailable without attempting an APK read", async () => {
  rn.Platform.OS = "ios";
  const snapshot = await new Sources(config, "ios").collect();
  expect(snapshot.sourceStates.apk).toBe("unavailable");
  expect(snapshot.sourceStates.play_referrer).toBe("unavailable");
  expect(native.readPackageSource).not.toHaveBeenCalled();
});

it("clipboard foreground races retry finitely, while denied access is terminal", async () => {
  native.readClipboard
    .mockRejectedValueOnce(
      Object.assign(new Error("focus"), { code: "BACKGROUND" }),
    )
    .mockResolvedValue(
      "appinstall:v2:YXBw:c2.key." +
        "a".repeat(16) +
        "." +
        "b".repeat(68) +
        "." +
        "c".repeat(22),
    );
  const source = new Sources(
    { ...config, clipboardAttribution: true },
    "focus",
  );
  expect((await source.collect()).sourceStates.clipboard).toBe("pending");
  expect((await source.collect()).evidence).toHaveLength(1);
  native.readClipboard.mockRejectedValue(
    Object.assign(new Error("denied"), { code: "PERMISSION_DENIED" }),
  );
  const denied = new Sources(
    { ...config, clipboardAttribution: true },
    "denied",
  );
  expect((await denied.collect()).sourceStates.clipboard).toBe("unavailable");
  const count = native.readClipboard.mock.calls.length;
  await denied.collect();
  expect(native.readClipboard).toHaveBeenCalledTimes(count);
  native.readClipboard.mockRejectedValue(
    Object.assign(new Error("focus"), { code: "BACKGROUND" }),
  );
  const capped = new Sources(
    { ...config, clipboardAttribution: true },
    "capped",
  );
  for (let i = 0; i < 4; i++) await capped.collect();
  expect(native.readClipboard).toHaveBeenCalledTimes(count + 3);
  expect((await capped.collect()).sourceStates.clipboard).toBe("unavailable");
});

it("newest link wins even if earlier resolve completes last, and duplicate delivery coalesces", async () => {
  let first!: (data: unknown) => void;
  const resolve = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise((r) => {
          first = r;
        }),
    )
    .mockResolvedValue({ shortCode: "b", linkId: "b" });
  const h = new DeepLinkHandler(config.baseUrl, "myapp", resolve);
  const callback = vi.fn();
  h.initialize(callback);
  const a = h.handle("myapp://a");
  await h.handle("myapp://b");
  await h.handle("myapp://b");
  first({ shortCode: "a", linkId: "a" });
  await a;
  expect(callback).toHaveBeenCalledTimes(1);
  expect(callback.mock.calls[0][1].linkId).toBe("b");
  expect(resolve).toHaveBeenCalledTimes(2);
  h.cleanup();
});

it("concurrent event producers are bounded even when HTTP never completes", async () => {
  let ack!: (value: unknown) => void;
  const request = vi.fn(
    () =>
      new Promise((r) => {
        ack = r;
      }),
  );
  const q = new EventQueue("blocked-events", {
    request,
  } as unknown as Transport);
  await q.add({ eventName: "first", timestamp: new Date().toISOString() });
  const sending = q.flush();
  await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1));
  expect(q.flush()).toBe(sending);
  const calls = Array.from({ length: 1000 }, () =>
    q.add({ eventName: "next", timestamp: new Date().toISOString() }),
  );
  expect(q.count).toBe(100);
  const accepted = await Promise.all(calls);
  expect(accepted.filter(Boolean)).toHaveLength(99);
  // Every accepted event has reached disk while the first network call is still blocked.
  const restored = new EventQueue("blocked-events", {
    request,
  } as unknown as Transport);
  await restored.load();
  expect(restored.count).toBe(100);
  q.stop();
  ack({ acknowledged: true });
  await sending;
});

it("event payload bytes are bounded, immutable and persist stable IDs across retry/restart", async () => {
  const request = vi.fn().mockRejectedValue(new Error("offline"));
  const q = new EventQueue("stable-events", {
    request,
  } as unknown as Transport);
  const value = {
    eventName: "purchase",
    timestamp: new Date().toISOString(),
    eventData: { amount: 10 },
  };
  await q.add(value);
  value.eventData.amount = 99;
  await q.flush();
  const first = request.mock.calls[0][1];
  expect(first.eventData.amount).toBe(10);
  expect(first.eventId).toMatch(/^[0-9a-f-]{36}$/);
  const restored = new EventQueue("stable-events", {
    request,
  } as unknown as Transport);
  await restored.load();
  await restored.flush();
  expect(request.mock.calls[1][1]).toEqual(first);
  const large = {
    eventName: "large",
    timestamp: value.timestamp,
    eventData: { text: "中".repeat(18000) },
  };
  let added = 0;
  while (await restored.add(large)) added++;
  expect(added).toBeLessThan(100);
  expect(
    await restored.add({ ...large, eventData: { text: "中".repeat(30000) } }),
  ).toBe(false);
});

it("authentication failures retain events and bad individual payloads do not block successors", async () => {
  const request = vi.fn().mockRejectedValue(new HttpError(401));
  const q = new EventQueue("auth-events", { request } as unknown as Transport);
  await q.add({ eventName: "one", timestamp: new Date().toISOString() });
  await q.add({ eventName: "two", timestamp: new Date().toISOString() });
  await q.flush();
  expect(q.count).toBe(2);
  request
    .mockRejectedValueOnce(new HttpError(400))
    .mockResolvedValue({ acknowledged: true });
  await q.flush();
  expect(q.count).toBe(0);
});

it("init budget includes stalled storage and initialization can complete later", async () => {
  vi.useFakeTimers();
  let resume!: (value: string | null) => void;
  vi.mocked(AsyncStorage.getItem).mockImplementationOnce(
    () =>
      new Promise((r) => {
        resume = r;
      }),
  );
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, json: async () => finalResult })),
  );
  const sdk = new AppInstallSDK();
  sdks.push(sdk);
  const started = sdk.init(config);
  await vi.advanceTimersByTimeAsync(1501);
  expect((await started).reason).toBe("initial_response_pending");
  resume(null);
  await vi.advanceTimersByTimeAsync(1);
  expect((await sdk.getAttribution()).isFinal).toBe(true);
});

it("slow event recovery does not block the final cache or install response", async () => {
  let resume!: (value: [string, string | null][]) => void;
  vi.mocked(AsyncStorage.multiGet).mockImplementationOnce(
    () =>
      new Promise((r) => {
        resume = r;
      }),
  );
  const request = vi.fn(async () => ({
    ok: true,
    json: async () => finalResult,
  }));
  vi.stubGlobal("fetch", request);
  const sdk = new AppInstallSDK();
  sdks.push(sdk);
  expect((await sdk.init(config)).isFinal).toBe(true);
  expect((await sdk.getAttribution()).isFinal).toBe(true);
  expect(request).toHaveBeenCalledTimes(1);
  resume([]);
  await sdk.flushEvents();
});

it("trackEvent returns after persistence without waiting for HTTP; no timers for an empty queue", async () => {
  vi.useFakeTimers();
  let ack!: (value: unknown) => void;
  const request = vi.fn(async (url: string) =>
    url.endsWith("/event")
      ? await new Promise((r) => {
          ack = r;
        })
      : { ok: true, json: async () => finalResult },
  );
  vi.stubGlobal("fetch", request);
  const sdk = new AppInstallSDK();
  sdks.push(sdk);
  await sdk.init(config);
  await sdk.flushEvents();
  expect(vi.getTimerCount()).toBe(0);
  expect(await sdk.trackEvent("purchase")).toBe(true);
  await vi.advanceTimersByTimeAsync(1);
  expect(sdk.getQueuedEventCount()).toBe(1);
  ack({ ok: true, json: async () => ({ acknowledged: true }) });
  await sdk.flushEvents();
  expect(sdk.getQueuedEventCount()).toBe(0);
  expect(vi.getTimerCount()).toBe(0);
});

it("pending getters respect long server retry intervals without additional HTTP", async () => {
  vi.useFakeTimers();
  const request = vi.fn().mockResolvedValue({
    ...finalResult,
    attributed: false,
    deepLinkData: null,
    isFinal: false,
    attributionStatus: "pending",
    retryAfterMs: 120000,
  });
  const { m } = manager(request);
  await m.refresh();
  for (let i = 0; i < 100; i++) await m.refresh();
  await vi.advanceTimersByTimeAsync(119999);
  await m.refresh();
  expect(request).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(24002);
  expect(request).toHaveBeenCalledTimes(2);
});

it("event restore discards other installations and can recover from a transient storage error", async () => {
  const request = vi.fn().mockResolvedValue({ acknowledged: true });
  const old = new EventQueue("restore-events", {
    request,
  } as unknown as Transport);
  await old.add({
    installId: "old",
    eventName: "one",
    timestamp: new Date().toISOString(),
  });
  await old.add({
    installId: "current",
    eventName: "two",
    timestamp: new Date().toISOString(),
  });
  const restored = new EventQueue("restore-events", {
    request,
  } as unknown as Transport);
  await restored.load("current");
  expect(restored.count).toBe(1);
  await restored.flush();
  expect(request.mock.calls[0][1].installId).toBe("current");

  vi.mocked(AsyncStorage.multiGet).mockRejectedValueOnce(
    new Error("disk busy"),
  );
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => ({
      ok: true,
      json: async () =>
        url.endsWith("/event") ? { acknowledged: true } : finalResult,
    })),
  );
  const sdk = new AppInstallSDK();
  sdks.push(sdk);
  expect((await sdk.init(config)).isFinal).toBe(true);
  expect(await sdk.trackEvent("recovered")).toBe(true);
  await sdk.flushEvents();
  expect(sdk.getQueuedEventCount()).toBe(0);
});

it("failed event persistence releases its reservation and concurrent flushes share one request", async () => {
  const request = vi.fn().mockResolvedValue({ acknowledged: true });
  const q = new EventQueue("failure-events", {
    request,
  } as unknown as Transport);
  vi.mocked(AsyncStorage.setItem).mockRejectedValueOnce(new Error("disk full"));
  await expect(
    q.add({ eventName: "one", timestamp: new Date().toISOString() }),
  ).rejects.toThrow();
  expect(q.count).toBe(0);
  await q.add({ eventName: "two", timestamp: new Date().toISOString() });
  await Promise.all(Array.from({ length: 100 }, () => q.flush()));
  expect(request).toHaveBeenCalledTimes(1);
});

it("per-event persistence does not rewrite the remaining backlog on acknowledgements", async () => {
  const request = vi.fn().mockResolvedValue({ acknowledged: true });
  const q = new EventQueue("linear-events", {
    request,
  } as unknown as Transport);
  vi.mocked(AsyncStorage.setItem).mockClear();
  for (let i = 0; i < 100; i++)
    await q.add({
      eventName: "one",
      timestamp: new Date().toISOString(),
      eventData: { text: "a".repeat(1024) },
    });
  expect(AsyncStorage.setItem).toHaveBeenCalledTimes(100);
  const bytes = vi
    .mocked(AsyncStorage.setItem)
    .mock.calls.reduce((sum, call) => sum + call[1].length, 0);
  expect(bytes).toBeLessThan(150000);
  await q.flush();
  expect(AsyncStorage.setItem).toHaveBeenCalledTimes(100);
  expect(AsyncStorage.removeItem).toHaveBeenCalledTimes(100);
});

it("late initialURL cannot supersede an already observed live link", async () => {
  let initial!: (url: string | null) => void;
  rn.Linking.getInitialURL.mockReturnValueOnce(
    new Promise((r) => {
      initial = r;
    }),
  );
  const callback = vi.fn();
  const resolve = vi.fn(async () => null);
  const h = new DeepLinkHandler(config.baseUrl, "myapp", resolve);
  h.initialize(callback);
  await h.handle("myapp://new");
  initial("myapp://old");
  await Promise.resolve();
  expect(resolve).toHaveBeenCalledTimes(1);
  expect(callback.mock.calls[0][0]).toBe("myapp://new");
  h.cleanup();
});

it("a restored installation marker cannot clear a newly opened direct context", async () => {
  const { scope64 } = await import("../src/Sources");
  const scope = scope64(
    JSON.stringify([config.baseUrl, config.attributionAppId, config.appScheme]),
  );
  await AsyncStorage.setItem(
    "@appinstall:marker:" + scope,
    "previous-instance",
  );
  let install!: (value: unknown) => void;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) =>
      url.includes("/resolve/")
        ? {
            ok: true,
            json: async () => ({ shortCode: "new", linkId: "new-link" }),
          }
        : await new Promise((r) => {
            install = r;
          }),
    ),
  );
  rn.Linking.getInitialURL.mockResolvedValueOnce("myapp://new");
  const sdk = new AppInstallSDK();
  sdks.push(sdk);
  const starting = sdk.init(config);
  await vi.waitFor(() =>
    expect(sdk.getActiveAttribution()?.linkId).toBe("new-link"),
  );
  install({ ok: true, json: async () => finalResult });
  expect((await starting).isFinal).toBe(true);
  expect(sdk.getActiveAttribution()?.linkId).toBe("new-link");
  const active = sdk.getActiveAttribution()!;
  active.linkId = "changed";
  expect(sdk.getActiveAttribution()?.linkId).toBe("new-link");
});

it("events preserve occurrence time and link context while storage recovery is pending", async () => {
  let resume!: (value: [string, string | null][]) => void;
  vi.mocked(AsyncStorage.multiGet).mockImplementationOnce(
    () =>
      new Promise((r) => {
        resume = r;
      }),
  );
  const request = vi.fn(async (url: string) => ({
    ok: true,
    json: async () =>
      url.endsWith("/event") ? { acknowledged: true } : finalResult,
  }));
  vi.stubGlobal("fetch", request);
  const sdk = new AppInstallSDK();
  sdks.push(sdk);
  await sdk.init(config);
  const original = sdk.getActiveAttribution()!;
  const sending = sdk.trackEvent("waiting");
  // Model a newer link arriving while the event is waiting for its storage slots.
  await (sdk as any).context.recordDeepLinkOpen("newer-link");
  resume([]);
  expect(await sending).toBe(true);
  await sdk.flushEvents();
  const calls = request.mock.calls as unknown as [string, RequestInit][];
  const payload = JSON.parse(
    calls.find((c) => c[0].endsWith("/event"))![1].body as string,
  );
  expect(payload.attributedLinkId).toBe(original.linkId);
});

it("disposing during queue format recovery preserves events for the next startup", async () => {
  const old = [{ eventName: "saved", timestamp: new Date().toISOString() }];
  await AsyncStorage.setItem("upgrade-events", JSON.stringify(old));
  let resume!: (value: [string, string | null][]) => void;
  vi.mocked(AsyncStorage.multiGet).mockImplementationOnce(
    () =>
      new Promise((r) => {
        resume = r;
      }),
  );
  const q = new EventQueue("upgrade-events", {
    request: vi.fn(),
  } as unknown as Transport);
  const loading = q.load();
  q.stop();
  resume([]);
  await loading;
  expect(JSON.parse((await AsyncStorage.getItem("upgrade-events"))!)).toEqual(
    old,
  );
  const restored = new EventQueue("upgrade-events", {
    request: vi.fn(),
  } as unknown as Transport);
  await restored.load();
  expect(restored.count).toBe(1);
});
