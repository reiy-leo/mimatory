# 设计规格 — Cupertino Vault 界面重构

> **评审从这里开始。** 阅读顺序：本文 §0（冲突与待拍板）→ §7（决策汇总）→ §8（验收标准）
> → 需要看流程再看 [flow.md](flow.md)；执行细节在 [implement.md](implement.md) 与其四个
> phase 文件，评审阶段可以跳过。就绪判定见 §10.3。

- 输入：Stitch 原型 `stitch_1password_web_clone`（4 屏，`/tmp/stitch/…`，2026-10-08 解包）
- 输入：`docs/design/2026-10-07-cupertino-vault-design-spec.md`（视觉与布局唯一来源）
- 输入：1Password 8 macOS 支持文档约 30 页（快捷键、侧栏、分类、自定义字段、搜索、
  归档/删除、条目历史、锁定策略、Watchtower、剪贴板、导入导出、1PUX 格式、桥安全、
  自动填充、设置存储）；清单与局限见 §10.1
- 输入：当前实现全量盘点（`src/App.tsx` 3022 行、`src-tauri/src/*`、`src/app/*`）
- 流程说明：[flow.md](flow.md)；执行计划：[implement.md](implement.md)

---

## 0. 先读这一节：冲突与需要你拍板的决策

原型、1Password 真实行为、AGENTS.md 已裁定项、当前实现四方互相不完全一致。分成四档：

- **一档**：与 AGENTS.md 已裁定项矛盾 → 裁定不重开，只是实现没跟上。不用你决定，只需确认排期。
- **二档**：原型自相矛盾，或原型与 1Password 真实行为矛盾 → **必须你拍板**。
- **三档**：原型要求的能力当前根本不存在，需要动 schema 或 Rust → 要你确认范围边界。
- **四档**：命名、像素、间距类细节 → 我按设计稿+HIG 直接定，列出来只为透明，不占用你的注意力。

### 0.1 一档 — 已裁定，实现待跟进

| # | 冲突 | 各方立场 | 处置 |
|---|---|---|---|
| C-01 | 主题色选择器 | 裁定 #6：primary 固定 `#0572EC`，**不可**用户配置。原型 Appearance 只有 System/Light/Dark，无彩色选择器。实现却有 22 色 picker（`theme.ts:36-57`，`App.tsx:2397-2412`） | 删除 picker。`--passless-*` 别名层保留但不再被用户覆写 —— 这是让 token 层成为唯一色彩来源的前提 |
| C-02 | `⌘K` 语义 | 裁定 #1：`⌘K` → 搜索/命令面板。实现：`⌘K` = 锁库（`App.tsx:597`） | 见 D-01，锁库快捷键要一并改 |
| C-03 | 同步后端 | 裁定 #2：迁到 iCloud Drive / Google Drive 文件。原型只显示 "Vault Synced (AES-256)" / "Synced" 徽标，无任何 GitHub 字样。实现：`github_sync.rs` 全量在场，Settings 里第 4 个 tab 整页是 GitHub | 本次**不新建 GitHub 界面**。同步 UI 收敛为 provider 无关的状态指示（见 D-06），`github_sync.rs` 原样保留待裁定 #2 排期 |
| C-04 | 断点 | 裁定 #4：`<820px` 两栏 / `<560px` 单栏。实现：`tauri.conf.json` `minWidth: 960`，`styles.css` **零条 `@media`** | 见 D-08，是排期问题不是方向问题 |
| C-05 | 界面字体 | 裁定 #5：`-apple-system`。设计稿 front matter 与正文都写 Inter | 按裁定走 `-apple-system`。设计稿该处已被 AGENTS.md 标注为过时 |
| C-06 | 暗色模式 | 裁定 #7：支持，但设计包**没有暗色 token 表**，`styles.css:111` 只是把旧值搬到 token 名上 | 见 D-07：先加 System 跟随，真正的暗色调色板单列一期 |
| C-07 | 设计 token | 裁定 #9：名字在 `tailwind.config.js`，值在 `styles.css :root`。已就位 | 新 token 一律走这条，**不加第四层别名** |

### 0.2 二档 — 必须你拍板

#### D-01 快捷键总表：原型 + 裁定 #1 与 1Password 冲突

裁定 #1 说 `⌘K` 是搜索/命令面板，原型搜索框占位符也写 `⌘K`。但 1Password 8 官方快捷键表里
**根本没有 ⌘K**：它用 `⌘F` 搜索、`⌥⌘F` 在当前列表内查找、`⌘⇧L` 锁库、`⌘/` 看快捷键表。
当前实现只注册了 4 个（`⌘,` `⌘N` `⌘F` `⌘K`），且 `⌘K` 是锁库。

推荐方案（改可见行为，需你确认）：

