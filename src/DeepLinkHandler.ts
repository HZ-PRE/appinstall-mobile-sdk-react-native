import { Linking } from "react-native";
import { extractCustomParameters, mergeUrlParameters } from "./urlParameters";
import type { DeepLinkCallback, DeepLinkData, ResolveFunction } from "./types";
/** Owns only its listener; disposing never removes the host's Linking listeners. */
export class DeepLinkHandler {
  private subscription?: { remove(): void };
  private generation = 0;
  private sequence = 0;
  private recent?: { url: string; at: number };
  private callback?: DeepLinkCallback;
  constructor(
    private readonly baseUrl: string,
    private readonly scheme: string,
    private readonly resolve: ResolveFunction,
  ) {}
  initialize(callback: DeepLinkCallback): void {
    this.cleanup();
    this.callback = callback;
    const gen = this.generation;
    const initialSequence = this.sequence;
    this.subscription = Linking.addEventListener("url", ({ url }) => {
      void this.handle(url);
    });
    void Linking.getInitialURL()
      .then((url) => {
        if (url && gen === this.generation && initialSequence === this.sequence)
          void this.handle(url);
      })
      .catch(() => {});
  }
  cleanup(): void {
    this.generation++;
    this.recent = undefined;
    this.subscription?.remove();
    this.subscription = undefined;
    this.callback = undefined;
  }
  parseURL(url: string): DeepLinkData | null {
    if (url.length > 8192) return null;
    const m = /^([a-z][a-z0-9+.-]*):\/\/([^/?#]*)([^?#]*)(?:\?([^#]*))?/i.exec(
      url,
    );
    if (!m || m[2].includes("@")) return null;
    const base = /^(https?):\/\/([^/]+)(.*)$/i.exec(this.baseUrl)!;
    const isWeb =
      m[1].toLowerCase() === base[1].toLowerCase() &&
      m[2].toLowerCase() === base[2].toLowerCase() &&
      (m[3] === base[3] || m[3].startsWith(base[3] + "/"));
    if (!isWeb && m[1].toLowerCase() !== this.scheme) return null;
    try {
      const params = new Map<string, string>();
      for (const p of (m[4] ?? "").split("&")) {
        if (!p) continue;
        const i = p.indexOf("=");
        params.set(
          decodeURIComponent((i < 0 ? p : p.slice(0, i)).replace(/\+/g, " ")),
          decodeURIComponent((i < 0 ? "" : p.slice(i + 1)).replace(/\+/g, " ")),
        );
      }
      const shortCode =
        params.get("shortCode") ??
        m[3].split("/").filter(Boolean).pop() ??
        (!isWeb ? m[2] : "");
      if (!shortCode || !/^[A-Za-z0-9_-]{1,128}$/.test(shortCode)) return null;
      return {
        shortCode,
        customParameters: extractCustomParameters(params.entries()),
        utmParameters: {
          source: params.get("utm_source"),
          medium: params.get("utm_medium"),
          campaign: params.get("utm_campaign"),
          term: params.get("utm_term"),
          content: params.get("utm_content"),
        },
        ...(!isWeb ? { appScheme: this.scheme } : {}),
      };
    } catch {
      return null;
    }
  }
  async handle(url: string): Promise<void> {
    const local = this.parseURL(url),
      gen = this.generation;
    if (!local) return;
    if (this.recent?.url === url && Date.now() - this.recent.at < 1000) return;
    this.recent = { url, at: Date.now() };
    const sequence = ++this.sequence;
    let data = local;
    try {
      const resolved = await this.resolve(
        "/api/sdk/v2/resolve/" + encodeURIComponent(local.shortCode),
      );
      if (resolved)
        data = mergeUrlParameters(
          resolved,
          local.customParameters as Record<string, string>,
        );
    } catch {}
    if (gen === this.generation && sequence === this.sequence) {
      try {
        this.callback?.(url, data);
      } catch {
        /* Host callback failures never become network failures. */
      }
    }
  }
}
