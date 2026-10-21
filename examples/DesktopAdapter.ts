// Optional desktop-only example. Install compatible versions of these modules
// in the desktop HOST, not in Android/iOS consumers of the SDK.
import * as FS from "@dr.pogodin/react-native-fs";
import Clipboard from "@react-native-clipboard/clipboard";
import { sha256 } from "@noble/hashes/sha256"; // @noble/hashes 1.x
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils";
import { createDesktopAdapter } from "@appinstall/mobile-sdk-react-native";

export function desktopAdapter(
  platform: "windows" | "macos",
  supportDirectory: string,
  localAppData?: string,
) {
  return createDesktopAdapter({
    platform,
    localAppData,
    applicationSupportDirectory: supportDirectory,
    readClipboard: () => Clipboard.getString(),
    exists: (path) => FS.exists(path),
    stat: (path) => FS.stat(path),
    read: (path, length, position, encoding) =>
      FS.read(path, length, position, encoding),
    sha256: (text) => bytesToHex(sha256(utf8ToBytes(text))),
  });
}
// Pass the adapter as init({..., desktopAdapter: desktopAdapter(...)}).
// Also register the appScheme with the OS and forward URLs to React Native Linking.
