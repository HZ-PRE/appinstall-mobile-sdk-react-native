/** AppInstall React Native SDK — current Go v2 attribution protocol. */
export { default, AppInstallSDK } from "./AppInstallSDK";
export { NavigationTracker, sanitizeScreenParams } from "./NavigationTracker";
export { createDesktopAdapter } from "./desktop";
export type { DesktopIO } from "./desktop";
export type {
  AppInstallConfig,
  DesktopAdapter,
  DeviceFingerprint,
  DeepLinkData,
  InstallAttributionResponse,
  ActiveAttribution,
  AttributionStamp,
  AutoTrackNavigationOptions,
  NavigationRouteLike,
  NavigationContainerRefLike,
  DeferredDeepLinkCallback,
  DeepLinkCallback,
} from "./types";
export type {
  ScreenEventEmitter,
  NavigationTrackerOptions,
} from "./NavigationTracker";