| 键 | 推荐语义 | 备注 |
|---|---|---|
| `⌘K` | 全局搜索 + 命令面板 | 同时满足裁定 #1 与原型占位符 |
| `⌘F` | 聚焦当前列表的过滤框（不是全局搜索） | 对齐 1Password 的 in-list find |
| `⌘⇧L` | 锁库 | **从 `⌘K` 迁走**，对齐 1Password |
| `⌘N` | 新建条目（弹类型选择） | 已有 |
| `⌘E` | 进入编辑 | 新增 |
| `⌘S` | 提交编辑 | 新增 |
| `Esc` | 取消编辑 / 清空搜索 | 新增 |
| `⌘C` / `⌘⇧C` / `⌥⌘C` | 复制用户名或主字段 / 密码 / 一次性密码 | 新增；**顺序别记反**，1Password 文档里 `⌥⌘C` 才是 OTP |
| `⌘R` | 显示/隐藏安全字段 | 新增 |
| `Delete` / `⌘Delete` | 移入 Archive / 移入 Recently Deleted | 新增，两个键两个去向，与 1Password 一致 |
| `⌘⇧F` | 在浏览器打开该条目的站点并填充 | 新增（对应 `⌘\` 全局自动填充之外的应用内入口） |
| `⌘⇧D` | 折叠/展开侧栏 | 新增，同时是 D-08 两栏态的入口 |
| `⌘/` | 快捷键速查浮层 | 新增，替换 Settings 里只读的 Shortcuts tab |
| `⌘1`–`⌘9` | 切换 vault | 新增，1Password 里这组键切的是账号/集合而非分类 |
| `↑↓` | 列表内移动选中行 | 新增（当前列表**完全没有键盘导航**） |

代价：`⌘K` 从锁库改成搜索，会让肌肉记忆反转。若你更看重"绝不误触锁库"，可以把搜索留在
`⌘K` 但要求二次确认——不推荐，1Password 没有这个负担。

#### D-02 编辑会话：自动保存还是显式保存？

原型同一屏上同时出现 "Draft auto-saved 14s ago" 和 `取消 / 保存` 两个按钮，自相矛盾。
1Password 桌面版快捷键表里 `⌘S` = "Save changes to an item"、`Esc` = "Cancel an edit"，
说明它**是显式提交会话**。当前实现也是显式（`isEditing` + Save 按钮，`App.tsx:460/1930`）。

三个选项：

- **A（推荐）显式提交 + 崩溃草稿**：编辑会话内每次变更防抖写入本地草稿，UI 显示
  "草稿已自动保存 Ns 前"；只有 `⌘S`/保存 才 `update_login_item` 落库；`Esc` 丢弃。
  异常退出后下次进该条目提示恢复。既解释得通原型两个元素共存，也保住当前实现结构。
- **B 纯自动保存**（1Password 移动端观感）：删掉保存按钮，字段失焦即落库。
  需要防抖 + 冲突检测，且与 `update_login_item` 的**整文档替换**语义（`vaultApi.ts:202`）
  相撞 —— 半编辑状态被自动写回会覆盖并发的扩展 `/save`。
- **C 纯显式**：删掉 "auto-saved" 文案。最省，但丢掉崩溃恢复。

选 A 会引入一个新的草稿存储（localStorage 明文不可接受，必须是加密侧车或 Rust 侧），
这是**安全面扩大**，见 §5.4。

#### D-03 分类口径：三套列表不一致

| 来源 | 内容 |
|---|---|
| 原型侧栏 | All Items / Logins / Secure Notes / Credit Cards / Identities / Passwords / Documents & Keys / Software Licenses / Bank Accounts（9 行，带计数） |
| 实现 `itemTypes`（`App.tsx:380-399`） | 18 种：上述之外还有 passport, driver_license, wifi, api_credential, server, database, email, router, crypto_wallet, passkey |
| 实现 `categoryItems`（`App.tsx:191-204`） | 12 种，与上面两套都不重合 |

后果已经发生：6 个类型（passport / driver_license / wifi / api_credential / crypto_wallet /
passkey）在类型下拉里能选，但**侧栏没有入口**，选了之后除了搜索再也找不到。

推荐：单一 `itemCatalog` 模块作为唯一来源，侧栏行、类型下拉、图标、i18n key 全部由它派生。
具体保留哪些类型要你定：

- **A（推荐）** 原型 8 类 + `Passkeys` + `Api Credentials` + `Servers` + `Databases`，
  砍掉 passport / driver_license / wifi / router / email / crypto_wallet（这些在密码管理器里
  是低频且无专属字段模板的伪分类）。
- **B** 全保 18 类，侧栏可折叠分组。
- **C** 只保原型的 8 类，其余类型从下拉里移除（**存量数据会变成无类型的孤儿**，需要迁移映射）。

注意：**类型不改变当前渲染的表单**（18 类共用同一套通用字段），原型的
"Standard Credentials" 分组暗示 login 类要有专属模板。这是 D-04。

**1Password 的官方口径可以化解这个三向不一致**：它的分类全集是
Common（`Login / Password / Credit Card / Identity / Secure Note / Document`）+
Other（`API Credential / Bank Account / Crypto Wallet / Database / Driver License /
Email Account / Medical Record / Membership / Outdoor License / Passport /
Reward Program / SSH Key / Server / Social Security Number / Software License /
Wireless Router`），而**侧栏显示哪几行是用户在 `Settings > Appearance > Categories`
里勾的**。也就是说"全集"和"侧栏行"本来就不该是同一个列表 —— 当前 9/18/12 的冲突
是因为把两件事写在同一处。所以推荐的落法是：`itemCatalog` 持全集（18 类大致能对上，
缺 `Medical Record / Membership / Reward Program / Outdoor License / SSH Key`，多
`passkey`），侧栏只渲染被启用的子集，默认取原型那 9 行 + `Passkeys`，
其余通过 Settings 打开。这比 A/B/C 都更接近 1Password，且不砍存量数据。

另一个值得照抄的官方行为：**`Password` 类目在创建时填了用户名就自动转成 `Login`**，
这解释了为什么"Passwords"能作为独立分类存在。当前实现没有这条转换，
`password` 与 `login` 是两个平行死类。

#### D-04 按类型定制字段模板 = 本期做还是不做？

原型编辑页把字段组织成 "Vault Assignment / Item Title / Tags / Standard Credentials /
Websites & Autofill Rules / Custom Fields / Secure Markdown Notes / Encrypted Attachments"。
当前实现是**一个通用表单服务全部 18 种类型**，`item_type` 只影响标签文字和侧栏图标。

- **A（推荐）** 本期只做 `login` 的完整模板（它占真实数据绝大多数），其余类型继续用通用表单，
  但把"区块"从硬编码 JSX 抽成数据驱动的 section renderer，为后续类型铺路。
- **B** 全部 8 类都做专属模板。工作量约为 A 的 3–4 倍，且每类都要设计字段映射到
  `item_fields(field_key, field_type, value_ciphertext)` 这张扁平表。
- **C** 本期完全不做模板，只重排视觉分组。最省，但原型里 Credit Card 的卡号/有效期/CVV
  之类就只是好看。

无论选哪个，**字段类型的词表是先决条件**，而当前 `item_fields.field_type` 是自由字符串。
1Password 官方给的自定义字段类型恰好是一份闭合清单：
`Text（默认）/ URL / Email / Address / Date / Month-Year / Phone / Password /
One-Time Password / Security Questions / Sign in with`，入口文案是 `Add More`、
区块标题是 "Add a custom field"，重排是物理拖拽把手。两个连带事实值得一起落：
`Date` 字段带 `Set expiry alert`（这就是 Watchtower "Expiring items" 的唯一数据来源），
`One-Time Password` 是一个**字段类型**而不是条目上的专属列（当前实现里 TOTP 藏在
`totp_*` 专用字段里，与官方模型不同）。所以阶段 2 的 `sections` 表要同时收
`field_type` 白名单，且白名单在 Rust 侧归一化、未知值降级为 `Text` 并记审计
（与 `item_type` 同一策略，见 §5.1）。

#### D-05 附件上限 100MB 与内联 BLOB 冲突

原型："Support for .pem, .id_rsa, PDF, images up to 100MB"。
实现：`attachments.content_ciphertext BLOB` **直接内联在 SQLite 里**（`storage.rs:175-182`），
读取时整块解密进内存。

100MB 内联意味着：一次 `list_login_items` 全表扫描会把所有条目的所有附件解密到内存；
备份/快照/同步都按整库走，一个 100MB 附件会让每次自动同步重写 100MB 密文。
这条**不能照原型实现**。

- **A（推荐）** 附件改为私有目录里的独立加密侧车文件（走 `storage::set_private_permissions`
  0600 / `create_private_directory` 0700），DB 只存元数据（id, item_id, file_name, byte_count,
  content_nonce, content_key_ciphertext）。上限提到 100MB 才成立。顺带解决审计遗留项 #3
  （解密临时文件清理）。
- **B** 保持内联，上限降到 10MB，UI 不再宣传 100MB。
- **C** 本期完全不动附件，只改样式。

A 是一次真实的存储层迁移 + 加密改造，安全权重高（密钥不能进 DB 明文列，也不能违反
"vault key 永不落盘"），必须你点头。

#### D-06 同步 UI 的暴露面

裁定 #2 未排期，但原型 Settings 第 4 项是 Accounts、侧栏底部是 "Vault Synced (AES-256)"。
当前 GitHub tab 有 repo URL / PAT / branch / path 四个输入框和一个 PAT 保存按钮。

- **A（推荐）** 本期把同步 UI 收成**一个 provider 无关的状态组件**（已同步 / 同步中 / 失败 /
  从未同步 + 最近同步时间），GitHub 细节折叠进"高级"，不删代码、不改行为。
- **B** 现在就实装 iCloud Drive 文件同步，替掉 GitHub。范围显著扩大，且裁定 #2 只说了方向，
  没说账号体系（Passless 是单库无账号，iCloud Drive 路径策略要新设计）。
- **C** 完全不动，GitHub tab 原样保留。与原型视觉不符。

"Vault Synced (AES-256)" 这类文案是**能力宣称**：在 B 落地前，A/C 都不应显示"已同步"，
只显示本地状态，避免误导。

#### D-07 System 主题 vs 暗色调色板欠账

原型 Appearance 有 `System / Light / Dark` 三档。当前只有 Light/Dark 两个按钮
（`App.tsx:2378-2391`），且裁定 #7 明确暗色 token 表是欠账。

- **A（推荐）** 本期加 `System`（`matchMedia('(prefers-color-scheme)')` + 监听变更），
  暗色调色板**仍留欠账**，不假装做完了。
- **B** 本期一并补齐暗色 token 表。需要你先给暗色设计基准，否则就是我在编设计。
- **C** 不加 System，保持两档。

A 的风险：System 跟随会让用户更容易进入那个尚未设计好的暗色态，把 C-06 的欠账暴露在
更多人面前。若你认为暗色欠账不该被更容易触达，就选 C。

#### D-08 断点与 `minWidth: 960`

裁定 #4 要求 `<820px` 两栏、`<560px` 单栏。当前 `tauri.conf.json` 的 `minWidth: 960`
让窗口根本缩不进去，`styles.css` 也没有任何 `@media`。

- **A（推荐）** 本期把 `minWidth` 降到 560，实现两档折叠：`<820` 侧栏变 overlay
  （`⌘⇧D` 唤出），`<560` 单栏 push/pop。
- **B** 本期只降到 820，做两栏；单栏留后期。
- **C** 本期不动窗口尺寸，只做三栏视觉。裁定 #4 继续挂账。

A 会牵动 §3.2 三栏的每一条宽度约束，且 macOS 上"单栏"意味着详情页要能推回列表，
是导航栈问题不只是 CSS。

#### D-09 无密码重置：本期是否处理

2026-10-08 你因忘记密码真实丢过一次库。当前 Rust 侧**不存在任何改密/恢复路径**
（`vault.rs` 只有 `setup_master_password`，一次性）。

这属于产品级决策，不是界面重构的一部分，所以我把它列出来但默认**不在本期范围**：

- **A（推荐）** 本期只在锁屏加一句明确的"无法找回"提示 + 指向加密备份恢复的说明，
  不改密码学。另立一期做改密与恢复码。
- **B** 本期一并设计恢复码机制（需要新的密钥封装流程，动 KDF 与存储格式）。
- **C** 完全不提，保持现状。

C 我不建议：你已经付过一次真实代价，界面上至少要说清楚。

#### D-10 要不要把 Version History 纳入本期

N-12 + N-15 合起来是一整套"条目变更留痕"子系统：新表、写入钩子、保留策略、
加密（历史版本同样是明文密文）、UI 时间线、恢复动作。它和裁定 #2 的同步方案会互相影响
（同步冲突解决通常需要版本向量）。

- **A（推荐）** 本期**不做**，只在详情页放一个禁用的 "版本历史" 占位区块，另立一期。
- **B** 本期做最小版：每次 `update_login_item` 前把旧整文档存一行，只显示不恢复。
- **C** 本期做完整版（含恢复）。

选 B/C 都要先回答"保留几版、谁清理、密文放哪"，我不建议在界面重构里顺手定。

#### D-11 锁触发来源与安全偏好枚举

两个绑在一起的问题，因为在当前实现里无法分开修：

**其一，锁的判定只活在渲染进程。** 唯一的自动锁是一个 `setTimeout`
（`App.tsx:606-614`），靠 `mousemove/mousedown/keydown/scroll/touchstart` 重置。
它感知不到系统休眠、屏保，也感知不到应用被切到后台 —— 而合盖再打开时会话密钥
仍然在内存里。空闲计时器还依赖渲染进程存活，窗口关了但进程活着时行为不稳定。

**其二，8 项安全偏好里 5 项完全没有可观察效果**（`lockWhenDeviceLocks`、
`unlockWithMacPassword`、`deviceUnlockDuration`、`accountPasswordRequirement`、
`useUniversalClipboard`），且 8 项全部只写 localStorage + 发事件，**从不发给 Rust**。
在密码管理器里，一个不生效的安全开关比没有开关更糟。

三方枚举还互不一致（详见 implement_phase_4.md §4.3 的对照表）：空闲锁定、剪贴板清理、
密码可见时长三项，1Password、原型、当前实现各一套值。

锁的触发来源在 1Password 桌面端是**四个独立开关**，而不是一个枚举，这是本期对齐的目标：
`Lock when device locks or sleeps`（含切换用户）、`Lock after the device is idle for`、
`Auto-lock on exit`（离开应用后多久）、`Allow 1Password to prevent your device from sleeping`
（配合 `Show in Large Type`）。另外两条有据的约束值得抄：解锁/自动锁设置**不跨设备同步**，
以及"签名出"会移除本地库数据而"锁定"不会。

- **A（推荐）** 锁的权威判定移到 Rust（`shell.rs` 订阅会话/屏保通知，实现上面前三个开关）；
  5 个假开关逐个"接上或删除"，不允许保留无效果开关；枚举按 implement_phase_4.md §4.3
  的判定收敛（空闲锁定取桌面文档那一组 + `never`、剪贴板保持**单开关**、
  **新增**密码可见时长 —— 最后这一项的 5s/15s 是我自定的，1Password 文档里没有）；
  并把"锁/解锁偏好不参与同步"写进裁定 #2 的约束。
- **B** 只移锁判定，假开关本期不动。风险：把"界面承诺 > 实际行为"的状态再留一期。
- **C** 只删假开关，锁判定留后期。工作量最小，但把合盖不锁这个真实暴露面留着。

A 的范围明显大于 B/C：它要求 `shell.rs` 改通知订阅、偏好写入走 Rust、
外加一个新的可见时长计时器。若你认为本期重心应该完全放在界面上，选 C 并另立一期。

#### D-12 vault 隔离要不要成为真实承诺

承接 §0.3 末尾"vault 不是安全边界"。当前所有 vault 共用一把密钥，
原型的 "Vault Assignment" 却按"Personal / Work / Shared Family"这种访问控制的样子在画。

- **A（推荐）** 本期把 vault 明确呈现为**组织分组**：文案不出现"隔离/独立加密"，
  vault 列表旁标注"共用同一主密码"。`move_item_to_vault` 因此是廉价的一次 UPDATE。
- **B** 本期做真正的每库独立密钥。这会改动 KDF 派生、`AppState` 会话结构、
  锁屏流程、备份格式与 `.1pux` 导入，**远超界面重构范围**，应另立规范。
- **C** 本期完全不做 vault 区（N-14 推后），保留详情顶栏的切换器。与原型不符，
  但回避了宣称与实现不符的问题。

选 A 需要文案纪律；选 B 会把本期范围翻倍。

### 0.3 三档 — 原型要求但当前完全不存在的能力

这些不是"要不要做"的方向问题，而是"做的话要动哪里"的范围问题。默认全部纳入本期，
若你要砍请直说编号。

| # | 原型元素 | 当前状态 | 需要的改动 |
|---|---|---|---|
| N-01 | 侧栏每个分类后的**计数**（All Items 142, Logins 86…） | 全应用**没有任何计数渲染** | 新增 `count_items_by_type` 命令，或前端从已加载列表算（后者在归档/回收站语义下会错） |
| N-02 | 列表行的**相对日期**（Yesterday / Oct 12 / Aug 14） | `updated_at` 在 `LoginItem` 上存在（`vaultApi.ts:22`）但 `App.tsx` **零引用** | 纯前端；需要 i18n 化的相对时间格式化 |
| N-03 | 列表行的 **2FA 徽标**与 **tag 药丸** | 行内只渲染字母头像 + 标题 + 副标题 + 星（`App.tsx:1400-1413`），tags 从不出现在列表 | 前端；tag 色板见 N-07 |
| N-04 | 列表行的 **favicon / 类型图标** | 行内永远是首字母头像，`categoryItems` 的 icon 只在侧栏用 | 前端；favicon 需决定来源（见四档 T-06） |
| N-05 | 搜索**直接过滤列表** | 顶部搜索是独立下拉，`.slice(0, 8)` 硬截断、**只匹配标题**，不改变列表内容（`App.tsx:634-638`） | 前端 + 把 `list(query)` 的服务端参数真正用起来（`vaultApi.ts:178` 支持但从未传参） |
| N-06 | 排序控件（原型列表头部的 sort 图标） | 全应用**零 `.sort()` 调用**，顺序 = `ORDER BY updated_at DESC` | 前端 + 排序偏好持久化 |
| N-07 | **tag 颜色**与按 tag 筛选 | `tags` 表无 color 列；侧栏 "Tags" 只是"有任意 tag"（`App.tsx:626`） | schema 加 `tags.color`，或按 name hash 派生色（免迁移，推荐） |
| N-08 | 自定义字段/区块**拖拽排序** | 有装饰性 `☰` 把手（`App.tsx:1681-1683`，`aria-hidden`），**无任何拖拽逻辑**；`item_fields.position` 列已存在 | 前端拖拽 + 提交 position |
| N-09 | 密码生成器三预设（Random / Memorable / PIN）+ 排除易混淆字符开关 | `PasswordGeneratorOptions` 只有 length + 四个字符集布尔（`vault.rs:120-126`）；且**永远**排除易混淆字符（`vault.rs:1127-1133` 的字面量里没有 I/O/l/0/1），无法关闭；无 memorable、无 PIN | Rust 扩 options + 词表 + 新测试；UI 目前还**硬编码 length 24 忽略自己的 `generatorOptions` state**（`App.tsx:1053-1063` vs `449-455`） |
| N-10 | 密码**熵值显示**（"Entropy: 128 bits (Exceptional)"）+ 强度条 | 有 `is_weak_password` 与 watchtower score，但**无逐条熵值**，详情里不显示 | **放 Rust**（`estimate_password_strength`），与 `is_weak_password` / watchtower 同源，避免两套强弱判定；分档边界与 `bits → tier` 映射写成有单测的纯函数 |
| N-11 | 自动填充**匹配规则**（Exact / Base domain / Never submit） | `item_urls` 只有 `label` + `url`（`storage.rs:155-161`），无匹配模式列 | **安全相关**，见 §6.5；schema 迁移 + 桥侧匹配重写 |
| N-12 | **Version History (5 revisions)** | 无表、无命令。`sync_history` 是**整库快照**不是逐条目 | 新表 + 新命令 + 新 UI；范围最大的一项，建议单列一期（见 D-10） |
| N-13 | **回收站 UI** + 30 天到期 | 列与 4 个命令齐备，零 UI，**零到期清理** | 前端 + Rust 启动时 sweep |
| N-14 | Vault 归属选择器 + 跨库移动 | `items.vault_id` 存在，侧栏无 vault 列表（切换器在详情顶栏 `App.tsx:1431-1443`），**无移动条目的命令** | 新命令 `move_item_to_vault` + 侧栏 vault 区。**但见下方"vault 不是安全边界"** |
| N-15 | 密码**历史**（原型 "reveal + history"） | 无存储 | 与 N-12 同源，一并推到 D-10 |
| N-16 | Watchtower 作为**侧栏一等页面** | 侧栏有入口但列表区只显示一张提示卡 + "Open Settings"（`App.tsx:1388-1397`），报告在 Settings 第 6 tab | 纯前端搬迁 |
| N-17 | Quick Access "显示最近条目" | 窗口存在但从没在真机跑过（AGENTS.md 已知缺口） | 运行时验证欠账，不是新功能 |

#### vault 不是安全边界（原型隐含的能力宣称，必须纠正）

原型的 "Vault Assignment（Personal / Work / Shared Family / + Create New Vault）"
和侧栏的 vault 区，读起来像"工作库和个人库在密码学上是隔离的"。
**实际不是。** `Session { key: VaultKey, vault_id }`（`vault.rs:24-27`）只持有**一个**密钥，
`switch_vault` 走 `session_for_vault`（`lib.rs:210-212`）复用同一把 `VaultKey` 只换
`vault_id` —— 全部 vault 由**同一个主密码**派生的同一把密钥解密。

推论，两条都要写进实现：

- **好消息**：`move_item_to_vault` 是一次 `UPDATE items SET vault_id = ?`，
  不需要重新加密任何东西。N-14 的成本因此很低。
- **必须纠正的**：UI 不得暗示 vault 之间互相隔离。一个主密码泄露 = 全部 vault 泄露；
  一个 vault 的解密失败也不影响其他 vault 的可见性。文案上"库"应读作"分组"，
  或明确标注"vault 是组织方式，不是访问控制边界"。这与 §2.5 的假开关是同一类问题：
  **界面承诺 > 实际行为**。
- 若产品需要真正的隔离（每 vault 独立密钥/独立主密码），那是一次密码学改造
  （KDF 盐、密钥封装、锁屏流程全变），**不在本期范围**，需要另立规范。
  见 D-12。

### 0.4 四档 — 我直接定的细节

| # | 事项 | 判定 |
|---|---|---|
| T-01 | 列表栏宽度 | 设计稿写 260–360px，实现是默认 220 / 夹在 180–250（`App.tsx:432/828`）。**按设计稿改成 min 260 / max 360**，并把宽度持久化（当前不持久化） |
| T-02 | 侧栏宽度 | 设计稿 200–280px，实现固定 244px 不可调。保持 244 默认，加可调范围 200–280 并持久化 |
| T-03 | 列表行高 | 设计稿 56px，实现未显式约束。定为 56px |
| T-04 | 控件高度 | 设计稿 toolbar 搜索 30px / 详情编辑器 36px。全局 `input` 现为 `h-10`(40px)。**详情内降到 36px**，工具栏搜索 30px |
| T-05 | TOTP 显示格式 | 设计稿与原型都是 `492 817`（空格），实现是 `492 • 817`（`totpDisplay.ts:6`）。**改成空格**，并补"最后 5 秒由绿转红"（设计稿要求，当前只有环形进度） |
| T-06 | favicon 来源 | 不发网络请求（隐私：请求会泄露你存了哪些站）。**首字母 + 类型图标兜底**，仅当条目 URL 命中已内置的少量品牌图标时用品牌图标 |
| T-07 | tag 颜色 | 免迁移：按 tag 名的 hash 从固定 8 色低饱和色板取色（对齐设计稿 `rgba(5,114,236,.1)` 那类淡底） |
| T-08 | 密码遮罩点 | 设计稿 `#48484A` / 7px 圆点 / 6px 间距。实现是普通 `type=password` 输入框。**本期保留原生圆点**，自绘 mask 属于视觉债不属功能债 |
| T-09 | 双语标签 | 原型里 `取消 / Cancel`、`归档条目`、`移至废纸篓` 等中英并排是**设计稿标注手法**，不是界面要同时显示两种语言。走 i18n，单语渲染 |
| T-10 | 硬编码英文清理 | 至少 5 处：品牌名 `Passless`（`App.tsx:1267`）、URL label 默认值 `'website'` 常量（`App.tsx:116`，**会写进保存的数据**）、颜色 label 未译（`App.tsx:2407`）、若干 placeholder 字面量、窗口标题 `'Passless Settings'`（`App.tsx:1159`） |
| T-11 | Apple Watch 解锁 | 原型 Settings 有这一行。本项目无 watch 组件 → **不实现，不显示** |
| T-12 | 语言 "Follow System" | 原型有，实现只有 zh/en/ja 三档无跟随系统。**加**，映射规则：系统语言不在 {zh,ja} 时落 en |
| T-13 | 空闲锁定的计时位置 | 当前 `setTimeout` 在渲染进程（`App.tsx:606-614`），感知不到休眠/屏保/后台。见 D-11 |
| T-14 | 错误横幅 | 解锁后的详情区**只有 success-banner，没有 error-banner**（`App.tsx:1938`；error-banner 只存在于锁屏 `1244` 和 Settings `2320`）。补上 |

