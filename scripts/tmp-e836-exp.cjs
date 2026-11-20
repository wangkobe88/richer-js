require('dotenv').config({ path: 'config/.env' });
const { dbManager } = require('../src/services/dbManager');

const EXP = '7d60bc05-8c4e-4f0d-993c-6f2d02428ea7';
const TOKEN = '0xe83626c404ee63b68ae2a7cdb17fd7d4d2c77777';

async function main() {
  const sb = dbManager.getClient();
  const { data: exp0 } = await sb.from('experiments').select('*').eq('id', EXP).limit(1);
  if (!exp0 || !exp0.length) { console.log('exp row missing'); }
  else {
    const exp = exp0[0];
    console.log('cols:', Object.keys(exp).join(','));
    for (const k of ['experiment_name', 'name', 'trading_mode', 'platform', 'status']) {
      if (exp[k] !== undefined) console.log(k + ':', exp[k]);
    }
    const cfg = exp.config || {};
    const fm = cfg.fourmemeWs || {}, fl = cfg.flapWs || {};
    console.log('cheatCheck(4m):', JSON.stringify(fm.cheatCheck || null));
    console.log('cheatCheck(flap):', JSON.stringify(fl.cheatCheck || null));
    console.log('backtest:', JSON.stringify(cfg.backtest || null));
    console.log('buyPointCheck(4m):', JSON.stringify(fm.buyPointCheck || null));
    console.log('buyPointCheck(flap):', JSON.stringify(fl.buyPointCheck || null));
  }
  const { data: ev } = await sb.from('wss_events')
    .select('block_time,payload,platform')
    .eq('kind', 'token_create').eq('token_address', TOKEN).limit(2);
  console.log('token_create:', JSON.stringify(ev));
  const ANCHOR = '2026-10-04T11:01:51+00:00';
  const FROM = '2026-10-04T10:55:00+00:00';
  const { data: ticks, error } = await sb.from('wss_price_ticks')
    .select('block_time,block_number,log_index,is_buy,bnb_amount,sender_address')
    .eq('token_address', TOKEN)
    .gte('block_time', FROM).lte('block_time', ANCHOR)
    .order('block_time', { ascending: true }).limit(1000);
  if (error) throw new Error(JSON.stringify(error));
  console.log('ticks in [10:55, anchor]:', ticks.length);
  const walletMap = new Map(); let wi = 0;
  for (const t of ticks) {
    const w = (t.sender_address || '?').toLowerCase();
    if (!walletMap.has(w)) walletMap.set(w, 'W' + (++wi));
    const ts = new Date(t.block_time).toISOString().slice(11, 23);
    console.log(ts, t.is_buy ? 'BUY ' : 'SELL', Number(t.bnb_amount).toFixed(4), walletMap.get(w), 'blk', t.block_number, 'li', t.log_index);
  }
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
