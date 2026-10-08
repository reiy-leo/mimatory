# 阶段 2 — 数据契约、域匹配、附件与草稿

目标：把阶段 3 需要的数据结构与安全修复全部落地。本阶段几乎不动界面，
但决定了阶段 3 能承诺什么行为。

## 前置

- 阶段 1 完成。
- **需要拍板**：D-02（草稿存储 → 决定是否建 `draft_store`）、D-05（附件外置）。
- D-10（版本历史）默认推后 → 本阶段不建表；即便后续改判，也只影响是否**追加**一节，
  不阻塞本阶段其余工作。
- D-01 / D-03 / D-04 / D-07 / D-08 / D-09 / D-11 / D-12 **不**阻塞本阶段。

## 执行顺序（有依赖，不可乱序）

```
2.1 schema 迁移骨架
 ├─ 2.2 item_urls.match_rule ──┐
 ├─ 2.3 sections 表            ├─→ 2.7 新命令 + vaultApi 契约
 ├─ 2.4 附件外置               │
 └─ 2.5 回收站到期             ┘
2.6 域匹配（依赖 2.2）
2.8 草稿存储（依赖 2.1，独立于其余）
2.9 生成器扩展（独立）
```

先做 2.1，因为它定下迁移纪律，后面每一条都照它写。

### 2.1 迁移骨架与纪律

沿用既有风格：`has_column(connection, table, column)?` 判断 + `ALTER TABLE`
（`storage.rs:186-199` 是现成范例）。**不引入版本号分支框架** —— 那是另一件事，
本阶段顺手改会把风险从"加列"提升到"重写迁移系统"。

纪律（每条都要有测试）：

1. 新列必须 `NOT NULL DEFAULT <安全值>` 或可空。**不允许让旧库打不开**。
2. 每条迁移一个 Rust 测试：按旧 schema 建库 → 插一行 → 跑迁移 →
   断言列存在 **且** 旧行仍能被 `get_login_item` 读出且内容不变。
3. `CURRENT_SCHEMA_VERSION` 写进 `meta`（`storage.rs:201-205`）时同步递增。
4. 迁移前强制 `create_sync_history_snapshot` —— 见 2.4，附件迁移不可逆。

### 2.2 `item_urls.match_rule`

```sql
ALTER TABLE item_urls ADD COLUMN match_rule TEXT NOT NULL DEFAULT 'base_domain';
```

`ItemUrl` TS 契约加 `match_rule: 'exact' | 'base_domain' | 'never_submit'`。
默认 `base_domain` 是**行为变更**：当前子串匹配比 base_domain 更宽松，
迁移后部分条目会不再命中。这是修正不是回归，但要在 UI 里给"为什么没命中"的出口（阶段 3）。

### 2.3 `sections` 表（解除 JSON-in-value 技术债）

现状：区块被序列化成 JSON 塞进 `CustomField.value`（`App.tsx:206-233`
`parseSectionFields` / `stringifySectionFields`），而 `item_fields` 表已有 `position` 列
和 `field_type` 列 —— 数据结构是够的，只是没用对。

```sql
CREATE TABLE sections (
  id TEXT PRIMARY KEY NOT NULL,
  item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  title_ciphertext BLOB NOT NULL,
  position INTEGER NOT NULL DEFAULT 0
);
ALTER TABLE item_fields ADD COLUMN section_id TEXT REFERENCES sections(id) ON DELETE CASCADE;
```

迁移：解析 `field_type='section'` 行的 JSON value → 建 `sections` 行 + 把子字段的
`section_id` 指过去 → 删除原 section 宿主行。

**双读单写一个版本**：`get_login_item` 同时能读旧 JSON 形态和新表形态，
`update_login_item` 只写新形态。这样阶段 3 的 UI 可以安全回滚，不必回滚数据。

### 2.4 附件外置（D-05 选 A 时执行）

现状：`attachments.content_ciphertext BLOB` 内联（`storage.rs:175-182`），
读取时整块解密进内存。原型的 100MB 宣称在这个结构上**不成立**。

目标：

```
<app_data>/attachments/<item_id>/<attachment_id>.bin    # AES-GCM 密文
attachments(id, item_id, file_name_ciphertext, byte_count,
            content_nonce, content_tag, created_at)      # 去 content_ciphertext
```

- 目录 `storage::create_private_directory`(0700)，文件 `set_private_permissions`(0600)。
  **解密临时副本没有第二道防线**，这是唯一屏障（AGENTS.md 硬约束）。
- 密文用**每附件独立密钥**，密钥本身用会话密钥包裹后存 DB
  （`content_key_wrapped BLOB`）。理由：附件密钥可以随条目删除而不可恢复，
  而会话密钥永不落盘 —— 不违反"vault key 永不持久化"。
- 流式读写，**禁止**整块 `read_to_end` 再解密。100MB 的验收标准是内存峰值
  不随库内附件总量线性增长（design.md §8.16）。
