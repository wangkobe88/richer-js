# Live 实盘验收 Runbook（four.meme + flap，0.001 BNB 最小闭环）

> 状态：待用户执行。代码侧加固已完成并通过零 DB 单测（`node scripts/_test_live_hardening.cjs`，
> 31 断言），本文档是**真实资金**的最后一道验收，由用户在 182 上亲自执行。
> 对应记忆：live-acceptance-deferred。

## 0. 防御体系速览（验收时知道每一步在验证什么）

| 层 | 机制 | 配置（default.json `fourmemeWs.live` / `flapWs.live`） |
|---|---|---|
| L1 预成交校验 | trader 签名前校验「报价 vs 信号价预期」，ratio < 阈值拒单（BURNIE/尘埃防线） | `minOutRatio: 0.5` |
| L2 相对滑点锚 | swap `minOutputAmount` = 报价 × (1-滑点) | `slippageTolerance`（提交实验时填，默认 1%） |
| L3 卖出熔断 | 连续卖失败 ≥5 次 → 30min 冷却 + Telegram 告警 | `sellCircuitBreakerFailures: 5` / `...CooldownMs: 1800000` |
| L4 持仓数上限 | 只拦新开仓，0=不限 | `maxPositionTokens: 0` |
| L5 tx 等待 | 120s 未确认 → 报错带 txHash，**绝不自动重发**（防双买） | `txWaitTimeoutMs: 120000` |
| L6 现金门 | 可动用 = 链上余额 − 保留金额（`reserveNative`） | 实验配置 |
| L7 毕业告警 | four.meme 持仓毕业 → TM2 卖出必 revert，Telegram 告警人工去 PCS 处置 | 引擎内置 |

flap 收窄口径：**live 只买 BNB 计价盘**（非 BNB 盘 `swapExactInput` revert = 天然 fail-closed）；卖出 token→BNB 全盘支持。

## 1. 前置准备

1. **182 ENCRYPTION_KEY**：`config/.env` 里必须已有（与历史 live 实验一致；本地与 182 key 已核对一致，sha256 前 12 位 `cb09b8757a55`）。
2. **专用小额钱包**：新建一个只放验收资金的 EOA 钱包，转入 **0.05 BNB**（保留 0.01 + 买入 0.001×若干次 + gas 余量）。绝不使用主钱包。
3. **Telegram 通知**（可选但强烈建议）：182 上确认 Telegram bot 配置可用——熔断/毕业告警走这条路。
4. **采集在跑（直连架构）**：live 实验进程自己持有 WSS 订阅（collector 内嵌）——确认本实验进程存活即可；另确认一个 both 常驻虚拟实验在跑（事实采集器，保证 `wss_price_ticks` 连续供数，web K 线/离线工具依赖）。watcher 常驻进程已于 2026-10-09 废除。

## 2. four.meme 最小闭环（约 10 分钟）

### 2.1 创建验收实验

web UI（本地 `npm run web`，指向同一 Supabase）或直接 POST `/api/experiments`：

- 交易模式：**实盘**；平台：**Four.meme**（单平台，双平台 live 会被 400 拒绝）
- 钱包：专用钱包地址 + 私钥（AES-256 加密落库）
- 保留金额：`0.01`
- 单次买入金额：`0.001`（验收专用小额；**不配**每卡 BNB）
- 买入策略（宽松验收版，早止窗口太苛刻不易命中）：
  - condition: `currentPrice > 0 AND age < 60`，maxExecutions 3
  - 首次购买检查条件：**留空**（不挂 pre-check，纯验证链路）
- 卖出策略（买入后尽快全清）：condition: `profitPercent <= 100000`，maxExecutions 3
- 其余默认

### 2.2 启动（182，screen）

```bash
# 182 上；绝不启动 web 服务，只跑引擎进程
screen -S live-accept-4m
node main.js start-experiment -e <实验ID>
```

观察启动日志：钱包余额打印、`FourMemeDirectTrader` 初始化、初始 live 持仓恢复为空。

### 2.3 逐项验收

