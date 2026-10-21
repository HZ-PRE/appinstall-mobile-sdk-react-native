# React Native SDK 改造与完整性测试记录

日期：2026-10-21（Asia/Shanghai）

项目：`F:/pro/toinstall/mobile-sdk-react-native`

对齐参考：`F:/pro/toinstall/toinstall-mobile-sdk-flutter` 当前 AppInstall / Go v2 协议。

## 完成内容

- 新包名 `@appinstall/mobile-sdk-react-native`，版本 `2.0.0`；默认实例及 `AppInstallSDK` 类。
- v2 安装状态机：先持久化实例、并发合并、应用作用域隔离、待定重试、前后台生命周期、可信副本故障切换。
- 与 Flutter 一致的 24 小时默认窗口、1500 ms 初始等待、200 ms 首次来源收集预算。
- 不可变最终结果本地长期缓存；待定/重试窗口过期结果不被误缓存为最终状态。
- Android 原生模块：AtomicFile/no-backup、APK Walle 读取、Play Referrer、前台剪贴板、系统时区、UUID。
- iOS 原生模块源代码：原子文件、排除备份、前台剪贴板、系统时区、UUID；APK/Play 明确 unavailable。
- 桌面共用归因协议，支持启动 URI、收据及剪贴板；提供 `createDesktopAdapter` 和宿主 IO 接入示例。
- 完整显示屏物理尺寸、DPR、时区偏移、语言列表、Android 型号/架构、OS/App 版本、采集时间上传。
- 有界持久事件队列（100 条）、v2 事件确认、最后点击上下文、深链解析及可选页面跟踪。
- 删除旧 v1 请求、首次启动标记、无效客户端建链/管理令牌 API、旧诊断返回字段、失效示例及上游发布工具。
- 新增 Go `integration/react_native_test.go`，未修改服务端归因算法或概率门槛。

## 验证结果

| 验证 | 结果 | 边界 |
| --- | --- | --- |
| 从零 npm ci、清理 dist、TypeScript build | 通过 | `node scripts/verify.mjs` |
| SDK 单元/回归测试 | 80 项通过 | 单独运行时 1 项真实 Go 测试跳过，完整流程单独执行 |
| 真实 Go HTTP + 新 PG/Redis | 通过 | 5 种凭证路径 + 1 种概率路径，共 6 次独立安装、6 条事件落库 |
| 重启复用最终缓存 | 通过 | 6 条路径均断言没有新增安装 HTTP 请求 |
| 概率匹配 | 通过 | 无凭证，测试入口模拟同一公网 IP，真实 Go 算法完成匹配；未降低阈值 |
| 落地页 JS 回归 | 52 项通过 | Go 隔离 runner 运行 |
| Go vet、迁移及 PG/Redis 连通 | 通过 | 隔离 runner 运行 |
| Android 原生 clean/release AAR | 通过 | React Native 0.81.5，Gradle 8.14，AGP 8.11.1 |
| Android Lint | 通过 | No issues found |
| 原生 Walle 读取 | 通过 | 官方 CLI 给实际签名 APK 写入凭证，SDK 原生读取器成功读取 |
| APK 签名 | 通过 | apksigner v2 签名校验通过 |
| 自动链接配置 | 通过 | 使用真实 RN CLI 20 配置 schema 校验；验证 Java/podspec 路径 |
| npm 发布包文件检查 | 通过 | 不含测试、构建缓存、备份和旧 SDK 文件 |

测试覆盖磁盘失败、并发初始化、迟到响应、clear/dispose/reinit、回调异常、跨应用状态、
隐藏剪贴板密文、重复 Play token、错误桌面凭证、来源超时、队列容量和断网重试。

真实 Go 联测中的原生系统 IO 使用测试桩；HTTP、PG、Redis、凭证解密、服务端匹配和事件落库均实际执行。
循环地址不应作为概率证据，因此概率用例在测试 HTTP 入口注入相同的模拟公网地址。

尚未执行：iOS/macOS 原生编译、Windows 桌面宿主构建、真机剪贴板权限 UI、Play 商店实际安装。
这些项目受当前 Windows 测试机和宿主环境限制，不能由通过的模拟测试替代。
桌面宿主需按示例接入文件/剪贴板 IO，并注册系统 URL Scheme。

## 交付物

- 本地 npm 包：`test-results/appinstall-mobile-sdk-react-native-2.0.0.tgz`，64,912 字节。
- SHA-256：`6056bfe0064dbb4442b00c295cbeec77fa91504bda2b1e4e4a69dd54789e80f9`。
- Android 原生桥 AAR：`android/build/outputs/aar/sdk-release.aar`，13,802 字节。
- 以上是 SDK 包/桥接库体积，不是宿主 App 最终体积，未声称宿主安装包缩减比例。
- 主日志：`test-results/from-zero.log`。
- 扩展六路径联测：`test-results/go-integration.log`。
- 原生 APK 读取/验签：`test-results/native-apk-reader.log`。
- 原始项目备份：`test-results/before-migration.zip`；旧文档/发布配置备份：`test-results/legacy-docs-and-release.zip`。

运行时 JS 依赖仍只有 AsyncStorage 和 react-native-device-info；桌面示例使用的额外模块由桌面宿主按需提供。
安装 tgz 或本地项目后须重新构建原生 App。服务端、落地页及专属包应统一使用 appinstall 凭证前缀。
