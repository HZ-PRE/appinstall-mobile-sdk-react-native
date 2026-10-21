# 安装参数不落盘：两套 SDK 修改与从零验证

日期：2026-10-21

- Flutter SDK：0.2.4，F:/pro/toinstall/toinstall-mobile-sdk-flutter
- React Native SDK：2.0.2，F:/pro/toinstall/mobile-sdk-react-native

## 当前行为

1. 首次最终匹配成功，服务端参数正常交给当前会话的返回值和业务回调；参数仅在进程内存中存在。
2. SDK 不保存完整安装归因响应和 deepLinkData。Flutter 已删除安装参数存储层的保存、读取、JSON 编解码实现；RN 删除 state.response 的写入和重放逻辑。
3. 成功后只持久化 matched=true 及应用隔离、安装身份字段。installId 仍用于独立的事件上报，installInstanceId 用于安装幂等。
4. 重启读取成功标记后不采集凭证、不请求 /api/sdk/v2/install、不重放安装参数回调。getInstallData() 返回 null，也不触发 HTTP。
5. 本地返回状态：attributed=true、attributionStatus=matched、isFinal=true、reason=already_matched、deepLinkData=null。未保留的算法和范围用 none，结果版本用 0；这是本地状态，不伪造服务端匹配详情。
6. 待定/临时匹配不标记成功；待定安装的身份、请求信号和凭证仍保留用于重试，但任何阶段都不将服务端安装参数写入磁盘。
7. 最终未匹配记录 matched=false，不阻止下次启动重新查询。成功标记写入失败仍可重试，不能误记为已成功。
8. 升级读取旧 response 时仅提取成功与安装 ID 并删除旧参数；Flutter 旧 SharedPreferences 参数键也会清理。这些剩余的旧键/response 引用只用于删除历史数据，不用于继续读取或保存参数。
9. clearData() 删除成功标记；重新初始化后可再次归因。
10. 事件队列和新深链解析独立工作；“成功后不请求”指安装归因接口，不禁用业务主动上报事件或解析新链接。

## 从干净构建状态执行

| 检查 | 结果 |
| --- | --- |
| Flutter clean、pub get、生成 JSON / mocks | 通过 |
| Flutter analyze | No issues found |
| Flutter 全量离线测试 | 178 通过；2 个真实服务用例条件跳过 |
| Flutter 在新 PG/Redis 的全量测试 | 180 全部通过 |
| Flutter Android 插件 clean、assembleDebug、lintDebug | 通过 |
| RN TypeScript clean、npm ci、build、typecheck | 通过 |
| RN 全量单元测试 | 101 通过；1 个真实服务用例条件跳过 |
| RN 真实 Go/PG/Redis 联测 | 1 通过，涵盖剪贴板、APK、Play、Windows、macOS 和概率匹配 |
| RN Android 插件 clean、assembleRelease、lintRelease | 通过 |
| RN npm pack --dry-run | 通过 |
| Go TestFlutterEndToEnd / TestReactNativeEndToEnd / TestEventIdempotency | 全部通过 |
| 同次隔离环境的 sdk.js 测试 | 52 全部通过 |
| go vet、PG 迁移、Redis 连通检查 | 通过 |
| 两项目 git diff --check | 通过 |

测试覆盖首次参数交付、重启空参数且零安装请求、重复 getter 不发请求、成功不重放安装回调、待定参数不落盘、旧缓存清理、安装标记写失败重试、未匹配重启查询、应用隔离、clearData 重置、事件丢失响应后的幂等重试。

本次 Go 联测创建了全新的本地 PostgreSQL 数据目录和 Redis 实例，结束后已停止。未连接生产数据库，未修改服务端归因接口，未发布或部署。

当前为 Windows 环境。Android 构建已验证；iOS/macOS Xcode 原生构建、真实设备运行未验证。桌面与移动端凭证联测验证的是 SDK 协议及真实 Go 服务。这次没有重新运行所有服务端业务功能测试。

## 日志

Flutter 项目：
- status-only-clean.log
- status-only-pub-get.log
- status-only-codegen-final.log
- status-only-analyze.log
- status-only-unit-final.log
- status-only-android.log

RN 项目：
- test-results/status-only-clean-install.log
- test-results/status-only-build.log
- test-results/status-only-typecheck-final.log
- test-results/status-only-unit-final.log
- test-results/status-only-pack.log
- test-results/status-only-android.log

Go 联测：
F:/pro/go/appInstalltool/sdk-status-only-e2e.log
