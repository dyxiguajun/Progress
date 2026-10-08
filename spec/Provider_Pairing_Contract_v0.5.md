# Provider 与设备配对契约 v0.5

本文件记录当前实现；原有 Component / Instance / Metric / Card 与 `progress/workspace/v1` 保持兼容。下列字段是可选扩展，旧文件通过 `upgradeWorkspace` 迁移。

## 工作区与连接

- `folders`: `{id,name,icon,color}[]`；`Card.folderId` 指向文件夹。格位属于卡片，移动文件夹不复制实例或连接。
- `autoFill`: 默认 true；移除、移动后按视觉顺序填补前面的空位，显式拖动落点保持固定。
- `connections`: `{id,providerId,method,kind,label,priority,reconnect?,endpoint?,credentialRef?,accountKey?,sourceDevice?,sourceConnectionId?,deviceId?}[]`。
- `Instance.connectionIds`：最多 12 个绑定；`connectionStrategy` 为 automatic / direct / relay。后两者只使用指定路径。
- 自动模式从成功连接中选择：真实 observedAt 最新 → priority 较小 → latency 较低。读取失败保留最后成功值与旧采样时间，迟到旧样本不能覆盖显示或持久化缓存。
- 样本区分 observedAt、receivedAt、sourceDevice、connectionId。缓存身份包含组件、实例与绑定内容，变更账户、凭据引用、地址或策略后不会复用旧缓存。

## Provider 与只读数据

内置 Codex 使用官方 app-server，由 Codex 管理登录。Claude 个人订阅剩余配额未接入；组织历史用量接口不冒充剩余额度。

安装组件可声明 `manifest.quotaProvider`：id、name、connectionMethods、HTTPS helpUrl、credentialInstructions、requiredScopes；runtime 必须为 provider_quota。当前支持 read-only-url / api-key / bearer / endpoint-secret / pairing。安装包声明任意 OAuth 会被明确拒绝，尚无通用 OAuth 适配器。

手动服务 GET 返回 PDM 指标数组、`{metrics:[...]}` 或单个指标。配额窗口使用 range：

```json
{
  "id": "short-window",
  "name": "短周期",
  "kind": "range",
  "value": 72,
  "min": 0,
  "max": 100,
  "meaning": "remaining",
  "observed_at": "2026-10-07T17:00:00Z",
  "reset_at": "2026-10-07T18:00:00Z",
  "window_minutes": 300,
  "stale_after": 900
}
```

上例仅说明格式。服务必须填写自己的真实观测时间与数值；缺少观测时间、未知含义或超出范围时拒绝连接。meaning 支持 used / remaining / available；reset_at 与 window_minutes 可省略，不推算不存在的重置时间。多个窗口独立显示，整体观测时间取窗口中最早的时间。

API Key 使用 X-API-Key；Bearer 使用 Authorization；Endpoint + Secret 使用 X-Progress-Secret。凭据只保存在设备 vault。直连要求 HTTPS，loopback 调试可使用 HTTP；地址不接受 userinfo、查询参数或片段。禁止重定向，请求超时与数据大小上限为 15 秒 / 2 MB。Web 受 CORS、混合内容与浏览器局域网策略约束；新配额直连及 relay 在 Android 使用 CapacitorHttp，旧通用 HTTP 组件仍使用 fetch。

## 配对与 Agent

局域网默认关闭，由用户在设置开启。电脑来源 Agent 可继续刷新已分享连接；睡眠、退出进程与网络中断会停止可用性，不承诺系统后台唤醒。身份、已批准设备与加密来源存储在 `.progress-agent/`。

二维码字段仅为 schema、一次性 token、expiresAt、sourceDevice、sourceDeviceId、connectionId、cardId、endpoint、publicKey；不含第三方凭据或长期设备私钥。有效期 120 秒，重新生成使旧码失效。

流程：扫描 → 签名 claim 消耗 token → 两端核对校验码 → 来源批准 → 扫描端选择备用 / 替换 / 新卡片 → 保存设备绑定 → finish 使配对会话失效。Codex 来源账户不同不允许静默添加备用；可明确替换或创建新卡片。设备授权可单独撤销，也可停止分享并撤销该来源全部授权。已连接的中继可以请求新分享码，仍需要原来源批准。

协议 `/progress-relay/v1` 只接受 POST 加密消息：P-256 ECDH 派生 AES-GCM；设备 ECDSA 签名包含 action、deviceId、timestamp 和 nonce。来源公钥由二维码固定；请求时间窗口 60 秒，并拒绝重放。响应也加密。LAN HTTP 使用应用层加密，并非 TLS；协议仍是原型，尚未经过独立安全审查。

Owner API `/api/pairing/*` 要求 loopback Host、同 Origin、X-Progress-Client: pairing-v1 与 POST；不提供跨域 owner 控制。relay 限制 100 KB 请求体、10 秒请求时限、32 个并发请求、每 IP 每分钟 120 次；配对 / 等待会话各最多 32 个。来源采样合并并发读取，文件写入排队并原子替换。

设备 vault 使用 IndexedDB、AES-GCM 和 non-extractable CryptoKey；跨标签初始化通过原子事务选定同一个密钥与身份。Agent 文件目录 / 身份权限为 0700 / 0600，来源凭据加密。两者均不是系统 Keychain，也不等同于硬件隔离。

## 文件迁移

`.progress` 单卡片 JSON，`.progresspack` 工作区 ZIP；保留卡片、文件夹、实例、组件与连接关系。导出连接仅含便携元数据，移除 endpoint、凭据引用、账户指纹、设备身份与采样缓存，设置 reconnect=true。导入显示重连数量，须在新设备重新授权或配对。

旧 HTTP / 自定义组件配置若含已识别凭据字段或 URL 凭据，会拒绝导出并要求迁移到连接层。此措施不是任意文本的通用秘密识别器；组件作者不得在普通配置或 Schema 默认值中嵌入凭据。

## 验收边界

详见 `Progress_Handoff_v0.5.md`。浏览器两来源配对与 Node 加密协议测试不等同于真实 Android 相机 / 权限 / WebView / 局域网验收；调试 APK 构建成功也不等同于真机通过。
