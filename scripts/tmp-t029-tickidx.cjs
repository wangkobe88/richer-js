// T029/T030 信号触发点位 ticks 序号标记（182 跑）：每 BUY 信号行 → 触发 tick 序号/价/前向效果
// 口径：触发 tick = ticks 文件（链上真序）中 block_time <= 信号 created_at 的最后一行；
// 前向 = 触发价 vs +60/+300/+900s 窗内可靠价峰/末（不滤=outlier 不进）
const fs = require('fs');
const { dbManager } = require('/home/ubuntu/richer-js/src/services/dbManager.js');

const TOKEN = '0xfba95a4e00883f82f04a459b107bd4788e2c4444';
const TICKS = '/home/ubuntu/richer-js/scripts/buy-point/sets/bp-2026-11-05-v73-trades-ticks/' + TOKEN + '.json';

(async () => {
  const c = await dbManager.getClient();
  const probe = await c.from('strategy_signals')
    .select('id,created_at,signal_type,token_address,metadata')
    .eq('experiment_id', 'c6efed13-ce9d-41b0-89a5-8ca8b029a609')
    .gte('created_at', '2026-11-05T07:50:00Z')
    .lte('created_at', '2026-11-05T09:00:00Z')
    .order('id', { ascending: true })
    .limit(800);
  const sigs = (probe.data || []).filter((r) => r.token_address === TOKEN && r.signal_type === 'BUY');
  console.log('BUY 信号行:', sigs.length);

  const raw = JSON.parse(fs.readFileSync(TICKS, 'utf8'));
  const rows = raw.rows || [];
  const ts = (x) => new Date(x).getTime();
  let base = null;
  for (const r of rows) { if (r.price_bnb && !r.price_outlier) { base = r.price_bnb; break; } }
  console.log('ticks:', rows.length, '首行', rows[0].block_time, '末行', rows[rows.length - 1].block_time, '首可靠价', base);

  for (const s of sigs) {
    const m = s.metadata || {};
    const sc = ts(s.created_at);
    let idx = -1;
    for (let i = 0; i < rows.length; i++) { if (ts(rows[i].block_time) <= sc) idx = i; }
    if (idx < 0) { console.log('---', s.created_at, '无前置 tick'); continue; }
    const tick = rows[idx];
    let px = null;
    for (let i = idx; i >= 0; i--) { if (rows[i].price_bnb && !rows[i].price_outlier) { px = rows[i].price_bnb; break; } }
    const fwd = {};
    for (const w of [60, 300, 900]) {
      let mx = null, last = null;
      for (let i = idx + 1; i < rows.length; i++) {
        if (ts(rows[i].block_time) > sc + w * 1000) continue;
        const p = rows[i].price_bnb && !rows[i].price_outlier ? rows[i].price_bnb : null;
        if (p === null) continue;
        if (mx === null || p > mx) mx = p;
        last = p;
      }
      fwd[w] = { mx, last };
    }
    const pct = (p) => (p === null || !px) ? 'n/a' : ((p / px - 1) * 100).toFixed(1) + '%';
    const sg = m.signalGate || {};
    console.log('---', s.created_at, 'leg=' + JSON.stringify(sg.legId || sg.legName || null),
      'triggerNo=' + (sg.triggerNo ?? null),
      'exec=' + (m.execution_status || '') + (m.execution_reason ? '/' + m.execution_reason : ''));
    console.log('   tick#' + (idx + 1) + '/' + rows.length, tick.block_time, tick.trade_type, 'px=' + px,
      'vs首笔=' + (px && base ? ((px / base - 1) * 100).toFixed(1) + '%' : '?'));
    console.log('   +60s 峰' + pct(fwd[60].mx) + ' 末' + pct(fwd[60].last),
      '| +300s 峰' + pct(fwd[300].mx) + ' 末' + pct(fwd[300].last),
      '| +900s 峰' + pct(fwd[900].mx) + ' 末' + pct(fwd[900].last));
  }
  process.exit(0);
})().catch((e) => { console.error(e.message); process.exit(1); });
