// 预扫描补充：4 张关键票（好似喵/-32°/강형과의약속/duanju）的 PVP 判定 trace 明细（182 跑）
const { dbManager } = require('../src/services/dbManager.js');
const { BuyPointCheckService } = require('../src/market-analysis/BuyPointCheckService.js');
const { buildBuyPointSnapshot } = require('../src/market-analysis/buy-point-snapshot.js');
const FPC = require('../src/market-analysis/factor-pre-buy-check.js');

const TARGETS = ['0x4d49f6ef', '0xb28547c7', '0x338520c0', '0x65aebe91'];

async function main() {
  const c = await dbManager.getClient();
  const { data: exps } = await c.from('experiments').select('id').limit(500);
  const exp = exps.find((e) => e.id.startsWith('4af09d63'));
  const svc = new BuyPointCheckService({ persist: false }, { info() {}, warn() {}, error() {} }, { dbClient: c });
  const { data: sigs } = await c.from('strategy_signals')
    .select('token_address,token_symbol,created_at,executed,er:metadata->>execution_reason')
    .eq('experiment_id', exp.id).eq('signal_type', 'BUY')
    .order('created_at', { ascending: true }).limit(2000);
  for (const pre of TARGETS) {
    const rows = (sigs || []).filter((s) => s.token_address.startsWith(pre));
    if (!rows.length) { console.log(`\n### ${pre}: 无信号行`); continue; }
    console.log(`\n### ${(rows[0].token_symbol || '?')} ${rows[0].token_address} 信号 ${rows.length} 行`);
    for (const s of rows) {
      const anchorMs = new Date(s.created_at).getTime();
      const pull = await svc._pullTicksDb(s.token_address, anchorMs);
      if (!pull.rows.length || pull.anchorTickCount < 6) { console.log(`  ${s.created_at.slice(11, 19)} ticks 不足(${pull.anchorTickCount}) 跳过`); continue; }
      const meta = svc._normalizeMeta(s.token_address, { symbol: s.token_symbol, platform: null }, pull, null);
      const snap = buildBuyPointSnapshot(pull.rows, meta, {});
      const r = FPC.evaluateFactorPreBuy(snap);
      console.log(`  ${s.created_at.slice(11, 19)} exec=${s.executed} 基线er=${s.er || '(买)'} → 因子 ${r.pass ? 'PASS' : '拒 ' + r.reason}`);
      console.log(`    pvp: hit=${r.pvp.hit} branch=${r.pvp.branch}`);
      console.log(`    trace: ${JSON.stringify(r.trace)}`);
      // 大户钱包明细（0.2 级单笔 top6 的在场分类）
      const { bpTEndOf } = require('../src/market-analysis/buy-point-snapshot.js');
      const tEnd = bpTEndOf(snap.ticks);
      const bigs = (snap.wallets || []).filter((w) => (w.maxBuyBnb || 0) >= 0.19).slice(0, 6);
      for (const w of bigs) {
        const idle = (tEnd !== null && w.lastActDt !== null) ? Math.round((tEnd - w.lastActDt) / 1000) : null;
        console.log(`    大户 ${w.w.slice(0, 10)} 单笔${w.maxBuyBnb.toFixed(3)} 买${w.buyBnb.toFixed(3)} 卖${w.sellBnb.toFixed(3)} 净${(w.buyBnb - w.sellBnb).toFixed(3)} 距末动${idle === null ? '?' : idle + 's'} → ${FPC.classifyWallet(w, tEnd)}`);
      }
    }
  }
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e && e.stack || e); process.exit(1); });
