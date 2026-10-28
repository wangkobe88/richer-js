# gang CLI 实测形状档案（Step 0 探针 2026-10-28）

182 真实试单闭环采集（BAW `0xFC84D51c15ACBdDCC5381fdD389Cb9c99dCE4aBd`）；改机制/写 trader 前先读本文。

## 平台换代（2026-10-28 实测，采集端断流中）

- **V3 GangLaunchpad `0x15CFD2dc8278Fb87a1783ef42111618E20874365`**（preflight launchpad/createPad 均指它）约 2026-10-27 ~06:00 UTC 上线；新创建主要走 V3（CLI 对旧道 `gang create --taxed` 直接拒）
- V2 LaunchpadV2 `0x1B8F…966E` **收缩期仍在创建**（非只剩存量票）：近 2h Created ~5 个 vs 旧节奏 ~39（2026-10-28 实测 30min 内 4 票全出自 V2）；两 pad 并存创建，collector V2 Created 分支必须保留
- **曲线完全同构 V2**：gradAmt=15 BNB（WNB 盘）、Q0=gradAmt/3、R0=1.06656e9 储备枚数、边际价 P=Q²/K=Q²/(Q0·R0)、买卖各 1% 曲线费——GangLink 票 `raised=0.1163 → priceQuote=4.908e-9` 手算精确命中；0.047 BNB 买入量与储备积分 B=K(1/R₂−1/R₁) 对拍误差 <0.3%
- **V3 事件签名**（collector 须加订阅）：

| topic0 | 事件 | 形状 |
|---|---|---|
| `0x416fe98c8f1ea2977674a1a4…` | **Created（新）** | topics[1]=token [2]=creator [3]=quote；data **动态 ABI**（前三 word=偏移 0xa0/0xe0/0x120；后段 string name/symbol/uri；gradAmt=15e18 已实证；与 V2 静态槽不同，解码器须新写） |
| `0x6e59ac1e…` | Buy | 同 V2 签名（dw0/dw3/dw4 口径待对拍确认） |
| `0x00055e00…` | Sell | 同 V2 签名 |
| `0x92cbbe3d…` | VQL | 同 V2 签名 |
| `0xff1b99c8…`/`0xd46f0c9c…`/`0xbe561b8c…`/`0x3bc87c2d…` | fair 打新族 | 公售参数/创建/参与（0xbe561b8c 参与事件带 0.25 BNB 档）/初始化；暂不消费 |

- V3 上线初爆发（-19h 段 Buy 264/0.5h、fair 参与 114/0.5h）后衰减；近窗 V3 Created ~2/2h + V2 ~5/2h=换代收缩期
- CLI 命令分流：V3 票走 `gang v3 buy/sell`（`--amount`，BNB 直付 via router **无 wrap/approve 分步**）；V2 票走 `gang buy/sell`（`--bnb`，wrap-bnb→approve-quote→buy 三步链）；`gang quote` 遇 V3 票报错指路 `gang v3`

## 风控语义（核心发现）

| 方向 | requireConfirmation | 实测 |
|---|---|---|
| 买（V2/V3 内盘） | **false** | execute 直接 `BROADCASTED`，全自动 ✅ |
| 卖（内盘曲线） | **true** | `risks:[{code:"medium_risk_transaction"}]` → execute 返回 `PENDING_CONFIRMATION`（txHash:null，orderId 有）→ **App 人工确认** → confirmed |

- 拦截与金额无关（100 枚也拦）、与 pad 无关（V2/V3 都拦）、非时间窗（6min 后仍拦）
- 设置源=`baw wallet settings` 的 `abnormalTxnHandling`：默认 `AutoReject`（=351803 直接拒）；用户已改「需要确认」→ 变为可人工放行，**无完全放行选项**
- 卖出到账 **WBNB 非 BNB**（1% 帽退款同样回 WBNB）——对账/余额差法须计 WBNB
- buy 侧 requireConfirmation=false 的前提=devMode（7 天有效期，每次成功使用续期；过期 351802；余额帽 351804）

## CLI JSON 形状（黄金样本）

### V3 buy preview（`gang v3 buy --token <addr> --amount 0.047 --json`）
```json
{ "success": true, "step": "buy", "chainId": 56, "token": "0x…", "spend": "0.047", "quote": "WBNB",
  "expectTokens": "9394763.001403982747793684", "minTokensOut": "9300815.371389942920315747",
  "curveTaxPct": 0, "via": "router", "curveFeePct": 1, "requestId": "<hex32>",
  "expiresAt": 1793155360018, "requireConfirmation": false, "risks": [],
  "simulatedChanges": [{ "token": "0xeeee…eee", "type": "Native", "change": -47000000000000000 },
                       { "token": "0x…", "type": "Erc20", "change": 9.394763001403983e+24 }],
  "next": "gang execute --request-id …" }
```

