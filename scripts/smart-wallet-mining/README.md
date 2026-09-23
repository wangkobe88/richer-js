# 聪明钱钱包挖掘（smart-wallet-mining，BSC four.meme 版）

> **⚠️⚠️ 首行红线：重查询脚本，只能在 182 远程服务器上跑。** 本地走 VPN 连 Supabase 必超时。
> 本地仅允许 `mine --self-test`（零 DB 合成数据单测）与 `--no-db`（验管线，需先从 182 scp 小源缓存到 `data/tick-cache/`）。
> 所有 DB 访问走 `dbManager.getClient()`（SUPABASE_SERVICE_KEY 优先；anon 会被 wss_price_ticks 的 RLS 静默过滤成空）。

母版：pumpfun-wss-trader `scripts/smart-wallet-mining/`（Solana PumpFun，已暂停）。本目录为批 3.2 BSC 移植，方法论与纯函数逐字保留，链适配差异全部标注 ★BSC。

## 组成

| 文件 | 作用 |
|---|---|
| `mine-smart-wallets.cjs` | 主挖掘：6 阶段管线 → `data/smart-wallets-{ts}.csv/.json`；`--apply` 写 `wallets.category` + `wallets.token_count` |
| `verify-smart-wallets.cjs` | 独立路径对账（PnL 抽样重算 / mark 合理性 / A/B 结构），任一 fail 退出 1 |
| `apply-smart-bots.cjs` | 从产出 JSON 挑「高频bot样」写 `wallets.category='smart_bot'`（批 3.3 smartBotCount 消费） |
| `lib/tick-data-cache.js` | 每实验 gzip JSONL 缓存（staleness=DB max(received_at) 高水位，增量合并） |
| `lib/data-fetcher.js` | `(received_at,id)` 复合游标分页拉取（依赖 `scripts/sql/create-wss-ticks-received-idx.sql`） |

## 用法（182）

```bash
node --max-old-space-size=12288 scripts/smart-wallet-mining/mine-smart-wallets.cjs --days 7 \
  --anchor-wallets 0xAAA...,0xBBB...
node scripts/smart-wallet-mining/verify-smart-wallets.cjs --json data/smart-wallets-XXX.json
node scripts/smart-wallet-mining/apply-smart-bots.cjs --json data/smart-wallets-XXX.json --dry-run
# 确认后去掉 --dry-run 落库；或 mine --apply（挖掘直写，默认关）
```

本地仅：`node scripts/smart-wallet-mining/mine-smart-wallets.cjs --self-test`。

## 方法论（6 阶段，与母版一致）

0. **源计划**：virtual + blockchain='bsc' 实验枚举（丢 failed/pending/initializing，不排 running），tick 存在性探测（received_at desc limit 1）。★BSC 客户端滤掉 `config.platform==='flap'`（flap 实验与 four.meme 共享 tick 表，混入污染口径）；显式 `--experiments` 时不滤（用户自担）。
1. **逐源流式折叠**：全内存 pairs/tokenState；token 落寂 ≥6 源才剪尘配对（活跃期误剪=丢"先 0.01 后 0.5 BNB"前段买额→PnL 虚高）；`--max-pairs` 护栏超限中止不静默降级。多源合并=并集（wss_price_ticks UNIQUE(tx_hash,log_index)，并发实验首写者拥有该行，天然无重复）。
2. **配对 PnL 归约**：每票净 PnL 无配对恒等式 `net = sellBnb + (buyTok−sellTok)×mark − buyBnb`（与成本分配法无关）；carry-in 三桶剔除（sellFirst/overSell/ambig）；creator 自买剔除；mark=末位价（尘价 1000× 中位剔除回退）。
3. **两批门槛**：批1 活跃持续盈利（≥20 票、胜率≥0.40、mean≥0.03 BNB、对半两半均盈利、realized≥0.25 防断流票纸面富贵）；批2 稳准狠（5-20 票、胜率≥0.80、mean≥0.08 BNB、中位买≥0.04、realized≥0.5、单票≤0.6、≥2 天、raw 参与<200）。双达标归批2。公共门 wash+pump_dump 占比≤0.5。
4. **enrich**：★BSC 缩减——wallets 表仅 {address,chain,name,category}，母版 tags/clusters insider-coords 簇重叠与 token_participation 无此列不迁；只做人工标注冲突预检（现有 category 非空且非 smart 族 → `--apply` 跳过，产出仍列+notes 标注）。
5. **第三趟受限重扫**：A/B 带量验证（聪明钱早入票 vs 同类目+同热度桶+首 tick 48h 卡钳对照票的存活/散户到达提升，≥30 A 票才裁决）+ 随机钱包零假设（300 个 lcg seed 42，提升应≈0，显著为正=机械成分扣减）+ lead-lag 跟单标注（首买 ±1 block 内有先行者=被带，followRate≥0.7 标疑似跟单 bot）+ 协作环（合格票集 Jaccard≥0.6 对更高排名者）。
6. **产出**：CSV/JSON + 控制台中文报告；`--apply` 写 wallets（高频bot样→smart_bot，其余→smart_money；顺带写 `token_count` = 入榜钱包 rawTotalRun——批 3.3 sniperHolderShare 名单原料，依赖 `scripts/sql/create-wallets-token-count.sql` 已执行）。

