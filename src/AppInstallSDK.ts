import AsyncStorage from "@react-native-async-storage/async-storage";
import { AppState } from "react-native";
import { AttributionContext } from "./AttributionContext";
import { AttributionManager } from "./AttributionManager";
import { DeepLinkHandler } from "./DeepLinkHandler";
import { EventQueue } from "./EventQueue";
import { FingerprintCollector } from "./FingerprintCollector";
import { NavigationTracker } from "./NavigationTracker";
import { Sources, scope64 } from "./Sources";
import { Transport } from "./Transport";
import { configure, immutable } from "./protocol";
import { SDK_NAME, SDK_VERSION } from "./version";
import type {
  AppInstallConfig,
  DeferredDeepLinkCallback,
  DeepLinkCallback,
  InstallAttributionResponse,
  DeepLinkData,
} from "./types";
export class AppInstallSDK {
  private config?: AppInstallConfig;
  private manager?: AttributionManager;
  private transport?: Transport;
  private context = new AttributionContext();
  private events?: EventQueue;
  private links?: DeepLinkHandler;
  private nav?: NavigationTracker;
  private initialization?: Promise<InstallAttributionResponse>;
  private foreground?: { remove(): void };
  private eventTimer?: ReturnType<typeof setInterval>;
  private deferred?: DeferredDeepLinkCallback;
  private direct?: DeepLinkCallback;
  private updated?: (r: InstallAttributionResponse) => void;
  private last?: InstallAttributionResponse;
  private delivered = false;
  private epoch = 0;
  private scope = "";
  private marker = "";
  private stopping = false;
  private draining: Promise<void> = Promise.resolve();
  private directWork: Promise<void> = Promise.resolve();
  private eventsReady = false;

