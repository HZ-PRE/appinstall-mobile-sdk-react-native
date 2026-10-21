import type { DesktopAdapter } from "./types";
/** Bind the desktop host's existing filesystem/clipboard modules; mobile bundles need neither. */
export interface DesktopIO {
  platform: "windows" | "macos";
  readClipboard(): Promise<string | null>;
  exists(path: string): Promise<boolean>;
  read(
    path: string,
    length: number,
    position: number,
    encoding: "utf8",
  ): Promise<string>;
  stat(path: string): Promise<{ size: number | string }>;
  /** Lowercase SHA-256 hex over the UTF-8 input. This is a filename, not a credential. */
  sha256(text: string): string;
  /** Actual LOCALAPPDATA of the installing user; for Windows bootstrap receipts. */
  localAppData?: string;
  /** The host application's support directory, same location used by its installer. */
  applicationSupportDirectory: string;
}
export function createDesktopAdapter(io: DesktopIO): DesktopAdapter {
  return {
    readClipboard: () => io.readClipboard(),
    async readReceipt(appId, scheme, override) {
      let path = override;
      if (!path && io.platform === "windows" && io.localAppData) {
        const hash = io.sha256(appId + "\0" + scheme);
        if (!/^[a-f0-9]{64}$/.test(hash))
          throw new Error("Invalid desktop scope hash");
        const candidate =
          io.localAppData.replace(/[\\/]$/, "") +
          "/AppInstall/Install/" +
          hash +
          "/install.receipt";
        if (await io.exists(candidate)) path = candidate;
      }
      path ??=
        io.applicationSupportDirectory.replace(/[\\/]$/, "") +
        "/appinstall/" +
        scheme +
        "/install.receipt";
      if (!(await io.exists(path))) return null;
      if (Number((await io.stat(path)).size) > 2048)
        throw new SyntaxError("Oversized receipt");
      const text = await io.read(path, 2049, 0, "utf8");
      if (text.length > 2048) throw new SyntaxError("Oversized receipt");
      return text.trim();
    },
  };
}
