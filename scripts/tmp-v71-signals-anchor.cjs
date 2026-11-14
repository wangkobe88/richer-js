// 一次性：v71 936e1bd9 全部 BUY 信号票 + 生产 cheat_detection 首判锚清单（182 跑）
const { dbManager } = require('../src/services/dbManager.js');
const EXP = '936e1bd9-630a-4f91-bb52-3f4afb1a27f4';

async function main() {
  const c = await dbManager.getClient();
  const { data, error } = await c.from('strategy_signals')
    .select('token_address,token_symbol,created_at,action,executed')
    .eq('experiment_id', EXP)
    .eq('signal_type', 'BUY')
    .order('created_at', { ascending: true })
    .limit(500);
  if (error) throw new Error(error.message);
  const seen = new Map();
  for (const r of data) {
    if (!seen.has(r.token_address)) seen.set(r.token_address, { symbol: r.token_symbol, first: r.created_at || '(null)', n: 0, exec: 0 });
    const s = seen.get(r.token_address); s.n++; if (r.executed) s.exec++;
  }
  console.log(`总 BUY 信号行 ${data.length} / 去重 ${seen.size} 票`);
  console.log('addr,symbol,首信号,信号数,执行数,首判锚,首判qv,首判grade,首判时间,已收录case');
  // 本地 fixtures 对照由输出侧处理；此处打全清单
  for (const [addr, s] of seen) {
    let anchor = '-', qv = '-', grade = '-', at = '-', pf = '?';
    try {
      const { data: cd } = await c.from('cheat_detection')
        .select('anchor_tick_count,question_version,analyzed_at,snapshot_digest,platform')
        .eq('token_address', addr).order('analyzed_at', { ascending: true }).limit(1);
      if (cd && cd[0]) {
        anchor = cd[0].anchor_tick_count;
        qv = cd[0].question_version;
        at = (cd[0].analyzed_at || '').replace('T', ' ').slice(5, 19);
        pf = cd[0].platform || '?';
        const dig = cd[0].snapshot_digest;
        grade = dig && dig.grade != null ? dig.grade : '(无行)';
      }
    } catch (e) { grade = 'ERR'; }
    console.log([pf, addr, s.symbol, String(s.first).replace('T', ' ').slice(5, 19), s.n, s.exec, anchor, qv, grade, at].join(','));
  }
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
