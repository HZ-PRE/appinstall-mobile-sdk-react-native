The three classes in `com.appinstall.internal.walle` are adapted from Meituan-Dianping/Walle,
commit `f78edcf1117a0aa858a3d04bb24d86bf9ad51bb2`, `payload_reader/src/main/java/com/meituan/android/walle/`.

Copyright 2017 Meituan-Dianping. Licensed under Apache-2.0 (WALLE-LICENSE.txt).
Changes: internal package namespace to avoid collisions with host dependencies;
removed exception printing so malformed credentials cannot appear in logs.
Removed unused writer constants and the unused signing-block offset/Pair wrapper;
used standard UTF-8 and try-with-resources for the reader. Signing-block parsing
and bounds checks are retained.

Only the reader is included. Package generation uses the official Walle CLI;
Android apksigner must verify the input and output. Walle's old Maven artifact
is unavailable from Maven Central, so the small reader is pinned in source.
