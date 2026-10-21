# 叙事 case 回归测试工具（长期维护）

2026-10-19 C111 建立（33 票 C65-C110），同日工具正式化。**目的：每次改题集/改门/改 mapper，整链重析这批案票，确认该拦的拦、该放的放、拦截原因正确**——新 Jev 版本的「改了什么」由版本常量说了算，「没改坏什么」由本集合说了算。

## 资产

| 文件 | 职责 |
|---|---|
| `scripts/narrative/case-regression/fixtures.json` | 票集本体（caseId=台账编号；一票一 case，addr 全局唯一） |
| `scripts/narrative/case-regression/lib.mjs` | 判读/断言/收录/预期更新/涨幅分层抽样纯函数（零 DB 零网络） |
| `scripts/narrative/case-regression/run.mjs` | runner（重析对拍 + `--list`/`--add`/`--update-expect`） |
| `scripts/_test_case_regression_lib.cjs` | 断言器单测（44 断言，改 lib 必跑） |
| `scripts/narrative/case-regression/data/` | 对拍结果存档（CSV+JSON，期望/基线/当前同表；**进 git 的长期维护资产**，.gitignore 否定规则保入；C111 首轮=`case-regression-result-2026-10-19.csv` 29 PASS/4 OBSERVE） |
| `scripts/narrative/case-regression/build-sample.mjs` | 抽样集构建器（182 跑：实验并集→涨幅已知池→分层落盘 sample-sets/） |
| `scripts/narrative/case-regression/run-sample.mjs` | 抽样集 runner（182 跑：整链重析→分层×评级矩阵→data/ 存档；无 expect 断言） |
| `scripts/narrative/case-regression/sample-sets/` | 抽样集本体（地址清单+涨幅快照+seed，**进 git**；首轮=C136 `2026-10-21-three-exp-180`） |

## 快速开始（182 跑；本地只允许 `--list`）

```bash
npm run case-regression                          # 全量 33 票整链重析对拍（烧 Jev 配额，改版本后跑）
npm run case-regression -- --only C98,C104       # 选定票
npm run case-regression -- --list                # 集合清单（零 DB，本地可跑）
npm run case-regression -- --add <addr> --case C112 --note "案由一句话" [--observe "已知面"] [--dry]
npm run case-regression -- --update-expect C97,C102 --because "C113 裁定一句话" [--dry]

# 姊妹资产：叙事抽样测试集（统计评估，非 case 断言；见下节）
npm run narrative-sample-build -- --exps <id1>,<id2>,<id3> --name <set> --top 60 --bottom 60 --random 60 --seed <N>
npm run narrative-sample -- --set <set> [--only top|bottom|random] [--dry]
```

- 退出码：`0` 全过 / `1` 存在非 observe 票断言失败或收录校验失败 / `2` 重析异常（数据源不可用，验证未完成）
- 对拍结果（JSON+CSV）默认写工具 `data/` 子目录并**提交进 git**（每次改题集后的行为快照可追溯）；跑前自动备份全部票现行 `token_narrative` 整行到 `/tmp/case-regression-backup-*.json`（整行含完整 state 大文件，刻意留 /tmp 不进 git）；fixtures 写回前自动备份到 `/tmp/case-regression-fixtures-backup-*.json` + tmp+rename 原子写

## expect DSL（断言语义键全集）

| 键 | 语义 |
|---|---|
| `rating` | `'low'|'mid'|'high'` 单值或数组；`null`=不断言（评级交后腿的票） |
| `reasonIncludes` / `reasonExcludes` | 终态文案（blockReason/precheck.reason）子串全 AND / 禁词 |
| `precheckRuleIncludes` / `precheckRuleExcludes` | 对 `pre_check_result` 的 ruleName |
| `auditIncludes` | 审计键须在 stage1/stage2 结果列序列化内在场（如 `staleParentOverride`） |
| `tokenCategory` / `tokenCategoryExcludes` | `token_category` 精确等 / 不得再出现的类别 |

