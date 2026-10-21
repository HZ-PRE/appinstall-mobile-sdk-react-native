# AppInstall React Native SDK

与当前 `appinstall_flutter` / Go 服务对齐的 v2 客户端。包名为
`@appinstall/mobile-sdk-react-native`，本仓库尚未发布到 npm，请使用本地路径或打包后的 tgz。

## 接入

开发基准：React Native 0.81.5、React 19.1、Android API 24+、Java 17+。
Android 使用普通 NativeModule，可通过 React Native 的新架构互操作层加载；iOS 使用 React-Core 桥接，最低 iOS 15.1。
其它 React Native 版本需在宿主验证。本地测试机为 Windows，iOS/macOS 原生构建未验证。

在 App 项目中执行：

```powershell
npm install "F:/pro/toinstall/mobile-sdk-react-native"
```

iOS 另执行 `pod install`。必须重新构建原生 App，热更新 JS 不会安装原生模块。
Expo Go 不包含本模块；使用 development build / prebuild 后构建。

```ts
import AppInstall from '@appinstall/mobile-sdk-react-native';

AppInstall.onDeferredDeepLink(data => {
  console.log('安装传参', data?.customParameters);
});
AppInstall.onAttributionUpdated(result => {
  // pending 只是待定，不代表自然安装；最终结果以 isFinal 判断。
});

const result = await AppInstall.init({
  baseUrl: 'https://your-attribution-service.example',
  appScheme: 'yourapp',
  attributionAppId: '管理后台应用 ID',
  appToken: 'SDK 公共 token', // 不得填写平台管理员令牌
  clipboardAttribution: true, // 按宿主同意流程启用；系统仍可能显示粘贴提示
  attributionWindowHours: 24,
  initialAttributionTimeoutMs: 1500,
});

const data = await AppInstall.getInstallData();
await AppInstall.trackEvent('signup', {channel: 'app'});
```

`init` 超过初始等待时间返回 pending，后台仍会完成已有请求。`getAttribution()`
获取当前结果或触发重试；`getInstallData()` 仅返回已提交最终结果中的安装参数。
最终结果无本地 TTL，同一安装再次获取不请求网络。`retry_window_expired` 不视为不可变最终结果。

## 归因流程

1. 以服务地址、应用 ID、appScheme 隔离安装状态、事件和最后点击上下文。
2. 先生成并持久化安装实例 ID，再请求服务端。Android 状态使用 no-backup 目录及 AtomicFile；
   iOS 使用原子写入并排除备份。写入失败时不会直接上报一个未持久化实例。
3. Android 并行读取剪贴板、Walle 包内凭证和 Google Play Install Referrer。
   首次只等待采集 200 ms，慢来源保持 pending，后续补齐；Play 最多尝试三次。
4. iOS 收集剪贴板及概率匹配参数，APK / Play 标记 unavailable。不会伪造不可用来源。
5. 上传 `/api/sdk/v2/install`，匹配优先级、阈值、降级与凭证冲突由 Go 服务决定。
   SDK 不解密剪贴板、不持有密钥，仅接受本应用格式正确的密文。无关剪贴板不持久化或上传。
6. 按服务端建议重试，单次启动自动重试窗口 10 分钟，后台暂停定时重试，回前台可继续。
   永久 HTTP 配置错误不自动轮询。可配置最多两个同一部署的可信 HTTPS 副本，只有安装请求故障切换。
7. 最终结果先写盘再交给 App；最终状态移除凭证和指纹快照。应用卸载/显式清理开始新实例。

概率信号包含平台、版本、App 版本、完整显示屏物理尺寸、DPR、时区、时区偏移、语言列表、
Android 型号/ABI 家族及采集时间。不会自动采集广告 ID、设备永久 ID；可在同意后显式传入 `deviceId`。
匹配无法保证 100%，没有有效证据时可能保持 pending 或最终 unmatched。

## 事件、深链与生命周期

