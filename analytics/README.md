# Analytics 目录说明

本目录包含用于分析交易数据和系统性能的脚本。

## 分析脚本

### 交易活跃度分析

| 脚本 | 说明 | 运行方式 |
|-----|------|---------|
| `analyze_time_windows.js` | 多时间窗口交易活跃度分析。获取3分钟数据，分析1/1.5/2/3分钟窗口的交易行为差异 | `node analytics/analyze_time_windows.js` |
| `generate_trading_activity_csv.js` | 生成交易活跃度CSV文件。用于导出人工标注代币的交易数据 | `node analytics/generate_trading_activity_csv.js` |

### 策略与信号分析

| 脚本 | 说明 | 运行方式 |
|-----|------|---------|
| `analyze_strategy_performance.js` | 分析策略回测性能 | `node analytics/analyze_strategy_performance.js` |
| `analyze-profit-factors.js` | 分析盈利因子 | `node analytics/analyze-profit-factors.js` |
| `analyze-signal-metadata.js` | 分析交易信号元数据 | `node analytics/analyze-signal-metadata.js` |
| `analyze-token-creation-time.js` | 分析代币创建时间分布 | `node analytics/analyze-token-creation-time.js` |
| `test-filters.js` | 测试数据过滤器 | `node analytics/test-filters.js` |

### 社交媒体分析

| 脚本 | 说明 | 运行方式 |
|-----|------|---------|
| `social_media_analysis.mjs` | 分析代币的社交媒体数据（Twitter, Telegram等） | `node analytics/social_media_analysis.mjs` |

### 回测工具

| 脚本 | 说明 | 运行方式 |
|-----|------|---------|
| `list-backtests.js` | 列出所有回测记录 | `node analytics/list-backtests.js` |
| `check-backtest.js` | 检查回测状态 | `node analytics/check-backtest.js` |
| `compare-experiments.js` | 对比不同实验的结果 | `node analytics/compare-experiments.js` |
| `fix-backtest-status.js` | 修复回测状态 | `node analytics/fix-backtest-status.js` |

### 调试工具

| 脚本 | 说明 | 运行方式 |
|-----|------|---------|
| `debug_signals.js` | 调试交易信号 | `node analytics/debug_signals.js` |
| `verify_contract_risk_api.js` | 验证合约风险API | `node analytics/verify_contract_risk_api.js` |

## 文档

| 文档 | 说明 |
|-----|------|
| `DATA_SCHEMA.md` | 数据库架构文档 |
| `DATABASE_INDEX_OPTIMIZATION.md` | 数据库索引优化 |
| `LIVE_TRADING_ENGINE_PLAN.md` | 实盘交易引擎计划 |
| `TRADING_STRATEGY.md` | 交易策略说明 |
| `trend_confirmation_method.md` | 趋势确认方法 |

## 输出目录

`output/` 目录存储分析脚本的输出文件：

| 文件 | 说明 |
|-----|------|
| `trading_activity_analysis.csv` | 交易活跃度分析CSV（人工标注代币） |
| `social_media_*.json` | 社交媒体分析结果 |
| `social_media_tokens_*.csv` | 社交媒体代币数据 |
| `social_media_stats_*.csv` | 社交媒体统计数据 |

## 使用示例

### 运行多时间窗口分析

```bash
# 确保web服务器正在运行
npm run web

# 运行分析
node analytics/analyze_time_windows.js
```

### 生成交易活跃度CSV

```bash
# 确保web服务器正在运行
npm run web

# 生成CSV文件
node analytics/generate_trading_activity_csv.js
# 输出: trading_activity_analysis.csv
```

### 分析策略性能

```bash
node analytics/analyze_strategy_performance.js
```

## 注意事项

1. **依赖**: 部分脚本需要web服务器运行（`/api/token-early-trades`等API）
2. **环境变量**: 确保配置了 `config/.env` 中的数据库和API密钥
3. **输出**: 分析结果会输出到控制台或 `output/` 目录

## 相关API端点

- `/api/token-early-trades` - 获取代币早期交易数据（支持分页和时间窗口）
- `/api/backtest` - 回测API
- `/api/signals` - 交易信号API