---

## 1. 目标与非目标

### 目标

1. 把主窗口对齐成设计稿的 macOS 三栏（源列表 / 条目列表 / 详情检查器），并让
   **视觉来源收敛到 token 层**：组件规则里不出现字面 hex，不新增第四层别名。
2. 把 `App.tsx` 从 3022 行单文件拆成可维护的模块边界 —— 这是所有 UI 改动的先决条件，
   否则任何一处改动都要在 3000 行里做上下文切换。
3. 补齐原型的交互语义：搜索即过滤、显式编辑会话、键盘导航、归档/回收站双生命周期、
   tag 筛选、分类计数。
4. 修掉两处**安全正确性**缺陷：桥的 origin 子串匹配（§6.5）、附件与草稿的存储边界。
5. 让三窗口状态一致（§6.3）。
6. 所有新增可见文字走 i18n，保持 zh/en/ja 三语 parity（已有测试守着）。

### 非目标

- 不改密码学：KDF、AES-GCM envelope、备份格式 `passless-backup-v1` 不动。
- 不实现 iCloud/Google Drive 同步（裁定 #2 另立项目）。
- 不实装 Version History（D-10 默认推后）。
- 不改 `.1pux` 导入器，但它比"分类塌成列表"严重得多，这里记一笔免得被误分类成低优先级：
  ZIP 与 `accounts→vaults→items` 的遍历其实**是对的**，错在条目内部取值全读错了层级 ——
  真实文件把内容嵌在 `overview.*` 与 `details.*` 下，而 `parse_login_item` 从条目根读
  `title / url / urls / tags / notesPlain / fields`（`import_1pux.rs:90-198`），六个查找
  **全部落空**：`title` 回落到字面量 `"Imported Login"`（`:104`）、`urls` 空、用户名密码来自那个永不
  执行的 `fields` 循环（`:124`）。真实导出跑一遍的结果是"N 条同名空条目"，而 `ImportPreview` 报出来的
  `total_items` 计数看着完全正常。唯一读对的 `categoryUuid` 只用来**过滤**，不含
  "login"/"001" 的条目直接进 `unknown_items`（`:91-99`），所以信用卡/便签/身份信息是被
  **丢弃**而非塌陷。裁定 #8 问的"为什么分类塌了"其实问错了。
  修它的门槛也比原先以为的低：官方 `1pux-format` 页已公布完整真实结构，把上表六行对齐就是
  起点，真实样本只是验证手段。唯一仍然缺的是 `categoryUuid` 的取值表（官方只给了 `"001"`
  一个例子），所以任何凭记忆写的映射都是猜 —— 在那张表被回答之前不要动裁定 #8。
