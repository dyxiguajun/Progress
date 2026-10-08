# Progress

面向可量化信息的极简、本地优先进度工作区。数据来源保持开放，展示方式由用户掌控。

**Progress 是容器。Less is More。**

当前 Web 源码 v0.6.4：支持进度条、圆环、数值与填充，16 种矩形尺寸、横竖排列、拖拽缩放和组合卡片；可选择显示字段与顺序，空间不足整项隐藏，放大恢复。支持 HTTP PDM 接入、组件安装及工作区导出 / 导入。本机 Codex 配额依赖已安装并登录的 Codex 与本地 Agent。

Node.js 22.12+、pnpm 9+：

```sh
pnpm install --frozen-lockfile
pnpm dev
pnpm test
pnpm build
```

按 Vite 输出打开本地页面。首次工作区为空，示例需主动添加。开发不需要真实服务凭据。桌面浏览器与 Agent 启动方式为 `pnpm desktop`；静态部署不包含 Agent。

[开发指南](docs/DEVELOPMENT.md) · [架构](docs/ARCHITECTURE.md) · [PDM 接入](docs/PDM.md) · [贡献](CONTRIBUTING.md)

项目处于早期开发，接口与格式仍可能变化。首次源码发布以 Web 为主，不提供新版 Android APK。自有代码采用 [MIT](LICENSE)，第三方许可见 [声明](THIRD_PARTY_NOTICES.md)。
