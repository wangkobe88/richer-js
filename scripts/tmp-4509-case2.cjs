require('dotenv').config({ path: 'config/.env' });
const { dbManager } = require('../src/services/dbManager');

const EXP = '7d60bc05-8c4e-4f0d-993c-6f2d02428ea7';
const TOKEN = '0x4509204c4f82dee14352bf7cfafae4138b287777';

async function main() {
  const sb = dbManager.getClient();

  const { data: sigs } = await sb.from('strategy_signals')
    .select('*')
    .eq('experiment_id', EXP)
    .eq('token_address', TOKEN)
    .order('created_at', { ascending: true })
    .limit(50);

  // BUY #4 (15:03:13) 与 SELL 的完整 metadata
  for (const row of sigs) {
    if (row.created_at >= '2026-10-03T15:03:10' && row.created_at <= '2026-10-03T15:03:20' && row.signal_type === 'BUY') {
      const md = row.metadata || {};
      console.log('=== BUY#4 metadata keys:', Object.keys(md).join(','));
      console.log('actFrontGate:', JSON.stringify(md.actFrontGate || null));
      const ch = md.cheatCheck || {};
      console.log('cheatCheck:', JSON.stringify({ status: ch.status, grade: ch.grade, levels: ch.levels, info: typeof ch.info === 'object' ? { stallBurstWave: ch.info && ch.info.levels && ch.info.levels.stallBurstWave } : ch.info }).slice(0, 1200));
    }
    if (row.signal_type === 'SELL') {
      const md = row.metadata || {};
      console.log('=== SELL metadata keys:', Object.keys(md).join(','));
      console.log('SELL burstCooldownInfo:', JSON.stringify(md.burstCooldownInfo || md.strategy && md.strategy.burstCooldownInfo || null));
      console.log('SELL strategy:', JSON.stringify(md.strategy || null));
      const fr = md.factorResults || {};
      console.log('SELL factorResults:', JSON.stringify({ profitPercent: fr.profitPercent, currentPriceBnb: fr.currentPriceBnb, currentVsLaunchPct: fr.currentVsLaunchPct, holdSec: fr.realHoldDuration }));
    }
  }

  // trades 全文
  const { data: trades } = await sb.from('trades')
    .select('*')
    .eq('experiment_id', EXP)
    .eq('token_address', TOKEN)
    .order('created_at', { ascending: true })
    .limit(20);
  for (const t of trades) {
    console.log('\n=== trade', t.id, 'type=', t.trade_type || t.side || t.action);
    for (const k of Object.keys(t)) {
      if (['id', 'experiment_id', 'token_address', 'created_at', 'updated_at'].includes(k)) continue;
      const v = t[k];
      if (v === null || v === undefined) continue;
      const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
      console.log(`  ${k}: ${s.slice(0, 500)}`);
    }
  }

  // ticks 15:03:00 之后
  const rows = [];
  let cur = null;
  for (let i = 0; i < 8; i++) {
    let q = sb.from('wss_price_ticks')
      .select('id,block_time,bnb_amount,price_bnb,trade_type,sender_address,trader_address,block_number')
      .eq('token_address', TOKEN)
      .order('id', { ascending: true })
      .limit(1000);
    if (cur) q = q.gt('id', cur);
    const { data, error } = await q;
    if (error) throw new Error(JSON.stringify(error));
    rows.push(...data);
    if (data.length < 1000) break;
    cur = data[data.length - 1].id;
  }
  const tMs = s => new Date(s).getTime();
  const after = rows.filter(r => tMs(r.block_time) >= tMs('2026-10-03T15:03:10+00:00'));
  console.log('\n### ticks 15:03:10 之后 (' + after.length + '):');
  let last = null;
  for (const t of after) {
    const gap = last ? ((tMs(t.block_time) - tMs(last)) / 1000).toFixed(0) : '-';
    console.log(`${t.block_time} gap=${gap}s ${t.trade_type === 'sell' ? 'S' : 'B'} ${Number(t.bnb_amount).toFixed(4)}B px=${Number(t.price_bnb).toExponential(3)} w=${(t.sender_address || t.trader_address || '').slice(0, 8)}`);
    last = t.block_time;
  }
  // 卖出后峰值
  const sellMs = tMs('2026-10-03T15:03:37+00:00');
  const post = rows.filter(r => tMs(r.block_time) > sellMs);
  if (post.length) {
    const maxPx = Math.max(...post.map(r => Number(r.price_bnb)));
    const maxRow = post.find(r => Number(r.price_bnb) === maxPx);
    const lastRow = post[post.length - 1];
    console.log(`\n卖出后: 峰值px=${maxPx.toExponential(3)} @${maxRow.block_time}  末行=${lastRow.block_time} px=${Number(lastRow.price_bnb).toExponential(3)}`);
    console.log(`卖出后买额=${post.filter(r => r.trade_type !== 'sell').reduce((s, r) => s + Number(r.bnb_amount), 0).toFixed(3)}B 卖额=${post.filter(r => r.trade_type === 'sell').reduce((s, r) => s + Number(r.bnb_amount), 0).toFixed(3)}B 钱包=${new Set(post.map(r => r.sender_address || r.trader_address)).size}`);
  }
  // 生命周期统计
  const burstMs = tMs('2026-10-03T15:02:21+00:00');
  const pre = rows.filter(r => tMs(r.block_time) < burstMs);
  const preBuy = pre.filter(r => r.trade_type !== 'sell').reduce((s, r) => s + Number(r.bnb_amount), 0);
  const preSell = pre.filter(r => r.trade_type === 'sell').reduce((s, r) => s + Number(r.bnb_amount), 0);
  console.log(`\n### 生命周期: 总ticks=${rows.length} | burst前: ${pre.length}笔 买${preBuy.toFixed(2)}B/卖${preSell.toFixed(2)}B 钱包${new Set(pre.map(r => r.sender_address || r.trader_address)).size} | burst前末笔=${pre[pre.length - 1] && pre[pre.length - 1].block_time} (静默=${((burstMs - tMs(pre[pre.length - 1].block_time)) / 1000).toFixed(0)}s)`);
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
