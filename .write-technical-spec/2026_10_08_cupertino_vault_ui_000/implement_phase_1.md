# 阶段 1 — 行为等价的模块拆解与视觉收敛

目标：把 `App.tsx` 从 3022 行拆成有边界的模块，并把色彩来源收敛到 token 层。
**本阶段不改变任何用户可见行为** —— 这是它唯一的验收标准。

## 前置

- 阶段 0 完成，`pre-cupertino-vault` tag 存在，工作区干净。
- 本阶段不需要 design.md 的任何未决拍板。

## 为什么先拆

`VaultWindow` 单组件 1520 行、持有约 15 类关注点、全前端只有 5 个组件。阶段 3 要往这个
结构里加侧栏 vault 区、计数、tag 筛选、编辑会话、命令面板、键盘导航、回收站视图。
不先拆，阶段 3 的每一次改动都要在 3000 行里做上下文切换，回归面无法界定。

## 步骤

### 1.1 建立 `vaultStore` 单一出口

当前状态全散在 `App.tsx` 的 **67 个 `useState`** 里（`grep -c useState src/App.tsx` 实测），
数据变更直接调 `vaultApi.*` 后各自 `refreshItems()`。后果已经发生：main 窗口改数据后
**不广播** `passless-vault-changed`，quick-access 显示过期列表（flow.md §4）。

- 新建 `src/state/vaultStore.ts`：持有 `items / vaults / selectedId / activeNavigation /
  loading / error`，暴露 `refresh() / create() / update() / archive() / trash() /
  restore() / switchVault() / select()`。
- **每个会改库的方法在成功后统一 `emit('passless-vault-changed')`**。这是 design.md §6.3
  的实现点，不是可选风格。
- 用 `useSyncExternalStore` + context 暴露，不引外部状态库。
- 事件名保持现有 5 个（`App.tsx:485/493/503/515/566`），不新增同义事件。

约束：迁移期间允许 `VaultWindow` 暂时保留局部 UI state（`showPassword`、`isEditing`、
`itemListWidth` 等），只把**数据**收进 store。一次性全改会把回归面推到不可控。

### 1.2 抽浮层原语

当前弹层是各处自绘的 `absolute` div，z-index、外部点击关闭、Esc、焦点回捕各自为政。

- `src/components/overlay/Popover.tsx` + `Menu.tsx`：受控开合、点外关闭、`Esc`、
  焦点陷阱、`aria-expanded`。
- 替换点：详情顶栏 vault 下拉、"Add more" 菜单（`App.tsx:1889-1918`）、section 子字段
  菜单（`1730-1752`）、Settings 的 select 类弹层。
- 本阶段**不**做 `CommandPalette` / `Dialog`（阶段 3），`window.prompt`（`App.tsx:798`）
  原样保留。

### 1.3 组件外移（纯搬迁）

| 从 `App.tsx` | 到 | 行号 |
|---|---|---|
| 侧栏 | `components/shell/Sidebar.tsx` | 1261-1340 |
| 顶部搜索条 | `components/shell/TopSearchBar.tsx` | 1342-1372 |
| 条目列表 | `components/shell/ItemList.tsx` | 1374-1419 |
| 详情顶栏 | `components/shell/InspectorHeader.tsx` | 1428-1476 |
| 生成器面板 | `components/inspector/GeneratorPane.tsx` | 1477-1561 |
| 条目表单 | `components/inspector/ItemForm.tsx` | 1562-1941 |
| `ItemSearchField` | `components/inspector/ItemSearchField.tsx` | 275-342 |
| 锁屏两变体 | `components/shell/LockScreen.tsx` | 1172-1257 |
| 常量表（`addMoreOptions` 等） | `src/app/itemCatalog.ts`（先只搬不改） | 116-273 |

搬迁纪律：
- **逐文件搬，每搬一个跑一次 `npm run build` + `npm run test`**，不攒批。
- props 只传数据与回调，不传 store 实例（阶段 3 再评估）。
- 搬动时**不重命名、不改结构、不顺手优化**。任何"看起来更好"的想法写进
  `phase-1-notes.md`，留给阶段 3。
- `SettingsWindow` / `QuickAccessWindow` 留在 `App.tsx`，阶段 4 才动。

### 1.4 色彩收敛到 token

