# 钱包分析工具

## 功能说明

基于已标注代币的早期交易者，分析每个钱包参与的代币分类分布，形成钱包画像。

## 数据流程

```
代币标注数据 (experiment_tokens.human_judges)
         ↓
获取所有标注代币
         ↓
查询早期交易数据 (early_trades)
         ↓
提取早期交易者钱包
         ↓
统计钱包-分类关系
         ↓
生成钱包画像
```

## 使用方法

```bash
cd wallets_analysis
npm install
npm start
```

## 配置说明

编辑 `config.js` 修改配置：

| 配置项 | 说明 | 默认值 |
|--------|------|--------|
| earlyTradeWindow | 早期交易时间窗口（秒） | 300 (5分钟) |
| minTradeAmountUSD | 最小交易金额（USD） | 5 |
| concurrency | 并发请求数 | 5 |
| requestDelay | 请求间隔（毫秒） | 200 |
| enableCache | 是否启用缓存 | true |

## 输出文件

分析完成后，在 `output/` 目录生成：

- `wallet_profiles_<timestamp>.json` - 完整数据
- `wallet_profiles_<timestamp>_summary.json` - 摘要数据（Top 100）
- `wallet_profiles_<timestamp>.csv` - CSV 格式

## 输出格式

### JSON 格式

```json
{
  "generated_at": "2026-02-26T10:00:00Z",
  "summary": {
    "total_wallets": 1250,
    "total_tokens_analyzed": 85,
    "by_dominant_category": {
      "fake_pump": 450,
      "high_quality": 120,
      "mid_quality": 280,
      "low_quality": 300,
      "no_user": 100
    },
    "quality_distribution": {
      "high": 120,
      "mid": 280,
      "low": 750,
      "unknown": 100
    },
    "top_wallets": [...]
  },
  "wallets": {
    "0x1234...abcd": {
      "total_participations": 15,
      "categories": {
        "fake_pump": 8,
        "no_user": 3,
        "low_quality": 4
      },
      "dominant_category": "fake_pump",
      "dominant_quality": "low",
      "tokens": [...]
    }
  }
}
```

### CSV 格式

```
钱包地址,总参与次数,流水盘,无人玩,低质量,中质量,高质量,主导分类,质量等级
0x1234...abcd,15,8,3,4,0,0,fake_pump,low
...
```

## 分类说明

| 分类 | 标签 | 质量 |
|------|------|------|
| fake_pump | 流水盘 | low |
| no_user | 无人玩 | low |
| low_quality | 低质量 | low |
| mid_quality | 中质量 | mid |
| high_quality | 高质量 | high |

## 钱包质量分数

钱包质量分数计算方式：
- 高质量代币参与: +100 分/个
- 中质量代币参与: +50 分/个
- 低质量代币参与: -50 分/个
- 最终分数 = 总分 / 参与次数

分数越高，钱包质量越好。
