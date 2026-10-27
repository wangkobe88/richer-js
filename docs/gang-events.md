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
| Graduated | `0x6da2ac48` | topics[1]=token；pair(PCS V2)/quote/tokenAmount/quoteAmount |
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
