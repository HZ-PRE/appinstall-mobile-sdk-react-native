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
  private closed = false;
  private readonly active = new Set<AbortController>();
  constructor(private readonly config: AppInstallConfig) {}
  close(): void {
    this.closed = true;
    for (const controller of this.active) controller.abort();
    this.active.clear();
  }
  async request<T>(path: string, body?: unknown): Promise<T> {
    if (this.closed) throw new Error("Transport is closed");
    const encoded = body === undefined ? undefined : JSON.stringify(body);
    const install = path === "/api/sdk/v2/install";
    const bases = install
      ? [this.config.baseUrl, ...(this.config.attributionFallbackURLs ?? [])]
      : [this.config.baseUrl];
    for (let i = 0; i < bases.length; i++) {
      if (this.closed) throw new Error("Transport is closed");
      const controller = new AbortController();
      this.active.add(controller);
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
              ...(encoded === undefined ? {} : { body: encoded }),
            });
            if (!response.ok) throw new HttpError(response.status);
            return (await response.json()) as T;
          })(),
          install ? 2000 : 5000,
        );
      } catch (e) {
        if (i === bases.length - 1 || !retryable(e)) throw e;
      } finally {
        this.active.delete(controller);
        controller.abort();
      }
    }
    throw new Error("No service available");
  }
}
