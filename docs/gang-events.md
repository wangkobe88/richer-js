# gang.fun 事件与口径档案（M0 收口 2026-10-27）

调研期完整结论见 git 历史与 CLAUDE.md gang 段；本文只留**现行口径 + M0 实测数据**，改动须同步更新。

## 合约与事件

- **双 pad 订阅（2026-10-28 换代接入）**：V2 `0x1B8F3f69DFa0a7F63d308C7EB0Fd38D8b099966E` + **V3 GangLaunchpad `0x15CFD2dc8278Fb87a1783ef42111618E20874365`**——新创建主要走 V3（CLI 默认道）但 **V2 收缩期仍在创建**（~4-5/2h，实测 30min 4 票全出自 V2，两 pad 并存）；legacy soft pad `0x315B…` 不订阅
- 六 topic0（单测 `_test_gang_collector_decode` 黄金锁死）：

| 事件 | topic0（前缀） | 形状 |
|---|---|---|
| Created（V2） | `0xd23a4470` | topics[1]=token [2]=creator [3]=quote（0x0 亦按 WBNB）；data 串：name/symbol/logoUri/taxed(bool)/refPair/gradAmt |
| V3Created（V3） | `0x416fe98c` | topics 同上（quote=0x0 ⟺ WNB 盘）；data **动态 ABI**（string name/symbol/logoUri + uint256 unknownParam/gradAmt）；refPair 恒 null |
| Buy | `0x6e59ac1e` | topics[1]=token [2]=buyer；dw0=净入金(毛×0.99) dw1=taxDividend dw2=taxPlatform dw3=tokensOut dw4=曲线累计 realQuote |
| Sell | `0x00055e00` | topics[1]=token [2]=seller；dw0=tokensIn dw1/dw2=税 dw3=净收款 dw4=累计 |
| Graduated | `0x6da2ac48` | topics[1]=token；data **三字段（2026-10-27 链上 5/5 实证）**：quote（≠PCS pair，逐票==Created quote）/tokenAmount 恒 2e8（毕业注入池储备协议常量）/quoteAmount==Created gradAmt 逐票精确全等。旧四字段形状系调研期构造未实证，对真实事件解码必败（毕业全清卖丢失），已修+单测锁死 |
| VirtualQuoteLocked | `0x92cbbe3d` | 仅计数（不消费） |

- ⚠️ indexed topic 地址是 32 字节左填充——解码一律 `topicAddr()` 剥成 20 字节小写（flap 母版 token 走 data 段无此问题）；WBNB 比较须 `.toLowerCase()` 同域（checksum 常量直比恒 false）——两坑单测锁死，改 collector 机制层先查

**V3 细则（2026-10-28 换代接入）**：

- V3Created data=动态 ABI（string name/symbol/logoUri + uint256 unknownParam/gradAmt），无 taxed（恒 false）/refPair（恒 null 落库，DB 重建读端 `p.refPair ? … : null` 天然兼容）；payload 带 `pad:"v3"` 标记落库审计
- **gradAmt 逐票各异**：WNB 盘 29/29 恒 15（与 V2 同口径）、quote 盘 18/18 各异（如 bibi.ai=1788077.25 quote）——V3 Created 是 gradAmt 唯一正源；quote 盘换算走 `_getQuoteConversion`（miss→null+quoteRateUnavailable）
- unknownParam（w3）：w3≠0 ⟺ quote 盘，形状是 20 字节地址但 eth_call 无代码（非合约），存档不消费
- **V3 Graduated 形状未实证**（V3 上线 24h 无毕业票）=观察点：fail-loud decodeFailed 兜底，首个 V3 毕业票须人工对拍，勿预设形状
- **V3 实时命中实证（2026-10-28 1h dry-run，03:36-04:36 UTC）**：双 pad 窗内 Created V2×12 + V3×2（0xf050…acfe/0x993c…3d7f）=14 与 collector tokenCreated 精确对拍，零 decodeFailed、零 unknownTopic0、零断连；FA 518 ticks 全接受。本窗 V2 节奏 12/h 反超 V3 2/h（单小时样本，「V2 收缩」表述按窗浮动）

## 毕业进度口径（对拍定案）

- `progressPct ≡ dw4 / 15e18`——**仅 V2 WNB 盘口径**（V2 gradAmt 协议常量 15 恒定，indexer 同源）；**V3 gradAmt 逐票各异**（WNB 盘实测 29/29 仍恒 15、quote 盘 18/18 各异），进度分母=Created gradAmt（FA 阈值链 `graduationThresholdBnb` set-once 读 Created 值，机制天然兼容）
- **dw4 = Σ(买净入金 dw0) − Σ(卖毛流出)**：卖毛流出 = dw3/0.99（卖方被扣 1% 税，曲线流出的是毛额而 dw3 是净收款）
- FA 资金口径 `poolInflowBnb = Σdw0 − Σdw3`（系数 1.0/1.0）→ **系统性略高于 dw4，偏差 = 累计卖税 ≈ 1%×卖量**（M0 三票实测 −0.0052/−0.0064/−0.0055 BNB 与卖量完全吻合）。量级：毕业前 ~0.3% 相对误差，flap 同款近似先例；**实际毕业判定走 Graduated 事件**（事件驱动全清），progress 因子仅展示/条件用
- 首买种子 = 0：首买后 dw4 精确等于首买 dw0；三票首买 dw0 恒 0.047319 BNB（创建者初始买入协议定值，观察项）
- 非毕业 `noteGraduation` 不学 gang（gradAmt 在 Created 硬性携带，阈值链 `graduationThresholdBnb ?? 15` set-once）

## 曲线精确参数（2026-10-28 链上校准，勿再用 8e8 假设）

