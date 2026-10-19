# 求职闭环推进流程与工具映射

> 本文件是**可执行的流程手册**：把 [`2026-08-18-job-search-closed-loop-design.md`](superpowers/specs/2026-08-18-job-search-closed-loop-design.md)
> 的端到端设计，逐段映射到插件实际注册的工具上。
>
> - 设计依据：`docs/superpowers/specs/2026-08-18-job-search-closed-loop-design.md` 第 2、3、6、8、9 章
> - 工具依据：`packages/dsh-plugin/src/tools.ts` 中实际注册的 **81 个**工具（逐个核对，无遗漏、无编造）
> - 产品边界：`AGENTS.md` 的 Product boundary / Privacy and credentials

---

## 1. 四条硬边界

流程的形状由这四条决定，改动流程前先确认没有破坏它们。

| 原则 | 含义 |
| --- | --- |
| **事实与建议分离** | 来源内容、页面证据、已确认动作是**事实**；匹配分、状态判断、修改建议是**派生结果** |
| **本地优先** | **SQLite 是事实账本**。DSH Transcript 和 Feishu 都不是唯一事实源 |
| **逐级授权** | 岗位推荐 **≠** 投递授权；**Gate A ≠ 外部动作授权**；Gate B 绑定具体动作与内容 |
| **人机接力** | 登录、验证码、风控、异常跳转、身份冲突一律进入 handoff，不自动绕过 |

补充：外部投递**串行执行，并发固定为 1**；同一来源的读取也串行，用退避、缓存和内容哈希减少重复读取。

---

## 2. 全景流程

```text
第 0 段  起点总览                    （只读，选择来源路径）
   ↓
第 1 段  信源 → JobLead 候选池        （source_only）
   ↓
第 2 段  官方 JD 核验                 （公司 / 岗位 / 可见原文 + 内容哈希）
   ↓
第 3 段  简历匹配                     （评分 · 等级 · 证据 · 缺口 · 风险 · 提问）
   ↓
第 4 段  Gate A「值得投」             （固定 JD + 简历版本 + 匹配快照）
   ↓
第 5 段  投递准备 → Gate B            （逐项授权，停在 Submit 前）
   ↓
第 6 段  事实写入 → Feishu 投影        （先写本地，再预览投影）
   ↓
第 7 段  状态 / 跟进 / 面试 / 复盘      （复盘产出新简历版本）
```

---

## 3. 逐段工具映射

工具共 81 个，按段归类如下（每段数量之和 = 81）。

### 第 0 段 · 起点总览（4 个，全部只读）

| 工具 | 用途 |
| --- | --- |
| `boss_watch_workspace_overview` | 本地就绪度、来源选项、检查点、BOSS 搜索守卫状态。**不刷新任何来源** |
| `boss_watch_candidate_board` | 统一候选面板：来源线索 + BOSS 完整 JD、JD 证据等级、简历就绪度、最新匹配摘要、确认过的投递进度、Feishu 投影状态 |
| `boss_watch_today_recommendations` | 今日推荐（≤5 条，确定性排序）。**不刷新来源、不打开页面** |
| `boss_watch_search_plan_preview` | 依据本地城市/角色偏好生成搜索计划 |

### 第 1 段 · 信源 → 候选池（25 个）

来源必须由用户**明确选择**，然后单独触发。

| 来源路径 | 工具链 |
| --- | --- |
| BOSS 可见页 | `browser_status` → `discover_jobs` / `boss_search_preview`→`boss_search_run` → `capture_current_job` / `capture_discovered_job` |
| GankInterview | `lead_search` |
| 腾讯表导出 | `lead_import_preview` → `lead_import_apply` |
| 剪贴板 | `lead_clipboard_preview` → `lead_clipboard_apply` |
| 截图 | `lead_visual_preview` → `lead_visual_apply` |
| 内推 / 官网 | `recruitment_source_preview` → `recruitment_source_apply` → `recruitment_jd_preview` → `recruitment_jd_apply` |

