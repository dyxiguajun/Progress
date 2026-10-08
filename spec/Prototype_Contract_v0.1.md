# Progress 原型实现合同 v0.1

此文档描述 v0.3.0 代码实际支持的能力，是完整 Component Specification 的子集。迁移格式仍使用 v1 Schema。

## 对象与存储

Component 存储 Manifest、Config Schema 和可选的静态指标；Instance 保存组件 ID、用户配置、名称及创建时间，并允许 HTTP 连接保存可选的 `refreshInterval`；Metric 在单个实例内使用稳定 ID；Card 通过 `instanceId + metricId` 绑定，独立保存显示方式与强调色。

HTTP 按实例采集，卡片复制默认共享实例。移除最后一张卡片时清理没有卡片引用的实例。修改实例配置会影响所有引用卡片，界面展示受影响的数量。

## 组件包

`.progressmod` 使用 ZIP，根目录包含：

```text
manifest.json
config.schema.json
data.json            # static Runtime 必需
```

ID 使用带点的命名空间；本轮版本号支持 `major.minor.patch` 三段数字。JSON Schema 表单子集支持 string、number、integer、boolean、enum、default、title、description、minimum、maximum、minLength、maxLength，以及 `date-time` 字段。配置中的未声明字段会被拒绝。

v0.5.1 补充：配置 Schema 顶层可保留文字 `title` / `description`。省略 `$schema` 时使用 draft-07；声明 `https://json-schema.org/draft/2020-12/schema` 时使用独立的 draft-2020-12 校验器。两种声明均仅支持上述自动表单子集，不能借声明新版本启用嵌套对象、复杂条件、外部引用或自定义关键字。拒绝时会列出不支持的关键字及字段位置。

Runtime：

| 类型 | 配置 / 数据契约 |
| --- | --- |
| `time_range` | 读取配置 `end` 与可选 `start`，时间存为带时区的 ISO 字符串 |
| `manual` | 读取 `value`、`max`、`unit`、`meaning` |
| `quota` | 读取 `value`、`max`、`unit` 和可选 `reset`，含义固定为 remaining |
| `static` | 从 `data.json` 读取指标数组，入口固定为 data.json |
| `http` | GET 指定 URL，`{{field}}` 引用对应配置值；实例可覆盖刷新间隔，范围为 5–86400 秒整数，未覆盖时使用 Manifest 声明或默认 15 秒 |

HTTP 必须声明 `permissions: ["network"]`。仅支持 http/https 地址，不支持 URL 中的用户名密码，不携带浏览器登录凭据，不跟随重定向。连接授权保存在本机实例中；预览前必须确认。认证、Shell、文件系统权限及第三方代码执行尚未实现。

## PDM

HTTP 可返回单个 PDM 对象、指标数组，或 `{ "metrics": [...] }`。单个对象未指定 ID / 名称时补为 `main` / `当前进度`；数组中的指标必须有唯一 ID 和名称。

六种核心类型：range、gauge、counter、time_range、state、indeterminate。数值需要是有限数字；range 的 min 默认为 0，max 必须大于 min；time_range 的 end 必填，若有 start，则 end 必须晚于 start。仅目标时间的倒计时没有比例。

`meaning` 不自动反转进度。remaining 37/100 表示剩余比例 37%。超出范围的数值保留，只有图形填充限制为 0–100%。

可选 `secondary` 提供 role/value/unit，v0.6.4 增加可选稳定 id / label（各非空、≤200 字，id 在同一指标中唯一）。旧卡默认最多两项，原 eta 按秒格式化；新显示配置可以独立选择辅助项，未知 role 不推断业务语义。`observed_at` 与 `stale_after` 描述数据新鲜度；HTTP 未提供时，分别使用收到响应的时间和三倍刷新间隔。数据过期和连接失败独立于业务状态。

HTTP 失败后保留最后成功样本，展示采集异常；配置变化时清理旧样本，避免把旧连接的数据显示成新连接的数据。请求有 10 秒超时及指数退避，延迟为刷新间隔乘以 2 的连续失败次数次方，倍数最多 20、延迟最多 86400 秒。手动重试、页面重新可见或网络恢复时重置退避并立即请求；离线时中止请求，隐藏页面暂停新请求。

