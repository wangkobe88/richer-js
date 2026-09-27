'use strict';
/**
 * wallet-category — 钱包类别阈值常量（pumpfun 回迁批 4，精简版）
 *
 * 母版 scripts/shared/wallet-category.js 还含 WALLET_CATEGORY 枚举族 /
 * NEW_WALLET_THRESHOLD / PROTECTED_CATEGORIES 等（web WalletDataService 与已不迁的
 * 分析脚本消费）；批 4 迁移范围内唯一消费点是 TokenPositionAnalyzer._packProfile，
 * 故只迁 HIGH_FREQ_THRESHOLD 一项，其余不迁（需要时再补，避免搬运无消费方的枚举）。
 */

// 高频钱包阈值（链无关的 token 计数）：isSniper 现算口径单一真相源。
// ★isSniper 不落表、不存字段（母版用户指令：所有钱包统一处理，不做 sniper 特殊处理）：
//   使用点从 profile.tokenCount >= HIGH_FREQ_THRESHOLD 现算——TPA._packProfile 对高频钱包
//   置空 buckets/lowTinyRatio（跨大量代币的聚合桶统计在高频下失真）。
const HIGH_FREQ_THRESHOLD = 200;

module.exports = { HIGH_FREQ_THRESHOLD };
