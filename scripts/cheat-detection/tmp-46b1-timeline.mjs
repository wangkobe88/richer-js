// tmp-46b1-timeline.mjs — 0x46b1…7777 首析 healthy 是否造成实害：token 时间线+signals+trades 对齐
import { createRequire } from 'module';
const require_ = createRequire(import.meta.url);
require_('dotenv').config({ path: 'config/.env' });
const { dbManager } = require_('../../src/services/dbManager.js');

const ADDR = '0x46b19a670569067686c2d4c402c5ef5519077777';
const sb = dbManager.getClient();

const { data: evs } = await sb.from('wss_events')
  .select('platform,payload,block_time').eq('kind', 'token_create').eq('token_address', ADDR).limit(5);
const hit = (evs ?? []).find((r) => r.payload && r.payload.symbol);
console.log(`token_create: symbol=${hit?.payload?.symbol} platform=${hit?.platform} createdAt=${hit?.block_time}`);

const { data: tk, error: tkErr } = await sb.from('wss_price_ticks')
  .select('block_time').eq('token_address', ADDR)
  .order('block_number', { ascending: true }).limit(1);
const { data: tkTail } = await sb.from('wss_price_ticks')
  .select('block_time').eq('token_address', ADDR)
  .order('block_number', { ascending: false }).limit(1);
console.log(`ticks 首行=${tk?.[0]?.block_time} 尾行=${tkTail?.[0]?.block_time}`);

const { data: sig, error: sigErr } = await sb.from('strategy_signals')
  .select('*')
  .eq('token_address', ADDR).order('created_at', { ascending: true }).limit(30);
if (sigErr) throw new Error(sigErr.message);
console.log(`\nsignals 行数=${sig?.length ?? 0}`);
for (const s of sig ?? []) {
  const cc = s.metadata?.cheatCheck ?? s.metadata?.gmgnCheck;
  const ccStr = cc ? JSON.stringify(cc).slice(0, 200) : '-';
  console.log(`#${s.id} ${s.created_at} ${s.signal_type}/${s.action}/${s.reason ?? '-'} 策略=${s.strategy_name ?? s.strategy ?? '-'} cheatCheck=${ccStr}`);
}

const { data: tr, error: trErr } = await sb.from('trades')
  .select('id,created_at,trade_direction,success,bnb_amount,metadata')
  .eq('token_address', ADDR).order('created_at', { ascending: true }).limit(10);
if (trErr) throw new Error(trErr.message);
console.log(`\ntrades 行数=${tr?.length ?? 0}`);
for (const t of tr ?? []) {
  console.log(`#${t.id} ${t.created_at} ${t.trade_direction} success=${t.success} ${t.bnb_amount}BNB`);
}
