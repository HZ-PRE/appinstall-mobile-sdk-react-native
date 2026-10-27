import { Dimensions, NativeModules, Platform } from "react-native";
import DeviceInfo from "react-native-device-info";
import { normalizeLanguageTag } from "./languageTag";
import { deadline } from "./protocol";
import type { DeviceFingerprint } from "./types";
export class FingerprintCollector {
  static formatEquipment(parts: string[]): string | undefined {
    const value = [
      ...new Set(
        parts
          .map((p) => p.replace(/[\s\x00-\x1f\x7f]+/g, " ").trim())
          .filter(
            (p) =>
              p &&
              !["unknown", "null", "undefined", "n/a"].includes(
                p.toLowerCase(),
              ),
          ),
      ),
    ].join(" ");
    return value ? Array.from(value).slice(0, 128).join("").trim() : undefined;
  }

  static async collect(): Promise<DeviceFingerprint> {
    const screen = Dimensions.get("screen"),
      ratio = screen.scale;
    const platform = Platform.OS as string;
    const appVersion = DeviceInfo.getVersion(),
      version = DeviceInfo.getSystemVersion();
    let timezone = "";
    try {
      timezone = await deadline(
        Promise.resolve(
          NativeModules.AppInstallAttribution?.getTimezone(),
        ).then((v) => v || Intl.DateTimeFormat().resolvedOptions().timeZone),
        200,
      );
    } catch {
      /* Keep unknown IANA timezone absent. */
    }
    if (!timezone && new Date().getTimezoneOffset() === 0) timezone = "UTC";
    const locales = (
      NativeModules.SettingsManager?.settings?.AppleLanguages ?? [
        NativeModules.I18nManager?.localeIdentifier,
        typeof navigator === "undefined" ? undefined : navigator.language,
      ]
    )
      .map(normalizeLanguageTag)
      .filter((s: unknown) => typeof s === "string") as string[];
    let intlLocale: string | undefined;
    try {
      intlLocale = normalizeLanguageTag(
        Intl.DateTimeFormat().resolvedOptions().locale,
      );
    } catch {}
    if (!locales.length && intlLocale) locales.push(intlLocale);
    const signals: Record<string, unknown> = {
      screenUnit: "physical",
      timezoneOffsetMinutes: new Date().getTimezoneOffset(),
      languages: [...new Set(locales)].slice(0, 10),
      collectedAt: new Date().toISOString(),
    };
    if (Number.isFinite(ratio) && ratio > 0) signals.pixelRatio = ratio;
    if (platform === "android") {
      signals.deviceModel = DeviceInfo.getModel();
      try {
        const abis = await deadline(DeviceInfo.supportedAbis(), 200);
        const families = new Set(
          abis
            .slice(0, 16)
            .map((a) =>
              /^(arm64-v8a|armeabi-v7a|armeabi)$/.test(a)
                ? "arm"
                : /^(x86|x86_64)$/.test(a)
                  ? "x86"
                  : "",
            )
            .filter(Boolean),
        );
        if (families.size === 1) signals.cpuArchitecture = [...families][0];
      } catch {}
    }
    if (
      /^[1-9][0-9]{0,4}(?:\.(?:0|[1-9][0-9]{0,4})){0,3}$/.test(version) &&
      ["android", "macos"].includes(platform)
    )
      signals.osVersion = version;
    let normalizedVersion = version;
    if (platform === "windows") {
      const build = Number(version.split(".")[2]);
      normalizedVersion =
        build >= 22000 ? "11" : build >= 10240 ? "10" : "Unknown";
      if (normalizedVersion !== "Unknown")
        signals.osVersion = normalizedVersion;
    }
    // Use hardware metadata or the Windows OS build; never hostnames or unique IDs.
    let equipment: string | undefined;
    try {
      equipment = this.formatEquipment(
        platform === "android"
          ? [
              DeviceInfo.getBrand(),
              DeviceInfo.getModel(),
              DeviceInfo.getDeviceSync(),
            ]
          : ["ios", "macos"].includes(platform)
            ? ["Apple", DeviceInfo.getModel(), DeviceInfo.getDeviceId()]
            : platform === "windows"
              ? [
                  "Microsoft",
                  "Windows",
                  normalizedVersion,
                  /^(\d+\.\d+\.\d+)(?:\.\d+)?$/.exec(version)?.[1] ?? "",
                ]
              : [platform, normalizedVersion],
      );
    } catch {
      // Optional metadata must not prevent installation attribution.
    }
    return {
      ...(equipment ? { equipment } : {}),
      userAgent: `${DeviceInfo.getApplicationName()}/${appVersion} ${platform}/${normalizedVersion}`,
      platform,
      platformVersion: normalizedVersion,
      appVersion,
      ...(timezone ? { timezone } : {}),
      ...(locales[0] ? { language: locales[0] } : {}),
      ...(screen.width > 0 && screen.height > 0 && ratio > 0
        ? {
            screenWidth: Math.round(screen.width * ratio),
            screenHeight: Math.round(screen.height * ratio),
          }
        : {}),
      signals,
    };
  }
}
