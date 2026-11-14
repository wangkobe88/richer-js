// 一次性（182 跑）：bt-v100 review 集 v3——270 票每票补全点位定位与数值锚全量：
//   signalId（信号行 id，直达 signals 页）+ atIso（完整 created_at 含日期，v2 只有 HH:MM:SS 跨天无法定位）
//   + price（metadata.price=fire 价）+ anchors（metadata.buyPoint.anchors 数值锚全量，null 保留诚实）
// 输出 /tmp/v100-anchor-info.json 供本地 merge 进 data/v100-review-cases.json。
const fs = require('fs');
const { dbManager } = require('../../src/services/dbManager.js');
const EXP = '11fc182a-b051-4665-857c-5c14e6713334';
const parse = (m) => { try { return typeof m === 'string' ? JSON.parse(m) : (m || {}); } catch { return {}; } };

async function pullAll(c, table, cols) {
  const rows = [];
  let from = 0;
  for (;;) {
    const { data, error } = await c.from(table).select(cols).eq('experiment_id', EXP).order('id').range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...data);
    if (data.length < 1000) break;
    from += 1000;
  }
  return rows;
}

(async () => {
  const c = await dbManager.getClient();
  const sigs = await pullAll(c, 'strategy_signals', 'id,token_address,signal_type,created_at,metadata');
  const firstBy = new Map();
  for (const s of sigs) {
    if (s.signal_type !== 'BUY' || firstBy.has(s.token_address)) continue;
    const m = parse(s.metadata);
    const bp = m.buyPoint || {};
    firstBy.set(s.token_address, {
      signalId: s.id,
      atIso: String(s.created_at),
      priceBnb: m.price != null ? Number(m.price) : null,
      anchors: bp.anchors || null,
    });
  }
  const out = Object.fromEntries(firstBy);
  fs.writeFileSync('/tmp/v100-anchor-info.json', JSON.stringify(out));
  console.log(`tokens=${firstBy.size} → /tmp/v100-anchor-info.json`);
  const sample = [...firstBy.entries()][0];
  console.log('sample:', sample[0].slice(0, 10), JSON.stringify(sample[1]).slice(0, 200));
  process.exit(0);
})().catch((e) => { console.error('FATAL', e && e.stack || e); process.exit(1); });
