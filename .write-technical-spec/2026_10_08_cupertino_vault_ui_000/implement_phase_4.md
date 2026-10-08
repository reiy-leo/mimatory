# 阶段 4 — Settings、假开关、Watchtower 与交付

目标：把 Settings 对齐原型的偏好结构，处置"界面有开关、行为无实现"的假开关，
补齐三语与运行时验证，完成交付检查单。

## 前置

- 阶段 1–3 完成。
- **需要拍板**：D-06（同步 UI 暴露面）、D-07（System 主题）、D-09（密码找回提示）、
  D-11（锁触发来源与偏好枚举）。

---

## 4.1 假开关处置（本阶段最高优先级）

**这是诚信问题，不是排期问题。** 当前 8 项安全偏好里 5 项完全没有可观察效果：

| 偏好 | 现状 |
|---|---|
| `lockWhenDeviceLocks` | 仅存 localStorage，无订阅者 |
| `unlockWithMacPassword` | 仅影响 `shouldShowTouchIdUnlock`（`App.tsx:1174-1178`）是否显示按钮 |
| `deviceUnlockDuration` | 无效果 |
| `accountPasswordRequirement` | 无效果 |
| `useUniversalClipboard` | 无效果 |
| `autoLockIdleDuration` | **真生效**（`App.tsx:606-614`） |
| `clearClipboardAfter90Seconds` | **真生效**（`App.tsx:1092-1101`） |
| `unlockUsingTouchId` | **真生效**（`shouldShowTouchIdUnlock`） |

而且**全部 8 项只写 localStorage + 发事件，从不发给 Rust**（`App.tsx:2271-2275`）。
在密码管理器里，一个不生效的安全开关比没有开关更糟 —— 用户会以为自己有保护。

处置原则：**每一项要么接上真实行为，要么从界面删除。不允许保留无效果开关。**
design.md §8.17 把这条列为验收标准。逐项判定：

| 偏好 | 处置 |
|---|---|
| `lockWhenDeviceLocks` | **接上**：`shell.rs` 订阅 `NSWorkspace.sessionDidResignActiveNotification` / 屏保通知 → 调 `lock_vault`。见 4.2 |
| `accountPasswordRequirement` | **接上**：记录上次主密码验证时间戳（Rust 侧，不放前端 —— 前端时间可被篡改），超过间隔时即使 Touch ID 可用也强制走主密码。这是 D-09 之外唯一能改善"忘记主密码"后果的措施：**至少保证密钥不会永久停留在只靠 Touch ID 的状态** |
| `deviceUnlockDuration` | **删除**。它表达的语义与 `accountPasswordRequirement` 重叠，且原型里没有这一项 |
| `useUniversalClipboard` | **删除**。跨设备粘贴密码属于产品方向决策，不是开关 |
| `unlockWithMacPassword` | **降级为说明文字**，不做开关。macOS 登录密码本来就是 Touch ID 的回退路径，无法关闭 |

## 4.2 锁触发来源（D-11）

当前唯一的自动锁是渲染进程一个 `setTimeout`（`App.tsx:606-614`），
监听 `mousemove/mousedown/keydown/scroll/touchstart` 重置。

问题：

1. **系统休眠不锁** —— 合盖再打开，会话密钥还在内存里。
2. **屏保不锁** —— 同上。
3. **应用切到后台不锁** —— 空闲判定基于本窗口的 DOM 事件，窗口不可见时
   `mousemove` 不再触发，反而会更早锁定（行为不稳定）。
4. 关掉主窗口 ≠ 锁库（`shell.rs` 的托盘与窗口生命周期决定），用户可能以为关了就是锁了。

目标：

- **锁的权威判定移到 Rust**。`shell.rs` 订阅 macOS 会话/屏保通知，直接调
  `VaultService::lock`，不依赖渲染进程存活。
- 空闲计时保留在前端（只有它知道"用户是否在操作"），但 Rust 侧加一个
  **单调时钟兜底**：`last_activity` 由前端节流上报（比如每 30s 一次），
  Rust 用 `Instant` 判定，前端计时器挂了或窗口被隐藏时兜底仍能锁。
- 托盘菜单加"立即锁定"项（当前 `handleLock` 在界面上完全不可达）。
- 验收：合盖 5 分钟再开 → 必须回到锁屏；屏保触发 → 必须锁；这两条**只能手动测**。

## 4.3 偏好枚举对齐

