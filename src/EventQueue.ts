import AsyncStorage from "@react-native-async-storage/async-storage";
import { Transport, HttpError, retryable } from "./Transport";

const MAX_EVENTS = 100;
const MAX_BYTES = 1024 * 1024;
export function utf8Bytes(value: string): number {
  let bytes = 0;
  for (const char of value) {
    const code = char.codePointAt(0)!;
    bytes += code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4;
  }
  return bytes;
}
function eventId(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = Math.floor(Math.random() * 16);
    return (c === "x" ? r : (r & 3) | 8).toString(16);
  });
}
interface Entry {
  slot: number;
  order: number;
  event: Record<string, unknown>;
  bytes: number;
  ready: boolean;
}
export class EventQueue {
  private entries: Entry[] = [];
  private bytes = 0;
  private order = 0;
  private serial: Promise<unknown> = Promise.resolve();
  private sending?: Promise<void>;
  private stopped = false;
  constructor(
    private readonly key: string,
    private readonly transport: Transport,
  ) {}
  private slotKey(slot: number): string {
    return this.key + ":slot:" + slot;
  }
  async load(installId?: string): Promise<void> {
    if (this.stopped) return;
    // Loading occurs before accepting producers; a failed restore can safely be retried.
    this.entries = [];
    this.bytes = 0;
    this.order = 0;
    const rows = await AsyncStorage.multiGet(
      Array.from({ length: MAX_EVENTS }, (_, i) => this.slotKey(i)),
    );
    if (this.stopped) return;
    for (let slot = 0; slot < rows.length; slot++) {
      const raw = rows[slot][1];
      if (!raw) continue;
      try {
        if (raw.length > 65536) throw new Error("Oversized event");
        const { order, event } = JSON.parse(raw);
        const bytes = utf8Bytes(raw);
        if (
          !Number.isSafeInteger(order) ||
          typeof event?.eventId !== "string" ||
          typeof event.eventName !== "string" ||
          typeof event.timestamp !== "string" ||
          (installId !== undefined && event.installId !== installId) ||
          bytes > 65536 ||
          this.bytes + bytes > MAX_BYTES
        )
          throw new Error("Invalid event");
        this.entries.push({ slot, order, event, bytes, ready: true });
        this.bytes += bytes;
        this.order = Math.max(this.order, order);
      } catch {
        await AsyncStorage.removeItem(this.slotKey(slot));
      }
    }
    this.entries.sort((a, b) => a.order - b.order);
    // Resume interrupted upgrades without losing or duplicating persisted events.
    const previous = await AsyncStorage.getItem(this.key);
    if (this.stopped) return;
    if (previous) {
      if (previous.length <= MAX_BYTES) {
        let events: unknown;
        try {
          events = JSON.parse(previous);
        } catch {}
        if (Array.isArray(events)) {
          const existing = new Set(this.entries.map((e) => e.event.eventId));
          const valid = events
            .slice(0, MAX_EVENTS)
            .filter(
              (e) =>
                e &&
                typeof e.eventName === "string" &&
                typeof e.timestamp === "string",
            );
          const scoped = valid.filter(
            (e) => installId === undefined || e.installId === installId,
          );
          for (const event of scoped)
            if (!event.eventId) event.eventId = eventId();
          await AsyncStorage.setItem(this.key, JSON.stringify(scoped));
          for (const event of scoped) {
            if (this.stopped) return;
            if (!existing.has(event.eventId)) await this.add(event);
          }
        }
      }
      if (!this.stopped) await AsyncStorage.removeItem(this.key);
    }
  }
  private enqueue<T>(work: () => Promise<T>): Promise<T> {
    const next = this.serial.then(work);
    this.serial = next.catch(() => {});
    return next;
  }
  get count(): number {
    return this.entries.length;
  }
  add(value: Record<string, unknown>): Promise<boolean> {
    // Reserve before any asynchronous work so queued writes are also bounded.
    if (this.stopped || this.entries.length >= MAX_EVENTS)
      return Promise.resolve(false);
    const order = ++this.order;
    const raw = JSON.stringify({
      order,
      event: { ...value, eventId: value.eventId ?? eventId() },
    });
    const bytes = utf8Bytes(raw);
    if (bytes > 65536 || this.bytes + bytes > MAX_BYTES)
      return Promise.resolve(false);
    const occupied = new Set(this.entries.map((e) => e.slot));
    let slot = 0;
    while (occupied.has(slot)) slot++;
    const entry: Entry = {
      slot,
      order,
      event: JSON.parse(raw).event,
      bytes,
      ready: false,
    };
    this.entries.push(entry);
    this.bytes += bytes;
    return this.enqueue(async () => {
      try {
        await AsyncStorage.setItem(this.slotKey(slot), raw);
        entry.ready = true;
        return true;
      } catch (error) {
        this.remove(entry);
        throw error;
      }
    });
  }
  private remove(entry: Entry): void {
    const index = this.entries.indexOf(entry);
    if (index >= 0) {
      this.entries.splice(index, 1);
      this.bytes -= entry.bytes;
    }
  }
  flush(): Promise<void> {
    if (this.sending) return this.sending;
    this.sending = this.send().finally(() => {
      this.sending = undefined;
    });
    return this.sending;
  }
  private async send(): Promise<void> {
    while (!this.stopped && this.entries.length) {
      await this.serial;
      const entry = this.entries[0];
      if (this.stopped || !entry?.ready) return;
      try {
        const result = await this.transport.request<{ acknowledged: boolean }>(
          "/api/sdk/v2/event",
          entry.event,
        );
        if (result.acknowledged !== true)
          throw new Error("Invalid event acknowledgement");
      } catch (e) {
        // Configuration/proxy errors must not discard business events.
        if (
          retryable(e) ||
          !(e instanceof HttpError) ||
          ![400, 413, 422].includes(e.status)
        )
          return;
      }
      if (this.stopped) return;
      await this.enqueue(async () => {
        await AsyncStorage.removeItem(this.slotKey(entry.slot));
        this.remove(entry);
      });
    }
  }
  stop(): void {
    this.stopped = true;
  }
  async drain(): Promise<void> {
    this.stop();
    await this.sending?.catch(() => {});
    await this.serial;
  }
  async clear(): Promise<void> {
    await this.drain();
    await AsyncStorage.multiRemove([
      this.key,
      ...Array.from({ length: MAX_EVENTS }, (_, i) => this.slotKey(i)),
    ]);
    this.entries = [];
    this.bytes = 0;
  }
}
