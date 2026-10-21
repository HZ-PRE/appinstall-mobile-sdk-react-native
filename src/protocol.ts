import type { AppInstallConfig, InstallAttributionResponse } from "./types";
export function serverURL(value: string, localAllowed = true): string {
  if (
    typeof value !== "string" ||
    value.length > 2048 ||
    value.trim() !== value
  )
    throw new Error("Invalid service URL");
  const m =
    /^(https?):\/\/(\[[0-9a-f:]+\]|[a-z0-9.-]+)(:\d{1,5})?(\/[a-z0-9_./~-]*)?$/i.exec(
      value,
    );
  if (
    !m ||
    (m[1].toLowerCase() !== "https" &&
      !(
        localAllowed &&
        ["localhost", "127.0.0.1", "[::1]", "10.0.2.2"].includes(
          m[2].toLowerCase(),
        )
      ))
  )
    throw new Error("Use HTTPS (HTTP only for local tests)");
  if (m[3] && (+m[3].slice(1) < 1 || +m[3].slice(1) > 65535))
    throw new Error("Invalid port");
  return `${m[1].toLowerCase()}://${m[2].toLowerCase()}${m[3] ?? ""}${m[4] ?? ""}`.replace(
    /\/+$/,
    "",
  );
}
export function configure(c: AppInstallConfig): AppInstallConfig {
  const scheme = c.appScheme?.trim().toLowerCase();
  if (
    !scheme ||
    scheme.length > 255 ||
    !/^[a-z][a-z0-9+.-]*$/.test(scheme) ||
    [
      "http",
      "https",
      "javascript",
      "data",
      "vbscript",
      "file",
      "blob",
      "about",
    ].includes(scheme)
  )
    throw new Error("Invalid appScheme");
  if (
    !c.attributionAppId?.trim() ||
    c.attributionAppId.length > 255 ||
    !c.appToken?.trim()
  )
    throw new Error("Application ID and SDK public token are required");
  const hours = c.attributionWindowHours ?? 24,
    timeout = c.initialAttributionTimeoutMs ?? 1500;
  if (!Number.isInteger(hours) || hours < 1 || hours > 2160)
    throw new Error("Invalid attributionWindowHours");
  if (!Number.isInteger(timeout) || timeout < 100 || timeout > 10000)
    throw new Error("Invalid initialAttributionTimeoutMs");
  const fallbacks = c.attributionFallbackURLs ?? [];
  if (fallbacks.length > 2)
    throw new Error("At most two trusted replicas are supported");
  if (
    c.desktopReceiptPath &&
    (c.desktopReceiptPath.length > 4096 ||
      !/^(?:[a-z]:[\\/]|\/|\\\\)/i.test(c.desktopReceiptPath))
  )
    throw new Error("Receipt path must be absolute");
  return {
    ...c,
    baseUrl: serverURL(c.baseUrl),
    appScheme: scheme,
    attributionWindowHours: hours,
    initialAttributionTimeoutMs: timeout,
    attributionFallbackURLs: fallbacks.map((u) => serverURL(u, false)),
  };
}
export function immutable(r?: InstallAttributionResponse): boolean {
  return (
    !!r?.isFinal &&
    !!r.installId &&
    r.reason !== "retry_window_expired" &&
    ((r.attributionStatus === "matched" && r.attributed && !!r.deepLinkData) ||
      (r.attributionStatus === "unmatched" && !r.attributed))
  );
}
export function parseResult(raw: unknown): InstallAttributionResponse {
  const r = raw as InstallAttributionResponse;
  if (
    !r ||
    typeof r.installId !== "string" ||
    !r.installId ||
    typeof r.attributed !== "boolean" ||
    typeof r.isFinal !== "boolean" ||
    !Number.isInteger(r.resultVersion) ||
    r.resultVersion < 1 ||
    !["pending", "matched", "unmatched"].includes(r.attributionStatus) ||
    typeof r.attributionMethod !== "string" ||
    typeof r.attributionScope !== "string" ||
    r.attributed !== (r.attributionStatus === "matched") ||
    (r.attributionStatus === "pending" && r.isFinal) ||
    (r.attributed &&
      (!r.deepLinkData ||
        typeof r.deepLinkData !== "object" ||
        typeof r.deepLinkData.shortCode !== "string")) ||
    (!r.attributed && r.deepLinkData != null)
  )
    throw new Error("Invalid current install response");
  return {
    installId: r.installId,
    attributed: r.attributed,
    attributionStatus: r.attributionStatus,
    attributionMethod: r.attributionMethod,
    attributionScope: r.attributionScope,
    isFinal: r.isFinal,
    resultVersion: r.resultVersion,
    deepLinkData: r.deepLinkData ?? null,
    ...(typeof r.reason === "string" ? { reason: r.reason } : {}),
    ...(typeof r.retryAfterMs === "number" && Number.isFinite(r.retryAfterMs)
      ? { retryAfterMs: r.retryAfterMs }
      : {}),
  };
}
export function pending(
  reason: string,
  installId = "",
): InstallAttributionResponse {
  return {
    installId,
    attributed: false,
    attributionStatus: "pending",
    attributionMethod: "none",
    attributionScope: "none",
    isFinal: false,
    resultVersion: 0,
    reason,
    retryAfterMs: 5000,
  };
}
export async function deadline<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Operation timed out")), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