先说一句重要的限定：**1Password 官方文档只给出标签，没有给出可选值全集**，而且桌面端
与移动端的两套标签在文档里不一致。下面这一列严格只写"文档里能确证的部分"，
凡是我从旧版本/移动端推断的都标出来了 —— 上一稿把这些都写成"1Password 官方"是错的，
如果按那份取值拍板，等于抄了一张不存在的表。

| 项 | 官方可确证 | 原型 | 当前实现 | 本期取值 |
|---|---|---|---|---|
| 空闲锁定 | 触发项叫 `Lock after the device is idle for`；桌面文档列出 `1 / 5 / 10 / 30 分钟、1 / 5 / 24 小时`；另一页（移动/旧版）是 `Immediately / 30s / 1 / 2 / 5min / Never`。**哪一份是当前 Mac 构建未经证实** | 2 / 5 / 10 / 30min / 1hr / Never | 1 / 2 / 5 / 10 / 15 / 30min / 1 / 4 / 8h / never | 见下 |
| 剪贴板清理 | 桌面端是**单个开关**，标签内嵌区间：`Remove copied information and authentication codes after 90 seconds.`，同时覆盖 OTP。没有文档给出多档区间 | 30s / 90s / 2min / 5min | 单个布尔（90s） | 见下 |
| 密码可见时长 | **无文档**。`Show in Large Type` 有据，自动隐藏时长无据 | 未提供 | 仅手动切换 | 见下 |
| 主密码重输间隔 | 标签 `Confirm my account password`，描述为"两次 Touch ID 解锁之间多久的间隔"，**未列枚举** | 24h / 3 / 7 / 14 / 30d | 1 / 7 / 14 / 30d / never | 见下 |

判定（`securityPreferences.ts:1-3`）：

- 空闲锁定：**取桌面文档那一组（1 / 5 / 10 / 30 分钟、1 小时）+ `never`**，
  删掉 `4h` / `8h`（超过 1 小时的"自动锁定"在密码管理器里没有安全意义，是错觉性配置）。
  `Immediately` 不给 —— 有 `never` 和 1 分钟就够了。
- 剪贴板：**保留单开关语义，标签内嵌区间**，与 1Password 一致：
  `关闭 / 复制后 90 秒清除（含一次性密码）`。原型的 30s/2min/5min 多档我**不采纳**，
  理由不是它不对，而是没有任何来源支持，而多档会诱导出"选 5 分钟也算安全"的错觉。
  真正必须修的是执行位置：`copyPassword` 的定时器在前端（`App.tsx:1092-1101`），
  窗口一关就失效 —— 挪到 Rust 与 4.2 同源。
- 密码可见时长：**新增**（5s / 15s / 保持可见）。默认 15s。这三个值是**我自定的**，
  没有外部依据，属于 T 档细节。
- 主密码重输间隔：加 `3d`，与原型一致。
- 枚举变更要做**旧值迁移**：localStorage 里存的 `'4h'` / `'8h'` 要映射到合法值，
  不能因为读到未知值就整体回落到默认（`loadSecurityPreferences` 现在是
  `{...default, ...parsed}` 浅合并，**不校验枚举**，读到 `'4h'` 会一路传到
  `getAutoLockMilliseconds` 的 `Record` 查找拿到 `undefined` → `minutes * 60 * 1000` = NaN）。
  这是一个真实的现存缺陷，顺手修。

## 4.4 Settings 结构重组

原型 9 项 / 当前 8 tab（design.md §4.1 的映射表）。

| 新 tab | 内容 | 来源 |
|---|---|---|
| General | 语言（+ Follow System，T-12）、外观（System/Light/Dark，D-07）、开机启动、菜单栏、Dock | 现 general + appearance 合并 |
| Vaults | vault 列表 + 计数 + 新建/重命名/删除 | **替代原型的 Accounts**（Passless 无账号体系） |
| Security | 4.1/4.2/4.3 的真实偏好 | 现 security，删假开关 |
| Privacy | Universal Clipboard（若保留）、截屏保护、遥测 | 从 security 拆出 |
| Watchtower | 保留，另在主窗口有真报告页（4.5） | 现 watchtower |
| Autofill | 域匹配默认规则、自动保存开关 | **新增**，来自阶段 2.6 |
| Browser | 桥配对，去掉"生成配对码"以外的暴露 | 现 browser |
| Advanced | import/export + 同步细节（D-06）+ 快照 + TOTP 开发者工具 | 现 import-export + sync + 2784-2800 |
| ~~Shortcuts~~ | **删除静态表**，换成 `⌘/` 浮层（4.6） | 现 2804-2825 |

