import { readFileSync } from "node:fs";
import { it, expect, vi } from "vitest";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { native, rn } from "./__mocks__/native";
import { AppInstallSDK } from "../src/AppInstallSDK";
import type { AppInstallConfig } from "../src/types";

it.skipIf(!process.env.APPINSTALL_RN_FIXTURE)(
  "fresh Go/PG/Redis: five credential paths, probability, events and restart caching",
  async () => {
    const f = JSON.parse(
      readFileSync(process.env.APPINSTALL_RN_FIXTURE!, "utf8"),
    );
    const config: AppInstallConfig = {
      baseUrl: f.baseUrl,
      appScheme: f.appScheme,
      attributionAppId: f.attributionAppId,
      appToken: f.appToken,
      deviceId: "consented-rn-id",
      clipboardAttribution: true,
      initialAttributionTimeoutMs: 10000,
    };
    const realFetch = globalThis.fetch;
    const request = vi.fn(realFetch);
    vi.stubGlobal("fetch", request);
    try {
      for (const mode of ["clipboard", "apk", "play", "windows", "macos", "probability"]) {
        await AsyncStorage.clear();
        native.states.clear();
        rn.Platform.OS = ["windows", "macos"].includes(mode) ? mode : "android";
        native.readClipboard.mockResolvedValue(
          mode === "clipboard" ? f.clipboard : null,
        );
        native.readPackageSource.mockResolvedValue(
          mode === "apk" ? f.apk : null,
        );
        native.readReferrer.mockResolvedValue(
          mode === "play"
            ? ({ status: "complete", referrer: f.play } as never)
            : { status: "unavailable" },
        );
        const c = {
          ...config,
          ...(["windows", "macos"].includes(mode)
            ? {
                desktopAdapter: {
                  readClipboard: async () => null,
                  readReceipt: async () => f[mode],
                },
              }
            : {}),
        };
        let sdk = new AppInstallSDK();
        try {
          const first = await sdk.init(c);
          expect(first.attributed, mode).toBe(true);
          expect(first.isFinal, mode).toBe(true);
          if (mode === 'probability') expect(first.attributionScope).toBe('probabilistic');
          if (!["windows", "macos"].includes(mode))
            expect(first.deepLinkData?.customParameters?.inviter).toBe(
              "rn-" + mode,
            );
          const calls = request.mock.calls.length;
          sdk.dispose();
          sdk = new AppInstallSDK();
          const cached = await sdk.init(c);
          expect(cached).toEqual(first);
          expect(request.mock.calls.length).toBe(calls);
          expect(await sdk.trackEvent("rn_e2e", { source: mode })).toBe(true);
          expect(sdk.getQueuedEventCount()).toBe(0);
          await sdk.clearData();
        } finally {
          sdk.dispose();
        }
      }
    } finally {
      vi.unstubAllGlobals();
    }
  },
  60000,
);
