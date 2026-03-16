# 代币交易序列分析

将代币早期交易转换为 `<钱包, 数额>` 序列，用于 NLP 算法分析。

## 背景

代币在某种意义上是一个钱包的序列——一个由 `<钱包, 数额>` 组成的序列，其中数额为正表示买，为负表示卖。这样的序列与文本非常类似，可以使用自然语言处理算法去处理。

## 文件结构

```
scripts/token-sequence-analysis/
├── data/
│   ├── raw/                    # 原始 AVE API 响应数据
│   │   ├── exp_14bbd262.json
│   │   ├── exp_015db965.json
│   │   ├── exp_4c265a5b.json
│   │   └── exp_431ffc1c.json
│   └── processed/              # 处理后的序列数据
│       ├── all_sequences.json
│       ├── good_tokens.json
│       └── bad_tokens.json
├── collect_data.js             # 数据采集脚本
├── build_sequences.js          # 序列构建脚本
├── utils/
│   └── trade_parser.js        # 交易解析工具
└── README.md
```

## 使用方法

### 1. 启动 Web 服务器

```bash
npm run web
```

确保服务器运行在 `http://localhost:3010`

### 2. 采集原始数据

```bash
node scripts/token-sequence-analysis/collect_data.js
```

该脚本会：
- 从 4 个虚拟实验中获取代币列表
- 调用 `/api/token-early-trades` 获取每个代币前 3 分钟的交易记录
- **完整保存 AVE API 原始返回数据** 到 `data/raw/` 目录

### 3. 构建交易序列

```bash
node scripts/token-sequence-analysis/build_sequences.js
```

该脚本会：
- 读取原始数据
- 将交易转换为 `<钱包, 数额>` 序列
- 计算统计信息（序列长度、唯一钱包数、净流入等）
- 区分好票（涨幅≥100%）和坏票
- 保存到 `data/processed/` 目录

## 数据格式

### 原始数据 (raw/*.json)

完整保存 AVE API 响应：

```json
{
  "experiment_id": "14bbd262-6464-4962-bc44-15be5de04ed5",
  "total_tokens": 50,
  "successful_collected": 48,
  "tokens": [
    {
      "token_address": "0x123...",
      "token_symbol": "TOKEN",
      "chain": "bsc",
      "platform": "fourmeme",
      "max_change_percent": 150.5,
      "ave_api_response": {
        "success": true,
        "data": {
          "tokenInfo": { /* 完整代币信息 */ },
          "earlyTrades": [
            {
              "tx_id": "0xabc...",
              "time": 1740000000,
              "wallet_address": "0xwallet...",
              "from_token": "0xtoken...",
              "to_token": "0xusdt...",
              "from_token_symbol": "TOKEN",
              "to_token_symbol": "USDT",
              "to_usd": 100.5,
              "from_usd": 100.5,
              "pair_liquidity_usd": 15000,
              "block_number": 12345
            }
          ],
          "debug": { /* 完整调试信息 */ }
        }
      },
      "collected_at": "2026-03-16T10:00:00Z"
    }
  ]
}
```

### 序列数据 (processed/*.json)

```json
{
  "total_tokens": 48,
  "good_token_threshold": 100,
  "sequences": [
    {
      "token_address": "0x123...",
      "token_symbol": "TOKEN",
      "chain": "bsc",
      "platform": "fourmeme",
      "experiment_id": "14bbd262-...",
      "max_change_percent": 150.5,
      "is_good_token": true,
      "sequence": [
        ["0xwallet1...", 100.5],
        ["0xwallet2...", -50.3],
        ["0xwallet3...", 200.0]
      ],
      "stats": {
        "length": 3,
        "unique_wallets": 3,
        "total_buys": 2,
        "total_sells": 1,
        "total_buy_amount": 300.5,
        "total_sell_amount": 50.3,
        "net_flow": 250.2
      }
    }
  ]
}
```

## 买卖判断逻辑

通过**目标代币地址**判断（而非 USDT 等交易币）：

- `to_token === tokenAddress` → 买入（获得目标代币）→ `amount = +to_usd`
- `from_token === tokenAddress` → 卖出（失去目标代币）→ `amount = -from_usd`

这样支持任何交易对（USDT、WBNB、USDC 等）。

## 后续 NLP 应用方向

1. **序列相似度**: 使用 DTW（动态时间规整）比较交易模式
2. **异常检测**: 用 LSTM/Autoencoder 发现异常交易模式
3. **分类预测**: 将序列视为"文本"，用 Transformer 预测代币质量
4. **模式挖掘**: 发现常见的好票/坏票交易模式
5. **嵌入学习**: 学习交易序列的向量表示

## 聚类分析

运行 `cluster_analysis.js` 进行无监督聚类分析：

```bash
node scripts/token-sequence-analysis/cluster_analysis.js
```

该脚本会：
- 使用 K-Means 对代币进行聚类 (K=3,4,5)
- 基于 13 个特征：序列长度、唯一钱包数、买卖比例、净流入等
- 生成聚类统计和代表性代币
- 保存聚类结果到 `data/processed/clusters_k*.json`

### 聚类结果概览 (K=5, 571个代币)

| 聚类 | 占比 | 特征 |
|------|------|------|
| 超高活跃优质币 | 9.5% | 序列>500笔, 涨幅中位数318% |
| 高涨幅早期爆发 | 17.7% | 序列35笔, 涨幅中位数190% |
| 极简暴利模式 | 1.6% | 仅2笔交易, 净流入$11,800 |
| 普通模式 | 50.6% | 各项指标中等 |
| 中高活跃 | 20.7% | 序列331笔, 涨幅中位数125% |

详见 `CLUSTER_ANALYSIS_REPORT.md`。

## 配置

在脚本中可修改的参数：

```javascript
// collect_data.js
const TIME_WINDOW_SECONDS = 180;      // 时间窗口（秒）
const MAX_CONCURRENT_REQUESTS = 3;    // 并发请求数
const REQUEST_DELAY_MS = 100;          // 请求延迟（毫秒）

// build_sequences.js
const GOOD_TOKEN_THRESHOLD = 100;      // 好票阈值（涨幅%）
```