来源状态独立于 Metric 的业务状态：首次连接、刷新中、过期、设备离线、连接失败、需要授权、数据格式不兼容及指标缺失。正常状态不显示常驻健康徽章。详情窗口分别显示最近成功连接与 `observed_at`，失败时明确提示正在保留旧值。配置和卡片外观编辑不会丢失已经填写的字段。

首次启动不自动载入示例。主动添加的示例通过实例 `demo` 标记识别，批量移除不会删除非示例卡片。删除后十秒内可以恢复卡片、连接及依赖，恢复时保留用户随后添加的卡片和对现有连接的修改。

## 迁移格式

- `.progress`：JSON，使用 `progress/workspace/v1` Schema，内含一张卡片、对应实例和组件定义。完整项目后续可以引入独立的 card Schema。
- `.progresspack`：ZIP，包含 `workspace.json`。JSON 内含组件定义、实例集合、卡片顺序、工作区名称及主题，静态组件的数据也在其中，能脱离原设备恢复。
- 导出弹窗支持逐项选择、全选与清空选择。只携带所选卡片引用的实例和组件定义，共享实例只保存一次；一张卡片使用 `.progress`，多张使用 `.progresspack`。
- HTTP 缓存数据与网络授权不进入导出包；静态数据作为组件定义的一部分保留。

导入需要校验稳定 ID、配置和引用关系，不使用显示名称推断对象身份。覆盖更新同 ID 对象；重命名产生新实例与卡片 ID，并维持多卡片共享关系；跳过保留原对象。冲突可逐项选择，或把规则应用到剩余冲突。组件同 ID 但定义不同则拒绝合并，支持选择替换完整工作区。

## 网格扩展（实验性）

Manifest 可选 `cardLayouts: { default, variants }`，每个变体包含 `id`、可选的 `label`、整数 `span: { columns, rows }` 和可选 `fallback`。开发者声明支持 1–12 列、1–8 行，最多 32 个变体；名称须唯一，默认变体须存在，回退链不得循环或引用不存在的尺寸。v0.6.1 官方 Renderer 支持 1–4 列 × 1–4 行的全部 16 种标准矩形，标准上限 4×4。保留 compact 1×1、wide 2×1、large 2×2、expanded 4×2 ID；新增尺寸使用 size-NxM。未声明时使用完整标准集，首方 Codex / 配额卡亦使用标准集。第三方尺寸声明继续限制该组件的选择；窄画布回退不会覆盖首选尺寸。

Card 可选 `layout: { variant, position?: { column, row, columns } }`。`variant` 是用户首选尺寸；格位从零开始，`columns` 记录生成提示时的网格容量。没有布局字段的旧卡片自动使用组件默认尺寸并首次定位，组件与连接定义保持不变。

网格通过 ResizeObserver 读取实际卡片画布宽度，当前实现使用 160 px 的最小单元参考宽度、16 px 间距和最多 12 列。这些物理参数是宿主实现，不是协议要求。窗口容量不足时按声明链选择可容纳的变体，仍不足时选择确定的兼容变体；若完全没有受支持尺寸，使用明确的占位提示，不压缩 Renderer。首选尺寸不因窗口变窄而被覆盖。

首次 / 新卡片寻找第一块空区域；既有有效格位先保留。移动或调整尺寸时固定目标 footprint，保留不冲突卡片，仅为冲突卡片寻找最近的可用格位。预览使用同一算法，越界或非整数跨度无效。有效释放、尺寸选择或方向按钮操作立即持久化；取消和无效释放保留原布局。只修改 Card 层，不改变 Instance、Metric 或连接采集状态。

选定导出、组件安装和工作区迁移保留上述可选字段。跨窗口恢复保证相同布局规则及首选尺寸，不保证像素一致。字段语义尚为原型扩展，最终名称及协议版本待完整规范确认。结构参考 `layout-v0.1.schema.json`，额外的唯一性 / 引用 / 回退链规则由宿主校验。

## Codex Usage 扩展（v0.4）

