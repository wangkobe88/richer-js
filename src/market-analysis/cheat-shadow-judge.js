/**
 * 作弊题集影子档位预判（FP47 第二批影子，2026-11-24 用户裁定「A 档四题全搞」）
 * ——零依赖纯函数，零 DB 零网络。
 *
 * 定位：wash_pair（同块对敲）/ insider_supply_sell（老鼠仓份额卖出）两道「死板
 * 计算」题的档位判据机械翻译。**门侧零消费**——A 主判 MAIN_IDS / L 通道照旧
 * 消费 Jev 档位（本模块产物只进 FA 观察键+回归对拍，攒分布与 Jev 档位对拍，
 * 分离度达标后用户再裁定转正）。G9/CD133 红线：只复刻主判据不碰反锚链的
 * 因子化必死——本模块刻意**不译**辅助判读（wash 反向鉴别/insider ③④节奏等额
 * 升档），对拍看简化线能否分离。
 *
 * 档位数值化（CHEAT_LEVEL_SCORES.level 同序）：none=0/weak=1/moderate=2/strong=3；
 * null=锚全缺失不可评（fail-closed 方向——条件串裸比较恒 false）。
 * ⓟ=候选定线（题面无硬线，全部对拍校准后用户裁定）。
 *
 * 单测：scripts/_test_cheat_shadow_judge.cjs
 */

/** wash_pair 占比档位线（ⓟ 对拍校准；题面正例 95%/反例 1.9%、「偶发 1~2 对=碰撞」） */
const WASH_LEVEL_SELL_PCT_WEAK = 10;
const WASH_LEVEL_SELL_PCT_MODERATE = 25;
const WASH_LEVEL_SELL_PCT_STRONG = 50;
const WASH_LEVEL_MIN_COUNT_WEAK = 3;
const WASH_LEVEL_MIN_COUNT_MODERATE = 5;
const WASH_LEVEL_MAX_COUNT_NONE = 2;

/** insider 双口径档位线（题面直供：≥25 主导/冲击线、10~25 明显在场） */
const INSIDER_LEVEL_PCT_MODERATE = 10;
const INSIDER_LEVEL_PCT_STRONG = 25;
/** insider 题⑤单钱包隐藏筹码豁免：零买纯卖（剔创建者）仅 1 个且占总交易量 <此% → 至多 weak */
const INSIDER_SOLO_VOLUME_PCT_EXEMPT = 15;
/** 分发网络判据：组内钱包 ≥此=网络形状（strong 资格；单点至多 moderate） */
const INSIDER_NETWORK_MIN_WALLETS = 2;

const LEVEL_BUCKETS = ['none', 'weak', 'moderate', 'strong'];

/**
 * wash_pair 档位预判（占比轴机械线——对数带配对三键已由 cheat-snapshot 代码算好，
 * Jev 只读值对档；本函数接棒「对档」这最后一步）。反向鉴别（买方一次性新钱包/
 * 多轮复现/卖方集中）刻意不译（辅助判读留 Jev）。
 * @param {Object} d - computeDerived 产物（cheat-snapshot）
 * @returns {{level:number|null, bucket:string|null, branch:string, trace:Object}}
 */
function judgeWashPairLevel(d) {
  const fin = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const count = fin(d && d.washPairCount);
  const sellPct = fin(d && d.washPairSellPct);
  const trace = { washPairCount: count, washPairSellPct: sellPct, washPairBuyPct: fin(d && d.washPairBuyPct) };
  if (count === null || sellPct === null) {
    // 无配对（pairN=0 → 三键全 null）=有证据的 none；键缺失（旧档/无 derived）=不可评
    return d && typeof d.washPairCount === 'number' && d.washPairCount === 0
      ? { level: 0, bucket: 'none', branch: 'zero_pair', trace }
      : { level: null, bucket: null, branch: 'unrated', trace };
  }
  // 「偶发 1~2 对可以是碰撞」「占比不足不为据」→ none
  if (count <= WASH_LEVEL_MAX_COUNT_NONE || sellPct < WASH_LEVEL_SELL_PCT_WEAK) {
    return { level: 0, bucket: 'none', branch: 'collision', trace };
  }
  if (count >= WASH_LEVEL_MIN_COUNT_MODERATE && sellPct >= WASH_LEVEL_SELL_PCT_STRONG) {
    return { level: 3, bucket: 'strong', branch: 'dominant', trace };
  }
  if (count >= WASH_LEVEL_MIN_COUNT_MODERATE && sellPct >= WASH_LEVEL_SELL_PCT_MODERATE) {
    return { level: 2, bucket: 'moderate', branch: 'evident', trace };
  }
  return { level: 1, bucket: 'weak', branch: 'sporadic', trace };
}

