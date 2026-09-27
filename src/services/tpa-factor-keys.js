'use strict';
/**
 * tpa-factor-keys — TPA 持仓因子键清单（单一真相源，pumpfun 回迁批 4）
 *
 * 两个清单供 FactorAggregator.getFactorKeys() 手动段并入（spread 动态键探针收不到，
 * 策略 condition 引用键 ∉ getAvailableFactorIds 会被 StrategyEngine 拒载）：
 *   - HOLDING_FACTOR_KEYS：TokenPositionAnalyzer 首次触发产出（holding_factors 落表 + FA 回填）
 *   - FA_TPA_KEYS：FA 自产的 TPA 联动键（非 TPA 侧写入）
 *
 * 键语义（与母版 token-position-analyzer 对齐）：
 *   TPAPre_walletHoldingPct   代币从池子流入钱包占比 %（Σ买−Σ卖 token / totalSupply ×100；全量无 skip）
 *   TPAPre_tokenScore         top 持仓者钱包分 floatPct 加权聚合（0-5 量纲）
 *   TPAPre_analyzeDurationMs  分析触发→完成耗时（画像+评分段）；未触发/失败 → null fail-closed
 *   TPAPre_analyzedAgeSec     画像就绪时代币年龄（触发年龄+耗时）
 *   TPAPre_zhuangScore 等     庄散四桶 floatPct 加权均分 + minZR/gapZR（computeZhuangRetail 附属）
 *   TPAPre_zhuangRetailRatio  (庄+新钱包)/散户 占比比（verdict 决策口径；散户=0 → Infinity + Infinite 标记）
 *   TPAPre_zhuangPct 等       四桶占比 % + 庄桶计数
 *   TPAAnalyzed               FA 侧 0/1（TPA 是否已对本 token 产出因子）
 *   TPAPre_retention          冻结 asof 庄集当前净持仓 token / 冻结时净持仓（FA 随 tick 重算）
 *   TPAPre_asofRelFirst       asof 价 / 首价（TPA 冻结时点相对涨幅基准）
 */

// TPA 侧产出键（holding_factors 快照 + FA holdingCache 回填；母版 :192-205 逐键对齐）
const HOLDING_FACTOR_KEYS = [
  'TPAPre_walletHoldingPct',
  // token 总分（_computeWalletScores 聚合；去门控化后供 condition 引用 TPAPre_tokenScore>X）
  'TPAPre_tokenScore',
  // TPA 运行耗时观察因子：analyzeDurationMs=分析触发→完成 wall clock 耗时；analyzedAgeSec=画像就绪时
  // 的代币年龄——实锤「early 买窗内 TPA 画像能否就绪」竞态的两把尺。未触发/分析失败 → null fail-closed。
  'TPAPre_analyzeDurationMs', 'TPAPre_analyzedAgeSec',
  // 庄散加权分（computeZhuangRetail 附属输出）
  'TPAPre_zhuangScore', 'TPAPre_retailScore', 'TPAPre_newWalletScore', 'TPAPre_neutralScore', 'TPAPre_minZR', 'TPAPre_gapZR',
  // 庄散比 + 4 桶占比（verdict 决策口径持久化，供 web 读落表；retail=0 时 ratio=Infinity+infinite=true）
  'TPAPre_zhuangRetailRatio', 'TPAPre_zhuangRetailRatioInfinite', 'TPAPre_zhuangPct', 'TPAPre_newWalletPct', 'TPAPre_retailPct', 'TPAPre_neutralPct', 'TPAPre_zhuangHolderCount',
];

// FA 自产键（FourMemeFactorAggregator._buildFactorMap 尾部注入，非 TPA 写入）
const FA_TPA_KEYS = [
  'TPAAnalyzed',        // 0/1：TPA 是否已对本 token 产出因子（触发前 0）
  'TPAPre_retention',   // 冻结庄集当前净持仓 / 冻结时净持仓（TPA 冻结 asof 后 FA 随 tick 重算）
  'TPAPre_asofRelFirst',// asof 价 / 首价（TPA 冻结时点基准，观察 asof 后走势用）
];

module.exports = { HOLDING_FACTOR_KEYS, FA_TPA_KEYS };
