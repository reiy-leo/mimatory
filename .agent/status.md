# 项目现状（交接用）

新 session 先读这份，再按需翻 `AGENTS.md`（工程规则）、`.agent/design.md`（设计规则）、`.agent/todo.md`（逐条的待办和未验证项）、`.agent/sync.md`（同步设计）。这份只讲「现在到哪了、还欠什么、代码大致怎么组织」，细节以那几份为准。

更新于 2026-11-02，对应 main `2a2dd19`。

## 一、项目是什么

- **Mimatory（中文名：密码库存）**，仓库 `reiy-leo/mimatory`。一个本地优先的密码管理器，对标 1Password。
- 技术栈：Tauri v2 + React 18 + TypeScript + Tailwind；Rust 后端，数据放在加密的 SQLite 保险库里。
- 附带一个 MV3 浏览器扩展（`browser-extension/`，开发者模式加载），只支持 Chromium 系浏览器，Firefox 暂不支持（Rei 2026-10-24 决定）。
- 目标平台：macOS、Windows、Linux（只支持 Wayland/Hyprland）、iOS、Android。每个平台一套皮肤，跟 Mindough 一样。目前只发过 macOS 包。
- 设计只按 Apple macOS HIG；图标默认用 Lucide；主题只跟随系统，App 里没有明暗开关。
- 主页 https://mimatory.rei8t.dev，代码在单独的仓库 `reiy-leo/mimatory-web`（规则：App 的网站一律放 `<仓库名>-web`，不进 App 仓库）。

## 二、版本和分支

- 当前版本 `0.1.0-alpha.2`（tag `v0.1.0-alpha.2`）。alpha 只出 macOS 预发布包，未签名，要右键打开。
- **发版前必须先问 Rei**，不要自己打 tag。
- 直接在 `main` 上开发（2026-10-17 起），不要 force-push。`feat/sync` 已全部合进 main，可以不管了。
- alpha.2 之后 main 上又积了很多功能（多选、同步界面、9 种语言、原生消息连接扩展、一键登录浮条、导入修复等），都还没发版。

## 三、已经做完的功能

按模块列，每项写清楚在哪看细节。

| 模块 | 现状 | 细节 |
|---|---|---|
| 保险库 | 多保险库、标签、分类、收藏、归档、废纸篓；最后一个没归档的保险库不能归档或删除 | AGENTS.md「Data model」「Vault security」 |
| 条目 | 17 种类型 + 模板字段、自定义区块、字段拖动排序、附件（仅桌面）、TOTP、条目之间的关联（父子 / 相关） | AGENTS.md「Data model」 |
| 列表 | 只返回摘要，选中时再解密；虚拟列表；多选（⌘A、⌘/⇧ 点击）和批量操作 | AGENTS.md「UI structure and its traps」 |
| 网站图标 | 先问 Google faviconV2，再问网站本身，加密缓存 | AGENTS.md / todo.md 2026-10-18 条 |
| 使用 … 登录 | 条目可以记「用 Google 登录」这类方式，扩展会提示 | AGENTS.md |
| 扩展连接 | 浏览器原生消息（固定扩展 ID，不用配对码），macOS 上校验浏览器签名；127.0.0.1:17891 HTTP 桥只做后备 | AGENTS.md「Extension connection」 |
| 扩展功能 | 输入框内联菜单（只填不提交）、页面顶部一键登录浮条（点了就提交）、通行密钥（Mimatory 自己当认证器） | todo.md「Passkeys」 |
| 1Password 导入 | 菜单 File ▸ Import ▸ 1Password (.1pux)；附件、「使用…登录」、相关项目（同一保险库内）都会导入；**不去重** | `src-tauri/src/import_1pux.rs` |
| 同步 | Google Drive（appDataFolder）或 WebDAV 二选一；逐条合并 + 墓碑；每次写入后自动触发 | `.agent/sync.md` |
| 多语言 | 9 种：en zh ja es pt(巴西) ru de fr id，默认跟随系统；Rust 原生菜单、托盘、Touch ID 提示也翻译了；后端错误用稳定错误码，前端翻译 | AGENTS.md「Languages」 |
| 改名 | Passless → Mimatory 已全改完；代码里剩下的 passless 都是迁移旧数据用的，不能删 | AGENTS.md「The Passless → Mimatory rename」 |

## 四、代码怎么组织（快速地图）

完整文件地图在 AGENTS.md「Architecture」，这里只记最常碰的：

- 前端 `src/`
  - 三个窗口：主窗口、设置窗口、Quick Access。主窗口的控制器是 `useVaultWindow.tsx`（约 2300 行），各组件从 `vw` 读状态。
  - `src/app/vaultApi.ts`：所有调 Rust 的入口。**改数据的命令必须走 `write()`**，它负责触发同步。
  - `src/app/locales/<语言>.ts`：每种语言一个文件；`i18n.ts` 管语言解析。
  - `src/app/errors.ts`：`describeError()` 把后端错误码翻成当前语言。
- Rust `src-tauri/src/`
  - `vault.rs` / `storage.rs` / `crypto.rs`：保险库、SQLite、加密。
  - `lib.rs`：Tauri 命令；`command_error.rs`：错误码。
  - `browser_bridge.rs`（HTTP 后备）、`native_messaging.rs` + `native_ipc.rs`（原生消息）。
  - `sync/`：同步核心（merge、engine、webdav、google_drive、oauth）。
  - `import_1pux.rs`、`passkey.rs`、`favicon.rs`、`totp.rs`、`native_i18n.rs`、`rename_migration.rs`。