- 不扩大浏览器桥的可达面：不加新端点、不改 `Access-Control-Allow-Origin: *` 的既有行为、
  配对 token 保持常量时间比较。
  顺带明确一件事，免得后面有人拿 1Password 当"锁着也能填"的依据：1Password 有**两套**自动填充
  模型 —— ① 扩展与桌面应用配对、**共享锁状态**；② macOS 系统级 AutoFill，把认证委托给
  Touch ID/登录密码，**不需要应用运行**。passless 的桥是①（`current_session` 在锁定时直接
  返回 `"vault is locked"`，`browser_bridge.rs:223-229`），这是本规范有意保留的选择：
  ②意味着密钥可以在无主密码会话的情况下被使用，与本项目的"密钥从不落盘"前提冲突。
- 不做多账号（原型 Accounts tab 见 §4.1 的处置）。

---

## 2. 现状（作为设计输入的事实）

### 2.1 前端结构

全前端只有 **5 个组件**，全在 `App.tsx`：`App`(412)、`VaultWindow`(424-1944)、
`SettingsWindow`(1967-2829)、`QuickAccessWindow`(2831-3022)、`ItemSearchField`(275-342)。
没有 `src/components/`，没有按钮/输入/行抽象，没有 modal 原语，没有路由。

`VaultWindow` 一个组件里同时持有：数据加载、搜索、选择、编辑态、生成器、附件、
vault 切换、快捷键、空闲锁定计时器、主题、i18n、跨窗口事件 —— 约 1520 行。

