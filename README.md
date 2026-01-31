# richer-js

基于数据驱动的 four.meme 代币自动交易引擎。

## 概述

本项目实现了针对 four.meme 平台新代币的自动化交易策略，策略基于对 6,884 个代币、113,892 条 K 线数据的深度分析。

## 核心策略

- **买入时机**: 代币创建后 1 分钟
- **买入条件**: earlyReturn 在 80-120% 之间
- **卖出策略**: 阶梯止盈（+30% 卖 50%，+50% 卖剩余）
- **观察窗口**: 30 分钟

详见 [交易策略文档](docs/TRADING_STRATEGY.md)

## 安装

```bash
npm install
```

## 配置

1. 复制环境变量模板：
```bash
cp config/.env.example config/.env
```

2. 编辑 `config/.env`，填入你的 AVE API Key：
```
AVE_API_KEY=your_api_key_here
```

## 运行

```bash
npm start
```

## 项目结构

```
richer-js/
├── docs/                   # 文档
├── config/                 # 配置文件
├── src/
│   ├── core/              # 核心组件
│   │   ├── ave-api/       # AVE API 客户端
│   │   ├── token-pool.js  # 代币监控池
│   │   └── strategy-engine.js  # 策略引擎
│   ├── collectors/        # 数据收集器
│   ├── monitors/          # 监控器
│   └── utils/             # 工具类
├── logs/                  # 日志目录
└── data/                  # 数据缓存目录
```

## 注意事项

⚠️ **本项目当前只进行决策输出，不执行实际交易**

所有买卖决策会输出到日志文件，供参考和验证。

## 风险提示

- 历史回测显示约 42% 的交易会亏损
- 本策略不构成投资建议
- 加密货币交易具有高风险
- 请根据自己的风险承受能力谨慎决策

## License

MIT
