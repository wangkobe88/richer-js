// 12 张 famous near_launch 票：burst 判定 × famous 是否在 burst 波内买入（182）
const { dbManager } = require('../src/services/dbManager.js');
const { BuyPointCheckService } = require('../src/market-analysis/BuyPointCheckService.js');
const { buildBuyPointSnapshot, bpTEndOf } = require('../src/market-analysis/buy-point-snapshot.js');
const FAMOUS = require('../config/rosters/famous-copy-wallets.json');
const ROSTER = new Set((FAMOUS.wallets || []).map((w) => w.toLowerCase()));

const T = [
  ['550f9e89', '0xdae106c8', 'Go Brrrrr'], ['550f9e89', '0x562ba26b', '胖五A'], ['550f9e89', '0xf488a483', 'GroundingPI'],
  ['550f9e89', '0x5bba5fbb', 'BSA'], ['550f9e89', '0xb96e4da8', 'VETO'], ['550f9e89', '0xb59692cc', '中国吊会飞'],
  ['550f9e89', '0x65a1490b', 'buy'], ['550f9e89', '0x9c13d510', '胖五B'],
  ['54dac9c5', '0x1ed2e3e5', '画地为牢'], ['54dac9c5', '0xce85402d', '羊'], ['54dac9c5', '0x40a58811', '왹냥'],
  ['54dac9c5', '0xe4529eeb', '漏洞獵人'], ['54dac9c5', '0x0f4bc185', '我画地为牢'],
];

async function main() {
  const c = await dbManager.getClient();
  const svc = new BuyPointCheckService({ persist: false }, { info() {}, warn() {}, error() {} }, { dbClient: c });
  for (const [pre, addrPre, name] of T) {
    const { data: exps } = await c.from('experiments').select('id').limit(500);
    const id = exps.find((e) => e.id.startsWith(pre)).id;
    const { data: sig } = await c.from('strategy_signals')
      .select('token_address,created_at,executed,cc:metadata->cheatCheck')
      .eq('experiment_id', id).eq('signal_type', 'BUY')
      .ilike('token_address', addrPre + '%').order('created_at', { ascending: true }).limit(3);
    if (!sig || !sig[0]) { console.log(`${name}: 无信号`); continue; }
    const addr = sig[0].token_address;
    const anchorMs = new Date(sig[0].created_at).getTime();
    // Jev sbw 判定
    const sbwHits = sig.map((s) => s.cc && s.cc.levels ? s.cc.levels.stallBurstWave : '?').join(',');
    // snapshot：burst 波窗 + famous 在波内买入
    const pull = await svc._pullTicksDb(addr, anchorMs);
    const meta = svc._normalizeMeta(addr, { platform: null }, pull, null);
    const snap = buildBuyPointSnapshot(pull.rows, meta, {});
    const cd = snap.cheatDerived || {};
    const burstInfo = {
      lastGapSec: cd.burstLastGapSec, exitBuy: cd.burstExitWaveBuyBnb, exitWallets: cd.burstExitWaveWallets,
      sinceWaveEnd: cd.burstSecSinceWaveEnd, segBuy: cd.burstWaveSegBuyBnb, waveBuy: cd.burstWaveBuyBnb,
      preTpm: cd.burstPreSegTicksPerMin, preBnb: cd.burstPreSegBnbPerMin,
    };
    // famous 在整个窗口内买入行 + 时间
    const tEnd = bpTEndOf(snap.ticks);
    const famRows = (snap.ticks || []).filter((t) => t.side === 'BUY' && t.wallet && ROSTER.has(String(t.wallet).toLowerCase()))
      .map((t) => ({ dt: t.dt, bnb: t.bnb, price: t.price }));
    console.log(`\n### ${name} ${addr}`);
    console.log(`  Jev sbw 判定（前3信号）: ${sbwHits}（1=burst）`);
    console.log(`  burst 锚: lastGap=${burstInfo.lastGapSec}s 出口波买=${burstInfo.exitBuy}B/${burstInfo.exitWallets}钱包 距波末=${burstInfo.sinceWaveEnd}s 簇买=${burstInfo.segBuy} 全窗波买=${burstInfo.waveBuy} 背景=${burstInfo.preTpm}笔/${burstInfo.preBnb}B per min`);
    console.log(`  famous 全窗买入 ${famRows.length} 笔: ${famRows.map((r) => `t+${r.dt}s ${r.bnb.toFixed(3)}B@${r.price ? r.price.toExponential(2) : '?'}`).join(' | ') || '无'}`);
  }
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e && e.stack || e); process.exit(1); });