### 2.2 主窗口布局

一个 CSS grid（`App.tsx:1260`）：`244px | itemListWidth | 6px | minmax(0,1fr)`。

| 栏 | 行号 | 宽度 |
|---|---|---|
| 侧栏 | 1261-1340 | 固定 244px，不可调不可折叠 |
| 顶部搜索条 | 1342-1372 | 跨 2–4 列，58px 被后层覆盖成 44px |
| 条目列表 | 1374-1419 | 默认 220，拖拽夹在 180–250，**不持久化** |
| 详情 | 1428-1941 | `minmax(0,1fr)` |

只读/编辑**不是两个视图**，是同一个内联表单被一个 `<fieldset disabled={!isEditing}>`
（`App.tsx:1565`）整体禁用。副作用要记住：只读态下密码的显示/复制/生成按钮**都是灰的**
（1606-1618），只有 Edit/Done、vault 选择器、Archive 可用。

### 2.3 数据模型（Rust/SQLite）

10 张表（`storage.rs:104-183`）：`meta, vaults, items, tags, item_tags, item_fields,
item_urls, settings, audit_events, attachments`。迁移是 `has_column` 判断 + `ALTER TABLE`，
无版本号迁移框架（`CURRENT_SCHEMA_VERSION` 只写进 `meta` 不用于分支）。

`items` 关键列：`item_type TEXT`（**自由字符串，无校验**）、`title_ciphertext`、
`favorite`、`archived`、`trashed`、`deleted_at`、`created_at`、`updated_at`。
注意：**标题加密，其余敏感内容都在 `item_fields` / `item_urls` / `attachments` 里加密**。

前端契约 `LoginItem`（`vaultApi.ts:10-23`）是**扁平固定形状**：
`title, username, password, website, urls[], notes, tags[], custom_fields[], favorite`。
`update` 是整文档替换。`created_at` 不在契约里（表里有），`LoginItem` 也不携带
"哪个字段属于哪个区块"的信息 —— 区块目前被 JSON 序列化塞进 `CustomField.value`
（`App.tsx:206-233`），这是要还的技术债。

### 2.4 命令面

`lib.rs:659-707` 注册 47 个命令。其中 `trash_login_item` / `list_trashed_login_items` /
`restore_trashed_login_item` / `purge_login_item` 四个已注册但**前端零调用**。

### 2.5 已确认的行为缺口

- 搜索不改列表（N-05）；零排序（N-06）；零键盘列表导航。
- `⌘K` 是锁库；只有 4 个快捷键。
- 无锁库按钮 —— `handleLock` 只能从 `⌘K` 和空闲计时器到达。
- 无同步按钮，无同步状态条（列表栏顶部那行显示的是数据库状态，`App.tsx:1375-1378`）。
- `window.prompt` 是唯一的原生对话框（新建 vault，`App.tsx:798`）。
- 8 项安全偏好只写 localStorage + 发事件，**从不发给 Rust**；其中 5 项
  （`lockWhenDeviceLocks`, `unlockWithMacPassword`, `deviceUnlockDuration`,
  `accountPasswordRequirement`, `useUniversalClipboard`）在前端也没有可观察效果。
  也就是：**界面上有开关，行为上没有对应实现**。这一条必须在重构里处理，
  否则是在扩大假开关的数量。
- `closeSettingsWindow`（`App.tsx:2250`）定义了但从未引用 —— Settings 没有关闭按钮。
- `navigation.ts` 的 `label` 和 `route` 字段是死数据。

---

## 3. 目标界面结构

### 3.1 模块边界（重构骨架）

先拆再改。目标目录：

```
src/
  app/
    itemCatalog.ts        # 唯一分类来源：type → {id, icon, section, i18nKey}
    matchRule.ts          # Exact / BaseDomain / NeverSubmit 的纯函数与测试
                          # （匹配本身在 Rust，见 §6.5；这里只有展示与类型）
  state/
    vaultStore.ts         # 取代散落的 useState；单一 mutation 出口 + 事件广播
    editSession.ts        # 编辑会话、脏检查、草稿
  components/
    shell/                # WindowChrome, Sidebar, ItemList, Inspector
    inspector/            # SectionRenderer, FieldRow, PasswordRow, TotpRow, TagPicker
    overlay/              # Popover, Menu, CommandPalette, Dialog（替换 window.prompt）
    settings/             # 每个偏好面板一个文件
```

硬约束：**所有会改数据的调用必须经过 `vaultStore` 的 mutation 出口**，出口负责
`emit('passless-vault-changed')`。这是 §6.3 一致性的实现方式，不是可选的重构口味。

### 3.2 三栏

| 栏 | 内容（自上而下） | 宽度 |
|---|---|---|
| 侧栏 | Vault 切换器（含计数）→ 搜索 → 主导航（全部/收藏/最近/已同步）→ Categories（分组，带计数）→ Tags（逐个 tag，带计数）→ Archive / Trash（带计数）→ 底部：Watchtower、Settings、同步状态 | 244 默认，200–280 可调，持久化；`<820px` 转 overlay |
| 条目列表 | 列表头（标题 + 计数 + 排序/筛选菜单）→ 行 → 空态 | 300 默认，260–360 可调，持久化 |
| 详情检查器 | 面包屑 + 操作条（Edit/Done/）→ 类型徽标 → 区块化表单 → 底部（Archive / Trash / 条目 ID） | `minmax(0,1fr)`，内容列最大 760px 居中 |

行的构成（56px）：图标 32×32 rounded 8 → 标题 + 副标题（用户名或 URL）→ 右侧 tag 药丸 /
2FA 徽标 / 相对日期。收藏星在 hover 或已收藏时常显。

### 3.3 详情检查器的区块

区块由 `SectionRenderer` 按数据驱动，不再硬编码 JSX：

1. **Vault 归属**（D-03/N-14）
2. **标题 + tag**
3. **主凭据**（用户名 / 密码 / 熵 / 生成器 / 一次性密码）— login 模板
4. **网站与自动填充规则**（N-11）
5. **自定义字段与区块**（N-08 拖拽）
6. **备注**
7. **附件**（D-05）
8. **安全建议**（Watchtower 单条视图）
9. **元数据**（创建/更新时间、条目 ID）
10. **版本历史**（D-10 默认禁用占位）

只读/编辑改成两个显式视图而不是一个 disabled fieldset：只读态**保留**复制/显示/打开
等动作按钮可用，只禁用输入。这条改变了当前最反直觉的行为（§2.2）。

---

## 4. Settings 窗口

原型 Settings 左栏 9 项：General / Accounts / Security / Privacy / Watchtower / Autofill /
Browser / Advanced。当前是 8 个 tab：general / appearance / import-export / sync / browser /
watchtower / security / shortcuts。

### 4.1 映射

| 原型 | 处置 |
|---|---|
| General | 保留现有 general，**并入 appearance**（原型的 Appearance theme 就在 General 页里），加 System（D-07）、Follow System 语言（T-12） |
| Accounts | **不做**。Passless 无账号体系，单库多 vault。左栏改成 "Vaults"（列 vault + 计数 + 新建），承接 N-14 |
| Security | 保留，但**必须先把 5 个假开关接上或删掉**（§2.5）。1Password 文档只给标签不给取值全集，所以对齐的是**语义**而非数值表：空闲锁定取桌面文档那一组 + `never`、删掉 4h/8h；剪贴板保持**单开关**并把区间写进标签（90 秒、含一次性密码），不做多档；密码可见时长（5s/15s/保持可见）是我自定的 T 档细节，无外部依据。三方枚举差异见 D-11，对照表在 implement_phase_4.md §4.3 |
| Privacy | 新增，从 Security 里拆出遥测/Universal Clipboard/截屏保护类 |
| Watchtower | 保留，但主窗口侧栏也要有真报告页（N-16） |
| Autofill | 新增：域匹配默认规则（N-11）、自动保存开关 |
| Browser | 保留现有 bridge tab，去掉"生成配对码"以外的暴露 |
| Advanced | 承接 import/export + sync 细节（D-06）+ 快照 |
| Shortcuts（当前 tab） | **删除静态表**，换成 `⌘/` 唤起的浮层（D-01） |

