import { AppState } from "react-native";
import type {
  AppInstallConfig,
  DeviceFingerprint,
  InstallAttributionResponse,
  SourceSnapshot,
} from "./types";
import { Sources, withScopeLock } from "./Sources";
import { Transport, retryable } from "./Transport";
import {
  deadline,
  immutable,
  parseResult,
  pending,
  previouslyMatched,
} from "./protocol";
import { SDK_NAME, SDK_VERSION } from "./version";
interface State {
  scope: string;
  instanceId: string;
  body?: Record<string, unknown>;
  sourceSnapshot?: SourceSnapshot;
  sourceStates?: Record<string, string>;
  evidence?: unknown[];
  invalidSource?: boolean;
  matched?: boolean;
  installId?: string;
}
export class AttributionManager {
  private state?: State;
  private result?: InstallAttributionResponse;
  private inFlight?: Promise<InstallAttributionResponse>;
  private timer?: ReturnType<typeof setTimeout>;
  private stopped = false;
  private failures = 0;
  private nextAttemptAt = 0;
  private readonly started = Date.now();
  private listener?: { remove(): void };
  constructor(
    private readonly config: AppInstallConfig,
    readonly source: Sources,
    private readonly transport: Transport,
    private readonly fingerprint: () => Promise<DeviceFingerprint>,
    private readonly accept: (
      r: InstallAttributionResponse,
      instanceId: string,
    ) => Promise<void>,
  ) {}
  get current(): InstallAttributionResponse | undefined {
    return this.result ? JSON.parse(JSON.stringify(this.result)) : undefined;
  }
  async start(): Promise<InstallAttributionResponse> {
    this.listener = AppState.addEventListener("change", (state) => {
      if (state !== "active") clearTimeout(this.timer);
      else if (!immutable(this.result)) void this.refresh();
    });
    try {
      return await deadline(
        this.refresh(),
        this.config.initialAttributionTimeoutMs!,
      );
    } catch {
      return this.current ?? pending("initial_response_pending");
    }
  }
  refresh(): Promise<InstallAttributionResponse> {
    if (this.stopped)
      return Promise.resolve(this.current ?? pending("stopped"));
    if (immutable(this.result)) return Promise.resolve(this.current!);
    if (this.inFlight)
      return this.inFlight.then((r) => JSON.parse(JSON.stringify(r)));
    if (Date.now() < this.nextAttemptAt) {
      this.armRetry();
      return Promise.resolve(this.current ?? pending("retry_scheduled"));
    }
    clearTimeout(this.timer);
    this.inFlight = this.perform().finally(() => {
      this.inFlight = undefined;
    });
    return this.inFlight.then((r) => JSON.parse(JSON.stringify(r)));
  }
  private async perform(): Promise<InstallAttributionResponse> {
    try {
      if (!this.state) {
        await withScopeLock(this.source.scope, async () => {
          if (this.stopped) return;
          const raw = await this.source.readState();
          if (this.stopped) return;
          const restored: State = raw
            ? JSON.parse(raw)
            : {
                scope: this.source.scope,
                instanceId: await this.source.newId(),
              };
          if (
            restored.scope !== this.source.scope ||
            typeof restored.instanceId !== "string" ||
            !/^[a-f0-9-]{36}$/i.test(restored.instanceId)
          )
            throw new Error("Invalid installation state");
          // Remove old response payloads; migrate only a committed success marker.
          const old = (restored as State & { response?: unknown }).response;
          if (old !== undefined) {
            let result: InstallAttributionResponse | undefined;
            try {
              result = parseResult(old);
            } catch {}
            delete (restored as State & { response?: unknown }).response;
            restored.matched =
              !!result && immutable(result) && result.attributed;
            if (result) restored.installId = result.installId;
            if (restored.matched) {
              for (const key of Object.keys(restored)) {
                if (
                  !["scope", "instanceId", "matched", "installId"].includes(key)
                )
                  delete (restored as unknown as Record<string, unknown>)[key];
              }
            }
          }
          if (
            restored.matched === true &&
            (typeof restored.installId !== "string" || !restored.installId)
          )
            throw new Error("Invalid matched installation marker");
          if (!raw || old !== undefined)
            await this.source.writeState(JSON.stringify(restored));
          if (this.stopped) return;
          this.state = restored;
          this.source.restore(restored.sourceSnapshot);
        });
      }
      if (this.stopped || !this.state) return pending("stopped");
      const state = this.state;
      if (state.matched === true)
        return await this.deliver(previouslyMatched(state.installId!));
      const needsSources =
        !state.sourceStates ||
        Object.values(state.sourceStates).includes("pending");
      // Observe errors on concurrent collectors immediately, including if fingerprinting fails.
      const collecting = needsSources
        ? this.source.collect().then(
            (value) => ({ value }),
            (error) => ({ error }),
          )
        : undefined;
      if (!state.body) {
        const fp = await deadline(this.fingerprint(), 2000);
        if (this.stopped) return pending("stopped");
        state.body = {
          ...fp,
          installInstanceId: state.instanceId,
          appScheme: this.config.appScheme,
          appToken: this.config.appToken,
          attributionWindowHours: this.config.attributionWindowHours,
          sdkName: SDK_NAME,
          sdkVersion: SDK_VERSION,
          ...(this.config.deviceId ? { deviceId: this.config.deviceId } : {}),
        };
        await this.source.writeState(JSON.stringify(state));
      }
      if (collecting) {
        const collected = await collecting;
        if ("error" in collected) throw collected.error;
        if (this.stopped) return pending("stopped");
        Object.assign(state, collected.value);
        await this.source.writeState(JSON.stringify(state));
      }
      if (this.stopped) return pending("stopped");
      const result = parseResult(
        await this.transport.request("/api/sdk/v2/install", {
          ...state.body,
          sourceStates: state.sourceStates,
          evidence: state.evidence ?? [],
          ...(state.invalidSource ? { invalidSource: true } : {}),
        }),
      );
      if (this.stopped) return pending("stopped");
      // Commit to disk before exposing a final result. A failed write remains retryable.
      const next: State = immutable(result)
        ? {
            scope: state.scope,
            instanceId: state.instanceId,
            matched: result.attributed,
            installId: result.installId,
          }
        : { ...state, matched: false, installId: result.installId };
      await this.source.writeState(JSON.stringify(next));
      this.state = next;
      if (this.stopped) return pending("stopped");
      this.failures = 0;
      return await this.deliver(result);
    } catch (e) {
      if (this.stopped) return pending("stopped");
      this.result = pending(
        retryable(e) ? "temporarily_unavailable" : "configuration_error",
        this.result?.installId,
      );
      if (retryable(e))
        this.schedule(
          Math.min(30000, 1000 * 2 ** Math.min(this.failures++, 5)),
        );
      return this.current!;
    }
  }
  private async deliver(
    result: InstallAttributionResponse,
  ): Promise<InstallAttributionResponse> {
    if (this.stopped) return pending("stopped");
    await this.accept(
      JSON.parse(JSON.stringify(result)),
      this.state!.instanceId,
    );
    if (this.stopped) return pending("stopped");
    this.result = result;
    if (immutable(result)) this.source.release();
    if (!immutable(result))
      this.schedule(Math.max(1000, result.retryAfterMs ?? 5000));
    return this.current!;
  }
  private schedule(ms: number): void {
    this.nextAttemptAt =
      Date.now() + ms + Math.floor(Math.random() * Math.max(1, ms / 5));
    this.armRetry();
  }
  private armRetry(): void {
    if (
      this.stopped ||
      (AppState.currentState && AppState.currentState !== "active") ||
      Date.now() - this.started > 600000
    )
      return;
    clearTimeout(this.timer);
    this.timer = setTimeout(
      () => {
        void this.refresh();
      },
      Math.min(2147483647, Math.max(1, this.nextAttemptAt - Date.now())),
    );
  }
  dispose(): void {
    this.stopped = true;
    clearTimeout(this.timer);
    this.listener?.remove();
    this.listener = undefined;
  }
  async drain(): Promise<void> {
    this.dispose();
    await this.inFlight;
  }
  async clear(): Promise<void> {
    await this.drain();
    await this.source.clearState();
    this.state = undefined;
    this.result = undefined;
  }
}
