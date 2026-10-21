import AsyncStorage from "@react-native-async-storage/async-storage";
import { AppState } from "react-native";
import { AttributionContext } from "./AttributionContext";
import { AttributionManager } from "./AttributionManager";
import { DeepLinkHandler } from "./DeepLinkHandler";
import { EventQueue, utf8Bytes } from "./EventQueue";
import { FingerprintCollector } from "./FingerprintCollector";
import { NavigationTracker } from "./NavigationTracker";
import { Sources, scope64 } from "./Sources";
import { Transport } from "./Transport";
import { configure, immutable, deadline, pending } from "./protocol";
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
  private eventTimer?: ReturnType<typeof setTimeout>;
  private eventPreparation?: Promise<void>;
  private eventRecovery?: () => Promise<void>;
  private eventSending?: Promise<void>;
  private eventRetryMs = 1000;
  private eventReservations = 0;
  private eventReservedBytes = 0;
  private directSeen = false;
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
      return this.initialization
        ? this.boundedInitialization(
            this.initialization,
            config.initialAttributionTimeoutMs!,
          )
        : this.getAttribution();
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
    return this.boundedInitialization(
      task,
      config.initialAttributionTimeoutMs!,
    );
  }
  private async boundedInitialization(
    task: Promise<InstallAttributionResponse>,
    ms: number,
  ): Promise<InstallAttributionResponse> {
    // Convert task failures to values so only the deadline becomes a pending result.
    const outcome = await deadline(
      task.then(
        (value) => ({ value }),
        (error) => ({ error }),
      ),
      ms,
    ).catch(() => ({
      value: this.last
        ? (JSON.parse(JSON.stringify(this.last)) as InstallAttributionResponse)
        : pending("initial_response_pending"),
    }));
    if ("error" in outcome) throw outcome.error;
    return outcome.value;
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
    this.directSeen = false;
    this.eventRetryMs = 1000;
    this.eventSending = undefined;
    this.eventPreparation = undefined;
    this.eventRecovery = undefined;
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
    const [, previous] = await Promise.all([
      this.context.load(),
      AsyncStorage.getItem(this.marker),
    ]);
    if (epoch !== this.epoch) throw new Error("Initialization cancelled");
    let validatedInstance: string | undefined;
    this.manager = new AttributionManager(
      config,
      source,
      this.transport,
      () => FingerprintCollector.collect(),
      async (result, instance) => {
        if (epoch !== this.epoch) return;
        if (validatedInstance !== instance) {
          if (previous && previous !== instance && !this.directSeen)
            await this.context.clear();
          if (previous !== instance)
            await AsyncStorage.setItem(this.marker, instance);
          if (epoch !== this.epoch) return;
          validatedInstance = instance;
          const events = this.events!;
          // Event recovery must not delay delivery of the durable install result.
          this.eventRecovery = async () => {
            if (previous && previous !== instance) {
              await events.clear();
              if (epoch !== this.epoch) return;
              this.events = new EventQueue(
                "@appinstall:events:" + this.scope,
                this.transport!,
              );
            } else await events.load(result.installId);
            if (epoch !== this.epoch) return;
            this.eventsReady = true;
            this.triggerEvents();
          };
          void this.prepareEvents().catch(() => {});
        }
        if (epoch !== this.epoch) return;
        const changed = JSON.stringify(this.last) !== JSON.stringify(result);
        this.last = result;
        if (immutable(result) && result.attributed && result.deepLinkData) {
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
        if (result.installId) this.triggerEvents();
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
      if (state === "active") this.triggerEvents();
      else {
        clearTimeout(this.eventTimer);
        this.eventTimer = undefined;
      }
    });
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
    if (data?.linkId) {
      this.directSeen = true;
      await this.context.recordDeepLinkOpen(data.linkId);
    }
    if (epoch === this.epoch) {
      try {
        this.direct?.(url, data);
      } catch {}
    }
  }
  private deliverDeferred(): void {
    if (
      !this.config ||
      this.delivered ||
      !this.deferred ||
      !immutable(this.last) ||
      !this.last?.attributed ||
      !this.last.deepLinkData
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
    if (this.initialization)
      return this.boundedInitialization(
        this.initialization,
        this.config?.initialAttributionTimeoutMs ?? 1500,
      );
    if (!this.config || !this.manager) throw new Error("Call init first");
    return this.manager.refresh();
  }
  async getInstallData(): Promise<DeepLinkData | null> {
    // Memory only: this getter never starts an attribution request.
    if (!this.config) return null;
    const result = this.last;
    return immutable(result) && result?.deepLinkData
      ? JSON.parse(JSON.stringify(result.deepLinkData))
      : null;
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
    if (this.eventReservations >= 100) return false;
    const serialized = JSON.stringify(properties);
    const bytes = utf8Bytes(serialized);
    if (bytes > 16384) throw new Error("Event data too large");
    if (this.eventReservedBytes + bytes > 1024 * 1024) return false;
    this.eventReservations++;
    this.eventReservedBytes += bytes;
    try {
      const data = JSON.parse(serialized);
      const epoch = this.epoch;
      const event = {
        installId: this.last.installId,
        eventName: name,
        eventData: data,
        timestamp: new Date().toISOString(),
        ...this.context.getStamp(),
        sdkName: SDK_NAME,
        sdkVersion: SDK_VERSION,
      };
      await this.prepareEvents();
      if (epoch !== this.epoch || !this.eventsReady) return false;
      const accepted = await this.events.add(event);
      if (accepted) this.triggerEvents();
      return accepted;
    } finally {
      this.eventReservations--;
      this.eventReservedBytes -= bytes;
    }
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
    await this.prepareEvents();
    if (this.eventsReady) await this.sendEvents();
  }
  private triggerEvents(): void {
    if (
      !this.eventsReady ||
      !this.config ||
      !this.last?.installId ||
      !this.events?.count ||
      (AppState.currentState && AppState.currentState !== "active") ||
      this.eventTimer
    )
      return;
    void this.sendEvents().catch(() => {});
  }
  private prepareEvents(): Promise<void> {
    if (this.eventPreparation) return this.eventPreparation;
    if (!this.config || !this.eventRecovery) return Promise.resolve();
    const task = this.eventRecovery().catch((error) => {
      if (this.eventPreparation === task) this.eventPreparation = undefined;
      throw error;
    });
    this.eventPreparation = task;
    return task;
  }
  private sendEvents(): Promise<void> {
    if (this.eventSending) return this.eventSending;
    clearTimeout(this.eventTimer);
    this.eventTimer = undefined;
    const epoch = this.epoch;
    this.eventSending = this.events!.flush().finally(() => {
      if (epoch !== this.epoch) return;
      this.eventSending = undefined;
      if (
        this.events?.count &&
        this.config &&
        (!AppState.currentState || AppState.currentState === "active")
      ) {
        this.eventTimer = setTimeout(() => {
          this.eventTimer = undefined;
          this.triggerEvents();
        }, this.eventRetryMs);
        this.eventRetryMs = Math.min(60000, this.eventRetryMs * 2);
      } else this.eventRetryMs = 1000;
    });
    return this.eventSending;
  }
  dispose(): void {
    this.epoch++;
    this.manager?.dispose();
    this.events?.stop();
    this.links?.cleanup();
    this.nav?.stop();
    this.foreground?.remove();
    clearTimeout(this.eventTimer);
    this.eventTimer = undefined;
    this.config = undefined;
    this.draining = Promise.all([
      this.draining,
      this.manager?.drain(),
      this.events?.drain(),
      this.eventPreparation?.catch(() => {}),
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
