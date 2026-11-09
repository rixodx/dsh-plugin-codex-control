# Harness Control Bridge / Harness 控制桥接

Local CLI bridge into the **running DeepSeek Harness desktop/Web Host**. Create or continue ordinary GUI conversations, inspect progress, wait for output, and cancel tasks from Codex or a terminal.

让 Codex 或终端向正在运行的 DeepSeek Harness 桌面/Web Host 提交任务，在同一个 GUI 会话中查看消息、结果和运行状态。插件不启动独立 headless runtime。

## 安装

需要 Node.js **24.9+**。兼容范围目前限定为真实桌面验证过的 **Harness 0.2.2-rc.1**；其他版本尚未验证。

在 DSH Desktop 的插件管理器中安装下列 GitHub Release 包，或在插件被市场收录后搜索 `dsh-plugin-codex-control`：

```text
https://github.com/rixodx/dsh-plugin-codex-control/releases/download/v1.0.2/dsh-plugin-codex-control-1.0.2.tgz
```

普通 Web profile 使用：

```sh
dsh plugin --profile web add https://github.com/rixodx/dsh-plugin-codex-control/releases/download/v1.0.2/dsh-plugin-codex-control-1.0.2.tgz
```

自定义 profile 将 `web` 换成宿主实际使用的名称。桌面端请使用应用自身的插件管理器，避免误装到另一个 Web profile。插件无构建脚本，无第三方运行依赖。热加载关闭时需正常重启宿主。

也支持源码安装：`dsh plugin --profile web add github:rixodx/dsh-plugin-codex-control`。

## CLI / 命令行

Host 必须保持运行。把 Release 包解压到任意本地目录，在包含 `cli.mjs` 的目录运行：

```sh
node cli.mjs ping
node cli.mjs plugin-status
node cli.mjs workspaces
node cli.mjs list
node cli.mjs create --cwd /absolute/workspace/path "桥接测试"
node cli.mjs prompt SESSION_ID "只计算 17 乘 23，不使用工具或修改文件。"
node cli.mjs state SESSION_ID
node cli.mjs wait SESSION_ID 30000
node cli.mjs events SESSION_ID
node cli.mjs cancel SESSION_ID
```

将示例中的工作区路径换成本机绝对路径（Windows 例如 `D:/projects/demo`），`SESSION_ID` 换成实际查询返回的 ID。安装包的 bin 名称为 `harness-control`；直接运行 `node cli.mjs` 不依赖 profile 的 bin 是否在 PATH。

非默认 Harness home 必须在每次调用时指定：`node cli.mjs --home /absolute/harness-home ping`，也可设置 `DSH_HOME`。插件默认与 Host 使用同一 `DSH_HOME`（缺省为 `~/.dsh`）。如需显式配置队列路径，可在宿主对应 profile 的配置补丁中覆盖：

```yaml
- id: harness-control-bridge-v1
  config:
    bridgeDirectory: /absolute/harness-home/cli-bridge-v1
```

CLI 通过 `--home /absolute/harness-home` 对齐该队列。每个队列只服务一个运行中的 Host。

`create WORKSPACE_ID [TITLE]` 可使用已登记工作区；`prompt SESSION_ID --file /absolute/prompt.txt` 从 UTF-8 文件读取消息。`wait SESSION_ID [MS] [AFTER_SEQ]` 最长等待 45 秒；提交任务前记录 `state.cursor` 并作为 AFTER_SEQ 传入可排除旧输出。

先检查 ping、`plugin-status`（应包含 `installed: true`、`enabled: true`），再到 Harness 插件页确认登记。消息带 `[CLI]` 前缀；新会话不会强制切换当前查看的对话。`accepted` 只表示入队，等待超时不会取消任务；权限审批和待回答问题仍需在 Harness 原界面处理。

## Codex 集成与来源

代码提取自作者自己的 [rixodx-codex-skill](https://github.com/rixodx/rixodx-codex-skill) 中 Harness Control 的 `assets/harness-bridge`，源提交 `7983118a1b858620629826014452f893d90657b7`。原仓库为私有技能库，不是安装本插件的前提。本公开仓库包含可独立安装的 Harness bundle 和 CLI，不依赖 Codex 技能文件。

Codex 可直接运行上述 CLI，也可使用原 Harness Control 技能。**已通过该技能安装桥接的用户，先用其 `setup.mjs --uninstall` 移除原来的受管理安装，再通过市场安装此插件**，避免同一 profile 重复加载两个 bundle。此包本身不安装 Codex 技能。

## 数据与权限

使用 `<Harness home>/cli-bridge-v1/{incoming,processing,outgoing}` 文件队列，无监听端口、无遥测、无安装脚本。调用现有 `sessionController`、`workspaceRegistry` 和 `pluginManager` 服务，不修改目标会话的模型或权限策略。

队列包含提示词、结果及请求记录，只应允许本机当前用户访问。Unix 新目录/文件分别以 0700/0600 创建；Windows 请依赖 Harness home 的用户 ACL。请求最大 64 KiB、有效期两分钟，已领取请求不重放。CLI 超时或宿主崩溃后执行结果可能未知，请按输出 requestId 检查队列与会话，避免直接重复提交有副作用的任务。记录不会自动清理；停用 Host 后可自行归档。

## 验证与限制

```sh
npm test
npm pack --dry-run
```

隔离测试覆盖实际 CLI 收发、工作区/会话操作、过期和重复请求拒绝、等待期间取消，以及卸载后停止读取队列。已在 Windows 通过真实 Harness 0.2.2-rc.1 包管理器向临时 home/profile 安装 tgz，确认依赖登记与 bundle 启用。GitHub Actions 在 Windows/Linux 上执行测试。

提取前已完成 Windows 桌面上的新建/续接会话、GUI 结果显示、用户中断，以及独立 Harness Web 实例安装连接验证。本次提取不代表重新完成真实 GUI 回归；macOS/Linux GUI 尚未实测。

## English quick start

Install the prebuilt GitHub Release `.tgz` through the Desktop plugin manager or `dsh plugin --profile web add <tarball-url>`. Keep the GUI Host running. Extract the same archive locally and use `node cli.mjs [--home HOME] ping|plugin-status|workspaces|list`, then create/prompt/state/wait/events/cancel with actual workspace and session IDs. Supports Node.js 24.9+ and tested Harness 0.2.2-rc.1 only. Local files carry prompts and results; restrict access to your user account. Existing approvals, models and permission policies remain controlled by Harness.

## License

MIT.
