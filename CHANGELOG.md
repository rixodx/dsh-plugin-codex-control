# 更新日志

## 1.0.2 — 2026-11-09

- 从 Harness Control 技能提取可独立安装的桥接插件与 CLI，保留原有协议和 bundle ID。
- 补齐 MIT 许可、公开仓库信息、安装/迁移说明和 Windows/Linux 隔离测试工作流。
- 将 ping 与 ready.json 的版本信息统一为 1.0.2。
- Windows 本地隔离测试全部通过；通过真实 Harness 0.2.2-rc.1 包管理器向临时 home/profile 安装 tgz，确认依赖已登记且 bundle 已启用。未重新执行真实 Harness GUI 回归。