- 迁移：逐附件"写新文件 → 校验哈希 → 清 `content_ciphertext`"，失败保留旧行并记
  `audit_events`。**迁移前强制快照**。
- 顺带解决审计遗留项 #3（`export_attachment_to_temp` 的解密临时文件清理）：
  临时文件用后即删 + 启动时清扫该目录的孤儿。

### 2.5 回收站 30 天到期

现状：`trashed` / `deleted_at` 列与 4 个命令齐备（`vault.rs:421-465`、
`lib.rs:670-676`），但 `deleted_at` 只用于 `ORDER BY`，**没有任何到期清理**。
1Password 语义是 Trash 保留 30 天、Archive 无限期。

- `trash_sweep.rs::sweep_expired(now)`：`DELETE FROM items WHERE trashed=1 AND
  deleted_at < now-30d`，并级联删附件文件（2.4 之后附件在盘上，必须一并删）。
- 在 `initialize_database` 与 `unlock_vault` 成功后各调一次。
- 测试：第 29 天仍在、第 31 天消失、附件文件同步消失、归档条目永不被 sweep 触及。

### 2.6 域匹配（安全，本阶段核心）

**这是全计划里唯一的纯安全修复，优先级最高。**

现状：`matches_query`（`vault.rs:1188-1208`）用 `stored.contains(query)`，
被 `browser_bridge.rs:156` 和 `:165` 直接当 origin 过滤器用。
存了 `https://github.com.evil.io` 的条目会在用户访问真实 `https://github.com` 时命中。

新建 `src-tauri/src/domain_match.rs`：

```rust
pub enum MatchRule { Exact, BaseDomain, NeverSubmit }
pub fn url_matches(item_url: &str, page_origin: &str, rule: MatchRule) -> bool
```

要求：

1. **拆分 `matches_query`**：UI 搜索（自由文本子串，合理）与桥的域匹配（必须是域名语义）
   是两件事，现在共用一个函数是缺陷根源。
2. base_domain 比较必须是**后缀感知**：`host == base || host.ends_with(&format!(".{base}"))`。
   绝不再用 `contains`。
3. eTLD+1 计算：**不引外部 PSL 表**。无法可靠判定公共后缀时**降级为 Exact** 并记
   `audit_events`。理由：把 `foo.co.uk` 的 eTLD+1 算成 `co.uk` 会让所有 `.co.uk` 站点
   互相命中 —— 引入错误 PSL 逻辑比降级更危险。这个取舍要写进代码注释和文档，
   不能默默选（design.md §6.5）。
4. 匹配逻辑只在 Rust 一处实现，UI 侧只读 `match_rule` 用于展示。
5. 桥侧改为：先取候选（不再传 origin 当 query），再逐 URL 用 `url_matches` 过滤。
   **不新增端点、不改 `ACAO: *`、token 比较保持常量时间**（design.md §6.1.4）。

必测用例（`#[cfg(test)]`，每条都要断言）：

| 存储 URL | 页面 origin | rule | 期望 |
|---|---|---|---|
| `https://github.com.evil.io/login` | `https://github.com` | BaseDomain | **✗**（当前实现是 ✓，这是回归锁） |
| `https://sub.github.com/x` | `https://github.com` | BaseDomain | ✓ |
| `https://github.com/x` | `https://github.com` | Exact | ✓ |
| `https://github.com/x` | `https://evil.test/?u=https://github.com` | BaseDomain | ✗ |
| 任意 | 任意 | NeverSubmit | ✗ |
| `https://notgithub.com` | `https://github.com` | BaseDomain | ✗ |
| `https://a.co.uk` | `https://b.co.uk` | BaseDomain | ✗（降级 Exact 后仍正确） |
| `http://github.com` | `https://github.com` | BaseDomain | ✓（scheme 不参与域匹配，需在文档中明示） |

### 2.7 新命令与契约扩展

`vault.rs` + `lib.rs:659-707` 注册：

```
count_items_by_type(vault_id) -> HashMap<String, usize>
count_archived_items() / count_trashed_items() -> usize
list_tags_with_counts() -> Vec<{name, count}>
move_item_to_vault(item_id, target_vault_id)
set_item_url_match_rule(item_id, url_id, rule)
sweep_expired_trash()                              # 2.5，也内部调用
estimate_password_strength(item_id) -> {bits, tier}   # 放 Rust，与 is_weak_password /
                                                     # watchtower 同源（N-10 已定）
```

`move_item_to_vault` 是一次 `UPDATE items SET vault_id = ?`，**不需要重新加密** ——
`Session { key, vault_id }`（`vault.rs:24-27`）对所有 vault 复用同一把 `VaultKey`，
`switch_vault` 走 `session_for_vault`（`lib.rs:210-212`）只换 `vault_id`。
前提是 D-12 选 A（vault 呈现为分组而非隔离）。若 D-12 选 B，这条命令要重写为
解密—重加密—双写—校验的迁移，本阶段的其余设计也随之改变。
必须校验 `target_vault_id` 存在。`PRAGMA foreign_keys = ON`（`storage.rs:102`）加上
`items.vault_id REFERENCES vaults(id)`（`:118`）会让指向不存在 vault 的更新直接报约束错误 ——
这是好事，但要有测试断言它**失败**而不是静默 no-op。

