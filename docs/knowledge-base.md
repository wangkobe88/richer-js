# 叙事分析知识库（C165）运维手册

理解代币叙事常需背景知识（「彪弟」需知「彪哥」；「哭哭奶龙」需知「哭哭马」）。知识库在分析时按 6 级规则匹配命中条目，注入 `[KNOWLEDGE_BASE]` 段辅助 Jev 判定；分析完的毕业票/高评级票自动沉淀回写。

## 文件结构与 id 约定

| 文件 | 进 git | 来源 | 说明 |
|---|---|---|---|
| `config/knowledge/concepts.json` | ✅ | 人工 | BSC 基础概念（Flap 平台、股票代币、four.meme、GMGN） |
| `config/knowledge/bluechips.json` | ✅ | 182 builder `--commit` | 蓝筹快照（ATH 市值 > $1M 口径，用户裁定） |
| `config/knowledge/manual-entries.json` | ✅ | 人工 | 补录/兜底：同 id 覆盖生成件（如蓝筹掉榜） |
| `data/knowledge/quasi-graduations.json` | ❌ | 182 builder `--commit` | 近期 7d 毕业准蓝筹（上限 300） |
| `data/knowledge/quasi-feedback.json` | ❌ | worker 运行时回写 | 反馈沉淀（同 id 覆盖 graduations=沉淀优先） |

合并序（后读覆盖同 id）：concepts → bluechips → quasiGraduations → quasiFeedback → manual。

**id 域**：蓝筹 `b:<小写地址>`、准蓝筹 `q:<小写地址>`（feedback 与 graduations 同 q: 域=后写覆盖；manual 用同 id 覆盖生成件兜底掉榜）、概念 `concept:<slug>`。

条目 schema：`{ id, kind: bluechip|quasi|concept, name, symbol, aliases[], address, twitter, narrative(≤320字), narrativeSource(coingecko|null), keywords[](仅concept), corpusTrigger, source, rating, athMarketCapUsd|graduatedAt, updatedAt }`。**manual 补录地址必须查实（DB/AVE/GMGN），勿用示意地址。**

**蓝筹叙事两级来源**：`--enrich`（token_narrative 已析行 + experiment_tokens intro + AVE）优先，`--enrich-desc`（CoinGecko 公开简介 description.en，剥 HTML/句界截 320）**只填占位**（空/纯「本系统评 X」/≤12 字），已有效富化不动；匹配收紧=symbol+name 双全等或词级前缀（词内包含拒配 NIGHT↔Midnight，宁缺毋冒配），条目带 `narrativeSource:'coingecko'` 审计。CG 免费 ~10 req/min（7s 限速+429 退避+断点续 `data/knowledge/build-bluechips/cg-map.json`；有 `COINGECKO_API_KEY` 环境变量自动带 demo key header）。

## 匹配器（`src/narrative/analyzer/knowledge/knowledge-matcher.mjs`）

6 级规则（优先级序）：`address_exact` > `twitter_exact` > `name_exact` > `name_substring`（LCS 判定，CJK≥2 或 latin≥4；**concept 条目不参与**——类目名是通用标签）> `corpus_contains` > `concept_keyword`。

防噪三防线：
1. 代码级 denylist（pepe/doge/coin/moon…，只压 substring/corpus 级，不压 name_exact）
2. 条目级 `corpusTrigger:false`（builder 对 denylist 名/短名自动置 false）
3. `maxEntries=5` 封顶按优先级截断留痕

匹配源=`{symbol, name, address, twitterHandle, corpusText(主推+bio+intro)}`；prestage 路径用账号 bio+推文二次匹配（`includePrestage` 配置门）。

## 注入与回写

