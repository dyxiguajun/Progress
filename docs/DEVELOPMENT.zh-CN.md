# 开发指南

[English](DEVELOPMENT.md) · [文档索引](README.md)

本文面向 Progress v0.6.5 的开源开发者，说明如何运行项目、定位代码、接入数据和验证改动。架构细节见 [Architecture](ARCHITECTURE.md)，组件与源码扩展见 [Extending Progress](EXTENDING.md)，回归流程见 [Testing](TESTING.md)。

## 从克隆到运行

安装 Git、Node.js **22.12+** 和 pnpm **9+**。Node 22 是开发基线：锁定的 Vite 需要 Node 20.19+ 或 22.12+，附带的 Capacitor CLI 需要 Node 22+。保留仓库的 lockfile。

```sh
git clone https://github.com/dyxiguajun/Progress.git
cd Progress
node --version
pnpm --version
pnpm install --frozen-lockfile
pnpm dev
```

打开 `http://127.0.0.1:5173`。首次工作区为空，可添加「手动进度」或「倒计时」完成无账户开发。示例需要主动添加，内容为模拟数据；基础开发不需要 `.env` 或线上后端。

开发服务器仅绑定本机，5173 被占用时会报错。可以停止自己占用该端口的进程，或运行 `pnpm dev --port 5174`。更换端口后，模拟 HTTP 服务也需要明确允许新的 origin。

## 常用命令与运行模式

在仓库根目录执行：

| 命令 | 用途 |
| --- | --- |
| `pnpm dev` | Vite 开发服务、React 热更新、本机 Agent 中间件 |
| `pnpm test` | 完整 Vitest 回归 |
| `pnpm build` | TypeScript 检查与 Web 构建，输出 `dist/` |
| `pnpm preview` | 预览已构建的 `dist/`，通常使用 4173 |
| `pnpm desktop` | 构建并在 5180 启动 Web + 本机 Agent，自动打开浏览器 |
| `pnpm extension:build` | 生成 Chrome 插件目录与 ZIP，保存到 `artifacts/` |
| `node scripts/demo-source.mjs` | 在 `http://127.0.0.1:8787/progress` 提供模拟 PDM |
| `node scripts/pack-examples.mjs` | 将 `examples/` 的三个示例打包为 `.progressmod` |

`pnpm preview` 和静态网站只提供 Web 文件；开发模式与桌面模式还提供本机 Codex / 配对路由。验证本机连接时应使用后两种模式。Codex 配额需要本机已安装并登录 Codex，随后在 Progress 的配置流程中确认账户。

如需桌面模式但不自动打开浏览器：

```sh
pnpm build
node scripts/desktop.mjs --no-open
```

用对应终端的 Ctrl+C 退出服务；桌面启动器会关闭相关 Agent 资源。`Progress.command`、`Progress.bat` 与 `scripts/dev.sh` 是便捷入口，仍需要可用的 Node / pnpm。

Node 脚本支持以下环境变量，通过所在 shell 的语法设置后启动：

| 变量 | 用途 |
| --- | --- |
| `PROGRESS_PORT` | 桌面 Web 端口，默认 `5180` |
| `PROGRESS_DEMO_PORT` | 模拟 HTTP 服务端口，默认 `8787` |
| `PROGRESS_CODEX_BIN` | 可选 Codex 可执行文件路径 |
| `PROGRESS_AGENT_HOME` | 配对身份/设备状态目录，默认工作目录下 `.progress-agent/` |
| `PROGRESS_AGENT_BIND` | 设置为 `127.0.0.1` 可限制独立配对监听器仅接受本机访问；默认启动时监听 `0.0.0.0` |

配对监听器与本机 Web 服务分别运行，由配对流程启动；限制到 loopback 后其他设备无法直接配对。这些变量用于 Node 进程，不是前端环境配置。

## 代码从哪里看