/**
 * insider_supply_sell 档位预判（①②⑤判据机械翻译；③④节奏/等额升档刻意不译）。
 * 输入键=computeDerived 新增锚（剔创建者口径，cheat-snapshot 已算）。
 * @param {Object} d - computeDerived 产物
 * @returns {{level:number|null, bucket:string|null, branch:string, trace:Object}}
 */
function judgeInsiderLevel(d) {
  const fin = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const sellPct = fin(d && d.insiderSellPct);
  const buyPct = fin(d && d.insiderSellBuyPct);
  const wallets = fin(d && d.insiderSellWallets);
  const soloWallets = fin(d && d.noBuySellWalletsExCreator);
  const soloVolumePct = fin(d && d.noBuySellVolumePctExCreator);
  const trace = {
    insiderSellPct: sellPct, insiderSellBuyPct: buyPct, insiderSellWallets: wallets,
    noBuySellWalletsExCreator: soloWallets, noBuySellVolumePctExCreator: soloVolumePct,
  };
  // 组不在场（0=有证据零值）→ none；锚全缺失（旧档/无 derived）→ null 不可评
  if (sellPct === null || buyPct === null || wallets === null) {
    return { level: null, bucket: null, branch: 'unrated', trace };
  }
  if (wallets === 0) return { level: 0, bucket: 'none', branch: 'no_group', trace };
  // ⑤ 单钱包隐藏筹码豁免：零买纯卖（剔创建者）仅 1 个 ∧ 占总交易量 <15% → 至多 weak
  // （占比口径再扎眼也不算数——总卖盘子小占比天然虚高，对盘面的实际分量以总量为准）
  const soloExempt = soloWallets === 1 && soloVolumePct !== null && soloVolumePct < INSIDER_SOLO_VOLUME_PCT_EXEMPT;
  if (soloExempt) {
    return sellPct >= INSIDER_LEVEL_PCT_MODERATE
      ? { level: 1, bucket: 'weak', branch: 'solo_exempt', trace }
      : { level: 0, bucket: 'none', branch: 'solo_exempt_none', trace };
  }
  // 网络形状（组内 ≥2 钱包）∧ 双口径都高 → strong；单点/冲击不足 → 至多 moderate
  const network = wallets >= INSIDER_NETWORK_MIN_WALLETS;
  if (sellPct >= INSIDER_LEVEL_PCT_STRONG && buyPct >= INSIDER_LEVEL_PCT_STRONG && network) {
    return { level: 3, bucket: 'strong', branch: 'network_dominant', trace };
  }
  if (sellPct >= INSIDER_LEVEL_PCT_MODERATE) {
    return { level: 2, bucket: 'moderate', branch: 'evident', trace };
  }
  return { level: 1, bucket: 'weak', branch: 'sporadic', trace };
}

/** 影子档位预判总入口（CheatCheckService/runner 消费） */
function judgeCodeLevels(derived) {
  return {
    washPair: judgeWashPairLevel(derived),
    insiderSupplySell: judgeInsiderLevel(derived),
  };
}

module.exports = {
  judgeWashPairLevel, judgeInsiderLevel, judgeCodeLevels,
  WASH_LEVEL_SELL_PCT_WEAK, WASH_LEVEL_SELL_PCT_MODERATE, WASH_LEVEL_SELL_PCT_STRONG,
  WASH_LEVEL_MIN_COUNT_WEAK, WASH_LEVEL_MIN_COUNT_MODERATE, WASH_LEVEL_MAX_COUNT_NONE,
  INSIDER_LEVEL_PCT_MODERATE, INSIDER_LEVEL_PCT_STRONG,
  INSIDER_SOLO_VOLUME_PCT_EXEMPT, INSIDER_NETWORK_MIN_WALLETS,
  LEVEL_BUCKETS,
};
