import type { AppInstallConfig } from "./types";
import { deadline } from "./protocol";
import { SDK_NAME, SDK_VERSION } from "./version";
export class HttpError extends Error {
  constructor(public readonly status: number) {
    super(`AppInstall HTTP ${status}`);
  }
}
export const retryable = (e: unknown): boolean =>
  !(e instanceof HttpError) ||
  e.status >= 500 ||
  e.status === 408 ||
  e.status === 429;
export class Transport {
  constructor(private readonly config: AppInstallConfig) {}
  async request<T>(path: string, body?: unknown): Promise<T> {
    const install = path === "/api/sdk/v2/install";
    const bases = install
      ? [this.config.baseUrl, ...(this.config.attributionFallbackURLs ?? [])]
      : [this.config.baseUrl];
    for (let i = 0; i < bases.length; i++) {
      const controller = new AbortController();
      try {
        return await deadline(
          (async () => {
            const response = await fetch(bases[i] + path, {
              method: body === undefined ? "GET" : "POST",
              signal: controller.signal,
              headers: {
                "Content-Type": "application/json",
                "X-AppInstall-SDK": `${SDK_NAME}/${SDK_VERSION}`,
                "X-App-Token": this.config.appToken,
              },
              ...(body === undefined ? {} : { body: JSON.stringify(body) }),
            });
            if (!response.ok) throw new HttpError(response.status);
            return (await response.json()) as T;
          })(),
          install ? 2000 : 5000,
        );
      } catch (e) {
        if (i === bases.length - 1 || !retryable(e)) throw e;
      } finally {
        controller.abort();
      }
    }
    throw new Error("No service available");
  }
}
