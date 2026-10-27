## Unreleased

- dispose 取消活动 HTTP 请求，备用地址复用一次 JSON 编码的请求快照；最终归因注销自身监听器，重复 start 不重复订阅。
- UTF-8 字节统计避免逐字符字符串分配；drain 释放内存事件，磁盘事件可由新实例恢复。
- 移除未使用的 @react-navigation/native 可选 peer 声明，导航跟踪仍通过传入的结构化 ref 工作。
- 自动上传可用的设备描述 `equipment`；设备信息不作为唯一标识，不增加依赖或权限。

## 2.0.2 (2026-10-21)

- 安装参数与完整归因响应不再写入本地；最终成功后只保留成功标记及必要的应用、安装身份。
- 重启后返回 already_matched 状态和空参数，不发送安装归因请求，也不重放安装参数回调。
- getInstallData 仅读取本次会话的内存参数，不触发网络；升级时清除旧 response 参数。
- 待定/临时匹配不记为成功；标记写失败继续重试。事件与新深链解析独立工作。

## 2.0.1 (2026-10-21)

- 修复剪贴板启动时暂未就绪被永久跳过、深链解析响应乱序及初始 URL 重复覆盖。
- 事件容量在异步任务入队前限制，增加 UTF-8 字节预算；逐事件持久化、独立网络发送、发送任务合并和按需退避。
- 事件持久化固定 eventId，配合 Go 数据库唯一索引实现重复上报去重。
- 初始化等待覆盖存储阶段；事件恢复不阻塞最终归因；待定查询遵守服务端重试间隔。
- iOS 文件 IO 移到串行后台队列；最终归因释放内存中的凭证快照。
- trackEvent 在本地保存成功后返回，主动等待发送使用 flushEvents；不新增运行时依赖。

## 2.0.0 (2026-10-21)

- 对齐 AppInstall Flutter / Go v2：应用作用域、凭证来源、持久安装状态、最终结果缓存和桌面适配器。
- 删除 v1 路由及客户端管理 API，增加 Android/iOS 原生桥和从零联测脚本。
## <small>1.6.2 (2026-10-19)</small>