### 4.2 必须修的结构问题

- 加关闭按钮（`closeSettingsWindow` 已是死代码，接上即可）。
- import 与 export 两张卡**共用同一个 `importPreview` state**（`App.tsx:1974/2131`），
  一张卡的预览会串到另一张卡下面显示。
- 移除 22 色 picker（C-01）。
- TOTP 开发者工具卡（`App.tsx:2784-2800`）从 Security 移到 Advanced，并改用
  `totpDisplay.ts` 格式化（现在它自己拼 `"{code} ({n}s)"`，绕过了统一格式）。

---

## 5. 数据与契约变更

### 5.1 schema

| 变更 | 迁移动作 | 关联 |
|---|---|---|
| `item_urls.match_rule TEXT NOT NULL DEFAULT 'base_domain'` | `ALTER TABLE` + `has_column` 守卫 | N-11，安全 |
| `items.item_type` 加白名单校验 | **不加 DB CHECK**（存量有非法值会打不开库），改在 Rust 反序列化时归一到 `itemCatalog`，未知值降级为 `login` 并记 `audit_events` | D-03 |
| `item_fields.field_type` 同样加白名单 | 同一策略，未知值降级 `text`；`field_type` 现在是自由字符串（`storage.rs:150`） | D-04 |
| 区块成为一等结构 | 新增 `sections` 表（id, item_id, title_ciphertext, position）+ `item_fields.section_id`；把现在塞在 `CustomField.value` 里的 JSON 迁过去 | D-04，技术债 |
| 附件外置 | 新目录 `<app_data>/attachments/`，`attachments` 只留元数据（`content_nonce`、`content_tag`、`content_key_wrapped`） | D-05 |
| tag 颜色 | **不加列**，hash 派生（T-07） | N-07 |
| 回收站到期 | 不加列，`deleted_at` 已够；启动时 sweep | N-13 |
| 版本历史 | 本期不加表 | D-10 |

迁移纪律：沿用 `has_column` + `ALTER TABLE` 的既有风格（不引入版本号分支框架，那是另一件事）；
每个新列必须 `NOT NULL DEFAULT` 或可空，**不允许让旧库打不开**；每条迁移配一个
"旧 schema 建库 → 跑迁移 → 断言列存在且旧行仍可读" 的 Rust 测试。

### 5.2 前端契约

`LoginItem` 需要扩：`created_at`、`vault_id`、`section_id`（字段级）、`match_rule`（URL 级）、
`favorite` 已有。同时**必须**把整文档替换改成字段级提交，或至少加 `updated_at` 乐观并发检查
—— 否则 D-02 的草稿与扩展 `/save` 会互相覆盖。

推荐：`update_login_item` 增加 `expected_updated_at` 参数，不匹配返回
`Conflict` 错误，前端提示"此条目在别处被修改"。这是最小可行的并发保护，
不需要引入字段级 patch 协议。

### 5.3 新命令

```
count_items_by_type(vault_id) -> { [item_type]: number }
count_trashed_items() / count_archived_items()
list_tags_with_counts()
move_item_to_vault(item_id, target_vault_id)
estimate_password_strength(item_id) -> { bits, tier }   # 与 is_weak_password 同源，见 N-10
set_item_match_rule(item_id, url_id, rule)
sweep_expired_trash()                         # 启动时调用
```

### 5.4 草稿存储（若 D-02 选 A）

草稿含明文凭据，**绝不能进 localStorage**。约束：

- 落在 `storage::create_private_directory` 建的 0700 目录内，文件 0600；
- 用会话密钥加密（不落密钥本身，不违反"vault key 永不持久化"—— 密钥只在内存，
  密文落盘是允许的，与 `sync_history` 快照同一模式）；
- 锁定即删除；退出即删除；提交成功即删除；
- 上限：单条目一份，最多 N 份，超出按 `updated_at` 淘汰。

---

## 6. 跨切面约束

### 6.1 安全不可协商项（继承 AGENTS.md，重构不得削弱）

1. vault key 只活在 `AppState` session mutex 内；不缓存 Keychain、不写解密库、不进备份。
2. 应用写的每个文件都走 `set_private_permissions`(0600) + `create_private_directory`(0700)。
   解密临时副本没有第二道防线。
3. 备份文件保持加密（`passless-backup-v1`，Argon2id over 输入的备份密码 + 每文件随机盐），
   故意不用会话密钥。
4. 桥保持 `127.0.0.1:17891`、`ACAO: *`、配对 token 常量时间比较；**不新增端点、不扩可达面**。
5. 新窗口 label 必须同步进 `src-tauri/capabilities/main.json` 的 `windows`，否则运行时
   `invoke()` 被拒。
6. CSP 只在打包构建生效，任何新增外部资源都要用 `npm run tauri build` 验证。
7. `cargo fmt` 禁止运行。

### 6.2 视觉收敛

- 组件规则里不出现字面 hex；新 token 一律 `tailwind.config.js` 加名字 + `styles.css :root` 加值。
- 新别名必须**派生自** `--color-*`；不加第四层。当前已有三层（`--color-*`、`--theme-*`
  `styles.css:79-86`、`--passless-*` `87-101`）。
- 改 `styles.css` 前必须确认目标选择器**不在前一个 `@layer` 块里**：文件有两个
  `@layer base` 和两个 `@layer components`，后层赢，但前层不是死代码（约 149 个选择器
  只存在于前层）。
- `docs/superpowers/specs/2026-07-01-task-page-ui-design-spec.md` 里的 `theme-*` 工具类家族
  **不属于本项目**，不得作为配方来源。

### 6.3 三窗口一致性

规则：**任何 mutation 出口必须广播**，任何窗口必须订阅它渲染的数据的失效信号。
具体：main 保存/新建/归档/删除/切 vault 后发 `passless-vault-changed`；
quick-access 补监听 `passless-theme-color-changed` 与 `passless-security-preferences-changed`。
事件名保持现有 5 个，不新增同义事件。

### 6.4 i18n

- 12 个命名空间（common, integrations, itemTypes, listTitle, lock, messages, nav,
  quickAccess, security, settings, shortcuts, vault）+ 三语 parity 测试。
- 新增可见文字必须同 PR 补 zh/en/ja，否则 parity 测试红。
- 修 T-10 的 5 处硬编码，其中 `'website'` 常量会**写进保存的数据**，属于数据污染，
  优先级高于其他四处。

### 6.5 自动填充域匹配（安全，独立成节）

当前 `matches_query`（`vault.rs:1188-1208`）把 origin 当**子串 needle**：
`stored_url.contains(origin)`。存了 `https://github.com.evil.io` 的条目会在用户访问真实
`https://github.com` 时命中。方向是"存储包含查询"，所以任何以真实域为前缀的注册域都能
污染匹配。

目标语义（对齐原型的三档）：

- `exact`：URL 的 host 与页面 host **完全相等**才命中。
- `base_domain`：host 相等 **且** eTLD+1 相等才命中。必须实现真正的后缀匹配
  （比较 `host === base || host.endsWith("." + base)`），不能再用 `contains`。
- `never_submit`：该 URL 永不参与桥匹配。

约束：

- 默认 `base_domain`，但**保守解析**：无公开后缀表时，把 host 切成"最多两段"当 eTLD+1
  是错的（`co.uk` 类会误判）。要么引入 `psl` 类数据表，要么在无法判定时降级为 `exact`
  并记审计事件。这个取舍要写明，不能默默选。
- 匹配逻辑放 Rust，前端与桥共用同一函数，避免两处实现漂移。
- 单测必须覆盖：`github.com.evil.io` ✗ `github.com`；`sub.github.com` ✓（base_domain）；
  `github.com` ✓（exact）；`evil/?u=https://github.com` ✗；`never_submit` 一律 ✗。

---

## 7. 关键决策与权衡（汇总）