- 注入段 `[KNOWLEDGE_BASE]`：header 级独立段（不占四区配额）+ 免责声明（背景≠宣告语料，关联与价值仍归题集）。null/空命中=state 逐字节 bit-parity。挂位：`jev-state-builder.mjs` 标准+prestage 两 builder；`stats.knowledgeSection` 观测。
- 匹配命中挂 `tokenData.raw_api_data.knowledge_matches` 审计（随 save 落库）。
- 反馈回写：analyzer 最终 save 后 `maybeCaptureKnowledgeFeedback`——rating∈captureRatings(['high']) 或（毕业 ∧ rating≠'low'）；只沉淀客观字段（intro/rating/reason），narrative=`intro截120｜本系统评 {rating}：reason截200`；tmp+rename 原子写；失败 warn 不影响分析。毕业点查 wss_events graduation（service key）。**feedback 自反馈排除**（ab0e2f9，C165 回归现场反证）：feedback 条目命中本票自身地址时剔除——「本系统评 high」注入自己重析=自锚定锁死（`excludeSelfFeedback` 挂 analyzer+prestage 双点）；蓝筹（客观 ATH）/graduations（客观毕业）自命中保留，feedback 姐妹票跨地址保留。

## Builder（只在 182 跑，本地禁止）

```bash
# 蓝筹（GMGN 三榜 24h×{marketcap,renowned_count,volume} 各 100 → ATH>$1M 过滤 → 叙事富化）
node scripts/narrative/build-knowledge-bluechips.mjs --smoke    # Phase 0 冒烟：确认 ATH 字段名/量纲
node scripts/narrative/build-knowledge-bluechips.mjs --fetch    # 三榜拉取（35s 节流+429 退避+断点续跑）
node scripts/narrative/build-knowledge-bluechips.mjs --verify   # 逐票 getTokenInfo 验 ATH（400ms 节流；429 ban 5 轮 exit 2）
node scripts/narrative/build-knowledge-bluechips.mjs --enrich   # 叙事富化（token_narrative+experiment_tokens+AVE 可选）
node scripts/narrative/build-knowledge-bluechips.mjs --enrich-desc # 叙事补齐：CoinGecko 公开简介填占位（7s 限速+断点续 cg-map.json）
node scripts/narrative/build-knowledge-bluechips.mjs --commit   # 写 config/knowledge/bluechips.json（缺省 dry-run）

# 准蓝筹（GMGN trenches completed 两平台 → 7d 窗+毕业时间点查 → 上限 300）
node scripts/narrative/build-knowledge-quasi.mjs --smoke
node scripts/narrative/build-knowledge-quasi.mjs --fetch
node scripts/narrative/build-knowledge-quasi.mjs --commit       # 写 data/knowledge/quasi-graduations.json（缺省 dry-run）
```

- 蓝筹按需重建（周级稳定）；准蓝筹日/按需。GMGN 索引时间晚链上 ~9min，只作窗口粗滤；毕业时间真相=wss_events graduation 点查。
- 蓝筹快照 commit 后**须 git push**（182 拉取生效）；data/ 两文件 182 本地即生效。

## 配置与热载

`config/narrative-engine.json` 顶层 `knowledgeBase` 段（searchFallback 同语义）：段缺失/enabled:false→null 静默关；enabled:true 残缺→throw fail-loud。**config 段变更需重启 narrative-engine**；此后 5 个知识文件 mtime 热载（每次调用 stat 全文件，变化即重载），免重启。

## 回归依赖（★）

**case-regression 跑前知识文件必须 commit 态**（蓝筹/concepts/manual 从 git 取，data/ 两文件 182 本地）——知识条目漂移会改变 state 注入导致票面翻转。排查回归漂移先 diff 知识文件。**且回归运行中 feedback 回写会中途改变知识态**（首轮 quasi-feedback 从无到有=轮内前后票条件不一致）——跑前确认 quasi-feedback.json 已存在且稳定。

回归预期锚：C129 彪弟（知识命中「彪哥」→ 翻正 mid|high）；哭哭奶龙必须保持 high（回退=噪声入侵，迭代 denylist/corpusTrigger）。

## 单测（零 DB 零网络，改到哪块跑哪块）

- `scripts/_test_knowledge_matcher.cjs` — 6 级规则/归一化/denylist/concept 门/封顶
- `scripts/_test_knowledge_section.cjs` — 段形状/截断/bit-parity（标准+prestate 两 builder）
- `scripts/_test_knowledge_loader.cjs` — 五文件合并/损坏跳过/mtime 热载/配置门
- `scripts/_test_knowledge_feedback.cjs` — _shouldCapture/upsert 驱逐/原子写/毕业点查口径
- `scripts/_test_knowledge_builder_core.cjs` — normalizeRankRow/ATH 两形态/窗口过滤/id 域
