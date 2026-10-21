import { describe, it, expect } from "vitest";
import { configure, parseResult, immutable } from "../src/protocol";
import {
  parseCredential,
  parseLaunch,
  parseReceipt,
  scope64,
} from "../src/Sources";
import "./__mocks__/native";
export const config = {
  baseUrl: "https://example.com",
  appScheme: "myapp",
  attributionAppId: "app",
  appToken: "public-token",
};
export const finalResult = {
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
export function blank(s: string): string {
  return (
    "\u2063\u2060\u2063\u200b\u2060\u2063\u200b\u2063" +
    Array.from(s, (c) =>
      [6, 4, 2, 0]
        .map(
          (shift) => "\u200b\u200c\u200d\u2060"[(c.charCodeAt(0) >> shift) & 3],
        )
        .join(""),
    ).join("") +
    "\u2063\u200b\u2060\u2063"
  );
}
describe("current protocol", () => {
  it("defaults to one day and validates URLs, schemes and timeouts", () => {
    expect(configure(config).attributionWindowHours).toBe(24);
    for (const input of [
      { baseUrl: "http://example.com" },
      { baseUrl: "https://x@y.com" },
      { appScheme: "javascript" },
      { attributionWindowHours: 0 },
      { initialAttributionTimeoutMs: 50 },
      { attributionFallbackURLs: ["http://localhost"] },
      { desktopReceiptPath: "relative" },
      { appToken: "" },
    ])
      expect(() => configure({ ...config, ...input })).toThrow();
  });
  it("requires current compact result and strips management diagnostics", () => {
    expect(
      parseResult({ ...finalResult, sourceResults: { apk: "complete" } }),
    ).toEqual(finalResult);
    for (const raw of [
      { ...finalResult, isFinal: undefined },
      { ...finalResult, resultVersion: 0 },
      { ...finalResult, attributed: false },
      { ...finalResult, deepLinkData: null },
      { ...finalResult, attributionStatus: "pending" },
    ])
      expect(() => parseResult(raw)).toThrow();
    expect(immutable({ ...finalResult, reason: "retry_window_expired" })).toBe(
      false,
    );
  });
  it("parses app scoped hidden ciphertext without retaining unrelated clipboard", () => {
    const token =
      "c2.key." + "a".repeat(16) + "." + "b".repeat(68) + "." + "c".repeat(22);
    const text = `appinstall:v2:${scope64("app")}:${token}`;
    expect(parseCredential(blank(text), "clipboard", "app")).toEqual({
      source: "clipboard",
      token,
    });
    for (const value of [
      "hello",
      blank(text) + "x",
      text.replace("key", "!"),
      text + "x",
      "x".repeat(9000),
    ])
      expect(parseCredential(value, "clipboard", "app")).toBeNull();
    expect(parseCredential(text, "clipboard", "other")).toBeNull();
    expect(scope64("中文")).toBe(Buffer.from("中文").toString("base64url"));
  });
  it("distinguishes dedicated APK from reusable channel evidence", () => {
    const token = "a".repeat(43);
    expect(
      parseCredential(`appinstall-click:v1:YXBw:${token}`, "apk", "app"),
    ).toEqual({ source: "apk_click", token });
    const linkId = "11111111-1111-4111-8111-111111111111";
    expect(
      parseCredential(
        `appinstall-package:v1:YXBw:${linkId}:${token}`,
        "apk",
        "app",
      ),
    ).toEqual({ source: "apk", token, linkId });
  });
  it("desktop evidence rejects wrong app, duplicate token and malformed receipt", () => {
    const token = "a".repeat(43);
    expect(parseReceipt(`appinstall-desktop:v1:YXBw:${token}`, "app")).toEqual({
      source: "install_file",
      token,
    });
    expect(
      parseLaunch(`myapp://open?lf_app=app&lf_token=${token}`, "app", "myapp"),
    ).toEqual({ source: "launch_uri", token });
    expect(() =>
      parseLaunch(
        `myapp://open?lf_app=app&lf_token=${token}&lf_token=${token}`,
        "app",
        "myapp",
      ),
    ).toThrow();
    expect(() =>
      parseLaunch(
        `myapp://open?lf_app=app&lf_token=${token}%0A`,
        "app",
        "myapp",
      ),
    ).toThrow();
    expect(
      parseCredential(`appinstall-click:v1:YXBw:${token}\n`, "apk", "app"),
    ).toBeNull();
    expect(() =>
      parseReceipt(`appinstall-desktop:v1:YXBw:${token}`, "other"),
    ).toThrow();
    expect(parseLaunch("other://open?lf_token=x", "app", "myapp")).toBeNull();
  });
});
