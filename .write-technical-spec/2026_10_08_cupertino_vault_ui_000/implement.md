# 执行计划 — Cupertino Vault 界面重构

设计依据：[design.md](design.md)；流程图：[flow.md](flow.md)。

本文件是索引 + 全量文件清单 + 总体验证策略。各阶段的详细步骤与验收在
`implement_phase_N.md` 里。

> **执行前置**：design.md 的 D-01 … D-11 中，D-02 / D-05 / D-08 / D-10 会改变范围或数据，
> 未拍板前不得进入对应阶段。阶段 0 与阶段 1 不受这些决策阻塞，可以先跑。

## 阶段划分

| 阶段 | 内容 | 依赖 | 被哪些决策阻塞 |
|---|---|---|---|
| [0](#阶段-0--基线) | git 基线、真机验证欠账、度量快照 | — | 无 |
| [1](implement_phase_1.md) | `App.tsx` 行为等价拆解、token 收敛、i18n 硬编码清理 | 0 | 无 |
| [2](implement_phase_2.md) | schema 迁移、域匹配、附件外置、草稿存储、回收站到期、新命令 | 1 | D-02 D-05 |
| [3](implement_phase_3.md) | 三栏主窗口：侧栏、列表、详情检查器、编辑会话、快捷键 | 2 | D-01 D-03 D-04 D-08 D-12 |
| [4](implement_phase_4.md) | Settings 重构、假开关处置、Watchtower 页、三语、交付验证 | 3 | D-06 D-07 D-09 D-11 |

阶段之间严格串行：阶段 2 的 `expected_updated_at` 契约变更是阶段 3 编辑会话的前提；
阶段 1 的模块边界是阶段 3 不失控的前提。

---

## 阶段 0 — 基线

不做任何功能改动，只把"可回滚"和"可验证"两件事建立起来。

1. **初始化 git 并提交基线。** 本仓库当前不是 git 仓库（`AGENTS.md` 环境说明），
   任何一步都不可回滚，而 design.md §9 把这条列为"极高"风险。
   - `git init` → 确认 `.gitignore` 覆盖 `node_modules/`、`dist/`、`src-tauri/target/`、
     `*.db`、`*.db-wal`、`*.db-shm`、`.write-technical-spec/`（**规范产物是否入库由你定，
     默认不加入 ignore、也不 stage**）。
   - 首次提交前 `git status` 逐项核对，**不得**把 `src-tauri/` 下的 vault 数据库文件或
     `.env` 提交进去。
   - 基线提交后打 tag `pre-cupertino-vault`。
2. **清运行时验证欠账**（AGENTS.md 已知缺口）：`npm run tauri build` 起打包版，逐项确认
   托盘菜单、`⌘⇧Space`、Quick Access 窗口位置、自启动、单实例重聚焦、CSP 未破。
   记录哪些通过 —— 后续阶段任何一项变红都要能区分"新引入"还是"本来就坏"。
3. **度量快照**，写进 `.write-technical-spec/…/baseline-metrics.md`：
   - `wc -l src/App.tsx src/styles.css`
   - `grep -c useState src/App.tsx`
   - `grep -RInE "#[0-9a-fA-F]{3,8}" src/components src/App.tsx` 的字面 hex 命中数（应为 0，
     非 0 则记录）
   - `cargo test` / `npm run test` 的用例数与结果
4. 不修改任何源码。

---

## 全量文件变更清单

### 新增 — 前端

| 文件 | 作用 | 阶段 |
|---|---|---|
| `src/app/itemCatalog.ts` | 唯一分类来源（type → icon/label/i18nKey/侧栏归属）。阶段 1 先原样搬入常量表，阶段 3 才重塑 | 1,3 |
| `src/app/matchRule.ts` | Exact / BaseDomain / NeverSubmit 的 TS 侧类型与展示（匹配本身在 Rust） | 2 |
| `src/state/vaultStore.ts` | 单一数据出口 + 事件广播 | 1 |
| `src/state/editSession.ts` | 编辑会话、脏检查、草稿交互 | 3 |
| `src/components/shell/WindowChrome.tsx` | 拖拽区、红绿灯留白、标题 | 3 |
| `src/components/shell/LockScreen.tsx` | 两种解锁变体（阶段 1 外移，阶段 4 加 D-09 文案） | 1,4 |
| `src/components/shell/TopSearchBar.tsx` | 现顶部搜索条（阶段 1 外移，阶段 3 改语义） | 1,3 |
| `src/components/shell/Sidebar.tsx` | 侧栏（含 vault 区、计数、tag 区、归档/回收站） | 3 |
| `src/components/shell/ItemList.tsx` | 列表 + 列表头 + 排序菜单 + 空态 | 3 |
| `src/components/shell/ItemRow.tsx` | 56px 行 | 3 |
| `src/components/shell/Inspector.tsx` | 详情容器 + 面包屑 + 操作条 + 底部 | 3 |
| `src/components/inspector/SectionRenderer.tsx` | 数据驱动区块渲染 | 3 |
| `src/components/inspector/PasswordRow.tsx` | 密码 + 熵 + 强度条 + 生成器入口 | 3 |
| `src/components/inspector/TotpRow.tsx` | `492 817` + 最后 5 秒转红 | 3 |
| `src/components/inspector/TagPicker.tsx` | 药丸 + 自动补全 | 3 |
| `src/components/inspector/UrlRuleRow.tsx` | 网站 + 匹配规则下拉 | 3 |
| `src/components/inspector/AttachmentSection.tsx` | 附件网格/行 + 拖放 | 3 |
| `src/components/inspector/FieldRow.tsx` | 单字段行（含把手） | 3 |
| `src/components/overlay/Popover.tsx` | 浮层原语（替代自绘 absolute div） | 1 |
| `src/components/overlay/Menu.tsx` | 菜单原语 | 1 |
| `src/components/overlay/Dialog.tsx` | 替代 `window.prompt`（`App.tsx:798`） | 3 |
| `src/components/overlay/CommandPalette.tsx` | `⌘K` | 3 |
| `src/components/overlay/ShortcutCheatSheet.tsx` | `⌘/`，替代静态 Shortcuts tab | 4 |
| `src/components/settings/*.tsx` | General / Vaults / Security / Privacy / Watchtower / Autofill / Browser / Advanced 各一文件 | 4 |
| `src/components/watchtower/ReportPage.tsx` | 主窗口内的 Watchtower 报告 | 4 |
| `src/components/trash/TrashView.tsx` | 回收站列表 | 3 |

### 新增 — Rust

| 文件 | 作用 | 阶段 |
|---|---|---|
| `src-tauri/src/domain_match.rs` | eTLD+1 保守解析 + 三档匹配，桥与 UI 共用 | 2 |
| `src-tauri/src/attachment_store.rs` | 侧车文件读写、0600/0700、清理 | 2 |
| `src-tauri/src/draft_store.rs` | 加密草稿、锁定即删 | 2 |
| `src-tauri/src/trash_sweep.rs` | 30 天到期清理 | 2 |

### 新增 — 测试

`src/app/itemCatalog.test.ts`、`src/state/vaultStore.test.ts`、
`src/state/editSession.test.ts`、`src/components/**/*.test.tsx`（关键交互路径）、
`src-tauri/src/domain_match.rs` 内联 `#[cfg(test)]`（design.md §6.5 的 5 个用例）、
`src-tauri/src/storage.rs` 每条迁移一个"旧库→迁移→旧行可读"测试、
`attachment_store.rs` 权限与往返测试、`draft_store.rs` 的锁定/退出/提交三路清理测试。

### 修改

| 文件 | 变更 | 阶段 |
|---|---|---|
| `src/App.tsx` | 从 3022 行降到路由 + 三窗口挂载；`VaultWindow` 全部 JSX 外移 | 1,3 |
| `src/app/vaultApi.ts` | `LoginItem` 扩 `created_at`/`vault_id`/`match_rule`/`section_id`；`update` 加 `expected_updated_at`；新增 §5.3 命令包装 | 2 |
| `src/app/securityPreferences.ts` | 三套枚举对齐 1Password（D-11）；删/接 5 个假开关 | 4 |
| `src/app/theme.ts` | 删 `themeColors` 22 色（C-01）；加 System | 4 |
| `src/app/navigation.ts` | 由 `itemCatalog` 派生；删死字段 `label`/`route` | 3 |
| `src/app/i18n.ts` | 新命名空间与 key，三语同步 | 3,4 |
| `src/app/totpDisplay.ts` | `•` → 空格；加最后 5 秒状态 | 3 |
| `src/styles.css` | token 收敛、三栏尺寸、`@media` 两档（D-08）、删 picker 相关规则 | 1,3,4 |
| `tailwind.config.js` | 新 token 名（值仍在 `styles.css :root`） | 1 |
| `src-tauri/src/lib.rs` | 注册新命令；`generate_handler![]` 同步 | 2 |
| `src-tauri/src/storage.rs` | `item_urls.match_rule`、`sections` 表、`item_fields.section_id`、`attachments` 去内容列 | 2 |
| `src-tauri/src/vault.rs` | `matches_query` 拆分（UI 搜索 vs 域匹配是两件事）、`expected_updated_at`、新命令实现、生成器 options 扩展 | 2 |
| `src-tauri/src/browser_bridge.rs` | 用 `domain_match` 替换 `list_login_items(origin)` 子串匹配；**不新增端点** | 2 |
| `src-tauri/src/shell.rs` | 锁库触发点补齐（屏保/休眠，D-11） | 4 |
| `src-tauri/capabilities/main.json` | 若新增窗口 label 必须同步（design.md §6.1.5） | 3 |
| `src-tauri/tauri.conf.json` | `minWidth` 960 → 560（D-08） | 3 |
| `AGENTS.md` | 更新 Design conformance 表状态、Known gaps、模块地图 | 各阶段末 |
| `browser-extension/popup.tailwind.css` | 若视觉对齐需要；**不改 `popup.css`（生成物）** | 4 |

### 删除

| 路径 | 条件 |
|---|---|
| `docs/design/2026-10-07-cupertino-vault-design-spec.md` | **必须先把它吸收进本规范**（本文档已引用其全部数值），且用户确认 |
| `docs/superpowers/specs/2026-07-01-task-page-ui-design-spec.md` | 独立确认项 —— 它是**另一个项目**的文档，本仓库非 git 时删除不可逆。见"docs 删除"一节 |

---

## docs 删除（用户明确指令，但有前置）

用户要求"整理完成后删除 docs 目录"。`docs/` 当前只有 2 个文件、共 32KB：

1. `docs/design/2026-10-07-cupertino-vault-design-spec.md` — 与 zip 里的
   `cupertino_vault/DESIGN.md` 除我加的 provenance 段落外逐字节相同。**原件在
   `/Users/apple/Downloads/stitch_1password_web_clone.zip` 里，删除安全。**
   但其数值规格已被本文档吸收，删除后 design.md 成为唯一来源。
2. `docs/superpowers/specs/2026-07-01-task-page-ui-design-spec.md` — 另一个项目
   （任务管理器）的 Tailwind 配方，本仓库非 git，**原件不在任何 zip 里，删了就没了**。
   它对本项目无用（`theme-*` 工具类家族在本 `tailwind.config.js` 里不存在），
   但"无用"不等于"可删"。

前置条件，三条都满足才执行删除：

- [ ] 本规范集交付并获用户评审通过；
- [ ] 阶段 0 的 git 基线已提交（删除动作本身可回滚）；
- [ ] 用户就第 2 个文件单独确认（移动到他处保留 or 直接删）。

在确认前，把两个文件复制到 `.write-technical-spec/2026_10_08_cupertino_vault_ui_000/absorbed/`
留档。同时更新 `AGENTS.md` 里指向 `docs/` 的两处引用（Architecture 段的
`docs/design/` 与 `docs/superpowers/` 两行、Design conformance 段第一句），
否则文档链接全部悬空。

---

## 总体验证策略

### 自动化门禁（每阶段末必须全绿）

```bash
npm run lint:fix          # biome；注意 Rust 不是 rustfmt-clean，永不运行 cargo fmt
npm run build             # tailwind(extension css) → tsc → vite build
npm run test              # vitest run
cd src-tauri && cargo test
```

`npm run build` 是唯一让 CSP 生效的构建，但只有 `tauri build` 才真正注入 —— 阶段末额外跑一次。

### 分层

| 层 | 手段 | 覆盖什么 |
|---|---|---|
| 纯函数单测 | Vitest | `itemCatalog`、`matchRule` 展示层、`totpDisplay`、`entropy`、`editSession` 脏检查、`vaultStore` reducer |
| 组件测试 | Vitest + jsdom + testing-library | 快捷键生效、搜索原地过滤、`↑↓` 导航、只读态按钮可用、拖拽重排后 position 提交、回收站三路操作 |
| Rust 单测 | `cargo test` | 每条 schema 迁移、域匹配 5 用例、附件权限与往返、草稿三路清理、回收站到期、生成器新 options、`expected_updated_at` 冲突 |
| 契约测试 | Rust + TS 双侧 | `LoginItem` 字段集一致；`generate_handler!` 注册数与 `vaultApi` 包装数对齐 |
| i18n parity | 已有测试 | 三语 key 集合相等 |
| 手动/真机 | 清单 | 托盘、`⌘⇧Space`、Quick Access 定位、窗口折叠两档、System 主题跟随、CSP、Touch ID、锁屏打断编辑会话 |

### 必须手动、无法自动化的项

阶段 3 与 4 的视觉与响应式：`<820px` / `<560px` 两档折叠、三栏宽度持久化、暗色/System 切换、
附件拖放、100MB 大文件、真机 Touch ID。这些只能在跑起来的 app 里看，
按 AGENTS.md 要求**不得以"类型检查和测试通过"代替功能正确性声明**。

### 回归对照

阶段 1 结束时的 `baseline-metrics.md` 是后续所有阶段的对照物。任何一项度量恶化
（App.tsx 行数回升、字面 hex 增加、用例数下降）都要在同一阶段内解释或修复。

---

## 交付检查单

- [ ] design.md §8 的 21 条验收标准逐条判定，未通过的写明原因
- [ ] D-01 … D-12 每一项的最终决定回写进 design.md §7 表格，不留"待拍板"
- [ ] `AGENTS.md` 的 Design conformance 表 9 行状态更新（C-01…C-07 至少 4 行从 Not done 变 Done）
- [ ] Known gaps 段更新：Trash UI 与 tag 筛选两条应消失；新增本阶段留下的欠账
- [ ] 字体许可证阻塞项（`public/fonts/JetBrainsMonoNL-SemiBold.ttf` 缺 SIL OFL 1.1 文本）
      状态确认 —— 未解决前不得发布，本清单不宣称已解决
- [ ] `docs/` 删除的三个前置条件全部勾选后才执行
- [ ] 四份 phase 文档与本文档互链无悬空
