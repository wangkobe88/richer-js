#!/usr/bin/env node
// ============================================================================
// KOL 研究·票池 token_create 时刻批查（wss_events，182 跑）
//   → data/kol-study/token-create.json  { addr: {blockTime, platform, symbol} }
//   用途：KOL 入场偏移 = start_holding_at(unix s) − token_create 时刻
// ============================================================================
const path = require('path');
const fs = require('fs');

async function main() {
  const { dbManager } = require('../../src/services/dbManager');
  const sb = dbManager.getClient();
  const pool = JSON.parse(fs.readFileSync(path.join(__dirname, '../../scripts/buy-point/sets/kol-study-pool.json'), 'utf8'));
  const out = {}; const missing = [];
  const addrs = pool.tokens.map((t) => t.address);
  for (let i = 0; i < addrs.length; i += 50) {
    const batch = addrs.slice(i, i + 50);
    const { data, error } = await sb.from('wss_events')
      .select('token_address,block_time,platform')
      .eq('kind', 'token_create').in('token_address', batch);
    if (error) throw new Error('wss_events 查询失败: ' + error.message);
    for (const r of data || []) out[r.token_address] = { blockTime: r.block_time, platform: r.platform };
  }
  for (const t of pool.tokens) {
    if (!out[t.address]) missing.push(`${t.symbol} ${t.address}`);
    else out[t.address].symbol = t.symbol;
  }
  fs.writeFileSync(path.join(__dirname, '../../data/kol-study/token-create.json'), JSON.stringify(out, null, 1));
  console.log(`ok=${Object.keys(out).length}/${addrs.length} missing=${missing.length}`);
  if (missing.length) console.log('missing:\n' + missing.join('\n'));
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