结构修复：
- 加关闭按钮 —— `closeSettingsWindow`（`App.tsx:2250-2252`）已定义但从未引用，接上。
- 修 import/export **共用同一个 `importPreview` state**（`App.tsx:1974/2131`）
  导致一张卡的预览串到另一张卡下面的 bug。
- 移除 22 色 picker（C-01）及其 `passless-theme-color-changed` 监听端（阶段 1 保留的那一半）。
- 窗口标题 `'Passless Settings'`（`App.tsx:1159`）走 i18n。

## 4.5 Watchtower 主窗口报告页（N-16）

当前侧栏有 Watchtower 入口但列表区只显示一张提示卡 + "Open Settings"
（`App.tsx:1388-1397`），报告数据在 Settings 第 6 tab 里以 7 行纯文本呈现
（`2660-2670`）。

- 新建 `components/watchtower/ReportPage.tsx`，占用条目列表 + 详情两栏
  （不是侧栏那种"选中后详情在第三栏"的模式，而是一整页报告）。
- 数据源不变：`watchtower_report` + `check_breached_passwords`。
- 详情侧的**单条建议**（原型 "Watchtower: Excellent (100 bits)"）复用阶段 2.7 的
  `estimate_password_strength`，与列表页同源，避免两套强弱判定。

## 4.6 `⌘/` 快捷键速查浮层

替换 Settings 里只读的 Shortcuts tab（`App.tsx:2810-2821` 那 5 行静态文本）。
内容必须与阶段 3.7 的实际注册项一致 —— 用同一份常量表驱动浮层和测试，
**不允许浮层写一套、实现另一套**。

## 4.7 密码找回说明（D-09）

选 A 时：锁屏加一句明确的"无法找回"说明 + 指向加密备份恢复的入口文字。
**不改密码学、不新增恢复路径。**

措辞要求：不得暗示"我们可以帮你重置"。当前 Rust 侧不存在任何改密/恢复命令
（只有一次性的 `setup_master_password`），任何含糊文案都是虚假承诺。

## 4.8 三语与交付

- 所有新增可见文字补 zh / en / ja，i18n parity 测试守门。
  12 个命名空间（common, integrations, itemTypes, listTitle, lock, messages, nav,
  quickAccess, security, settings, shortcuts, vault）预计新增 3 个
  （`watchtower`, `trash`, `matchRule`）。
- 相对日期三语排版手动核对（阶段 3 已列）。
- Quick Access 补监听 `passless-theme-color-changed`（该事件随 picker 删除而消失，
  实际是**删监听**）与 `passless-security-preferences-changed`（design.md §6.3）。

---

## 验证

自动化：
- `securityPreferences` 测试：旧值 `'4h'` / `'8h'` 迁移到合法值；
  未知值不再产生 NaN；枚举与 1Password 全集一致。
- 假开关回归锁：每个保留的偏好都有**一个断言其效果的测试**，
  没有测试的偏好不允许出现在界面上。
- Settings 结构测试：tab 集合、关闭按钮、import/export 预览互不串台。
- 门禁四连。

手动（只能真机）：
- 合盖 5 分钟 → 回到锁屏；屏保触发 → 锁。
- 剪贴板单开关实测：复制到剪贴板 → 90 秒后被清除，且**关闭窗口后**仍被清除
  （逻辑已挪到 Rust）；一次性密码走同一条路径。
- 密码可见时长 5s / 15s 自动隐藏。
- Touch ID 失败降级到主密码；`accountPasswordRequirement` 到期后强制主密码。
- 打包构建 CSP 未破（`npm run tauri build`）。
- 三窗口在 `<560px` 单栏态下的观感（阶段 3.8 的延续）。

## 交付

跑 `implement.md` 的交付检查单。其中三项要特别注意：

1. **字体许可证**：`public/fonts/JetBrainsMonoNL-SemiBold.ttf` 缺 SIL OFL 1.1 文本，
   未解决前**不得发布**。本阶段不负责解决，但必须在交付报告里明确它仍是阻塞项，
   不得因为"这轮没碰它"就默认它已解决。
2. **`docs/` 删除**：三个前置条件（评审通过、git 基线已提交、用户单独确认
   `docs/superpowers/` 那个外来文件的处置）全部满足才执行。
   删除后同步更新 `AGENTS.md` 指向 `docs/` 的三处引用。
3. **运行时验证欠账**：AGENTS.md 记录的"托盘 / `⌘⇧Space` / Quick Access / 自启动 /
   CSP 从未在真机验证过"—— 阶段 0 建立基线，阶段 4 末再跑一次，
   两次结果都写进交付报告。任何一项从"通过"变"失败"都必须在发布前修。
