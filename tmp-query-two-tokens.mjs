// 本地单条小结果读取：两 token 的事件/监控池/信号/交易
import { dbManager } from './src/services/dbManager.js';

const ADDRS = [
  '0xa7c9c86e2d3b6cb7de698d8067635ebd8e627777',
  '0xbeea1d618e533a387d941f58a7d4c9b7bd377777',
];
const client = dbManager.getClient();

for (const addr of ADDRS) {
  console.log(`\n===== ${addr} =====`);
  // 1. wss_events token_create
  const { data: ev } = await client
    .from('wss_events')
    .select('kind, platform, payload, created_at')
    .eq('token_address', addr.toLowerCase())
    .order('created_at', { ascending: true })
    .limit(5);
  if (ev && ev.length) {
    for (const e of ev) {
      const p = e.payload || {};
      console.log(`[event] ${e.kind} platform=${e.platform} at=${e.created_at} symbol=${p.symbol || p.tokenSymbol || '?'} name=${p.name || p.tokenName || '?'}`);
      const brief = JSON.stringify(p).slice(0, 400);
      console.log('  payload:', brief);
    }
  } else {
    console.log('[event] 无 wss_events 行');
  }

  // 2. 监控池
  const { data: pool } = await client
    .from('token_monitoring_pool')
    .select('token_symbol, status, created_at, first_seen_at, narrative_rating')
    .eq('token_address', addr.toLowerCase())
    .limit(2);
  console.log('[pool]', pool && pool.length ? JSON.stringify(pool) : '不在监控池');

  // 3. 信号
  const { data: sig } = await client
    .from('strategy_signals')
    .select('experiment_id, signal_type, created_at, metadata')
    .eq('token_address', addr.toLowerCase())
    .order('created_at', { ascending: false })
    .limit(3);
  if (sig && sig.length) {
    for (const s of sig) {
      const m = s.metadata || {};
      console.log(`[signal] exp=${s.experiment_id} type=${s.signal_type} at=${s.created_at} narrativeRating=${m.narrativeRating ?? m.narrative_rating ?? '?'} narrativeCall=${JSON.stringify(m.narrativeCall ?? null)}`);
    }
  } else {
    console.log('[signal] 无信号');
  }

  // 4. 成交
  const { data: tr } = await client
    .from('trades')
    .select('experiment_id, side, amount_bnb, created_at')
    .eq('token_address', addr.toLowerCase())
    .order('created_at', { ascending: true })
    .limit(6);
  console.log('[trades]', tr && tr.length ? JSON.stringify(tr) : '无交易');
}

process.exit(0);
