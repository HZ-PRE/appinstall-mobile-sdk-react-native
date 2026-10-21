import AsyncStorage from "@react-native-async-storage/async-storage";
import { Transport, retryable } from "./Transport";
export class EventQueue {
  private events: Record<string, unknown>[] = [];
  private serial: Promise<unknown> = Promise.resolve();
  private stopped = false;
  constructor(
    private readonly key: string,
    private readonly transport: Transport,
  ) {}
  async load(): Promise<void> {
    const raw = await AsyncStorage.getItem(this.key);
    if (raw) {
      try {
        const values = JSON.parse(raw);
        if (Array.isArray(values))
          this.events = values
            .filter(
              (v) =>
                v &&
                typeof v.eventName === "string" &&
                typeof v.timestamp === "string",
            )
            .slice(0, 100);
      } catch {
        this.events = [];
      }
    }
  }
  private enqueue<T>(work: () => Promise<T>): Promise<T> {
    const next = this.serial.then(work);
    this.serial = next.catch(() => {});
    return next;
  }
  get count(): number {
    return this.events.length;
  }
  add(event: Record<string, unknown>): Promise<boolean> {
    return this.enqueue(async () => {
      if (this.stopped || this.events.length >= 100) return false;
      this.events.push(event);
      try {
        await this.save();
      } catch (e) {
        this.events.pop();
        throw e;
      }
      return true;
    });
  }
  flush(): Promise<void> {
    return this.enqueue(async () => {
      while (!this.stopped && this.events.length) {
        try {
          const result = await this.transport.request<{
            acknowledged: boolean;
          }>("/api/sdk/v2/event", this.events[0]);
          if (result.acknowledged !== true)
            throw new Error("Invalid event acknowledgement");
        } catch (e) {
          if (retryable(e))
            return; /* A permanent invalid event must not block the queue. */
        }
        if (this.stopped) return;
        this.events.shift();
        await this.save();
      }
    });
  }
  private save(): Promise<void> {
    return AsyncStorage.setItem(this.key, JSON.stringify(this.events));
  }
  stop(): void {
    this.stopped = true;
  }
  async drain(): Promise<void> {
    this.stop();
    await this.serial;
  }
  async clear(): Promise<void> {
    await this.drain();
    this.events = [];
    await AsyncStorage.removeItem(this.key);
  }
}