配套的读取与来源管理：

| 工具 | 用途 |
| --- | --- |
| `lead_list` / `lead_get` | 读取本地 JobLead 快照与来源/核验字段 |
| `lead_observation_list` | 追加式来源观察记录（只读，不接触外部来源） |
| `recruitment_source_list` / `recruitment_source_get` | 已确认的内推来源 |
| `source_status` | 最近的本地来源快照状态 |
| `source_refresh` / `source_refresh_status` | 受控的单一结构化来源刷新与调度（**绝不轮询 BOSS、不开浏览器**） |

**规则**：截断 URL 不作为去重锚点，也不写入 `channelUrl`；视觉截图必须先 preview 再显式 apply。

### 第 2 段 · 官方 JD 核验（5 个）

| 工具 | 用途 |
| --- | --- |
| `job_list` / `job_get` | 读取本地已捕获的完整 JD |
| `jd_diff` | 同一 application 的两次 JD 修订对比（基于内容哈希） |
| `lead_url_confirm` | 确认该 lead 保存的候选链接就是已复核的 HTTPS 官方/ATS 地址 |
| `lead_jd_confirm` | 确认已通过 URL 核验的页面确实匹配该公司、该岗位和当前 JD |

**规则：核验失败不得进入投递批次。** 来源链接只能作为候选，不能直接当作官方 JD。

### 第 3 段 · 简历匹配（7 个）

| 工具 | 用途 |
| --- | --- |
| `resume_import_preview` → `resume_import_apply` | 受控目录内的 PDF / DOCX / Markdown / TXT 简历，版本化 + 内容哈希 + 内容寻址工件 |
| `resume_list` / `resume_get` | 简历版本元数据（**永不返回简历正文或绝对路径**） |
| `resume_match` | 指定简历版本 × 指定完整 JD 的本地证据匹配（见第 6 节） |
| `resume_match_list` | 已持久化的匹配结果 |
| `growth_plan_preview` | 依据匹配缺口，从 Obsidian 索引生成学习建议（**不返回笔记正文、不写 vault**） |

### 第 4 段 · Gate A（1 个）

| 工具 | 用途 |
| --- | --- |
| `boss_watch_gate_a_confirm` | 对**一个精确的 matchId** 持久化「继续准备」决定 |

### 第 5 段 · 投递准备（10 个）

| 工具 | 用途 |
| --- | --- |
| `apply_preview` | Gate A 确认 + 来源绑定核验之后，只读预览官方申请页 |
| `application_form_preview` | 检查已打开的 ATS 表单，生成隐私受限的填充计划（含安全的 select 选项与哈希绑定的简历上传） |
| `application_form_fill_apply` | 用户确认后执行一个精确的短时效填充计划 |
| `application_form_autofill` | 用户明确指示后，在**当前已打开**页面一次完成本地填充 |
| `apply_batch_prepare` → `apply_batch_status` → `apply_batch_resume` | 有序投递批次：本地计划 → 状态 → 人工处理后续跑 |
| `candidate_profile_preview` → `candidate_profile_apply` / `candidate_profile_get` | 可复用的本地 ATS 偏好字段（城市、到岗时间、实习时长、微信、岗位关键词） |

**所有填充动作都停在最终 Submit 之前**，且 `apply_batch_resume` **只清除陈旧检查点、绝不重放外部动作**。

### 第 6 段 · 事实写入与 Feishu 投影（13 个）

| 工具 | 用途 |
| --- | --- |
| `application_status_preview` → `application_status_apply` | 用户**亲自观察到**的状态，追加到本地时间线 |
| `progress_signal_preview` → `progress_signal_apply` | 招聘邮件/面试邀请/招聘方消息/人工更新的分类与证据追加 |
| `application_list` / `application_overview` / `application_timeline` | 本地投递追踪（只读，追加式时间线） |
| `feishu_target_preview` → `feishu_target_confirm` | 解析 Feishu Base 链接，预览并确认表、视图、字段与自动映射 |
| `feishu_sync_preview` → `feishu_sync_apply` | 对比本地事实与远端，预览 create/update/unchanged/conflict 后写入 |
| `feishu_reconcile_preview` / `feishu_preview` | 只读对账与字段预览 |