### execute 两种终态
```json
{ "success": true, "status": "BROADCASTED", "txHash": "0x…", "orderId": "2610280000…", "pendingConfirmation": false }
{ "success": true, "status": "PENDING_CONFIRMATION", "txHash": null, "orderId": "2610280000…", "pendingConfirmation": true,
  "next": "…poll baw wallet tx-history --binanceChainId 56 --type confirmed --json …" }
```

### V3 sell preview（须先 approve）
```json
{ "success": true, "step": "approve", "approve": "9394763.001…", "spender": "0x15CF…4365",
  "requestId": "…", "expiresAt": …, "requireConfirmation": false, "next": "gang execute --request-id …" }
// execute 后重跑同命令：
{ "success": true, "step": "sell", "amount": "100", "expectOut": "0.000000494782339524",
  "minOut": "0.000000489834516128", "curveFeePct": 1, "requireConfirmation": true,
  "risks": [{ "code": "medium_risk_transaction", "description": "Suspected dangerous transaction detected, proceed with caution." }], … }
```

### V2 buy 三步链（`gang buy --token --bnb 0.01 --json`，每步 execute 后重跑同命令）
1. `{ "step": "wrap-bnb", "wrap": "0.01", "haveWbnb": "0", "needWbnb": "0.01", … }`
2. `{ "step": "approve-quote", "amount": "0.01", … }`
3. `{ "step": "buy", "kind": "v2", "quoteIn": "0.01", "expectTokens": "1,890,146.27", "expectSpent": "0.01",
   "fee": "0.0001", "expectRefund": "0", "minTokensOut": "1,871,244.81", "quotePath": "LaunchpadV2.sol#_prepBuy",
   "deterministic": true, "agentNote": { "attached": false, "hint": "…" } }`
   ⚠️ **V2 金额串带千分位逗号**（"1,890,146.27"）解析须 strip；V3 是纯小数字符串

### 其它
- `gang v3 info --token`：`{ curveFeePct:1, platformTaxPct:0.5, graduationAt:"15", raised, toGraduation, progressPct, priceQuote, priceFrom:"curve", buyTaxPct:0, sellTaxPct:0 }`
- `gang v3 status --token`：`{ wallet, balance, graduated, dividendPct }`
- `gang tx --hash`：`{ status: "success", block, events: [] }`
- `baw wallet tx-history --binanceChainId 56 --json`：`data.transactions[] = { txType:"contract_call", txHash, status:"confirmed", txHashList[0].networkFee{feeValue}, instructions{send[{amount,addressInfo,tokenInfo}], receive[…]} }`——PENDING 确认轮询判源（instructions 精确到 token/金额=对账直接可用）
- quote 盘票（V2）买：`error: "not enough quote token …"` + `quote/need/have`（须持 quote ERC-20，BAW 无=买不了）

## 试单记录（真实资金）

| 操作 | tx | 结果 |
|---|---|---|
| 买 0.047 BNB GANGL（V3） | `0x949355f1…cff3b` | 9,394,763.001403982747793684 枚，与 expectTokens 逐位一致 |
| 买 0.01 BNB 개미（V2） | wrap `0x637ac0…` + approve `0x9b50fb…` + buy `0x5a210f03…e2ad` | 1,890,146.27 枚 |
| 卖 100 GANGL（V3 确认流验证） | `0xc56e6fe3…d60ac`（orderId 26102800002000524736） | +0.000000494782339524 WBNB，与 expectOut 逐位一致 |

- gas 实测 ~0.00001 BNB/tx；devMode 日限额 1000（美元计，settings `developerModeQuotaUsed` 累计）
- 剩余持仓：GANGL ~9,394,663 枚 + 개미 1,890,146 枚（微额指令后的处置走人工确认流）

## 可行性判定（Step 0 结论）

**三选一 → 半自动**：买全自动（BROADCASTED 直达）+ 卖人工确认（PENDING_CONFIRMATION → App 点确认）。无「全放行」选项（abnormalTxnHandling 无该档）。毕业票 PCS 池卖未测（无 graduated 持仓；毕业 ~4h/次低频本就走人工处置）。

对「创建即买+5min 快退」策略：退出腿依赖人工在场；曲线价=储备函数（无人交易不变），确认等待期的真实滑点=期间他人交易的曲线移动。首日观察点：确认延迟分布。
