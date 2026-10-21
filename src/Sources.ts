import { AppState, Linking, NativeModules, Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
const scopeLocks = new Map<string, Promise<unknown>>();
/** Serialize read/create in one JS runtime; the server deduplicates all exchanges by instance ID. */
export async function withScopeLock<T>(
  scope: string,
  work: () => Promise<T>,
): Promise<T> {
  const previous = scopeLocks.get(scope) ?? Promise.resolve();
  const next = previous.catch(() => {}).then(work);
  scopeLocks.set(scope, next);
  try {
    return await next;
  } finally {
    if (scopeLocks.get(scope) === next) scopeLocks.delete(scope);
  }
}
import { deadline } from "./protocol";
import type {
  AppInstallConfig,
  CollectedSources,
  Evidence,
  NativeBridge,
  SourceSnapshot,
  SourceStatus,
} from "./types";

export function scope64(value: string): string {
  const bytes = Array.from(unescape(encodeURIComponent(value)), (c) =>
    c.charCodeAt(0),
  );
  const alphabet =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  let bits = 0,
    count = 0,
    out = "";
  for (const byte of bytes) {
    bits = (bits << 8) | byte;
    count += 8;
    while (count >= 6) {
      count -= 6;
      out += alphabet[(bits >>> count) & 63];
    }
  }
  if (count) out += alphabet[(bits << (6 - count)) & 63];
  return out;
}
const token = {
  test: (value: string) =>
    value?.length === 43 && /^[A-Za-z0-9_-]+$/.test(value),
};
const blankPrefix = "\u2063\u2060\u2063\u200b\u2060\u2063\u200b\u2063",
  blankSuffix = "\u2063\u200b\u2060\u2063",
  alphabet = "\u200b\u200c\u200d\u2060";
export function parseCredential(
  raw: string | null,
  source: string,
  appId: string,
): Evidence | null {
  if (!raw || raw.length > 8192) return null;
  if (source === "clipboard" && raw.startsWith(blankPrefix)) {
    if (!raw.endsWith(blankSuffix)) return null;
    const body = raw.slice(blankPrefix.length, -blankSuffix.length);
    if (!body.length || body.length > 7200 || body.length % 4) return null;
    let text = "";
    for (let i = 0; i < body.length; i += 4) {
      let code = 0;
      for (let j = 0; j < 4; j++) {
        const v = alphabet.indexOf(body[i + j]);
        if (v < 0) return null;
        code = (code << 2) | v;
      }
      if (code < 32 || code > 126) return null;
      text += String.fromCharCode(code);
    }
    raw = text;
  }
  if (raw.length > 2048) return null;
  if (/[\r\n]/.test(raw)) return null;
  const p = raw.split(":");
  const click = source === "apk" && p[0] === "appinstall-click",
    channel = source === "apk" && !click;
  if (
    p.length !== (channel ? 5 : 4) ||
    p[0] !==
      (channel
        ? "appinstall-package"
        : click
          ? "appinstall-click"
          : "appinstall") ||
    p[1] !== (source === "clipboard" ? "v2" : "v1") ||
    p[2] !== scope64(appId)
  )
    return null;
  const value = p[p.length - 1];
  if (source === "clipboard")
    return /^c2\.[A-Za-z0-9_-]{1,32}\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{68}\.[A-Za-z0-9_-]{22}$/.test(
      value,
    )
      ? { source, token: value }
      : null;
  if (
    !token.test(value) ||
    (channel && !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(p[3]))
  )
    return null;
  return {
    source: click ? "apk_click" : source,
    token: value,
    ...(channel ? { linkId: p[3] } : {}),
  };
}
export function queryValues(query: string, key: string): string[] {
  return query.split("&").flatMap((part) => {
    const pos = part.indexOf("=");
    const name = pos < 0 ? part : part.slice(0, pos);
    return decodeURIComponent(name.replace(/\+/g, " ")) === key
      ? [
          decodeURIComponent(
            (pos < 0 ? "" : part.slice(pos + 1)).replace(/\+/g, " "),
          ),
        ]
      : [];
  });
}
export function parseReceipt(
  raw: string | null,
  appId: string,
): Evidence | null {
  if (raw == null) return null;
  const p = raw.trim().split(":");
  if (
    raw.length > 2048 ||
    p.length !== 4 ||
    p[0] !== "appinstall-desktop" ||
    p[1] !== "v1" ||
    p[2] !== scope64(appId) ||
    !token.test(p[3])
  )
    throw new SyntaxError("Invalid receipt");
  return { source: "install_file", token: p[3] };
}
export function parseLaunch(
  raw: string | null,
  appId: string,
  scheme: string,
): Evidence | null {
  if (!raw || raw.split(":")[0] !== scheme) return null;
  if (raw.length > 8192 || /^[^:]+:\/\/[^/?#]*@/.test(raw))
    throw new SyntaxError("Invalid launch URI");
  const query = raw.split("?")[1]?.split("#")[0] ?? "";
  const tokens = queryValues(query, "lf_token"),
    apps = queryValues(query, "lf_app");
  if (!tokens.length) return null;
  if (
    tokens.length !== 1 ||
    apps.length !== 1 ||
    apps[0] !== appId ||
    !token.test(tokens[0])
  )
    throw new SyntaxError("Invalid launch evidence");
  return { source: "launch_uri", token: tokens[0] };
}
export class Sources {
  private snapshot: SourceSnapshot = { entries: {} };
  private jobs = new Map<string, Promise<void>>();
  private generation = 0;
  readonly desktop =
    Platform.OS === "windows" || (Platform.OS as string) === "macos";
  readonly native: NativeBridge | undefined =
    NativeModules.AppInstallAttribution;
  readonly key: string;
  constructor(
    readonly config: AppInstallConfig,
    readonly scope: string,
  ) {
    this.key = "@appinstall:state:" + scope;
    if (!this.desktop && !this.native)
      throw new Error(
        "AppInstallAttribution native bridge missing: rebuild the host app",
      );
  }
  readState(): Promise<string | null> {
    return this.desktop
      ? AsyncStorage.getItem(this.key)
      : this.native!.readState(this.scope);
  }
  writeState(value: string): Promise<void> {
    return this.desktop
      ? AsyncStorage.setItem(this.key, value)
      : this.native!.writeState(this.scope, value);
  }
  async clearState(): Promise<void> {
    this.release();
    if (this.desktop) await AsyncStorage.removeItem(this.key);
    else await this.native!.clearState(this.scope);
  }
  release(): void {
    this.generation++;
    this.jobs.clear();
    this.snapshot = { entries: {} };
  }
  async newId(): Promise<string> {
    if (!this.desktop) return this.native!.newInstanceId();
    // Install instance is an idempotency identifier, never an authentication secret.
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
      const r = Math.floor(Math.random() * 16);
      return (c === "x" ? r : (r & 3) | 8).toString(16);
    });
  }
  restore(snapshot?: SourceSnapshot): void {
    if (snapshot?.entries) this.snapshot = JSON.parse(JSON.stringify(snapshot));
  }
  async collect(): Promise<CollectedSources> {
    const keys = this.desktop
      ? ["clipboard", "launch_uri", "install_file"]
      : ["clipboard", "apk", "play_referrer"];
    if (AppState.currentState && AppState.currentState !== "active")
      return {
        sourceStates: Object.fromEntries(
          keys.map((k) => [k, "pending" as const]),
        ),
        evidence: [],
        invalidSource: false,
        sourceSnapshot: this.snapshot,
      };
    const gen = this.generation,
      jobs: Promise<void>[] = [];
    const collect = (
      key: string,
      read: () => Promise<Evidence | null>,
      ms = 1000,
    ) => {
      if (
        this.snapshot.entries[key] &&
        this.snapshot.entries[key].status !== "pending"
      )
        return;
      this.snapshot.entries[key] = {
        ...this.snapshot.entries[key],
        status: "pending",
      };
      let job = this.jobs.get(key);
      if (!job) {
        const attempts = (this.snapshot.entries[key]?.attempts ?? 0) + 1;
        job = (async () => {
          try {
            const evidence = await deadline(read(), ms);
            if (gen === this.generation)
              this.snapshot.entries[key] = {
                status: "complete",
                evidence,
                attempts,
              };
          } catch (e) {
            if (gen === this.generation) {
              // Only retry explicitly transient failures. Never retry permission denial.
              const code = (e as { code?: string })?.code;
              const transient =
                code === "BACKGROUND" ||
                code === "NOT_READY" ||
                code === "TIMEOUT" ||
                (e instanceof Error && e.message === "Operation timed out");
              this.snapshot.entries[key] = {
                status:
                  e instanceof SyntaxError
                    ? "complete"
                    : transient && attempts < 3
                      ? "pending"
                      : "unavailable",
                attempts,
              };
              if (e instanceof SyntaxError) this.snapshot.invalidSource = true;
            }
          }
        })().finally(() => {
          if (gen === this.generation) this.jobs.delete(key);
        });
        this.jobs.set(key, job);
      }
      jobs.push(job);
    };
    if (this.config.clipboardAttribution)
      collect("clipboard", async () =>
        parseCredential(
          await (this.desktop
            ? this.config.desktopAdapter!.readClipboard()
            : this.native!.readClipboard()),
          "clipboard",
          this.config.attributionAppId,
        ),
      );
    if (this.desktop) {
      collect("launch_uri", async () =>
        parseLaunch(
          await Linking.getInitialURL(),
          this.config.attributionAppId,
          this.config.appScheme,
        ),
      );
      collect("install_file", async () =>
        parseReceipt(
          await this.config.desktopAdapter!.readReceipt(
            this.config.attributionAppId,
            this.config.appScheme,
            this.config.desktopReceiptPath,
          ),
          this.config.attributionAppId,
        ),
      );
    } else {
      if (Platform.OS === "android")
        collect("apk", async () =>
          parseCredential(
            await this.native!.readPackageSource(),
            "apk",
            this.config.attributionAppId,
          ),
        );
      else this.snapshot.entries.apk = { status: "unavailable" };
      const previous = this.snapshot.entries.play_referrer;
      if (!previous || previous.status === "pending") {
        let job = this.jobs.get("play_referrer");
        if (!job) {
          const attempts = (previous?.attempts ?? 0) + 1;
          this.snapshot.entries.play_referrer = { status: "pending", attempts };
          job = (async () => {
            let status: SourceStatus = "pending",
              evidence: Evidence | null = null,
              invalid = false;
            try {
              const result = await deadline(this.native!.readReferrer(), 6000);
              status = ["complete", "unavailable"].includes(result.status)
                ? result.status
                : "pending";
              if (status === "complete" && result.referrer) {
                const values = queryValues(result.referrer, "lf_token");
                if (values.length === 1 && token.test(values[0]))
                  evidence = { source: "play_referrer", token: values[0] };
                else if (values.length) invalid = true;
              }
            } catch (e) {
              if (e instanceof URIError) invalid = true;
            }
            if (gen === this.generation) {
              this.snapshot.entries.play_referrer = {
                status:
                  status === "pending" && attempts >= 3
                    ? "unavailable"
                    : status,
                attempts,
                evidence,
              };
              this.snapshot.invalidSource ||= invalid;
            }
          })().finally(() => {
            if (gen === this.generation) this.jobs.delete("play_referrer");
          });
          this.jobs.set("play_referrer", job);
        }
        jobs.push(job);
      }
    }
    await deadline(Promise.all(jobs), 200).catch(() => {});
    const sourceStates = Object.fromEntries(
      keys.map((k) => [k, this.snapshot.entries[k]?.status ?? "unavailable"]),
    ) as Record<string, SourceStatus>;
    return {
      sourceStates,
      evidence: keys.flatMap((k) =>
        this.snapshot.entries[k]?.evidence
          ? [this.snapshot.entries[k].evidence!]
          : [],
      ),
      invalidSource: this.snapshot.invalidSource === true,
      sourceSnapshot: JSON.parse(JSON.stringify(this.snapshot)),
    };
  }
}