- 扩展 `browser-extension/`：`background.js`、`content.js`、`passkey-provider.js`、`popup.*`、`_locales/`。
- CI `.github/workflows/`：`ci.yml`、`build.yml`（手动出包，读 Google OAuth 密钥）、`ios.yml`（从没跑过）。

## 五、开发和验证的规矩

- 提交作者 `Ryan Lincs <ryan.lincs@outlook.com>`，Conventional Commits，推 `git push origin HEAD:main`。
- 这个仓库**还在用 npm**（Rei 平时要 pnpm，换不换是单独的决定，还没做）。
- 沙箱里 `repo-multi/node_modules` 是指向 `repo-templates/node_modules` 的软链接，**不能提交**。
- 检查顺序：typecheck → biome → `vitest run --testTimeout=20000` → build；Rust 只能跑 `CARGO_BUILD_JOBS=2 cargo check --lib --tests`（`cargo test` 链接会内存不够）。
- `designContract` 测试禁止 Tailwind 任意值；`hardcodedStrings` 测试禁止界面里写死英文；zh 文案里不许出现「Mimatory」，要写「密码库存」。
- 界面改动要用 Playwright 截图自查（脚本在项目目录 `work/pwt/`，截图放 `work/screens/<功能>/`）。
- 回复里出现 HTTP 状态码要带中文说明，如「404 未找到」。

## 六、没做完 / 等 Rei 的事

### 等 Rei 动手
1. **建 `reiy-leo/mimatory-web` 仓库**：主页已上线，但代码只在沙箱本地提交（`f97d0dc`），GitHub 上还是 404。Rei 建好公开仓库并加上写权限部署密钥（公钥在 `/workspace/.keys/mimatory-web_deploy.pub`），或者重新连上 GitHub，就能推。
2. **在真 Mac 上试一遍**（见第七节清单），尤其是原生消息连接扩展、一键登录、Google Drive 同步。
3. **跑一次 Build apps**，确认 Google 登录能用（OAuth 密钥 2026-10-25 已配到 Actions）。

### 等 Rei 拍板（needs-owner-decision）
- 导入去重：按 1Password uuid 标记来源 + 按类型/标题/用户名/网址/创建时间判重，重复的只补空字段。已提方案，没回复。
- 忘记主密码的恢复方式（恢复密钥 / 应急包，第二个钥匙槽）。已提方案，没回复。
- 删掉 17891 HTTP 后备桥（等原生消息在 Rei 机器上确认可用）。
- 同步里还没定的几条（`.agent/sync.md`「Owner decisions」：两台设备主密码不同、改密码后重新包装、附件大小、通行密钥和 TOTP 种子要不要同步等）。
- 其余散在 `todo.md` 里标 `needs-owner-decision` 的：一个条目多种登录方式、图标走代理、字段操作细节、自动填充规则、通行密钥 AAGUID/计数器、手机端细节等。

### 我们这边还能做的
- 中文应用名在 iOS 主屏、Android 桌面、Windows 开始菜单还是英文。
- Watchtower 看不到模板字段里的过期日期和 TOTP。
- ⌘K 现在是锁定，应改成搜索 / 命令面板。
- 安全审计剩下的：附件临时文件清理、主密码尝试限速、主密码强度在 Rust 里强制、锁定时 `zeroize`、密钥轮换。
- Windows Hello 没做；附件只支持桌面。
- 清理 2026-10-09 删掉旧同步后留下的死数据（`settings` 表、旧 Keychain 条目等）。
- 侧边栏宽度重启后不保留。
- es/pt/ru/de/fr/id 六种语言要找母语的人审一遍。
- 扩展上架商店后，主页 FAQ 里「开发者模式加载」那句要改。

## 七、写了但从没在真机上跑过的

沙箱只能在 Linux + Chromium + 模拟后端里验证，下面这些都只有单元测试或截图，没在真 Mac 上见过：

- 原生消息：清单写到各浏览器目录、socket 权限、**浏览器签名校验**（Chrome/Arc/Edge/Brave）。
- 一键登录浮条、内联菜单在真实网站上的表现；Google/Microsoft 那种先输账号的登录流程。
- 同步：真实 Google Drive、真实坚果云/Nextcloud、第二台设备输入远端主密码。
- Touch ID、托盘、⌘⇧Space Quick Access、开机自启、macOS 毛玻璃、中文 Finder 名「密码库存」（只在打包后生效）。
- Passless → Mimatory 旧数据迁移（先退出旧 App 再试）。
- 1Password 导入：真实 .1pux 的附件和相关项目。
- 多选、⌘A、Edit ▸ Select All 在 WKWebView 里。
- 1 万条目时的虚拟列表性能。
- Windows / Linux / iOS / Android 任何真机构建。

## 八、项目外的东西（不在仓库里）

- 沙箱项目目录：`repo-multi/`（主工作树）、`repo-templates/`（真正的 node_modules）、`mimatory-web/`（主页代码，未推送）、`work/`（截图、Playwright 脚本、测试用小 crate）。`repo/`、`repo-sync/`、`wt-import/` 是旧的，可以删。
- 推送用部署密钥 `/workspace/.keys/mimatory_deploy`；扩展签名私钥 `/workspace/.keys/mimatory_extension.pem`（决定扩展 ID `pjcffbogeilnkbmnlegjdciggbfbekfb`，丢了 ID 就变）。
- Rei 的 Mac 可以通过 tailcat 远程跑命令（2018 Intel，macOS 15）；在 Mac 上装东西前先问，别用 Homebrew 从源码编译。