- 事件使用 `/api/sdk/v2/event`，最多持久化 100 条，失败保留，回前台和每 30 秒前台定时重试。
  `trackEvent` 返回是否成功进入队列，不代表已送达；`getQueuedEventCount()` 可查看剩余数。
  尚无服务端 installId 时返回 false。网络响应丢失可能导致重复事件，接口不承诺 exactly-once。
- `onDeepLink` 自动接收 Linking 初始链接及后续事件。仅接受配置的服务地址或 appScheme，
  通过 `/api/sdk/v2/resolve/:shortCode` 补全数据，失败则保留本地参数。凭证字段不会混入业务参数。
- 支持 `autoTrackNavigation` + `navigationRef`，页面参数默认不采集，可显式指定 allow-list。
- `dispose()` 停止本 SDK 的监听和重试，保留磁盘状态；再次 init 会等待旧请求收尾。
  `clearData()` 还会等待正在进行的请求后清理本作用域状态，供测试或显式重置使用。
- 多应用可分别创建 `new AppInstallSDK()`；同一个对象切换应用前先 dispose。

## Windows / macOS

共享 v2 状态机、概率信号、最终缓存，支持 `launch_uri`、加密剪贴板和 `install_file`。
React Native 桌面宿主通过 `createDesktopAdapter` 绑定自己使用的文件系统和剪贴板模块，
具体示例见 `examples/DesktopAdapter.ts`。手机接入不需要这些桌面依赖。

Windows 基础安装器对应的默认路径为：

```text
%LOCALAPPDATA%/AppInstall/Install/<sha256(appId + NUL + appScheme)>/install.receipt
```

必须使用下载/安装用户的实际 LOCALAPPDATA，不能用管理员或系统服务账户的目录。
macOS 默认读取 `<宿主 Application Support>/appinstall/<appScheme>/install.receipt`。
可通过 `desktopReceiptPath` 指定与安装器一致的绝对路径，读取限制 2048 字节。
无适配器时文件/剪贴板来源 unavailable，仍可使用启动 URI 和概率匹配。
桌面持久化依赖宿主 AsyncStorage，不保证卸载时一定删除桌面用户数据目录。

## 与原 SDK 的差异

- 仅保留 Go v2 安装、事件和解析接口，删除旧 v1 首次启动标记和诊断字段。
- `AppInstallConfig.attributionWindowHours` 默认 24 小时，不再使用旧的按天参数。
- 删除客户端创建短链接及管理端授权功能：当前服务端每个应用只有一个后台管理的链接，短标识由后台生成。
- 新凭证前缀为 `appinstall`，无旧 `appinstall` 协议兼容。与 Go、落地页 JS、专属包同步更新。
- 去除上游自动发布配置、semantic-release 工具依赖和失效示例。保留 MIT / Walle 版权许可证。
- 未增加运行时 JS 依赖，仍仅依赖 AsyncStorage 和 react-native-device-info；
  Android 额外原生依赖只有实际使用的 Install Referrer。

## 测试

```powershell
npm ci --ignore-scripts --legacy-peer-deps
npm run build
npm test
```

完整从零验证使用 `node scripts/verify.mjs`，须设置：

- `TEST_GO_DIRECTORY`：Go 项目目录。
- `EMBEDDED_PG_TOOLS`、`REDIS_TEST_BIN`：Go 隔离数据库测试所需工具。
- `ANDROID_GRADLE_WRAPPER`：可用的 Gradle 8.14 wrapper 脚本绝对路径。
- `JAVA_HOME`、`ANDROID_HOME`：本地 JDK 和 Android SDK。

脚本重新安装依赖、清理 dist、编译、测试、打包检查、构建原生 release AAR 及 Lint，
再启动全新的本地 PG/Redis 执行真实 Go HTTP 联测。单独 npm test 会跳过需要 Go fixture 的测试；
完整流程会单独执行它。测试不连接生产数据库，不代表真机剪贴板权限或 App Store / Play 安装测试。
