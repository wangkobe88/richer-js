# gang.fun 事件与口径档案（M0 收口 2026-10-27）

调研期完整结论见 git 历史与 CLAUDE.md gang 段；本文只留**现行口径 + M0 实测数据**，改动须同步更新。

## 合约与事件

- **LaunchpadV2 `0x1B8F3f69DFa0a7F63d308C7EB0Fd38D8b099966E`** 唯一订阅目标（legacy soft pad `0x315B…` 不订阅）
- 五事件 topic0（单测 `_test_gang_collector_decode` 黄金锁死）：

| 事件 | topic0（前缀） | 形状 |
|---|---|---|
| Created | `0xd23a4470` | topics[1]=token [2]=creator [3]=quote（0x0 亦按 WBNB）；data 串：name/symbol/logoUri/taxed(bool)/refPair/gradAmt |
| Buy | `0x6e59ac1e` | topics[1]=token [2]=buyer；dw0=净入金(毛×0.99) dw1=taxDividend dw2=taxPlatform dw3=tokensOut dw4=曲线累计 realQuote |
| Sell | `0x00055e00` | topics[1]=token [2]=seller；dw0=tokensIn dw1/dw2=税 dw3=净收款 dw4=累计 |
| Graduated | `0x6da2ac48` | topics[1]=token；data **三字段（2026-10-27 链上 5/5 实证）**：quote（≠PCS pair，逐票==Created quote）/tokenAmount 恒 2e8（毕业注入池储备协议常量）/quoteAmount==Created gradAmt 逐票精确全等。旧四字段形状系调研期构造未实证，对真实事件解码必败（毕业全清卖丢失），已修+单测锁死 |
| VirtualQuoteLocked | `0x92cbbe3d` | 仅计数（不消费） |

- ⚠️ indexed topic 地址是 32 字节左填充——解码一律 `topicAddr()` 剥成 20 字节小写（flap 母版 token 走 data 段无此问题）；WBNB 比较须 `.toLowerCase()` 同域（checksum 常量直比恒 false）——两坑单测锁死，改 collector 机制层先查

## 毕业进度口径（对拍定案）

- `progressPct ≡ dw4 / 15e18`（WBNB 盘 gradAmt 协议常量 15，实测恒定；indexer 同源）
- **dw4 = Σ(买净入金 dw0) − Σ(卖毛流出)**：卖毛流出 = dw3/0.99（卖方被扣 1% 税，曲线流出的是毛额而 dw3 是净收款）
- FA 资金口径 `poolInflowBnb = Σdw0 − Σdw3`（系数 1.0/1.0）→ **系统性略高于 dw4，偏差 = 累计卖税 ≈ 1%×卖量**（M0 三票实测 −0.0052/−0.0064/−0.0055 BNB 与卖量完全吻合）。量级：毕业前 ~0.3% 相对误差，flap 同款近似先例；**实际毕业判定走 Graduated 事件**（事件驱动全清），progress 因子仅展示/条件用
- 首买种子 = 0：首买后 dw4 精确等于首买 dw0；三票首买 dw0 恒 0.047319 BNB（创建者初始买入协议定值，观察项）
- 非毕业 `noteGraduation` 不学 gang（gradAmt 在 Created 硬性携带，阈值链 `graduationThresholdBnb ?? 15` set-once）

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