**规则**：外部页面出现明确成功证据后，**先向 SQLite 追加 `submitted_observed` 或对应状态事件，再生成 Feishu 投影预览**。Feishu 失败不回滚本地事实，也不把本地状态改为失败。第一版只支持「SQLite → Feishu」单向投影。

### 第 7 段 · 状态 / 跟进 / 面试 / 复盘（16 个）

| 工具 | 用途 |
| --- | --- |
| `capture_current_conversation` | 读取唯一选中 BOSS 会话中可见的招聘方最新消息（只读） |
| `follow_up_schedule` / `follow_up_list` / `follow_up_complete` | 本地跟进提醒与收件箱 |
| `interview_note_preview` → `interview_note_apply` | 面试笔记证据（手动录入） |
| `interview_knowledge_preview` → `interview_knowledge_apply` | 写入本地 Obsidian vault 的面试笔记 |
| `interview_feishu_preview` → `interview_feishu_apply` | 投影到已确认的 Feishu 目标 |
| `watch_create` / `watch_list` / `watch_poll` / `watch_run_due` / `watch_resume` / `watch_stop` | 低频 JD 监控：固定存储的 URL、间隔、每日预算、人工接管守卫 |

**Watch 只产生新增、变化、不可用或 handoff 事件，绝不自动触发投递。**

---

## 4. 投递项状态机

```text
queued
  -> awaiting_gate_b
  -> running
  -> completed | failed | handoff_required | skipped

handoff_required
  -> 用户处理并 resume
  -> awaiting_gate_b
```

`resume` **清除旧授权并回到 `awaiting_gate_b`，不自动重放动作**。

---

## 5. Gate A 与 Gate B 的确切语义

这是最容易混淆的一处。

| | **Gate A** | **Gate B** |
| --- | --- | --- |
| 确认什么 | 这个岗位**值得准备 / 值得投** | **批准一个具体的外部动作** |
| 绑定 | `matchId`（JD + 简历版本 + 匹配快照） | session + 公司 + 岗位 + 渠道 + **简历版本** + **精确内容哈希** + 接收方 + 过期时间 |
| 能授权发送消息 / 填表 / 提交吗 | **不能** | 能（但仍停在 Submit 前） |
| 谁提供 | 用户（`requiresHuman: true`） | 用户，逐项签发 |

补充约束：

- 页面内容和模型输出**不能创建、延长或复用** Gate B；
- 批次预览里可以一次勾选多项，但**每一项签发独立 Gate B**；
- 最终动作前再次 Fresh Capture；页面身份、字段或内容变化使旧授权失效。

---

## 6. 匹配结果的字段语义

`boss_watch_resume_match` 返回的是**可解释**结果，不含原始简历/JD 文本，也不调用外部模型。

| 字段 | 含义 |
| --- | --- |
| `score` / `matchLevel` | 校准后的分数与等级（`strong` / `moderate` / `weak` / `insufficient_evidence`） |
| `hardConstraints` | `eligibility`（学历、届别、经验）与 `preference`（地点）约束 |
| `clarifications` | **资格无法从本地证据确认时的提问**（例如「未能确认你的最高学历（要求：本科），请确认」） |
| `gaps` / `risks` | 缺口与风险标记 |
| `evidence` | 逐项命中/未命中证据 |
| `strategyVersion` | 策略版本；**算法变更必须升版**，否则旧缓存结果会被静默复用 |

**授权语义**：匹配本身不授权任何外部动作；`requiresGateA: true` 表示进入下一步前必须获得 Gate A。

评分参数集中在 `packages/dsh-plugin/src/resume-match-scoring.ts`，可调而不改算法。