买侧最小二乘拟合（24h 窗 319 票 ≥4 买，RMSE 0.001%）+ 72h 全量回放对拍（买 8868 笔 0 失配、卖 7997 笔 1 失配，0.05% 容差）。**拟合窗全为 V2 票；V3 曲线同构已实证**（GangLink 票 `raised → priceQuote` 手算精确命中 + 0.047 BNB 储备积分对拍 <0.3%，详档 docs/gang-cli-shapes.md）：

- **Q0 = gradAmt/3 精确成立**（319 票 Q0/gradAmt p10=p50=p90=0.3333；WNB 盘 = 5）
- **R0 = 1.06656e9 枚**（拟合值，票间散布 <0.002%）——毕业注入 2e8 只是 PCS 池注入量，与曲线初始储备无关（「1e9−2e8=8e8」是错误假设，实测即上述拟合）
- K = Q0×R0；任意时刻 **Q = Q0+dw4、R = K/Q、边际价 ∝ Q²**（dw4 直读即储备状态）
- 买/卖各 1% 税对拍确认（买 dw0=毛×0.99 M0 实证；卖 dw3/gross 全体单一常数 0.9898=拟合系统偏差内）
- **1% 钱包上限与出生价买单**：0.05 BNB 已超限（到手 1045 万枚 > 10M 上限，交易内退款）——出生价单钱包最大仓位 **≈0.048 BNB（恰 10M 枚）**；模拟更大额须按退款语义记账（反解实付 quote）

## 创建即买模拟（2026-10-28，72h/367 WNB 票/0.05 BNB，`scripts/gang-snipe-sim.cjs`）

- **早退正期望、~2h 转负**：E1 出生价 5min +13.8%（胜率 88.8%）→ 30min +5.9% → 2h +1.7% → 6h 起负 → EOW −1.9%；E2（首笔链上成交后跟买，现实可达——Created+首买常同 tx，E1 物理上多不可达）5min +11.7%；+20% 止盈（6h 超时）+11.1% ≈ 固定 5min
- 市场形状：相对出生价峰值中位 ×1.30、p90 ×1.64、max ×8.34，**到峰中位 ~12s**——纯「出生冲量」市场，出生几秒内冲顶后长尾阴跌
- 未建模残余：竞争者/MEV（队列里已有定值单机器人在吃同一波）、单一 72h 窗口单一 regime、quote 盘（45%）未覆盖

## M0 dry-run 实测（2026-10-27 182，180s 真流）

判据全过（`node scripts/dryrun-gang-wss.js --duration-ms 180000`，零 DB）：

- `tokenCreated=1 / tokenBought=19 / tokenSold=9 / decodeFailed=0 / unknownTopic0={}`
- FA 26 ticks 全接受、零 outlier、26 次 factorsEmitted、1 token 注册
- 乱序暂存闭环：120s 时 44 条未知 token trade 暂存，Created 到达后 flush 归零；stop 丢弃 63 条（dry-run 零 DB 不重建 map，设计内）
- VirtualQuoteLocked 捕获 1 次（签名链上有效）
- **dw4 对拍**（eth_getLogs vs indexer API，3 活跃票）：dw4/15e18 与 progressPct 逐票吻合（残差=两位小数舍入+秒级 indexer 滞后）

## 盘速参考（2026-10-27 实测）

- 新 token ~185s/个（408 个/21h）；交易 3.2 万笔/21h；毕业 ~4h/次
- `sort=progress` 高位票多为死票（尾部交易远在窗外）；对拍取材须从链上近窗活跃日志反查 token
- ANKR http getLogs：块窗上限浮动（80000 偶发 `Block range is too large`），40000 稳；`topics[0]` 数组 OR 不可用，须单 topic0 分查

## 24h 链上回拉分析（2026-10-27，getLogs 离线脚本，WNB/quote 盘分离）

**分析口径**：24h 窗 115200 块，Created=437 / Buy=19080 / Sell=14997 / Graduated=5。**quote 盘（非 WNB 计价）占 39%（170/437，主力 quote `0x0c630240…b405` 独占 120 个）**——混盘统计必被 quote 单位污染（v1 误得总买 4600 万 BNB），一切金额分析只看 WBNB 盘（267 个）。

WNB 盘市场形状（对策略设计的含义）：

- **全站买盘规模仅 ~335 BNB/24h（≈25 万 USD）**：买单额中位 0.05 / p90 0.07 / max 0.38 BNB——市场由 0.047319 BNB 定值单构成（首买协议定值 260/267 逐票吻合），非散户市场而是批量脚本市场
- **市值分布极窄**：中位 5.28 / p75 5.76 / p90 6.24 / max 12.85 BNB——出生市值≈virtualQuote（gradAmt/3=5）起步，p90 距出生价仅 +20%，**几乎没有票涨起来**；总卖/总买量比 92.6%=买入资金 92.6% 被收回，纯互割形状
- **每 token 中位 43 笔交易 / 22 个独立买家**，但人均仅 0.05 BNB；跨 token 扫票钱包 top5 各 175-183 币（每票 ~0.05 BNB 全扫）
- **集中度基线形状**：bundle 单块≥3 钱包形状 88%、even cluster 等额≥3 钱包形状 57%——「全员等额定值单」使 T67/T74 族因子在 gang 上天然爆表（等额簇判据退化为「买家数≥3」），**gang 买腿集中度门不能照搬 four.meme 阈值，须按 gang 基线重校准**
- 窗内 267 新票毕业 0 个；窗内 5 个 Graduated 全是窗外存量票（且当时四字段解码失败未计数——已修复）；毕业节奏 ~4-5h/次
- tx.from==trader 复验 10/10 一致（v1 混盘 5 + v2 WNB 5）——sender||trader 钱包口径适用确认
