/**
 * 新钱包判定画像集加载（2026-11-26 用户裁定「无 GMGN 画像/胜率为 0 全部视为
 * 新钱包」+「砍 ≥80% 一刀」）——gmgn_wallet_profiles 30d 快照（离线脚本回填），
 * 引擎启动一次性加载注入 FA（首 tick 前）；加载失败 throw 拒启（fail-fast：
 * 画像集是 freshWalletHoldPct 键的必要依赖，缺失时键恒 null=条件全拒=策略性
 * 拒买，宁拒启不静默）。
 */
'use strict';

/**
 * @param {object} dbClient - dbManager.getClient()（service key）
 * @returns {Promise<Map<string, number>>} addr(小写) -> winrate（0~1）
 */
async function loadFreshWalletWinrates(dbClient) {
  const map = new Map();
  let last = null;
  while (true) {
    let q = dbClient.from('gmgn_wallet_profiles')
      .select('address, winrate')
      .order('address', { ascending: true })
      .limit(1000);
    if (last) q = q.gt('address', last);
    const { data, error } = await q;
    if (error) throw new Error('gmgn_wallet_profiles 加载失败: ' + error.message);
    if (!data || !data.length) break;
    for (const r of data) map.set(String(r.address).toLowerCase(), Number(r.winrate) || 0);
    if (data.length < 1000) break;
    last = data[data.length - 1].address;
  }
  return map;
}

module.exports = { loadFreshWalletWinrates };
