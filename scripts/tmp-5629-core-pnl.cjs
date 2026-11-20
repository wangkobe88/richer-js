#!/usr/bin/env node
// 0x5629 团队·第三步v2：核心机器钱包全史净额（单钱包 eq）+ 11月活跃明细（block_time 界）
const { dbManager } = require('../src/services/dbManager');

const CORE = [ // 按票数排序的核心机器钱包
  '0xa8662c60c79e467d1c8e3a24327a27061f09a6e6', // 3766 票
  '0x06f0a63c7f3df29d855c84c6cbfc55f35abc1cfc', // 1585
  '0x3dcfdeafd1b8bbf6fc9c53acf9206a9931c4663f', // 805
  '0x94e32d1449ad9fd36afc83e6c3f1c826f8aac1b8', // 768
  '0x2887f7722b56a454a3b8243351eda6b80892ffdb', // 594
  '0x727864fad9aef9b1049b1a724c66d2f91ecc0bf2', // 593
  '0xd5ac55f2f3e276caac5a2e97900a7b46cd4f434a', // 572
  '0xa6bce800bb299696d1b235316d2249f2036a9a3d', // creator 460
];
const TEAM = JSON.parse(require('fs').readFileSync('/tmp/tmp-5629-team.json', 'utf8'));

async function walletHistory(sb, w) {
  const want = 'id,token_address,block_time,trade_type,bnb_amount';
  const rows = []; let cursor = 0;
  for (;;) {
    const { data, error } = await sb.from('wss_price_ticks').select(want).eq('sender_address', w).gt('id', cursor).limit(1000);
    if (error) throw error;
    if (!data.length) break;
    rows.push(...data);
    for (const r of data) if (r.id > cursor) cursor = r.id;
    if (data.length < 1000) break;
  }
  return rows;
}

async function main() {
  const sb = dbManager.getClient();
  console.log('=== 核心钱包全史净额（sender 口径）===');
  for (const w of CORE) {
    const t = Date.now();
    let rows;
    try { rows = await walletHistory(sb, w); }
    catch (e) { console.log(`${w} 查询失败: ${e.message}`); continue; }
    let buy = 0, sell = 0, buyN = 0, sellN = 0;
    const tok = new Set();
    for (const r of rows) {
      tok.add(r.token_address);
      const b = +r.bnb_amount || 0;
      if (r.trade_type === 'buy') { buy += b; buyN++; } else { sell += b; sellN++; }
    }
    console.log(`${w} 票=${tok.size} 买${buy.toFixed(1)}B/${buyN}笔 卖${sell.toFixed(1)}B/${sellN}笔 → 净${(sell - buy >= 0 ? '+' : '')}${(sell - buy).toFixed(2)}B  (${((Date.now() - t) / 1000).toFixed(0)}s)`);
  }

  console.log(`\n=== 2026-11-01 后团队活跃（sender eq 逐钱包 + block_time 界）===`);
  for (const w of TEAM) {
    const { data, error } = await sb.from('wss_price_ticks')
      .select('token_address,block_time,trade_type,bnb_amount')
      .eq('sender_address', w).gte('block_time', '2026-11-01').order('block_time').limit(200);
    if (error) { console.log(`${w.slice(0, 12)} 失败 ${error.message}`); continue; }
    if (!data.length) continue;
    const toks = [...new Set(data.map(r => r.token_address))];
    console.log(`${w.slice(0, 12)}… ${data.length}行 ${toks.length}票 ${data[0].block_time.slice(0, 16)}→${data[data.length - 1].block_time.slice(0, 16)}`);
    toks.slice(0, 5).forEach(t => console.log(`   ${t}`));
  }
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
