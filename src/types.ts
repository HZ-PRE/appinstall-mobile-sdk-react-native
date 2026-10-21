/** Current Go v2 protocol. Never embed platform administrator credentials. */
export interface AppInstallConfig {
  baseUrl: string;
  appScheme: string;
  attributionAppId: string;
  appToken: string;
  debug?: boolean;
  clipboardAttribution?: boolean;
  attributionWindowHours?: number;
  initialAttributionTimeoutMs?: number;
  attributionFallbackURLs?: string[];
  /** Host-provided identifier after consent; preferred for server installation deduplication. Never collected automatically. */
  deviceId?: string;
  desktopReceiptPath?: string;
  /** Windows/macOS IO; mobile uses the bundled native bridge. */
  desktopAdapter?: DesktopAdapter;
  autoTrackNavigation?: boolean | AutoTrackNavigationOptions;
  navigationRef?: NavigationContainerRefLike;
}
export interface DesktopAdapter {
  readClipboard(): Promise<string | null>;
  /** Read at most 2049 bytes; reject receipts larger than 2048 bytes. */
  readReceipt(
    appId: string,
    scheme: string,
    absolutePath?: string,
  ): Promise<string | null>;
}
export interface AutoTrackNavigationOptions {
  captureParams?: string[];
  debounceMs?: number;
}
export interface NavigationRouteLike {
  name: string;
  params?: Record<string, unknown>;
}
export interface NavigationContainerRefLike {
  addListener(
    type: "state",
    callback: (event?: unknown) => void,
  ): (() => void) | { remove?: () => void } | void;
  getCurrentRoute(): NavigationRouteLike | undefined;
  isReady?: () => boolean;
}
export interface DeviceFingerprint {
  userAgent: string;
  /** Human-readable brand/model/device code; not a unique device identifier. */
  equipment?: string;
  platform: string;
  platformVersion?: string;
  appVersion?: string;
  timezone?: string;
  language?: string;
  screenWidth?: number;
  screenHeight?: number;
  signals: Record<string, unknown>;
}
export interface DeepLinkData {
  shortCode: string;
  linkId?: string;
  deepLinkPath?: string;
  appScheme?: string;
  iosUrl?: string;
  androidUrl?: string;
  webUrl?: string;
  clickedAt?: string;
  customParameters?: Record<string, unknown>;
  utmParameters?: {
    source?: string;
    medium?: string;
    campaign?: string;
    term?: string;
    content?: string;
  };
}
export interface InstallAttributionResponse {
  installId: string;
  attributed: boolean;
  attributionStatus: "pending" | "matched" | "unmatched";
  attributionMethod: string;
  attributionScope: string;
  isFinal: boolean;
  resultVersion: number;
  reason?: string;
  retryAfterMs?: number;
  deepLinkData?: DeepLinkData | null;
}
export interface ActiveAttribution {
  linkId: string;
  clickId?: string;
  openedAt: string;
}
export interface AttributionStamp {
  attributedLinkId?: string;
  attributedClickId?: string;
  linkOpenedAt?: string;
  sessionId: string;
}
export type DeferredDeepLinkCallback = (data: DeepLinkData | null) => void;
export type DeepLinkCallback = (url: string, data: DeepLinkData | null) => void;
export type ResolveFunction = (path: string) => Promise<DeepLinkData | null>;
export type SourceStatus = "pending" | "complete" | "unavailable";
export interface Evidence {
  source: string;
  token: string;
  linkId?: string;
}
export interface SourceEntry {
  status: SourceStatus;
  evidence?: Evidence | null;
  attempts?: number;
}
export interface SourceSnapshot {
  entries: Record<string, SourceEntry>;
  invalidSource?: boolean;
}
export interface CollectedSources {
  sourceStates: Record<string, SourceStatus>;
  evidence: Evidence[];
  invalidSource: boolean;
  sourceSnapshot: SourceSnapshot;
}
export interface NativeBridge {
  readState(scope: string): Promise<string | null>;
  writeState(scope: string, value: string): Promise<void>;
  clearState(scope: string): Promise<void>;
  newInstanceId(): Promise<string>;
  readClipboard(): Promise<string | null>;
  readPackageSource(): Promise<string | null>;
  readReferrer(): Promise<{ status: SourceStatus; referrer?: string }>;
  getTimezone(): Promise<string>;
}