| 决策 | 选择 | 放弃了什么 | 状态 |
|---|---|---|---|
| 先拆 `App.tsx` 再改 UI | 是 | 短期进度可见性 | 已定（§3.1） |
| 编辑会话模型 | A：显式提交 + 崩溃草稿 | 纯自动保存的简洁 | **待拍板 D-02** |
| `⌘K` 语义 | 搜索/面板；锁库迁 `⌘⇧L` | 现有肌肉记忆 | **待拍板 D-01** |
| 分类口径 | 单一 `itemCatalog`，收敛到 12 类 | 6 个低频类型的入口 | **待拍板 D-03** |
| 类型专属模板 | 只做 login + 数据驱动渲染器 | 7 类的专属字段 | **待拍板 D-04** |
| 附件 | 外置加密侧车，支持 100MB | 一次性迁移风险 | **待拍板 D-05** |
| 同步 UI | provider 无关状态，不宣称"已同步" | 原型 "Vault Synced" 文案 | **待拍板 D-06** |
| System 主题 | 加，暗色调色板留欠账 | 暗色观感完整性 | **待拍板 D-07** |
| 断点 | 降 `minWidth` 到 560，做两档 | 三栏永远可见的简单 | **待拍板 D-08** |
| 密码恢复 | 本期只加提示，不动密码学 | 真正的找回能力 | **待拍板 D-09** |
| 版本历史 | 推后，放禁用占位 | 原型该区块 | **待拍板 D-10** |
| 锁触发与假开关 | 锁判定移 Rust；假开关逐个接上或删除 | 本期只改界面的纯度 | **待拍板 D-11** |
| vault 语义 | 呈现为组织分组，不宣称隔离 | 原型的访问控制观感 | **待拍板 D-12** |
| 并发保护 | `expected_updated_at` 乐观锁 | 字段级 patch | 已定（§5.2） |
| tag 颜色 | hash 派生，不加列 | 用户自定义色 | 已定（T-07） |
| favicon | 不发网络请求 | 真实站点图标 | 已定（T-06） |
| 域匹配 | Rust 单点实现，保守降级 | 覆盖率 | 已定（§6.5） |

---

## 8. 验收标准

一条标准必须可观察、可判定。分六组。

**结构**
1. `src/App.tsx` 不再是唯一组件文件；`VaultWindow` 拆到单文件 ≤400 行。
   这是**阶段 3 末**的标准，不是阶段 1 的 —— 阶段 1 只外移 JSX（`VaultWindow` 约 760 行），
   事件处理器要到阶段 1.1（数据进 `vaultStore`）与阶段 3.5（编辑逻辑进 `editSession`）
   才陆续离开。阶段 1 的退出标准见 implement_phase_1.md。
2. 全文件 `useState` 从基线 67 显著下降，数据变更只经由 `vaultStore` 出口。

**视觉**
3. `src/components/**` 与新增 CSS 规则中无字面 hex（`styles.css` 的 `:root` 赋值除外）。
4. 未新增第四层别名；`--passless-*` 仍只由 `--color-*` 派生（`--passless-sidebar-bg`
   那唯一例外保持）。
5. 三栏宽度落在 200–280 / 260–360 / fluid，且刷新后保持。

**交互**
6. D-01 表格里承诺的每个快捷键实际生效，且 `⌘/` 浮层内容与实现一致。
7. 输入搜索词后条目列表**原地收窄**，不再是独立下拉；无 8 条硬截断。
8. `↑↓` 能遍历列表并改变详情；`⌘E` 进编辑、`⌘S` 提交、`Esc` 取消。
9. 只读态下复制/显示密码/打开网站**可用**（当前是灰的）。
10. 自定义字段与区块可拖拽重排，重排结果重开后保持。
11. 回收站可见、可恢复、可清空；30 天后条目不再存在。
12. 归档条目不出现在列表、搜索和桥匹配中。

**数据与安全**
13. 旧库（迁移前 schema）打开后迁移成功且原有行全部可读；`cargo test` 覆盖每条迁移。
14. §6.5 的 5 个域匹配用例全部通过，含 `github.com.evil.io` ✗。
15. 草稿文件在锁定/退出/提交后不存在；权限 0600，目录 0700。
16. 附件外置后 `attachments` 表不再存内容密文；100MB 文件可存可读。
    可测的判据（不用 RSS 断言，跨机器不可复现）：
    (a) 读取路径的单元测试里注入一个"读满 100MB 就 panic"的 reader，证明它是分块的；
    (b) 静态断言 `attachment_store.rs` 中不存在对内容字段的 `read_to_end` /
        `Vec::with_capacity(byte_count)`；
    (c) 打开含 N 个大附件的库并 `list_login_items`，断言其不读取任何附件内容字节
        （用计数 reader 断言读取字节数为 0）。
17. 5 个假开关：要么接上真实行为，要么从界面删除。不允许保留无效果开关。

**一致性**
18. 在 main 改数据后，quick-access 与 settings 显示同一状态（手动验证 + 事件测试）。
19. 新增可见文字三语齐全，i18n parity 测试绿。

**回归**
20. `npm run build`、`npm run test`、`cd src-tauri && cargo test`、`npm run lint:fix` 全绿。
21. 打包构建（`npm run tauri build`）下 CSP 未破、三窗口都能起、托盘与 `⌘⇧Space` 首次
    在真机验证（AGENTS.md 已知欠账）。

---

## 9. 风险

| 风险 | 影响 | 缓解 |
|---|---|---|
| 拆 `App.tsx` 触碰全部状态流，回归面 = 整个应用 | 高 | 先做**行为等价**的搬迁（不改逻辑），单独一期并跑完 §8.20 再开始改 UI |
| 附件外置迁移中途失败 → 附件丢失 | 高（不可逆） | 迁移前强制 `create_sync_history_snapshot`；迁移采用"写新→校验→删旧"，失败保留旧行；提供只读回退 |
| `item_fields.value` 里的区块 JSON 迁到 `sections` 表 | 中 | 保留旧解析器一个版本，双读单写 |
| 无 git 仓库 → 任何一步都不可回滚 | **极高** | **开工前先初始化 git 并提交基线**。这是本计划的前置条件，见 implement.md 阶段 0 |
| 域匹配改保守后，部分用户条目不再自动命中 | 中 | 提供"查看为何未命中"的调试提示 + 审计事件 |
| System 主题把未完成的暗色暴露给更多人 | 中 | D-07 可选 C |
| 三语 parity 在改动密集期反复红 | 低 | 新 key 先只加 zh，en/ja 用同一批补齐再提交 |
| 运行时验证欠账（托盘/Quick Access/CSP）一直没被清 | 中 | 阶段 0 里先跑一次真机验证，建立基线 |

---

## 10. 评审记录与就绪判定

### 10.1 评审基线

- 原型：`/tmp/stitch/stitch_1password_web_clone/` 4 屏（`code.html` + `screen.png`；
  `1password_main_view/screen.png` 是 28 字节占位，只有 HTML 可用）。
- 设计稿：`docs/design/2026-10-07-cupertino-vault-design-spec.md`。
- 外部：1Password 官方支持文档。**两轮检索**，第二轮把可信面从 4 页扩到约 30 页
  （`support.1password.com` 的 sidebar / item-categories / custom-fields / keyboard-shortcuts /
  search-1password / archive-delete-items / item-history / unlock-auto-lock / auto-lock /
  touch-id-mac / sign-out / watchtower / watchtower-privacy / copy-passwords / export /
  import / 1pux-format / create-share-vaults / collections / favorites-tags /
  1password-browser-connection-security / macos-autofill / mac-universal-autofill /
  save-fill-passwords / autofill-confirmation / settings-security / travel-mode /
  getting-started-mac / getting-started-browser / rich-icons-privacy）。
  **仍未取到**：`/edit-items/`、`/password-generator/`（该 host 对这两个 slug 返 403），
  所以生成器参数仍取原型 + 现有 Rust 实现。
  检索得出的两条"负结论"同样是证据：1Password 的快捷键表里**没有 ⌘K**，
  Watchtower 的检查集里**没有软件更新检查**。
- 仓库：`src/App.tsx`、`src/app/*`、`src-tauri/src/{lib,vault,storage,browser_bridge}.rs`、
  `src-tauri/capabilities/main.json`、`src/styles.css`、`AGENTS.md`。
- 本文档集：flow.md、design.md、implement.md、implement_phase_1…4.md。

### 10.2 评审中发现并已修正的错误