| 要处理的工作 | 主要入口 |
| --- | --- |
| 启动、导航、配置、导入确认 | `src/main.tsx`、`src/App.tsx` |
| 数据类型与输入校验 | `src/core/model.ts`、`validation.ts`、`metrics.ts` |
| 本地/HTTP 采集与状态 | `runtime.ts`、`httpResponse.ts`、`sourceState.ts`、`src/hooks/useMetrics.ts` |
| Provider、账户绑定与连接选择 | `src/core/providers.ts`、`codex.ts`、`pairing.ts` |
| 存储、迁移与导出导入 | `storage.ts`、`vault.ts`、`packages.ts`、`components.ts`、`folders.ts` |
| 网格、组合、手势与手机 profile | `grid.ts`、`cardGroups.ts`、`gestures.ts`、`src/hooks/useLayoutProfile.ts` |
| 卡片与显示字段 | `src/ui/ProgressCard.tsx`、`MetricView.tsx`、`ConfiguredContent.tsx`、`QuotaView.tsx`、`useCardContentGuard.ts` |
| 工作区交互与搜索 | `src/ui/WorkspaceGrid.tsx`、`OperationLayer.tsx`、`Spotlight.tsx`、`src/styles.css` |
| 本机 Agent 与后台采集 | `scripts/codex-agent.mjs`、`pairing-agent.mjs`、`desktop.mjs`、`extension/` |

核心分层是 **Component → Instance → Metric → Card**：组件定义能力；实例保存配置；指标表达数据；卡片保存显示与布局偏好。增加来源时优先让服务输出 [PDM](PDM.md)，使用内置 URL 进度；需要复用配置时再制作声明式组件。包格式不执行任意 JavaScript。新增 runtime、Provider 或 renderer 时，需同时维护类型、校验、完整配置流程、持久化和迁移。

## 用模拟数据验证 HTTP

保持默认 `pnpm dev` 服务，在另一终端运行：

```sh
node scripts/demo-source.mjs
```

选择「+ → 预设组件 → URL 进度」，填写 `http://127.0.0.1:8787/progress`，允许网络访问、测试连接、选择指标并保存。服务提供变化的传输进度和固定温度，均为模拟数据。编辑并刷新页面，确认配置保留；停止模拟服务后，确认显示连接异常并保留最后有效样本；重新启动服务后重试。

模拟服务的 CORS allowlist 覆盖 localhost / 127.0.0.1 的 5173 端口。使用 preview、desktop 或其他端口时，需要显式调整示例服务的 allowlist。HTTPS 页面直接读取 HTTP 地址会受到浏览器限制。普通网页首页不是进度 API；需要完整 JSON 接口和符合 PDM 的响应。

## 修改时保持的约定

- 优先显示用户数据，日常界面使用功能标签；正常状态安静，异常说明问题、已有数据是否可用及恢复操作。
- 卡片尺寸使用组件支持的整数格位变体，根据实际容器计算布局；移动/缩放优先局部避让。
- 保留直接配置、长按/右键菜单和非拖动操作。编辑时允许触摸滚动；组合判定保持固定 24px 内缩与 420ms 停留。
- 桌面与手机布局独立保存，旧数据和导出导入继续兼容；内容不足时整项隐藏可选字段，并保留用户偏好。
- 连接失败保留最后有效数据；账户不匹配时必须重新确认，不能继续展示其他账户缓存。各配额窗口独立表达。
- 网络同意、Chrome 授权和设备凭据需要在目标设备重新确认。工作区导出不会携带这些授权。

浏览器存储按 origin 隔离：`localhost`、`127.0.0.1`、不同端口和线上地址的数据分别保存。建议使用独立开发浏览器 profile；迁移或清理前先备份。配置、设备凭据、采集缓存的保存位置见 [存储说明](ARCHITECTURE.md#storage-and-portability)。导出检查不能保证过滤所有私人地址，共享样例应使用合成内容。

## 验证与提交

运行 `pnpm test`、`pnpm build`；涉及插件或共享采集代码时还需 `pnpm extension:build`。人工流程见 [Testing](TESTING.md)，提交说明见 [Contributing](../CONTRIBUTING.md)。仓库尚未配置 CI，不应以不存在的自动检查代替本地执行。

公开提交包括源码、测试、必要配置、示例、规范和开发文档。私人账户、日志、截图、历史交接及生成产物保持本地忽略，完整范围见 [Repository contents](REPOSITORY.md)。公开文档应能从全新克隆独立使用。

`main` 关联 Cloudflare Pages，推送会触发发布；Web 构建命令为 `pnpm build`，输出目录为 `dist`。换部署域名时还需明确调整插件允许的 origin。静态部署不包含本机 Agent。

公开源码含 Capacitor 依赖和平台存储分支，但不含 Android 项目与本地设备构建脚本；`android:*` 命令需要这些本地文件。真 Android / iPhone、真实账户和 Chrome 安装后关页 alarm 验收需单独完成，模拟视口、mock API 与构建成功各有自己的验证范围。
