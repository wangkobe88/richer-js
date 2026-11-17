// CD401/405 背景腿验证预扫描（182 只读）：v131 全部 BUY 信号时刻重放两臂新旧对比
const path = require('path');
const { dbManager } = require('../src/services/dbManager.js');
const { BuyPointCheckService } = require('../src/market-analysis/BuyPointCheckService.js');
const { buildBuyPointSnapshot } = require('../src/market-analysis/buy-point-snapshot.js');
const FPC = require('../src/market-analysis/factor-pre-buy-check.js');

async function main() {
  const c = await dbManager.getClient();
  const { data: exps } = await c.from('experiments').select('id').limit(500);
  const id = exps.find((e) => e.id.startsWith('f3dd5537')).id;
  const svc = new BuyPointCheckService({ persist: false }, { info() {}, warn() {}, error() {} }, { dbClient: c });
  let sigs = [], from = 0;
  while (true) {
    const { data, error } = await c.from('strategy_signals')
      .select('token_address,token_symbol,created_at')
      .eq('experiment_id', id).eq('signal_type', 'BUY')
      .order('created_at', { ascending: true }).range(from, from + 999);
    if (error) throw new Error(error.message);
    sigs = sigs.concat(data);
    if (data.length < 1000) break;
    from += 1000;
  }
  console.log(`v131 BUY 信号 ${sigs.length} 行重放（背景腿版）`);
  let old401 = 0, new401 = 0, old405 = 0, new405 = 0, n = 0;
  const newlySaved = new Map(); // 背景腿救回的 (token,sym) 命中
  for (const s of sigs) {
    n++;
    if (n % 200 === 0) console.log(`  … ${n}/${sigs.length}`);
    try {
      const anchorMs = new Date(s.created_at).getTime();
      const pull = await svc._pullTicksDb(s.token_address, anchorMs);
      if (!pull.rows.length || pull.anchorTickCount < 6) continue;
      const meta = svc._normalizeMeta(s.token_address, { symbol: s.token_symbol, platform: null }, pull, null);
      const snap = buildBuyPointSnapshot(pull.rows, meta, {});
      const cd = snap.cheatDerived || {};
      // 旧版（无背景腿）=卖压两线+代理三腿/捆绑两口径；新版=现函数（含背景腿）
      const oldA = (typeof cd.burstWaveSegSellPct === 'number' && cd.burstWaveSegSellPct >= 30
        && typeof cd.burstWaveSegSellBnb === 'number' && cd.burstWaveSegSellBnb >= 0.3
        && typeof cd.burstSecSinceWaveEnd === 'number' && cd.burstSecSinceWaveEnd <= 60
        && typeof cd.burstWaveWalletMedianBnb === 'number' && cd.burstWaveWalletMedianBnb < 0.05
        && typeof cd.burstWaveWalletNetBnb === 'number' && cd.burstWaveWalletNetBnb > 0);
      const newA = FPC.armBurstExitSellPressure(cd);
      const oldB = ((typeof cd.burstWaveBundleMaxWallets === 'number' && cd.burstWaveBundleMaxWallets >= 7)
        || (typeof cd.burstWaveBundleAdjPairSum === 'number' && cd.burstWaveBundleAdjPairSum >= 7));
      const newB = FPC.armBurstBundledWave(cd);
      if (oldA) old401++; if (newA) new401++;
      if (oldB) old405++; if (newB) new405++;
      if (oldA && !newA) newlySaved.set(s.token_address, { sym: s.token_symbol, arm: 'cd401' });
      if (oldB && !newB) newlySaved.set(s.token_address, { sym: s.token_symbol, arm: (newlySaved.get(s.token_address) || {}).arm === 'cd401' ? 'cd401+cd405' : 'cd405' });
    } catch (e) { /* 单行异常跳过 */ }
  }
  console.log(`\nCD401 命中：旧 ${old401} 行 → 新（背景腿）${new401} 行`);
  console.log(`CD405 命中：旧 ${old405} 行 → 新（背景腿两臂同加）${new405} 行`);
  console.log(`\n背景腿救回票（token 级 ${newlySaved.size} 张）：`);
  for (const [k, v] of newlySaved) console.log(`  ${(v.sym || '?').slice(0, 14).padEnd(15)} ${v.arm}  ${k}`);
  // Go Brrrrr 验收
  const dj = sigs.find((s) => s.token_address.startsWith('0xdae106c8'));
  if (dj) {
    const anchorMs = new Date(dj.created_at).getTime();
    const pull = await svc._pullTicksDb(dj.token_address, anchorMs);
    const meta = svc._normalizeMeta(dj.token_address, { symbol: dj.token_symbol, platform: null }, pull, null);
    const cd = buildBuyPointSnapshot(pull.rows, meta, {}).cheatDerived || {};
    console.log(`\nGo Brrrrr 验收（首信号时刻）：CD401 新判定=${FPC.armBurstExitSellPressure(cd)}（false=PASS ✓）；背景锚 preSeg=${cd.burstPreSegBnbPerMin} BNB/min / ${cd.burstPreSegTicksPerMin} 笔/min`);
  }
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e && e.stack || e); process.exit(1); });
