# Live 实盘验收 Runbook（four.meme + flap，0.001 BNB 最小闭环）

> 状态：待用户执行。代码侧加固已完成并通过零 DB 单测（`_test_live_hardening` 31 断言 +
> 2026-10-13 实盘前置批：执行器/余额差实收/nonce/gas/手工交易队列等 9 个单测 200+ 断言），
> 本文档是**真实资金**的最后一道验收，由用户在 182 上亲自执行。
> 对应记忆：live-acceptance-deferred。

## 0. 防御体系速览（验收时知道每一步在验证什么）

| 层 | 机制 | 配置（default.json `fourmemeWs.live` / `flapWs.live`） |
|---|---|---|
| L1 预成交校验 | trader 签名前校验「报价 vs 信号价预期」，ratio < 阈值拒单（BURNIE/尘埃防线） | `minOutRatio: 0.5` |
| L2 相对滑点锚 | swap `minOutputAmount` = 报价 × (1-滑点) | `slippageTolerance`（提交实验时填，默认 **5%**） |
| L3 卖出熔断 | 连续卖失败 ≥5 次 → 30min 冷却 + Telegram 告警；**链上余额 0（外部处置）不计连败**，独立长冷却+告警 | `sellCircuitBreakerFailures: 5` / `...CooldownMs: 1800000` |
| L4 持仓数上限 | 只拦新开仓，0=不限 | `maxPositionTokens: 0` |
| L5 tx 等待 | 120s 未确认 → 报错带 txHash，**绝不自动重发**（防双买） | `txWaitTimeoutMs: 120000` |
| L6 现金门 | 可动用 = 链上余额 − 保留金额（`reserveNative`） | 实验配置 |
| L7 毕业告警 | four.meme 持仓毕业 → TM2 卖出必 revert，Telegram 告警人工处置（PCS/手工交易面板） | 引擎内置 |
| L8 nonce 管理 | NonceManager 串行取 pending nonce，跨 token 并发买不竞争；nonce 拒收自动 reset 重试一次 | BaseTrader 内置 |
| L9 动态 gas | gasPrice=链上价（≤max 钳 max）；gasLimit=estimate×1.3（≤hardCap）；失败回落旧固定值 | `trading.gasStrategy: dynamic`（`pinned` 回滚旧行为） |

flap 收窄口径：**live 只买 BNB 计价盘**（非 BNB 盘 `swapExactInput` revert = 天然 fail-closed）；卖出 token→BNB 全盘支持。

## 1. 前置准备

1. **182 ENCRYPTION_KEY**：`config/.env` 里必须已有（与历史 live 实验一致；本地与 182 key 已核对一致，2026-10-13 实测 sha256 前 12 位 `1e256969297e`）。
2. **创建执行器（推荐钱包管理方式）**：新建一个只放验收资金的 EOA 钱包，转入 **0.05 BNB**（保留 0.01 + 买入 0.001×若干次 + gas 余量），绝不使用主钱包。然后 web「执行器」页（`/executors`）录入：名称 + 地址 + 私钥（明文只在录入时传输一次，服务端嗅探后 AES-256 加密落 `executors.auth_token`，任何 API 响应绝不回传密文）。私钥唯一真源=执行器表，实验 config 只存 `executorId`。
   - 兼容：创建实验仍支持「复用历史钱包/手输私钥」直配路径（密文落实验 config），存量习惯不变；`executorId` 与 `privateKey` 并存会被拒（防歧义）。
   - 删除保护：执行器被 live 实验 `config.wallet.executorId` 引用时不可删除（400 + 关联清单）；仅 virtual 引用可删。
3. **Telegram 通知**（可选但强烈建议）：182 `config/.env` 配 `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID`（本地已配，两端对齐）——熔断/毕业/外部处置告警走这条路；缺变量时通知静默禁用（交易不受影响）。
4. **采集在跑（直连架构）**：live 实验进程自己持有 WSS 订阅（collector 内嵌）——确认本实验进程存活即可；另确认一个 both 常驻虚拟实验在跑（事实采集器，保证 `wss_price_ticks` 连续供数，web K 线/离线工具依赖）。watcher 常驻进程已于 2026-10-09 废除。

## 2. four.meme 最小闭环（约 10 分钟）

### 2.1 创建验收实验

web UI（本地 `npm run web`，指向同一 Supabase）或直接 POST `/api/experiments`：

- 交易模式：**实盘**；平台：**Four.meme**（单平台，双平台 live 会被 400 拒绝）
- 钱包：**执行器下拉选择**（§1.2 建好的执行器；地址服务端回填，私钥不落实验 config）
- 保留金额：`0.01`（执行器自带 `reserve_native` 时以实验配置为最高优先）
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

### 2.4 手工交易（应急清仓/毕业盘人工处置）

web 实验详情页 → live 实验出现「手工交易」入口（`/experiment/<id>/manual`）：

- **买**：监控池内 token + BNB 金额（FA 无价/不在池 → 拒绝，fail-closed 与策略路径同语义）
- **卖**：持仓 token + 比例（0-1）或全清；毕业票自动路由 PCS trader 卖出
- 命令走 DB 队列（`manual_trade_requests`），实验进程 5s 轮询消费，**复用引擎同一执行路径**（L1 锚/熔断/卡账本全套）——web 进程绝不直接发交易（与引擎内存账本冲突）
- 实验停机期间命令滞留 `pending`，重启后 10min 内消费或过期；执行历史面板可查状态
- 验收建议：闭环尾声对残余持仓发一笔手工卖，确认 trades 行 `metadata.isManualTrade: true`

### 2.5 收尾

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

- [ ] four.meme：§2.3 九项全过（尤其 4 对账、7/8/9 失败路径）+ §2.4 手工交易一笔
- [ ] flap：§3 差异点全过
- [ ] 执行器：创建/绑定/删除保护（被 live 引用时 400）
- [ ] 无「未预期的 revert」：所有失败都能在 trades/日志中归因到已知机制（拒单/熔断/现金门/毕业）
- [ ] 实收与预期偏差在 gas 量级（<0.0005 BNB/笔）
- 验收实验处置：**置 stopped 保留**，不删除。

## 5. 常见问题

- **买入一直不触发**：确认本实验进程 collector 存活（日志持续有 tick 流/wss-down-guard 无告警；直连架构进程崩=采集断流）+ 常驻 both 采集实验在跑（`wss_price_ticks` 新行持续推进）；确认买入 condition 对新 token 成立。heartbeat 行是已废除 watcher 的历史产物，不再更新。
- **卖出 revert 且日志带「fail-closed 拒绝裸奔卖出」**：trySell 预估失败 + 引擎提供了预期锚 → 预期行为，检查该 token 是否毕业盘/流动性异常。
- **「确认超时(120s)，txHash=0x...」**：**绝不重发**。bscscan 查该 hash 终态；若已上链，重启实验靠 trades 恢复对齐；若未上链，人工评估补单。
- **「⛓️ 链上余额为 0（外部处置，不计熔断连败）」**：该 token 钱包外已被卖出/转走，引擎只告警+长冷却，不会反复重试也不会熔断——人工核对后可在手工交易面板或忽略。
- **验收钱包私钥安全**：验收完成后钱包清空归档；执行器管理页可停用/删除（无 live 引用时可删）；「复用历史钱包」下拉仍可从历史实验拷密文（要求两端 ENCRYPTION_KEY 一致）。
