import { vi } from "vitest";
const native = vi.hoisted(() => {
  const states = new Map<string, string>();
  return {
    states,
    readState: vi.fn(async (scope: string) => states.get(scope) ?? null),
    writeState: vi.fn(async (scope: string, value: string) => {
      states.set(scope, value);
    }),
    clearState: vi.fn(async (scope: string) => {
      states.delete(scope);
    }),
    newInstanceId: vi.fn(async () => crypto.randomUUID()),
    readClipboard: vi.fn(async (): Promise<string | null> => null),
    readPackageSource: vi.fn(async (): Promise<string | null> => null),
    readReferrer: vi.fn(async () => ({ status: "unavailable" })),
    getTimezone: vi.fn(async () => "Asia/Shanghai"),
  };
});
const rn = vi.hoisted(() => ({
  Platform: { OS: "android" },
  AppState: {
    currentState: "active",
    addEventListener: vi.fn(() => ({ remove: vi.fn() })),
  },
  Linking: {
    getInitialURL: vi.fn(async (): Promise<string | null> => null),
    addEventListener: vi.fn(() => ({ remove: vi.fn() })),
  },
  Dimensions: {
    get: vi.fn(() => ({ width: 360, height: 800, scale: 3, fontScale: 1 })),
  },
}));
vi.mock("react-native", () => ({
  ...rn,
  NativeModules: {
    AppInstallAttribution: native,
    I18nManager: { localeIdentifier: "zh_CN" },
  },
}));
vi.mock("react-native-device-info", () => ({
  default: {
    getVersion: () => "1.0",
    getSystemVersion: () =>
      rn.Platform.OS === "windows"
        ? "10.0.22621"
        : rn.Platform.OS === "macos"
          ? "15.0"
          : "14",
    getModel: () => "Pixel 8",
    getBrand: () => "Google",
    getDeviceSync: () => "shiba",
    getDeviceId: () => "Mac14,7",
    getApplicationName: () => "AppInstallTest",
    supportedAbis: async () => ["arm64-v8a", "armeabi-v7a"],
  },
}));
export { native, rn };