* fix(fingerprint): send the device language as language-region (#8) ([7c0569e](https://github.com/HZ-PRE/appinstall-mobile-sdk-react-native/commit/7c0569e)), closes [#8](https://github.com/HZ-PRE/appinstall-mobile-sdk-react-native/issues/8) [en_ES_#u-fw-mon-mu-celsius](https://github.com/en_ES_/issues/u-fw-mon-mu-celsius)

## <small>1.6.1 (2026-09-10)</small>

* fix(deeplink): keep URL parameters on a direct open (#7) ([635a23b](https://github.com/HZ-PRE/appinstall-mobile-sdk-react-native/commit/635a23b)), closes [#7](https://github.com/HZ-PRE/appinstall-mobile-sdk-react-native/issues/7)

## 1.6.0 (2026-06-10)

* feat(sdk): report SDK name + version (SIT-235 · React Native) (#6) ([a4ebc5d](https://github.com/HZ-PRE/appinstall-mobile-sdk-react-native/commit/a4ebc5d)), closes [#6](https://github.com/HZ-PRE/appinstall-mobile-sdk-react-native/issues/6)

## 1.5.0 (2026-06-10)

* feat: autoTrackNavigation + last-click attribution context (SIT-237) (#5) ([c3537bf](https://github.com/HZ-PRE/appinstall-mobile-sdk-react-native/commit/c3537bf)), closes [#5](https://github.com/HZ-PRE/appinstall-mobile-sdk-react-native/issues/5)

## 1.4.0 (2026-05-04)

* ci: drop flaky 'npm install -g npm@latest' self-upgrade step (#4) ([62cbc18](https://github.com/HZ-PRE/appinstall-mobile-sdk-react-native/commit/62cbc18)), closes [#4](https://github.com/HZ-PRE/appinstall-mobile-sdk-react-native/issues/4) [#2](https://github.com/HZ-PRE/appinstall-mobile-sdk-react-native/issues/2)
* Merge pull request #2 from AppInstall/feat/app-token ([b89b060](https://github.com/HZ-PRE/appinstall-mobile-sdk-react-native/commit/b89b060)), closes [#2](https://github.com/HZ-PRE/appinstall-mobile-sdk-react-native/issues/2)
* update packages ([98b32fb](https://github.com/HZ-PRE/appinstall-mobile-sdk-react-native/commit/98b32fb))
* docs: surface appToken in llms.txt and README ([46c277f](https://github.com/HZ-PRE/appinstall-mobile-sdk-react-native/commit/46c277f))
* feat: add appToken config option for Cloud organic-install attribution ([bdb7a13](https://github.com/HZ-PRE/appinstall-mobile-sdk-react-native/commit/bdb7a13)), closes [AppInstall/cloud#76](https://github.com/AppInstall/cloud/issues/76)

## 1.3.0 (2026-03-17)

* ci: add semantic-release with OIDC trusted publishing to npm ([8d634bc](https://github.com/HZ-PRE/appinstall-mobile-sdk-react-native/commit/8d634bc))
* feat: add setExternalUserId for user attribution on shared links ([deed87c](https://github.com/HZ-PRE/appinstall-mobile-sdk-react-native/commit/deed87c))
* feat: add trackRevenue() convenience method for standardized revenue events ([53438c2](https://github.com/HZ-PRE/appinstall-mobile-sdk-react-native/commit/53438c2))

# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.2.0] - 2026-03-03
### Added
- `externalUserId` option in `CreateLinkOptions` — identifies the app user creating the link, enabling per-user deduplication and share attribution
- `deduplicated` boolean in `CreateLinkResult` — indicates when an existing link was returned instead of creating a new one (per-user deduplication)

## [1.1.8] - 2026-02-27
### Changed
- Optimized README and npm package description for LLM discoverability
- Added competitor positioning keywords and cross-SDK references
- Added `firebase-dynamic-links` npm keyword

## [1.1.7] - 2026-02-27
### Fixed
- Corrected GitHub repository, bugs, and homepage URLs in package.json

## [1.1.6] - 2026-02-26
### Added
- `llms.txt` — LLM-optimized integration reference shipped with the published package, enabling AI coding assistants to generate accurate integration code directly from node_modules

## [1.1.5] - 2026-02-13
### Fixed
- Removed accidental self-referencing `file:` dependency in published package that prevented `npm install` from working

## [1.1.3] - 2026-02-12
### Fixed
- Replaced `new URL()` and `URLSearchParams` usage with manual string parsing — `URL.pathname` is not implemented in React Native's Hermes engine, which caused `parseURL()` to crash silently and skip server-side deep link resolution entirely
- Rounded screen dimensions to integers in `FingerprintCollector` — Android's `Dimensions.get('window')` returns floats (e.g. `434.717`) which caused PostgreSQL INSERT errors on INTEGER columns in the install endpoint

## [1.1.2] - 2026-02-12
### Added
- `createLink()` method for creating short links programmatically from mobile apps via the AppInstall API
- `CreateLinkOptions` type — accepts optional `templateId`, `templateSlug`, `deepLinkParameters`, `title`, `description`, `customCode`, and `utmParameters`

## [1.1.1] - 2026-02-12
### Added
- `CreateLinkResult` type — returns `url` (full shareable URL), `shortCode`, and `linkId`
- Exported `CreateLinkOptions` and `CreateLinkResult` types from package entry point
- Simplified link creation: when `templateId` is omitted, the SDK calls `POST /api/sdk/v1/links` which auto-selects the organization's default template — mobile apps no longer need to know template IDs or slugs

## [1.1.0] - 2026-02-11

### Added
- Server-side URL resolution for deep links intercepted by App Links (Android) and Universal Links (iOS) — when the OS opens the app directly, the SDK now calls the resolve endpoint to retrieve custom parameters, UTM data, and link metadata
- Device fingerprint collection sent with resolve requests for click attribution and deferred deep linking analytics
- `deepLinkPath` and `appScheme` optional fields on `DeepLinkData` type
- `ResolveFunction` type export for advanced SDK consumers

### Changed
- `DeepLinkHandler.handleDeepLink` is now async to support server-side URL resolution
- `DeepLinkHandler.initialize` accepts an optional `resolveFn` parameter for URL resolution
- `DeepLinkHandler.parseURL` now correctly extracts the short code from template URLs (e.g., `/templateSlug/shortCode`)
- `AppInstallSDK.onDeepLink` automatically provides a resolver that calls the backend resolve endpoint
- Deferred deep link responses now normalize `deepLinkParameters` from the backend into `customParameters` for a consistent interface across direct and deferred deep link paths

### Fixed
- Fixed deep links returning empty `customParameters` when the app was opened via App Links or Universal Links, where the OS intercepted the URL before the AppInstall server could append parameters via redirect

## [1.0.1] - 2025-12-11

- Initial release
# 2.0.0 — AppInstall Go v2 migration

- Replace the v1 install flow with persisted scoped instances, concurrent evidence collection, bounded foreground retries and immutable final caching.
- Add Android/iOS native IO, Walle APK and Play collection; desktop receipt/launch/clipboard adapters.
- Use compact v2 results, current probability fields, trusted install failover, bounded persistent event queues and isolated Linking listeners.
- Rename the package/API to AppInstall, remove obsolete link-creation/admin APIs, release tooling and outdated examples.
- Preserve source licenses. Native Apple builds require validation on a Mac.
