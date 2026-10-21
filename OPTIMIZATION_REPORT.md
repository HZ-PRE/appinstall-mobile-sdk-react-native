后续变更：安装参数持久化已取消，当前行为与验证见 [STATUS_ONLY_REPORT.md](STATUS_ONLY_REPORT.md)。以下为之前版本的优化记录。

# React Native SDK 2.0.1 优化验收记录

日期：2026-10-21（Asia/Shanghai）

## 完成内容

- 剪贴板区分暂未前台就绪、超时与永久失败。暂时失败保持 pending，后续最多尝试三次；拒绝和不支持不重复读取。不会绕过系统授权。
- 深链按接收序号提交结果，旧响应不覆盖新链接；合并一秒内相同 URL，迟到的 initialURL 不覆盖实时链接。
- 初始化预算覆盖存储阶段，超时返回 pending 后继续初始化；事件恢复不阻塞归因最终结果。安装标记每次初始化只校验一次。
- 待定查询遵守 retryAfterMs 和错误退避，并发请求继续合并；最终结果先持久化再返回。
- 事件在异步写入前预占容量：100 条、序列化内容 1 MiB，业务参数 16 KiB UTF-8。字节预算不等于进程总内存上限。
- 网络发送独立于持久化，合并 flush；逐事件固定槽位存储，避免重写整个数组。恢复时校验安装实例；退出过程中保留旧格式持久事件。
- trackEvent 本地保存成功后返回，不等待 HTTP；flushEvents 主动等待发送过程。事件时间和归因上下文在调用时固定。
- 有积压才启动前台退避定时器（1 秒至 60 秒），空队列无定时器。401/403 等配置错误保留事件，400/413/422 无效事件丢弃。
- 固定持久化 eventId，Go 按 install_id/client_event_id 唯一索引去重。重复请求返回同一确认，不覆盖原数据或重复创建 Webhook 任务。
- iOS 文件 IO 移到串行后台队列，UI/剪贴板保留主线程，读取前检查状态文件大小。最终归因释放凭证快照，公开上下文返回副本。
- 未增加运行时依赖，未调整概率门槛或凭证安全规则。

## 验证结果

| 项目 | 结果 |
| --- | --- |
| 从零 npm ci、清理 dist、TypeScript、npm 包检查 | 通过；最后修改后再次 build 和打包 |
| SDK 单元/回归 | 96 项通过；依赖 Go fixture 的 1 项在下面独立执行 |
| 新 PG/Redis 中 Go 全套测试 | 139 项顶层测试通过，5 项条件性跳过；不含子测试 |
| RN + 真实 Go HTTP/PG/Redis | 剪贴板、APK、Play、Windows、macOS、概率共 6 条路径通过 |
| 事件响应丢失 | 每条路径保存后丢弃首次响应，由 SDK 重发；最终只落库 6 条事件 |
| 并发去重 | 20 个重复请求只产生 1 条事件和 1 个 sdk_event Webhook 任务 |
| 重启最终缓存 | 六条路径均无新增安装 HTTP 请求 |
| 落地页 JS | 52 项通过 |
| Go vet、幂等迁移、PG/Redis 连通 | 通过 |
| Android clean / release / lint | 通过，Lint: No issues found |
| Git whitespace 检查 | 通过 |

队列另覆盖：首个 HTTP 阻塞时并发提交 1000 次，只接收剩余 99 条，且仍可落盘恢复。
100 条、每条约 1 KiB 的事件仅进行 100 次单项写入，确认阶段不重写剩余队列。未进行真机 P95/RSS 压测，不宣称具体提升百分比。

修复了复验中发现的旧测试问题：
- Node 密文向量仍使用改名前 AAD；用 tools/generate-clipboard-reference.mjs 独立生成当前协议向量。
- Webhook 旧请求头和 Windows 旧收据目录断言改为当前 AppInstall 名称。
- 去重专项用例在 Windows PG 冷启动建连时偶发超时；改用 4 个预热连接、测试专用等待预算及 15 秒上下文。生产默认配置未变。

日志位于 test-results：
- optimization-from-zero.log：初次干净构建、Android 和 SDK 联测通过。
- optimization-final.log：扩展干净构建；其中 Go 专项用例首次因测试建连超时失败，保留诊断记录。
- optimization-build.log / optimization-unit-final.log：最后版本编译和 96 项 SDK 测试通过。
- optimization-go-final.log：修正后全新 PG/Redis 的 Go 全套、RN 实际 HTTP 重试去重、52 项 JS 测试、vet 和迁移通过，退出码 0。
- optimization-pack.log：最终 npm 包生成。

## 边界

Go 本轮跳过管理端浏览器、Flutter、真实 APK worker、旧 Node portable、Go 到旧 Node 密文互操作测试，原因是未提供相应外部测试配置。
当前为 Windows 环境：iOS 原生编译、macOS/Windows RN 宿主编译、真机剪贴板权限、Play 商店实际安装未执行。
iOS 源码已修改，不能据此声称 Xcode 构建通过。

Go 的既有 .gitignore 忽略 integration/；新增和修正的测试已在本地保存执行，后续提交时需一并纳入。

## 交付及升级

- SDK：@appinstall/mobile-sdk-react-native 2.0.1。
- 本地包：test-results/appinstall-mobile-sdk-react-native-2.0.1.tgz，71,359 字节。
- SHA-256：5695ce1001e162d1c488abfd85640862025cc22b101bc89e47be873ba2c432ea。
- Go 修改位于 F:/pro/go/appInstalltool，新增 in_app_events.client_event_id 和唯一索引。
- 同步更新服务端并运行 appinstalltool -config config.yaml migrate，事件去重才生效。
- 安装新 SDK 后重新构建宿主 App；未发布 npm、未部署生产、未访问生产数据库。
