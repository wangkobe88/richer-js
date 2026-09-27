'use strict';
/**
 * tpa-defaults — TPA 触发门 BSC 生产推荐初值（pumpfun 回迁批 4，单一真相源）
 *
 * ⚠️ 不是运行时默认值：TokenPositionAnalyzer 的 trigger 必须实验层显式配置
 * （experiments.config.tokenPositionAnalyzer.trigger，构造期缺配 fail-fast，无代码默认）。
 * 本常量供：①实验 config 抄写推荐值；②回测校准对拍基准；③文档引用。
 *
 * 初值依据（全部待 wss_price_ticks 分布回测校准）：
 *   blocks: 1      母版 slots:2(≈0.8s) → BSC 最小可表达门（1 block≈3s，与 FA firstBlockWindowMs=3000 同窗）
 *   tradeCount: 10 母版 15 → BSC tick 密度低（3s/块），15 会与时间门失衡
 *   buyBnb: 6      母版 buySol:15 ×0.4 换算惯例（与批 1 bigHolder 2.9→1.0 同源）
 *   minHolders: 4  计数链无关，同值
 */
const PROD_TRIGGER_GATE = { blocks: 1, tradeCount: 10, buyBnb: 6, minHolders: 4 };

module.exports = { PROD_TRIGGER_GATE };