| # | 验收点 | 判定 |
|---|---|---|
| 1 | 买入成交 | 日志出现「购买成功」+ tx hash；trades 表新增 live buy 行，`actual_amount_out`（余额差/事件解析实得）为正，metadata 含 `protocol`、`preTradeCheck ratio` |
| 2 | 预成交校验放行值合理 | signal metadata / 日志中 ratio 在 0.5~1.5 量级（正常滑带）；若频繁 <0.6 说明 minOutRatio 需要调 |
| 3 | 卖出成交 | 买入后 1-2 个 tick 周期内卖出腿触发；trades 表 live sell 行，`actual_received` 与钱包 BNB 进账一致（bscscan 对时间戳） |
| 4 | portfolio 对账 | 实验页 portfolio：BNB 可用余额 + 持仓估值 ≈ 钱包当前余额 − 保留额（±gas，量级 0.001 内）；token 持仓卖空后归零 |
| 5 | 链上核对 | bscscan 查两笔 tx：buy `value=0.001 BNB`、sell `value=0`（token 转出 + BNB 进账）；gas 单价 ≤ `maxGasPrice` |
| 6 | 重启恢复 | `screen` 里 Ctrl+C 停止 → 置 stopped；`--force` 重启 → 启动日志回放 trades 恢复持仓（若还有未卖 token），卡牌字段实验验证 `metadata.cardTrade` 重放 |
| 7 | 失败路径 A：run-engine 拒绝 | `node src/run-engine.js <live实验ID>` → 必须报错「live 实验不能用 run-engine.js 启动」（不静默当虚拟盘） |
| 8 | 失败路径 B：双平台 live 拒绝 | web 创建 live + 双平台 → 400；前端提交也被拦 |
| 9 | 失败路径 C：现金门 | 把钱包余额转走到 < 保留额+买入额 → 下一笔买入必须被拒（trades 失败记录或引擎日志现金门报错），**不**出现链上交易 |

### 2.4 收尾

```bash
# 182：置 stopped 留行（跑了一段时间的实验绝不删除——用户裁定）
node main.js start-experiment ... 停止后状态自动置 stopped
```

## 3. flap 最小闭环（同构，差异点如下）

- 平台：**Flap**；其余参数同 §2.1。
- 启动日志确认 `FlapPortalTrader` 初始化 + Portal 地址 `0xe2cE6ab80874Fa9Fa2aAE65D277Dd6B8e65C9De0`。
- 买入成交的实得来自**余额差法**（税后真相）；卖出实收 = BNB 余额差 + gas 补偿。验收点 1/3/4/5 同 four.meme。
- **非 BNB 计价盘**：若买腿撞上 quote_token 非 NULL 的盘，`swapExactInput` revert → 买入失败记录——这是预期 fail-closed 行为，不是 bug；等下一个 BNB 盘 token 即可。
- 毕业盘：flap token 毕业后 Portal 只支持内盘，卖出同样 revert——flap 毕业告警未接毕业事件处置（collector 有 graduation 回调事件，live 告警路径同 four.meme 需观察是否触发）。

## 4. 验收通过标准（全绿才可放量）

- [ ] four.meme：§2.3 九项全过（尤其 4 对账、7/8/9 失败路径）
- [ ] flap：§3 差异点全过
- [ ] 无「未预期的 revert」：所有失败都能在 trades/日志中归因到已知机制（拒单/熔断/现金门/毕业）
- [ ] 实收与预期偏差在 gas 量级（<0.0005 BNB/笔）
- 验收实验处置：**置 stopped 保留**，不删除。

## 5. 常见问题

- **买入一直不触发**：确认本实验进程 collector 存活（日志持续有 tick 流/wss-down-guard 无告警；直连架构进程崩=采集断流）+ 常驻 both 采集实验在跑（`wss_price_ticks` 新行持续推进）；确认买入 condition 对新 token 成立。heartbeat 行是已废除 watcher 的历史产物，不再更新。
- **卖出 revert 且日志带「fail-closed 拒绝裸奔卖出」**：trySell 预估失败 + 引擎提供了预期锚 → 预期行为，检查该 token 是否毕业盘/流动性异常。
- **「确认超时(120s)，txHash=0x...」**：**绝不重发**。bscscan 查该 hash 终态；若已上链，重启实验靠 trades 恢复对齐；若未上链，人工评估补单。
- **验收钱包私钥安全**：验收完成后钱包清空归档；如钱包要复用，web「复用历史钱包」下拉会服务端拷贝密文（要求两端 ENCRYPTION_KEY 一致）。
