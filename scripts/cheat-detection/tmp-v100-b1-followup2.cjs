// 一次性（182 跑）：bt-v100 四案补查。
// ①苍蝇 0x0432（idx6，BP pattern_gate 拒=有盘型判定）两 famous 址聚合——用户所指可能是这票
// ②苹果SI cheatCheck.levels/anchors dump——E_low 拒的 act/sbw 事实
// ③苍蝇 0x68bb sender 解析缺口——两 famous 零买卖是否因藏在未解析行（trader=聚合路由）
const { dbManager } = require('../../src/services/dbManager.js');
const EXP = '11fc182a-b051-4665-857c-5c14e6713334';
const ROSTER = require('../../config/rosters/famous-copy-wallets.json');
const parse = (m) => { try { return typeof m === 'string' ? JSON.parse(m) : (m || {}); } catch { return {}; } };
const short = (a) => (a ? a.slice(0, 8) + '…' + a.slice(-4) : '-');
const ts = (s) => String(s || '').slice(11, 19);
const R4_FAMOUS = ['0xd44e17d5daeab4ec126e2c8395758b55f959298b', '0x3472ccf6209925204b9cf352171ee150904fda7e'];

async function firstSignal(c, addr) {
  const { data, error } = await c.from('strategy_signals')
    .select('id,created_at,metadata').eq('experiment_id', EXP)
    .eq('signal_type', 'BUY').eq('token_address', addr).order('id').limit(1);
  if (error) throw new Error('signals: ' + error.message);
  return data[0];
}
async function pullTicks(c, addr) {
  const q = 'id,block_time,trade_type,bnb_amount,price_bnb,sender_address,trader_address';
  const { data, error } = await c.from('wss_price_ticks').select(q).eq('token_address', addr)
    .order('id', { ascending: true }).limit(6000);
  if (error) throw new Error('ticks: ' + error.message);
  return data || [];
}

(async () => {
  const c = await dbManager.getClient();
  const rosterList = (Array.isArray(ROSTER) ? ROSTER : (ROSTER.wallets || ROSTER.addresses || []))
    .map((f) => String(typeof f === 'string' ? f : (f.address || '')).toLowerCase());

  // ① 苍蝇 0x0432
  {
    const addr = '0x04323e04c5f48587951c2d974b7f1b007b6e7777';
    const sig = await firstSignal(c, addr);
    const rows = await pullTicks(c, addr);
    const m = parse(sig.metadata);
    const bp = m.buyPoint || {}; const dims = bp.dimensions || {};
    console.log(`\n===== 补① 苍蝇0x0432（idx6） ${addr} =====`);
    console.log(`锚=${ts(sig.created_at)} cheat=${(m.cheatCheck || {}).grade} BP=${(bp.assessment || {}).bucket}/${(bp.assessment || {}).rule}`);
    console.log(`盘型=${JSON.stringify(dims.market_pattern)} 活跃度=${JSON.stringify(dims.activity_level)}`);
    console.log(`buyPoint.anchors=${JSON.stringify(bp.anchors || {}).slice(0, 600)}`);
    const anchorMs = Date.parse(sig.created_at);
    const agg = (win, label) => {
      const buy = new Map(), sell = new Map(); let buyBnb = 0;
      for (const r of win) {
        const a = (r.sender_address || r.trader_address || '').toLowerCase();
        const b = Number(r.bnb_amount || 0);
        if (r.trade_type === 'buy') { buyBnb += b; buy.set(a, (buy.get(a) || 0) + b); }
        else sell.set(a, (sell.get(a) || 0) + b);
      }
      console.log(`${label}：${win.length} 行；买入 ${buyBnb.toFixed(2)} BNB`);
      for (const f of R4_FAMOUS) {
        const b = buy.get(f) || 0, s = sell.get(f) || 0;
        console.log(`  ${short(f)}${rosterList.includes(f) ? '[roster]' : '[未收录]'} 买 ${b.toFixed(4)} 卖 ${s.toFixed(4)} 净 ${(b - s).toFixed(4)}${buyBnb > 0 && b > 0 ? ` 占买 ${(b / buyBnb * 100).toFixed(1)}%` : ''}`);
      }
      const top = [...buy.entries()].sort((x, y) => y[1] - x[1]).slice(0, 5);
      console.log('  买入 top5：' + top.map(([a, b]) => `${short(a)} ${b.toFixed(2)}B`).join(' '));
    };
    agg(rows.filter((r) => Date.parse(r.block_time) <= anchorMs), '锚窗');
    agg(rows, '全史');
  }

  // ② 苹果SI levels/anchors
  {
    const addr = '0xc9bf4530033f6497002d228296fedb45036f7777';
    const sigs = await c.from('strategy_signals').select('id,created_at,metadata')
      .eq('experiment_id', EXP).eq('signal_type', 'BUY').eq('token_address', addr).order('id').limit(8);
    console.log(`\n===== 补② 苹果SI 全部 BUY 信号 cheat 事实 =====`);
    for (const s of sigs.data || []) {
      const cc = parse(s.metadata).cheatCheck || {};
      console.log(`#${s.id} ${ts(s.created_at)} grade=${cc.grade} reasons=${JSON.stringify((cc.reasons || []).map((r) => r.code))}`);
      if (cc.levels) console.log(`  levels.act=${cc.levels.activityLevel} sbw=${cc.levels.stallBurstWave}`);
      const an = cc.anchors || {};
      const keys = ['spanSec', 'tickCount', 'ticksPerMin', 'idlePct', 'burstMaxGapSec', 'burstWaveBuyBnb', 'burstWaveWallets', 'burstExitVsLaunchPct', 'nearTail10TickN', 'nearTail10BnbPerMin', 'nearTail5TickN', 'nearTail5BuyN', 'nearTail5BuyBnb'];
      console.log('  anchors: ' + keys.map((k) => `${k}=${an[k]}`).join(' '));
    }
  }

  // ③ 苍蝇 0x68bb sender 缺口
  {
    const addr = '0x68bb8cd436bdc8b178ab886b5a7abed5e6177777';
    const rows = await pullTicks(c, addr);
    console.log(`\n===== 补③ 苍蝇68bb sender 解析缺口 =====`);
    let nullSender = 0; const traderDist = new Map(); let nullBnb = 0;
    for (const r of rows) {
      if (!r.sender_address) { nullSender++; nullBnb += Number(r.bnb_amount || 0); }
      const t = (r.trader_address || '').toLowerCase();
      traderDist.set(t, (traderDist.get(t) || 0) + 1);
    }
    console.log(`全 ${rows.length} 行：sender NULL ${nullSender} 行（${nullBnb.toFixed(2)} BNB）`);
    console.log('trader 分布：' + [...traderDist.entries()].sort((x, y) => y[1] - x[1]).slice(0, 5).map(([a, n]) => `${short(a)}=${n}`).join(' '));
    console.log('→ 若聚合路由行占比高且 sender NULL，famous 可能藏在未解析行（无法按钱包归属）');
  }
  process.exit(0);
})().catch((e) => { console.error('FATAL', e && e.stack || e); process.exit(1); });