**写断言纪律（C111 三教训）**：
1. 只断言**确定性键**（拦截位 ruleName、审计 override 键、rating 方向）；Jev 概率面掷骰的（nameForm argmax 浮动、低置信 carrier 掷硬币）**勿写死**——rating 不断言配 `observe` 键说明已知面。
2. 拦截位会随门链序移动（C74 分桶 precheck 先拦、C108 门链序 nf→sc→tier）——断言「方向对」而非「死因恰好是某门」，除非该门是 case 的全部语义。
3. 四信封判读（fin > pcr > prest）只在 lib `interpret` 一处实现，勿在断言或脚本里重复。

## 工作流

### A. 新 case 收录（每个新叙事 case 都要进集合）

结案时（台账追加同批）：`--add <addr> --case C<n> --note "案由"`。工具快照现行行为作 rating 基线并盖 `addedAt`；**生成后必须人工复核 expect**——rating 是否即断言语义、补 `reasonIncludes`/`auditIncludes` 意图键（机器只记录现状，断言意图必须人来定）。`--add` 刻意不重析（不烧 Jev 配额）——票须已有终态行，没有就先 `--only` 跑出来。

### B. 预期更新（故意的行为变化）

裁定使某票预期变化时：`--update-expect <ids> --because "<case 编号> <裁定一句话>"`。rating/tokenCategory 从现行行刷新、人工调过的细节键原样保留、盖 `expectSince`/`expectBecause` 留痕。**每个预期都必须能回答「为什么是现在这个值」**——这两个键就是长期维护的根。不带 `--because` 拒绝执行。

### C. 改题集/改门/改 mapper 后

CLAUDE.md「修改 Jev 题集」流程第 6 步：先跑全量对拍（预期变化票已用工作流 B 更新过的应 PASS；未更新的偏差就是回归，修代码或修预期二选一并留痕），再部署。部署前后行为差=本次对拍 CSV 与 `data/` 内存档的历史 CSV 对查。

## 维护规则

- caseId=台账 case 编号（C 编号），新增前先 grep 台账防撞号（C107 教训：并行会话可能已占用下一个编号）
- 集合只增不删——票的语义过时就改 expect 配 observe 说明，案票本身是历史资产
- 改 lib 任何判读/断言语义 → 跑 `node scripts/_test_case_regression_lib.cjs`（36 断言）+ 事故形状反证仍在
- 重析会覆盖 `token_narrative` 行（跑前自动整行备份）；fixtures 写回原子化，撕裂=丢弃 tmp 重来

## 姊妹资产：叙事抽样测试集（C136，2026-10-21 建）

与 case 回归集的分工：回归集=**断言集**（该拦的拦该放的放，一票一 case 人工 expect）；抽样集=**统计评估集**（按涨幅分层的统计样本，机器只记录现状不断言，看评级分布与「评级 vs 涨幅」相关性）。

- **构建**（182）：`npm run narrative-sample-build -- --exps <id,...> --name <set> --top N --bottom N --random N --seed N`——experiment_tokens 并集 → token_profiles.max_change_percent 非空（涨幅已知池）→ 排除回归集已收录票 → top（max 降序）/bottom（max 升序，max=0 并列按 final 升序=跌最狠优先）/random（剩余池 mulberry32(seed) 洗牌，seed 落盘可复现）→ `sample-sets/<set>.json`（tmp+rename 原子写）。分层纯函数 `stratifySample`/`mulberry32` 在 lib.mjs，单测锁定。
- **跑**（182）：`npm run narrative-sample -- --set <set> [--only top|bottom|random] [--dry]`——跑前备份现行 token_narrative 判读列到 /tmp；串行整链重析（`ignoreCache:true`）；输出分层×评级矩阵 + `data/sample-<set>-result-<ts>.{json,csv}`（CSV 含涨幅列，进 git）。`--dry` 只回读现行行不烧 Jev 配额。退出码 0=全完成 / 2=有重析异常。
- **维护**：抽样集只增不建重复（同一实验组合要新样本时换 name+seed 重抽）；样本快照与涨幅口径（峰值 BNB 可用价链）绑定在集合元数据里，涨幅后续变化不回填——对拍时以集合内快照为准。
