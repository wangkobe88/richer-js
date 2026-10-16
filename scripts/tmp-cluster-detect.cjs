// 纯自研捆绑检测模拟：同 block 首买簇（不依赖 GMGN 标签）
const { dbManager } = require('/Users/nobody1/Desktop/Codes/richer-js/src/services/dbManager');
const TOKEN = '0xdae1cb514a8a7c7d538b95147f59aecf5a147777';
const FIRE_AT = Date.parse('2026-10-16T00:45:08.678+00:00');

(async () => {
  const { data: ticks, error } = await dbManager.getClient()
    .from('wss_price_ticks')
    .select('block_number, log_index, block_time, trade_type, trader_address, sender_address, token_amount, bnb_amount')
    .eq('token_address', TOKEN)
    .order('block_number').order('log_index').limit(1000);
  if (error) { console.error('ERR', error); process.exit(1); }

  const seen = new Set();           // 已买过该 token 的钱包
  const byBlock = new Map();        // block → 首买行[]
  for (const t of ticks) {
    const w = String(t.sender_address || t.trader_address).toLowerCase();
    if (t.trade_type !== 'buy') continue;
    if (seen.has(w)) continue;
    seen.add(w);
    if (!byBlock.has(t.block_number)) byBlock.set(t.block_number, []);
    byBlock.get(t.block_number).push({ ...t, w });
  }

  console.log('=== 检测算法：同 block 首买簇（size>=3）===');
  console.log('block        簇大小  金额(BNB) min~max       等额?  li差分          合计BNB  fire可见');
  for (const [blk, rows] of [...byBlock].sort((a, b) => a[0] - b[0])) {
    if (rows.length < 3) continue;
    const amts = rows.map(r => Number(r.bnb_amount));
    const min = Math.min(...amts), max = Math.max(...amts);
    const equalish = max / min < 1.05;                    // 等额指纹（±5%）
    const lis = rows.map(r => r.log_index);
    const diffs = lis.slice(1).map((v, i) => v - lis[i]);
    const evenGap = Math.max(...diffs) - Math.min(...diffs) <= 2; // 等间隔指纹
    const visAtFire = Date.parse(rows[0].block_time) <= FIRE_AT;
    console.log(String(blk).padEnd(12), String(rows.length).padEnd(6),
      min.toFixed(4) + ' ~ ' + max.toFixed(4), (equalish ? 'YES' : 'no ').padEnd(6),
      ('[' + diffs.join(',') + ']').padEnd(16),
      amts.reduce((s, v) => s + v, 0).toFixed(4).padEnd(7),
      visAtFire ? '✅可见' : '✗(fire后)');
    for (const r of rows) console.log('    ', 'li=' + String(r.log_index).padStart(3), r.w);
  }

  // fire 时刻视角的完整检测输出（模拟引擎在 fire 点能看到的）
  console.log('\n=== fire 时刻（00:45:08.678）检测器输出 ===');
  const seenF = new Set(); const byBlockF = new Map();
  for (const t of ticks) {
    if (Date.parse(t.block_time) > FIRE_AT) break;
    const w = String(t.sender_address || t.trader_address).toLowerCase();
    if (t.trade_type !== 'buy' || seenF.has(w)) continue;
    seenF.add(w);
    if (!byBlockF.has(t.block_number)) byBlockF.set(t.block_number, []);
    byBlockF.get(t.block_number).push({ ...t, w });
  }
  let firedTotalBnb = 0;
  for (const t of ticks) if (Date.parse(t.block_time) <= FIRE_AT && t.trade_type === 'buy') firedTotalBnb += Number(t.bnb_amount);
  for (const [blk, rows] of [...byBlockF].sort((a, b) => a[0] - b[0])) {
    if (rows.length < 3) continue;
    const amts = rows.map(r => Number(r.bnb_amount));
    const clusterBnb = amts.reduce((s, v) => s + v, 0);
    console.log('block', blk, '簇', rows.length, '钱包 合计', clusterBnb.toFixed(4),
      'BNB = 窗内总买入的', (clusterBnb / firedTotalBnb * 100).toFixed(1) + '%');
  }
  process.exit(0);
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