C-01 要求删 22 色 picker，但删之前要先确认没有别的东西依赖它覆写的别名。

- 审计 `--passless-*` 的 ~110 处读取（`styles.css:87-101`），确认删掉 picker 后
  这些别名只由 `:root` 静态赋值。
- 移除 `theme.ts:36-57` `themeColors`、`App.tsx:2397-2412` 的 radiogroup、
  `passless-theme-color-changed` 事件的发送端（**保留监听端直到阶段 4**，避免中途
  出现"事件发了没人听"和"听了没人发"两种状态混在一起）。
- 组件规则里的字面 hex 全部换成 token。已知残留：锁屏已修（`styles.css:244-280`），
  本阶段用 `grep -RInE "#[0-9a-fA-F]{3,8}" src/components src/App.tsx` 复查。
- **不新增第四层别名**（design.md §6.2）。唯一允许的字面量例外仍是暗色的
  `--passless-sidebar-bg: #171d26`。

### 1.5 `styles.css` 双 `@layer` 陷阱

改任何规则前先确认它是否同时存在于前一个 `@layer` 块。已知实例：`.compact-lock-screen`
（`styles.css:240`）的 `bg-slate-50` / `p-7` 被后层 `.lock-screen`（`1336`，
`background: var(--theme-bg-2)` + `@apply p-2`）以同特异度覆盖 —— 前层那两条**已经是死的**。

- 本阶段产出一份 `styles.css` 前/后层重复选择器清单，附在 `phase-1-notes.md`。
  阶段 3 改样式时这是必需的输入。
- 只清理**确认死掉**的规则；约 149 个只存在于前层的选择器不是死代码，**不得删**。

### 1.6 i18n 硬编码清理（T-10）

| 位置 | 问题 | 优先级 |
|---|---|---|
| `App.tsx:116` | URL label 默认值 `'website'` 常量**会写进保存的数据** | **最高** —— 数据污染 |
| `App.tsx:1267` | 品牌名 `Passless` 硬编码 | 低（品牌名本就不译） |
| `App.tsx:1159` | 窗口标题 `'Passless Settings'` | 中 |
| `App.tsx:2407-2408` | 颜色 label 未译（随 picker 一起删） | — |
| 若干 placeholder | `App.tsx:2425/2544/2552` | 中 |

`'website'` 那条要小心：已经保存的条目里存在英文 `'website'` label 的数据。
本阶段只改**新写入**的默认值，不回填历史数据（回填需要区分用户真的写了 "website"
还是默认值污染，无法可靠判定）。

## 验证

- **行为等价**是主验收：`npm run test` 用例数不得下降；三窗口手动走一遍
  （解锁 → 选条目 → 编辑 → 保存 → 归档 → 恢复 → 切 vault → 改主题 → 改语言 →
  改安全偏好 → 生成密码 → 用 `⌘⇧Space` 开 Quick Access）。
- 新增测试：`vaultStore.test.ts` 断言每个 mutation 都发一次 `passless-vault-changed`
  （用 mock listen 计数）。这条是 flow.md §4 那个 bug 的回归锁。
- `baseline-metrics.md` 对照：`App.tsx` 行数下降、`useState` 计数下降、字面 hex 为 0。
- 门禁四连（`implement.md` 的验证策略一节）。
- 阶段末更新 `AGENTS.md` 的 Architecture 模块地图（`src/App.tsx` 那一行已经不再准确）。

## 退出条件

- `App.tsx` ≤ 1200 行（只剩 `App` + `SettingsWindow` + `QuickAccessWindow` + 挂载逻辑）。
- 无任何用户可见行为变化 —— 若发现"修好了一个顺手的小 bug"，单独提交并在本文件记录，
  不得混进搬迁提交。

## 已知风险

| 风险 | 缓解 |
|---|---|
| 搬迁时顺手改逻辑，回归无法归因 | 逐文件跑门禁；提交粒度 = 一个组件 |
| `vaultStore` 收得太狠导致渲染风暴 | 只收数据，UI state 留局部；用 `useSyncExternalStore` 的选择器 |
| 删 picker 后有规则依赖其覆写的别名 | 1.4 先审计 ~110 处读取再删 |
| 事件发送端与监听端不同步下线 | 保留监听端至阶段 4 |