| 级别 | 发现 | 处置 |
|---|---|---|
| P1 | 初稿把主题色数量写成 23，实测 `theme.ts` 的 `themeColors` 是 **22** 条 | 全部改正 |
| P1 | 原型 "Vault Assignment" 被当作纯 UI 需求，未察觉它隐含**安全隔离宣称**。实测 `Session { key, vault_id }`（`vault.rs:24-27`）与 `session_for_vault`（`lib.rs:210-212`）证明所有 vault 共用一把 `VaultKey` | 新增 §0.3 末"vault 不是安全边界"与决策 **D-12**；阶段 2.7 与阶段 3.2 补文案纪律 |
| P2 | 空闲锁定/剪贴板/密码可见时长的三方枚举差异只被当作细节，实际牵涉"锁判定只在渲染进程、系统休眠不锁" | 新增决策 **D-11** |
| P2 | `estimate_password_strength` 放 Rust 还是 TS 在 N-10 / §5.3 / §3.1 / implement.md 四处都是"待定"，等于没人决定 | 定为 Rust（与 `is_weak_password` 同源），删 `entropy.ts` |
| P2 | §8.1 的 "`VaultWindow` ≤400 行" 与阶段 1 的退出标准冲突（阶段 1 只外移 JSX，处理器仍留原处） | §8.1 标明是阶段 3 末标准，并说明为何 |
| P2 | §8.16 用"内存峰值"作验收，跨机器不可复现，会退化成随机红灯 | 换成三条可确定判定的替代（分块 reader 注入 / 静态断言无 `read_to_end` / 列表加载零读取） |
| P2 | `itemCatalog.ts` 在 implement.md 清单里标阶段 3，但阶段 1.3 就要创建它 | 改为 "1,3" 并说明两阶段各做什么 |
| P3 | flow.md 引用了不存在的 "D-14"；design.md 引用了不存在的 "§4.6"；"§3 布局壳" 应为 §3.2 | 改正确 |
| P3 | D-10 被列为阶段 2 的阻塞项，但阶段 2 默认不建表，实际不阻塞 | 从阻塞列表移除，改为说明 |
| P3 | 附件列名在 §5.1 与阶段 2.4 之间漂移（`content_key_ciphertext` vs `content_key_wrapped`） | 统一 |
| P3 | 阶段 1 的 `useState` 数写成"约 40"，实测 `grep -c` = **67** | 改正确 |
| **P1** | §4.3 的"1Password 官方"一列把桌面端与移动/旧版两套标签混成一张取值表，且**剪贴板被写成 5 档区间**——官方桌面端其实是**单个开关**、区间内嵌在标签里（90 秒，覆盖一次性密码）。按那份表拍板等于抄一张不存在的表 | §4.3 重写为"官方可确证 / 原型 / 当前实现 / 本期取值"四列并逐项标出处；剪贴板改为保持单开关；design.md §4 Security 行与阶段 4 验收同步 |
| **P1** | 非目标里写"修 `.1pux` 需要先拿到真实样本" —— **错了**，官方 `1pux-format` 页已公布真实结构（ZIP + `export.attribute` + `export.data` 的 `accounts→vaults→items` + 以 `documentID` 命名的附件目录 + 完整条目键名） | 非目标改写为"门槛比原先以为的低"，并保留唯一真正缺口：`categoryUuid` 取值表未公布（只给了 `"001"`），所以裁定 #8 在被这张表回答前不动 |
| P2 | D-01 快捷键表把复制 OTP 写成 `⌥C`（实为 `⌥⌘C`），且完全没有 `Delete`/`⌘Delete` 这对官方键 | 修正并补 `⌘⇧F`（开站点并填充）；阶段 3 列表键盘行由 `⌘Backspace` 改为官方的 `Delete`/`⌘Delete`，并加"输入框聚焦时让回默认行为"的守卫 |
| P2 | D-03 把 9/18/12 三套列表当成"该保留哪些类型"的取舍，但官方模型里**分类全集与侧栏行本来就是两个东西**（`Settings > Appearance > Categories` 勾选） | 推荐落法改为 `itemCatalog` 持全集 + 侧栏渲染启用子集；补一条可照抄的官方行为（`Password` 填了用户名自动转 `Login`） |
| P2 | 全文缺 `field_type` 词表，而 D-04 让人拍板"做不做类型模板"却没有可用的类型词汇表；`item_fields.field_type` 目前是自由字符串（`storage.rs:150`） | D-04 补官方闭合清单（11 种）并指出 `One-Time Password` 是字段类型而非专属列、`Date` 的 `Set expiry alert` 是 Watchtower "Expiring items" 的唯一来源；§5.1 与阶段 2.7 加白名单行 |
| P2 | D-11 的推荐项写"三套枚举取 1Password 全集"，与上面 §4.3 的事实错误同源 | 改为按 §4.3 逐项收敛，并补官方四个锁触发开关（device locks/sleeps、idle、on exit、prevent sleeping）与"解锁/自动锁偏好不跨设备同步"这条约束 |
| **P1** | 把 `.1pux` 导入的问题描述成"分类塌陷/保真度不足"。逐行核对 `parse_login_item`（`import_1pux.rs:90-198`）与官方公布结构后确认：**ZIP 与 `accounts→vaults→items` 遍历是对的**，但 `title/url/urls/tags/notesPlain/fields` 六个取值全读在错误层级（真实文件在 `overview.*` 与 `details.*` 下），全部落空 —— 真实导出得到 N 条 `"Imported Login"` 空条目，`ImportPreview` 的计数却完全正常 | 非目标段重写为准确的失效模式与影响；裁定 #8 的问题本身被指出是问错了；阶段 2 "本阶段不改"同步更正（原先还写了"修它需要真实样本"，官方页面已公布结构，并不需要） |
| P3 | §3.6 只对齐了 Archive/Trash 的**语义**没对齐**命名** | 明确用 `Archive` / `Recently Deleted`（原型对该区无命名，故不构成冲突），动作沿用 `Restore Item` / `Destroy permanently`；zh 为"已归档 / 最近删除" |

另外核实了一条**无需改动**的假设：1Password 文档说归档项"不出现在搜索结果与自动填充建议里"，
实测 `list_login_items` 已同时排除 `archived` 与 `trashed`（`vault.rs:515`），
桥的 `list_matches` 走的正是这个函数（`browser_bridge.rs:156`）—— 行为已成立，缺的只是 UI 与文案。

引用完整性已机检：`D-01…D-12`、`N-01…N-17`、`C-01…C-07`、`T-01…T-14` 全部"被引用的都有定义"，
四个 phase 文件链接与全部 `§` 交叉引用均可解析。文档集里唯一出现的 `D-14` 字样是本表
对那次修正的记述本身，不是引用。

### 10.3 就绪判定：**BLOCKED**

按 write-technical-spec 的就绪标准，存在未决决策即为 BLOCKED。本文档集**是故意**
以这个状态交付的 —— 用户的指令是"生成一份完整的 spec 让我审核，有冲突的地方提醒"，
把 12 项会改变语义、范围或密码学边界的决定留给实现隐式选择，才是真正的不合格。

待拍板 = D-01 … D-12。按"是否卡住代码"分：

- **不卡代码**（有安全默认值，可边写边定）：D-01 D-03 D-04 D-06 D-07 D-09
- **阻塞阶段 2**：D-02（草稿存储）、D-05（附件外置）
- **阻塞阶段 3**：D-08（断点）、D-12（vault 语义）
- **阻塞阶段 4**：D-10（版本历史，默认推后）、D-11（锁判定 + 假开关处置）
- **可能把本期范围翻倍**：D-05 选 A、D-08 选 A、D-10 选 C、D-12 选 B

**阶段 0 与阶段 1 完全不受阻塞**，可以立即执行 —— 它们不改变任何用户可见行为，
且阶段 0 的 git 基线是本计划里唯一能对冲"本仓库不是 git 仓库、任何一步都不可回滚"
这条极高风险的措施。

### 10.4 残留的测试与运维风险

- 三栏折叠、暗色观感、附件拖放、100MB 大文件、Touch ID、合盖锁定、打包 CSP
  **无法自动化**，只能在跑起来的 app 里判定。按 AGENTS.md 的要求，
  不得以"类型检查和测试通过"代替功能正确性声明。
- 阶段 1 的行为等价性没有现成回归套件可依赖 —— 现有测试覆盖的是抽取出来的纯模块
  （`lockScreen` / `totpDisplay` / `securityPreferences`），`App.tsx` 本身几乎没有测试。
  等价性主要靠手动清单 + 逐文件提交粒度，这是一个真实的薄弱点。
- 域匹配改保守后，部分存量条目会不再自动命中。无法预测影响面，因为没有
  "桥命中/未命中"的历史数据。建议阶段 2 上线后从 `audit_events` 读一段时间再决定是否放宽。
