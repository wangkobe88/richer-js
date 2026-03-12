## 两个回测实验差异的完整分析

### 实验对比

| 指标 | 实验1 | 实验2 |
|------|-------|-------|
| ID | 209a7796-f955-4d7a-ae21-0902fef3d7cc | 2522cab9-721f-4922-86f9-7484d644e7cc |
| maxExecutions | 4 | 1 |
| preBuyCheckCondition | creatorIsNotBadDevWallet >= 1 AND drawdownFromHighest > -25 AND ... | (无这两个条件) |
| buyCondition | (无 drawdownFromHighest > -25) | drawdownFromHighest > -25 AND ... |
| 回测运行时间 | 11:27:19 - 11:32:51 | 11:45:45 - 11:53:17 |
| 代币数 | 22 | 36 |
| 胜率 | 55% | 26% |
| 平均收益 | +6.7% | +3.1% |

### 关键差异

1. **运行时间不同**：
   - 实验1先运行，处理了早期的 time_series_data
   - 实验2后运行，处理了更多的 time_series_data（包括新增的代币）
   - 14个额外代币的数据在实验1运行时还未完全生成

2. **配置差异**：
   - **maxExecutions**: 实验1=4, 实验2=1
     - 实验1可以对同一代币多次购买，更好地捕捉收益
     - 实验2每个代币只能购买一次

   - **preBuyCheckCondition**:
     - 实验1有 `creatorIsNotBadDevWallet >= 1 AND drawdownFromHighest > -25`
     - 实验2没有这两个条件

   - **buyCondition**:
     - 实验1没有 `drawdownFromHighest > -25`
     - 实验2有 `drawdownFromHighest > -25`

### 那14个代币为什么只在实验2中？

- DREAM, 吃瓜群众, FIGHT, MAC, Pill, 何医, Angel, Four.meme trenches, AI Agent时代, 杨果福, FLORK, 龙虾港, 牦牛, Claude
- 这些代币的买入时间在 11:50-11:53
- 实验1在 11:32:51 就结束了
- **所以实验1根本没有机会处理这些代币**

### 效果差异的原因

1. **maxExecutions = 4 的优势**：
   - 可以对优质代币进行多次购买
   - 例如代币 0xfe874780... 在实验1中买了4次，在实验2中只买了1次

2. **preBuyCheckCondition 的过滤作用**：
   - `creatorIsNotBadDevWallet >= 1` 过滤掉了部分低质量代币
   - `drawdownFromHighest > -25` 防止在下跌趋势中买入

### 结论

两个实验的差异主要是由于：
1. **运行时间不同** - 实验2处理了更多的代币数据
2. **maxExecutions 不同** - 实验1可以多次购买，提高收益
3. **过滤条件不同** - 实验1有更严格的 preBuyCheckCondition

这些因素共同导致了实验1更好的表现（55%胜率 vs 26%，+6.7% vs +3.1%）。