## ★BSC 适配差异清单（vs 母版）

- **单位**：`bnb_amount/price_bnb` 十进制 BNB 直用（母版 lamports /1e9）；CLI/CSV 列名 Sol→Bnb（`--min-tick-bnb`/`medianBuyBnbPerPair`/`unrealizedBnb` 等）；内部 pair 字段 `bs/ss/bt/st` 保留。
- **次序键**：一切次序用 `(block_time, block_number)` 复合键（母版 (ts, slot)；null→0，BSC ~3s/块）。
- **lead-lag**：Δslot≤2 → **Δblock≤1**（墙钟跨度近似：3s 块 ×1 ≈ 400ms slot ×2）。
- **token 分类双路**：主路 `token_profiles` 全局表（批 3.1 OnlineProfileBuilder 写入）；无行的 token 用折叠期攒的 cls slim-tick 缓冲 + `experiment_tokens.raw_api_data.totalSupply` 内嵌现算（`classifyToken` 同一代码，`applyFallbackClassification`）——含尘/outlier tick（priceReliable 标志区分），与在线 OPB 全量口径一致。注意：挖掘窗=实验覆盖窗，晚于窗的 token 生命不在内，fallback 分类与在线全窗有偏（多数 token 全生命周期 < 挖掘窗，偏差有限）。
- **锚点钱包**：母版写死 CCCCQ/9999huSC/AbuGAb9M（Solana 地址）→ 默认空 + `--anchor-wallets 0xAAA,0xBBB` 传入；无锚点输出 ⚠️（名单置信靠 A/B+verify）。
- **creator 比较**：大小写不敏感（EVM checksum 两种存法都算自买；母版 Solana 地址本就 base58 敏感直比）。
- **mark 合理性（verify）**：无 sol_price_cache → tick 内含 FX=median(price_usd/price_bnb) × totalSupply 对拍 token_profiles.peak_mcap_usd（×1.05 容差，毒价虚高在此现形）。
- **URL**：solscan → bscscan（`/address/{w}`、`/token/{tk}`）。
- **不迁**：mayhem 盘剔除（pumpfun 专属）、`--keep-insider` 簇排除、tags/clusters、token_participation/flatPart、rawTotalWallets 列。
- **金额初值**（全部标"待回测校准"）：minTick 0.002 BNB（=FA minPriceUpdateBnb 同口径）/ 参与门 0.02 / 批1 mean 0.03 / 批2 mean 0.08 / 尘配对 0.02 / winEps 0.001 / costPerSide 0.03（1% 协议费+gas+滑点）。

## 参数重校提示

按裁定②「保留原口径+参数重校」：结构/语义对齐母版，BNB 金额阈值按 four.meme 节奏定的初值只是起点。首跑 7 天窗后看 funnel 与批1/批2 产出量，用 `--active-min-mean`/`--sharp-min-mean`/`--pair-min-buy-bnb` 等旗标重校，再回填默认值。

## 已知边界

- 单源数据（当前仅实验 572033ad 有 ticks）时 A/B 对照池小、verdict 多为「不确定」——管线有效性不受影响，名单置信等数据量。
- `--apply`/apply-smart-bots 写 wallets 为 upsert `onConflict 'address,chain'`：mine `--apply` 送 {address,chain,category,token_count}，apply-smart-bots 送 {address,chain,category}——PostgREST on conflict 只更新送入列，name 保留。
- **sniper 名单口径边界（批 3.3）**：`token_count` 仅入榜钱包有值（挖掘 rawTotalRun）→ FA 的 sniper 名单（`chain='bsc' AND token_count≥50`）⊆ 挖掘入榜集，非全史画像；fail-closed（名单小=门保守）方向安全。全量 rawTotal 画像源待后续离线管线；挖掘更新名单后引擎重启才生效（模块级单例不热重载）。
- verify 的 PnL 对拍容差 TOL=6e-4 BNB；500-tick mark 独立重算与全量滚动窗口在可靠价 tick >500 且末期稀疏时理论可差（末 11 条价总被 500 覆盖，实际一致）。