`update_login_item` 加 `expected_updated_at: Option<String>`：不匹配返回
`VaultError::Conflict`（design.md §5.2）。**没有这条，D-02 的草稿与扩展 `/save`
会互相静默覆盖** —— 扩展的 `save_login` 走的也是 `update_login_item`
（`browser_bridge.rs:170`）。

`item_type` 白名单：Rust 反序列化时归一到 catalog，未知值降级 `login` + 记审计。
`field_type` 同样处理，白名单取 design.md D-04 里那份 1Password 闭合清单
（`text / url / email / address / date / month_year / phone / password / one_time_password /
security_question / sign_in_with`），未知值降级 `text`。**两者都不加 DB CHECK 约束** ——
存量数据里可能有非法值，CHECK 会让库打不开。

`vaultApi.ts` 同步扩 `LoginItem`：`created_at`、`vault_id`、`urls[].match_rule`、
`custom_fields[].section_id`。加一个契约测试断言 Rust 结构体字段集与 TS type 一致。

### 2.8 草稿存储（D-02 选 A 时执行）

草稿含**明文凭据**，绝不能进 localStorage。

- `draft_store.rs`：`<app_data>/drafts/<item_id>.enc`，会话密钥加密（同 2.4 的包裹思路），
  目录 0700、文件 0600。
- 三路清理，每条都要测试：提交成功删、`Esc` 取消删、`lock_vault` 时**全目录清空**。
  第四条：进程异常退出后保留，供恢复提示。
- 上限：每条目一份，全局最多 20 份，超出按 `updated_at` 淘汰。
- `lock_vault` 路径必须覆盖 —— 当前 `handleLock`（`App.tsx:733-742`）只清 session，
  不碰磁盘，草稿会跨锁定存活。

### 2.9 密码生成器扩展（N-09）

现状：`PasswordGeneratorOptions` 只有 `length` + 四个字符集布尔（`vault.rs:120-126`）；
字符集字面量（`vault.rs:1127-1133`）**永久排除** `I O l 0 1`，无法关闭；
无 memorable、无 PIN。前端还硬编码 length 24 忽略自己的 `generatorOptions` state
（`App.tsx:1053-1063` vs `449-455`）。

```rust
pub enum GeneratorKind { Random, Memorable, Pin }
pub struct PasswordGeneratorOptions {
  pub length: usize,
  pub uppercase: bool, pub lowercase: bool,
  pub numbers: bool, pub symbols: bool,
  pub exclude_ambiguous: bool,   // 默认 true，保持现有输出特征
  pub kind: GeneratorKind,       // 默认 Random，serde default 保兼容
}
```

- `exclude_ambiguous: false` 时字符集补回 `I O l 0 1`。
- `Memorable`：内置词表（`embed` 或 `include_str!`，**不发网络**），默认 4 词、
  分隔符 `-`、可选首字母大写、可选尾数。词表要过一遍去歧义。
- `Pin`：`length` 位纯数字，用 `gen_range` 而非取模（避免模偏差）。
- 长度夹取从 `clamp(8,128)` 改为按 kind 分别夹取（PIN 4–12，Memorable 3–10 词）。
- 每个 kind 的测试：分布合理性（卡方或至少"1000 次生成无重复、字符集覆盖完整"）、
  `exclude_ambiguous` 双向、空集合仍报错。
- 前端把 `generatorOptions` 真正传下去，删掉硬编码。

## 验证

```bash
cd src-tauri && cargo test        # 本阶段主战场
npm run build && npm run test     # 契约变更会打断前端，必须同步改
npm run lint:fix
```

- 域匹配 8 用例全绿，特别是 `github.com.evil.io` ✗。
- 每条 schema 迁移的"旧库→迁移→旧行可读"测试绿。
- 附件：100MB 往返测试 + design.md §8.16 的三条可测判据（分块 reader 注入、
  无 `read_to_end` 静态断言、列表加载读取字节数为 0）。
  **不要写 RSS 峰值断言** —— 跨机器不可复现，会退化成随机红灯。
- 草稿四路清理测试。
- 迁移失败注入：附件写到一半断电（模拟：中途 `Err`）→ 旧行仍在、快照仍在、
  新文件被清理。

## 本阶段不改的东西

- 任何界面布局（阶段 3）。
- `github_sync.rs`（C-03/D-06）。
- `import_1pux.rs` —— ZIP 遍历是对的，但条目内部六个取值路径全错，真实导出会得到 N 条
  名为 "Imported Login" 的空条目，而预览计数看起来正常（详见 design.md 非目标段）。
  路径修正不需要真实样本，官方 `1pux-format` 页已公布结构；仍缺的只有 `categoryUuid` 取值表。
  与本阶段无关。
- 备份格式 `passless-backup-v1`。
