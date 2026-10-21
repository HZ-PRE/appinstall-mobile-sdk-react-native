# AppInstall React Native SDK
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
  appToken: 'SDK 公共 token', // 填写本应用的 SDK token，不得填写平台管理员令牌
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

## 平台设置

### Android

1.  **AndroidManifest.xml**: 为AppLinks(HTTPS)和自定义方案添加意图过滤器。.

```xml
<activity ...>
    <!-- App Links (Standard HTTPS) -->
    <intent-filter android:autoVerify="true">
        <action android:name="android.intent.action.VIEW" />
        <category android:name="android.intent.category.DEFAULT" />
        <category android:name="android.intent.category.BROWSABLE" />
        <data android:scheme="https" android:host="go.yourdomain.com" />
    </intent-filter>

    <!-- Custom Scheme (Optional) -->
    <intent-filter>
        <action android:name="android.intent.action.VIEW" />
        <category android:name="android.intent.category.DEFAULT" />
        <category android:name="android.intent.category.BROWSABLE" />
        <data android:scheme="yourapp" />
    </intent-filter>
</activity>
```

2.  **Asset Links**: 确保您的`.well-known/assetlinks.json`文件托管在您的域名上。.

### iOS

1.  **Universal Links**: Add the Associated Domains capability in Xcode.
    *   `applinks:go.yourdomain.com`
2.  **Custom URL Schemes**: Add your scheme in `Info.plist` under URL Types.
3.  **AASA File**: Ensure your `.well-known/apple-app-site-association` is hosted on your domain.

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
- 可选 `TEST_GO_ALL=1`：在新 PG/Redis 中执行 Go 全套测试；默认执行 SDK 联测和事件去重测试。

脚本重新安装依赖、清理 dist、编译、测试、打包检查、构建原生 release AAR 及 Lint，
再启动全新的本地 PG/Redis 执行真实 Go HTTP 联测。单独 npm test 会跳过需要 Go fixture 的测试；
完整流程会单独执行它。测试不连接生产数据库，不代表真机剪贴板权限或 App Store / Play 安装测试。