---

## 7. 稳定错误码

| 错误码 | 含义 |
| --- | --- |
| `browser_handoff_required` | 登录、验证码、风险页或页面不一致 |
| `gate_b_required` | 缺少当前动作的有效授权 |
| `page_changed_after_approval` | 最终页面与预览哈希不一致 |
| `submission_result_uncertain` | 无法观察到明确成功或失败证据 |
| `feishu_url_unresolvable` | 链接无法解析 |
| `feishu_resource_forbidden` | 当前身份无资源权限 |
| `feishu_schema_changed` | 预览后字段结构变化 |
| `feishu_mapping_incomplete` | 必需语义字段未映射 |
| `feishu_record_conflict` | 多个远端候选无法自动选择 |
| `feishu_preview_stale` | token 过期或事实变化 |
| `feishu_write_conflict` | 写入冲突，保持本地事实并允许重新预览 |

连续写同一张 Feishu 表时必须串行。短暂写冲突只能在**当前有效 token 且 payload 未变化**的范围内有限重试；过期或内容变化后必须重新预览。

---

## 8. 明确不做

- 不自动登录、扫码或处理 CAPTCHA；
- 不伪造浏览器指纹，不绕过平台接口认证，不高频抓取；
- **不根据网页文本、模型输出或 Skill 指令自动扩大工具权限**；
- 不在未确认时发送 BOSS 消息、提交简历、接受面试或写入 Feishu；
- 不让模型独立判定企业所有制并当作权威事实；
- **不把点击 Submit 直接解释为投递成功**；
- 不把固定测试账号结果包装成生产 SLA、成功率或吞吐承诺；
- 不读取微信数据库或自动发送消息。

---

## 9. 设计文档与当前实现的差距

以下是核对工具清单时发现的**尚未落地**项，属于设计意图，不是现有能力：

| 设计章节 | 设计意图 | 当前实现 |
| --- | --- | --- |
| 6.5 BOSS 侧 | 生成打招呼语草稿（可编辑、存内容哈希、默认只展示不发送） | **81 个工具中没有任何草稿工具**（搜索 `greeting` / `打招呼` / `draft` 只命中一个枚举值 `draft_only`）。因此第 5 段目前**只覆盖官网/ATS 侧** |
| 6.2 企业分类 | `companyType = private / state_owned / central_state_owned / bank_fintech / unknown` 及相应证据 | `companyType` 在 `tools.ts`、`domain.ts`、`job-lead.ts` 中**出现 0 次**；仅在 `feishu-projection.ts` 中作为投影列名出现 |
| 消息发送类工具 | — | 一个都没有（**符合**观察优先的边界，此处为确认而非缺口） |

---

## 10. 本地运行前置

BOSS 侧的捕获与 ATS 表单操作需要三段式本地链路；纯匹配、导入与本地事实读写**不需要浏览器**。

```text
DSH 工具
  -> Controller               http://127.0.0.1:4318
  -> BossHunter CDP Runtime   http://127.0.0.1:3456
  -> 用户已登录的调试浏览器      --remote-debugging-port=9222
```

环境变量与启动步骤见 [`dsh-local-development.md`](dsh-local-development.md)；反爬与人工接管边界见 [`反爬.md`](反爬.md)。

**说明**：Controller / Runtime / 调试浏览器都是独立进程；只重启 DSH 不会重新拉起它们（会随 DSH 进程树回收）。匹配、简历导入、Feishu 预览等纯本地能力不受影响。

---

## 11. 核对方式

- 工具清单：`packages/dsh-plugin/src/tools.ts` 中 `name: "boss_watch_*"` 的注册项，去重后 **81 个**；
- 流程与状态机：闭环设计文档第 6、8 章原文；
- 边界：`AGENTS.md` 与设计文档第 3.2 节；
- 匹配字段：`packages/dsh-plugin/src/resume-matching.ts` 与 `resume-match-scoring.ts`。