  init(input: AppInstallConfig): Promise<InstallAttributionResponse> {
    if (this.stopping)
      return Promise.reject(new Error("SDK cleanup is in progress"));
    const config = configure(input);
    const scope = scope64(
      JSON.stringify([
        config.baseUrl,
        config.attributionAppId,
        config.appScheme,
      ]),
    );
    if (this.config) {
      if (scope !== this.scope)
        return Promise.reject(
          new Error("Dispose the SDK before changing applications"),
        );
      return this.initialization ?? this.getAttribution();
    }
    this.config = config;
    this.scope = scope;
    this.marker = "@appinstall:marker:" + scope;
    const initEpoch = this.epoch;
    const task = this.initialize(config)
      .catch((e) => {
        if (this.epoch === initEpoch) this.dispose();
        throw e;
      })
      .finally(() => {
        if (this.initialization === task) this.initialization = undefined;
      });
    this.initialization = task;
    return task;
  }
  private async initialize(
    config: AppInstallConfig,
  ): Promise<InstallAttributionResponse> {
    const epoch = this.epoch;
    await this.draining;
    if (epoch !== this.epoch) throw new Error("Initialization cancelled");
    this.last = undefined;
    this.delivered = false;
    this.eventsReady = false;
    const source = new Sources(config, this.scope);
    this.transport = new Transport(config);
    this.context = new AttributionContext({
      debug: false,
      storageKey: "@appinstall:attribution:" + this.scope,
    });
    this.events = new EventQueue(
      "@appinstall:events:" + this.scope,
      this.transport,
    );
    await Promise.all([this.context.load(), this.events.load()]);
    if (epoch !== this.epoch) throw new Error("Initialization cancelled");
    this.manager = new AttributionManager(
      config,
      source,
      this.transport,
      () => FingerprintCollector.collect(),
      async (result, instance) => {
        if (epoch !== this.epoch) return;
        const previous = await AsyncStorage.getItem(this.marker);
        if (previous && previous !== instance) {
          await this.events!.clear();
          this.events = new EventQueue(
            "@appinstall:events:" + this.scope,
            this.transport!,
          );
          await this.context.clear();
        }
        await AsyncStorage.setItem(this.marker, instance);
        if (epoch !== this.epoch) return;
        this.eventsReady = true;
        const changed = JSON.stringify(this.last) !== JSON.stringify(result);
        this.last = result;
        if (immutable(result) && result.attributed) {
          if (!this.context.getActive())
            await this.context.recordDeepLinkOpen(result.deepLinkData?.linkId);
          if (epoch !== this.epoch) return;
          this.deliverDeferred();
        }
        if (changed) {
          try {
            this.updated?.(JSON.parse(JSON.stringify(result)));
          } catch {}
        }
        if (result.installId) void this.events?.flush().catch(() => {});
      },
    );
    this.links = new DeepLinkHandler(config.baseUrl, config.appScheme, (path) =>
      this.transport!.request<DeepLinkData>(path),
    );
    this.links.initialize((url, data) => {
      this.directWork = this.directWork
        .then(() => this.handleDirect(url, data, epoch))
        .catch(() => {});
    });
    this.foreground = AppState.addEventListener("change", (state) => {
      if (this.eventsReady && state === "active")
        void this.events?.flush().catch(() => {});
    });
    this.eventTimer = setInterval(() => {
      if (
        this.eventsReady &&
        (!AppState.currentState || AppState.currentState === "active")
      )
        void this.events?.flush().catch(() => {});
    }, 30000);
    if (config.autoTrackNavigation && config.navigationRef) {
      const options =
        typeof config.autoTrackNavigation === "object"
          ? config.autoTrackNavigation
          : {};
      this.nav = new NavigationTracker(
        config.navigationRef,
        (name, data) => {
          void this.trackEvent(name, data).catch(() => {});
        },
        options,
      );
      this.nav.start();
    }
    return this.manager.start();
  }
  private async handleDirect(
    url: string,
    data: DeepLinkData | null,
    epoch: number,
  ): Promise<void> {
    if (epoch !== this.epoch) return;
    if (data?.linkId) await this.context.recordDeepLinkOpen(data.linkId);
    if (epoch === this.epoch) {
      try {
        this.direct?.(url, data);
      } catch {}
    }
  }
  private deliverDeferred(): void {
    if (
      this.delivered ||
      !this.deferred ||
      !immutable(this.last) ||
      !this.last?.attributed
    )
      return;
    this.delivered = true;
    try {
      this.deferred(JSON.parse(JSON.stringify(this.last.deepLinkData)));
    } catch {}
  }
  onDeferredDeepLink(callback: DeferredDeepLinkCallback): void {
    this.deferred = callback;
    this.deliverDeferred();
  }
  onDeepLink(callback: DeepLinkCallback): void {
    this.direct = callback;
  }
  onAttributionUpdated(
    callback: (result: InstallAttributionResponse) => void,
  ): void {
    this.updated = callback;
    if (this.last) {
      try {
        callback(JSON.parse(JSON.stringify(this.last)));
      } catch {}
    }
  }
  async getAttribution(): Promise<InstallAttributionResponse> {
    if (this.initialization) return this.initialization;
    if (!this.config || !this.manager) throw new Error("Call init first");
    return this.manager.refresh();
  }
  async getInstallData(): Promise<DeepLinkData | null> {
    const result = await this.getAttribution();
    return immutable(result) ? (result.deepLinkData ?? null) : null;
  }
  async getInstallId(): Promise<string | null> {
    return this.last?.installId ?? null;
  }
  getSessionId(): string {
    return this.context.getSessionId();
  }
  getActiveAttribution() {
    return this.context.getActive();
  }
  getQueuedEventCount(): number {
    return this.events?.count ?? 0;
  }
  async trackEvent(
    name: string,
    properties: Record<string, unknown> = {},
  ): Promise<boolean> {
    if (!this.events || this.stopping) throw new Error("Call init first");
    if (!/^[A-Za-z0-9_.:-]{1,100}$/.test(name))
      throw new Error("Invalid event name");
    if (!this.last?.installId) return false;
    const data = JSON.parse(JSON.stringify(properties));
    if (JSON.stringify(data).length > 16384)
      throw new Error("Event data too large");
    const accepted = await this.events.add({
      installId: this.last.installId,
      eventName: name,
      eventData: data,
      timestamp: new Date().toISOString(),
      ...this.context.getStamp(),
      sdkName: SDK_NAME,
      sdkVersion: SDK_VERSION,
    });
    if (accepted) await this.events.flush();
    return accepted;
  }
  trackRevenue(
    amount: number,
    currency: string,
    properties: Record<string, unknown> = {},
  ): Promise<boolean> {
    if (!Number.isFinite(amount) || amount < 0 || !/^[A-Z]{3}$/.test(currency))
      throw new Error("Invalid revenue/currency");
    return this.trackEvent("revenue", {
      ...properties,
      revenue: amount,
      currency,
    });
  }
  async flushEvents(): Promise<void> {
    if (this.eventsReady) await this.events?.flush();
  }
  dispose(): void {
    this.epoch++;
    this.manager?.dispose();
    this.events?.stop();
    this.links?.cleanup();
    this.nav?.stop();
    this.foreground?.remove();
    clearInterval(this.eventTimer);
    this.config = undefined;
    this.draining = Promise.all([
      this.draining,
      this.manager?.drain(),
      this.events?.drain(),
      this.directWork,
    ]).then(() => {});
  }
  async clearData(): Promise<void> {
    this.stopping = true;
    const initialization = this.initialization;
    this.dispose();
    try {
      await initialization?.catch(() => {});
      await this.draining;
      await Promise.all([this.manager?.clear(), this.events?.clear()]);
      await this.context.clear();
      if (this.marker) await AsyncStorage.removeItem(this.marker);
      this.manager = undefined;
      this.events = undefined;
      this.last = undefined;
      this.delivered = false;
      this.deferred = undefined;
      this.direct = undefined;
      this.updated = undefined;
    } finally {
      this.stopping = false;
    }
  }
}
export default new AppInstallSDK();
