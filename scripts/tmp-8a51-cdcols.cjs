// 查 cheat_detection 列名 + 0x6a4f 实际信号行(是否手工买)
const { dbManager } = require('../src/services/dbManager');
const SRC = '8a51f2fd-e467-4459-9004-18b9486ab567';
const TOKS = ['0x7e4468d4cd89b5ca97f504b526c592fd37297777', '0xf5e642bc79bd3dff16bb02794c6854933bb57777', '0x6a4f5e1539d1a8e5eb2b1b74772e2b6ee66b7777'];
(async () => {
  const c = dbManager.getClient();
  const { data: one } = await c.from('cheat_detection').select('*').in('token_address', TOKS).limit(1);
  if (one && one[0]) {
    console.log('cheat_detection cols:', Object.keys(one[0]).join(','));
    const d = one[0].digest ? JSON.parse(one[0].digest) : one[0].digest;
    console.log('digest keys:', d && typeof d === 'object' ? Object.keys(d).join(',') : typeof d);
  } else console.log('cheat_detection 无行');
  const { data: rows } = await c.from('cheat_detection').select('*').in('token_address', TOKS).order('created_at', { ascending: true }).limit(30);
  for (const r of (rows || [])) {
    const d = typeof r.digest === 'string' ? JSON.parse(r.digest) : (r.digest || {});
    const g = d.grade ?? r.grade_info?.grade ?? null;
    console.log(`[cd] ${r.token_address.slice(0, 10)} ${String(r.created_at).slice(11, 19)} kind=${r.kind ?? '-'} grade=${g} reason=${JSON.stringify(d.gradeReasons ?? r.grade_reasons ?? []).slice(0, 100)}`);
  }
  // 0x6a4f 与 0xf5e6 实际 BUY 信号行
  for (const a of [TOKS[2], TOKS[1]]) {
    const { data: sig } = await c.from('strategy_signals').select('signal_type,action,executed,reason,created_at,metadata').eq('experiment_id', SRC).eq('token_address', a).order('created_at').limit(8);
    console.log(`\n[src-signals ${a.slice(0, 10)}] rows=${(sig || []).length}`);
    for (const s of (sig || [])) {
      const md = s.metadata ? JSON.parse(s.metadata) : {};
      console.log(`  ${String(s.created_at).slice(11, 19)} ${s.signal_type} exec=${s.executed} reason=${String(s.reason || '').slice(0, 80)} cheat=${JSON.stringify(md.cheatCheck?.grade ?? md.cheatCheck?.status ?? '-').slice(0, 60)}`);
    }
  }
  process.exit(0);
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
