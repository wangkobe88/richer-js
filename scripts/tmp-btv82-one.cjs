// 一次性：bt-v82 单票门链详情——用法 node scripts/tmp-btv82-one.cjs <token地址>
const { dbManager } = require('../src/services/dbManager.js');
const V82 = 'd8d3f246-6767-4192-804c-3dabdeb15baa';
const V81 = 'a5b43ad1-78b0-450e-bd9d-3dde74fbf713';
const TOK = process.argv[2];
if (!TOK) { console.error('用法: node scripts/tmp-btv82-one.cjs <token>'); process.exit(1); }
const parse = (m) => { try { return typeof m === 'string' ? JSON.parse(m) : (m || {}); } catch { return {}; } };

(async () => {
  const c = await dbManager.getClient();
  for (const [exp, tag] of [[V82, 'v82'], [V81, 'v81']]) {
    const { data, error } = await c.from('strategy_signals')
      .select('id,created_at,metadata,signal_type')
      .eq('experiment_id', exp).eq('token_address', TOK).eq('signal_type', 'BUY').order('id');
    if (error) throw error;
    console.log(`\n===== ${tag} ${TOK} BUY 信号 ${data.length} 条 =====`);
    for (const s of data) {
      const m = parse(s.metadata);
      const cc = m.cheatCheck || {}, bp = m.buyPoint || {};
      const a = bp.assessment || {};
      console.log(`@${s.created_at} [${s.strategy_name || m.strategyName || '?'}] exec=${m.execution_status}`);
      console.log(`  cheat: status=${cc.status || '-'} grade=${cc.grade || '-'}${cc.exempt ? ` 豁免{code:${cc.exempt.code}, originalGrade:${cc.exempt.originalGrade}}` : ''}${cc.exemptDenied ? ` denied:${cc.exemptDenied}` : ''} cached=${cc.cached} anchorTickCount=${cc.anchorTickCount ?? bp.anchorTickCount ?? '-'}`);
      if (cc.reasons) console.log(`  cheatReasons: ${JSON.stringify(cc.reasons)}`);
      if (cc.levels) console.log(`  levels: ${JSON.stringify(cc.levels)}`);
      if (cc.buckets) console.log(`  buckets: ${JSON.stringify(cc.buckets)}`);
      if (bp && Object.keys(bp).length) {
        console.log(`  BP: status=${bp.status || '-'} bucket=${a.bucket || '-'} prob=${a.prob ?? '-'} rule=${a.rule || '-'} anchorTickCount=${bp.anchorTickCount ?? '-'}`);
        if (bp.dimensions) for (const [k, v] of Object.entries(bp.dimensions)) {
          if (v && v.bucket != null) console.log(`    ${k}: ${v.bucket}(${v.prob ?? '-'})${v.exempt ? ' {豁免:' + v.exempt.code + '}' : ''}`);
        }
        if (bp.reasons) console.log(`  BPreasons: ${JSON.stringify(bp.reasons)}`);
      } else console.log('  BP: 无段（cheat 拒/超时在先）');
    }
  }
  process.exit(0);
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
