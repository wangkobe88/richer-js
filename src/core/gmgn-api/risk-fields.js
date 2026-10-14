/**
 * GMGN token info → dev/holder 风险字段提取（纯函数，CJS 共享层）
 *
 * 2026-10-14 从 narrative/utils/gmgn-social-fetcher.mjs 抽出（行为零变化）：买腿
 * 第三层 GMGN 条件（GmgnRiskCheckService，FAKER 0xc6ee…7777 团伙盘案）与叙事侧
 * 社媒补源共用同一提取——单一真相源，防字段口径漂移。
 *
 * x-0 0xa5fd 案（2026-09-27）实测：链上 creator 是 flap 工厂地址（每次发币换新
 * EOA，链上维度 creator 发币史恒 1）+ 一次性钱包 + 回收 handle 买粉伪装新项目。
 * GMGN 的推特维度归因暴露真相：twitter_create_token_count=16（serial issuer），
 * holder 侧 wallet_tags_stat 76% 是 bundler。字段随 token info 一次调用带出，
 * 零额外配额。
 */

/**
 * 从 GMGN getTokenInfo 响应提取 dev/holder 风险字段
 * @param {Object} info - GMGN getTokenInfo 响应
 * @returns {Object|null} risk 字段集；dev/wallet_tags_stat 全缺 → null
 */
function extractGmgnRisk(info) {
  const dev = info?.dev || {};
  const tags = info?.wallet_tags_stat || {};
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const risk = {
    issuerTokenCount: num(dev.twitter_create_token_count), // 该推特账号关联发币总数（x-0=16）
    creatorAddress: dev.creator_address || null,           // GMGN 归因真实 EOA（非链上工厂）
    creatorTokenStatus: dev.creator_token_status || null,  // creator_close=已清仓离场
    fundFrom: dev.fund_from || null,                       // creator 资金来源（币安热钱包=一次性钱包）
    bundlerWallets: num(tags.bundler_wallets),
    sniperWallets: num(tags.sniper_wallets),
    freshWallets: num(tags.fresh_wallets),
    topWallets: num(tags.top_wallets),                     // 标签统计分母（x-0=46）
    imageDupCount: num(info?.image_dup_count),             // 头像/图片重复数（批量盘特征）
  };
  const hasAny = Object.values(risk).some(v => v !== null);
  return hasAny ? risk : null;
}

module.exports = { extractGmgnRisk };