第一方 `dev.progress.codex-usage` 使用固定 `codex_usage` Runtime 与 `quota` 组合 Renderer，不能通过组件传入程序路径或命令。实例配置仅保存可选的账户指纹 `accountKey`；Card 使用组合标识 `metricId: codex-usage` 及可选的 `quotaGroups`，实际 Snapshot 保留独立窗口 Metric 和适配后的 quota 结构，不合并百分比。组选择使用上游字典 key，另行保留 limitId。

macOS / Windows 本机 Agent 读取 Codex app-server，静态网页和 Android 不具有本机执行权限。Codex 负责登录和凭据；宿主只接收脱敏账户、窗口与 credits。适配器优先多 bucket；缺失、未知、异常字段不补 0 / 100。首次、前台、手动、通知与五分钟兜底读取；十五分钟标记过期，失败保留旧样本，账户变化要求重新确认。

最后样本与工作区分开保存且不导出。迁移只保留白名单的组件、配置、组选择及外观，清空账户绑定，恢复时再次确认本机账户。此扩展尚为原型字段；详细边界及实际验收见 `../Progress_Codex_Handoff_v0.4.md`。

## 待扩展

下一阶段优先验证自定义配置界面和 Renderer 的宿主桥接；再正式设计 Schema 版本演进、fallback、扩展命名空间、凭据引用、更新迁移与 Android 后台行为。

## v0.6.2 外观与滚动可选扩展

Card 支持本地 icon 白名单（32 个键见 src/core/iconCatalog.ts）、renderer fill、fillDirection bottom-up/left-right、ringCenter auto/icon/value。可导出、导入并校验，禁止远程图标和任意可执行 Renderer。fill 仅用于可计算比例的 range/time_range，不改变来源状态语义。

Workspace.scrollDirection 为 vertical/horizontal（缺省 vertical）。v0.6.3 删除 wheelMode 设备设置，迁移清除旧字段。横向画布默认将纯垂直 wheel 映射为横移，保留原生 deltaX、Shift 和缩放手势。Card.layout.horizontalPosition 保存 column/row/rows；有界行向右延伸，竖向 position 独立保留。横向行数来自当前窗口可用高度，resize/reflow 维持实际矩形跨度，不旋转卡片；自动填空按列优先，再按行。

## v0.6.3 组合卡片可选扩展

Workspace.cardGroups 为引用式组合数组，每项包含 id、name、cardIds（2–32 个同文件夹 Card 引用）、style（rings/bars）、可选 layout 和可选布尔 simple。组合有自己的横竖布局，成员原 Card / Instance / Metric 与配置保留；组的首个 Card 作为画布承载点，其余成员不重复出现在画布。删除失效引用，少于两成员自动解散。Workspace.groupValues 为可选布尔值，缺省 true，作为新组合的显示百分比默认值；simple 缺省继承 groupValues===false，显式 true / false 优先于全局设置，保存组合配置后形成局部设置。simple=true 隐藏组百分比，悬停圆环或键盘聚焦渐显不带百分号的裸数值，离开恢复图标。simple 在合并、复制、移动、导出白名单和导入校验中保留。

导出保留白名单组字段与开关；选中部分成员时仅保留至少两名入选成员的组合。导入重命名冲突同步映射引用，覆盖 / 跳过后清理失效组合。组合不会引入凭据或账户缓存。相关扩展仍是本原型版本的数据契约。

## v0.6.4 可选显示配置

Card.displayPreferences 可选 `{fields:string[]}`，最多 64 个唯一键；缺省沿用原 renderer / display，不迁移旧卡。基础键 icon/title/value/progress/status/details/reset/credits/account/updated，附加键 metric:<id>、secondary:<id>；旧 secondary 无 id 使用 role:同角色序号。配置属于 Card，复制与白名单导出保留；缺失键保留选择但不造值。图标 / 名称保留头部，其他顺序是实际空间预算的优先级。临时隐藏不会修改持久配置。详情展示完整来源指标。

组合判定内部区域改为四边固定内缩 24 CSS px；保持既有顶部 / 侧上三分之一入口及 420ms 稳定停留。具体实现、验收及边界见 Progress_Display_Adaptive_Handoff_v0.6.4.md。
