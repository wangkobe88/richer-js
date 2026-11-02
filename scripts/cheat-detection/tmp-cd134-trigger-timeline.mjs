#!/usr/bin/env node
// 一次性：五票检测触发点位时间线（cheat_detection 全行 + 首析时刻盘面位置 + signals 买点 gate 轨迹）
import { createRequire } from 'module';
const require_ = createRequire(import.meta.url);
const { dbManager } = require_('../../src/services/dbManager.js');
const sb = dbManager.getClient();

const ADDRS = [
  ['MAI', '0x732bd5190992ecb2365e080c2d3d37880cb17777'],
  ['RAM', '0xec74ec6b297fbe318ff09da24023319a36737777'],
  ['眉眉', '0x5a3f19b5bd587c4a127096ff37f6c9d59f007777'],
  ['에코', '0x43705ac9eb429777f3d993d854a29bcd61837777'],
  ['猴子币', '0xd827bc26713cb6412f4d163766938dee3d0c7777'],
];
const { data: expAll, error: eExp } = await sb.from('experiments')
  .select('id,experiment_name,trading_mode,status,created_at')
  .order('created_at', { ascending: false }).limit(200);
if (eExp) throw new Error(`experiments: ${eExp.message}`);
const expRow = (expAll ?? []).filter((r) => String(r.id).startsWith('e3d00085'));
if (!expRow.length) throw new Error(`实验 e3d00085 未找到（近 ${expAll?.length ?? 0} 行实验）`);
const EXP = expRow[0].id;
console.log(`实验 ${expRow[0].experiment_name}（${expRow[0].trading_mode}/${expRow[0].status}）= ${EXP}`);

for (const [name, addr] of ADDRS) {
  // 1) cheat_detection 全行时间线
  const { data: rows, error: e1 } = await sb.from('cheat_detection')
    .select('*').eq('token_address', addr)
    .order('analyzed_at', { ascending: true }).limit(50);
  if (e1) throw new Error(`cheat_detection: ${e1.message}`);
  // 2) token 创建时间 + 首 tick 时间
  const { data: ev, error: e2 } = await sb.from('wss_events')
    .select('platform,payload,block_time')
    .eq('kind', 'token_create').eq('token_address', addr)
    .order('id', { ascending: true }).limit(1);
  if (e2) throw new Error(`wss_events: ${e2.message}`);
  const created = ev && ev[0] ? ev[0].block_time : null;
  const { data: tk, error: e3 } = await sb.from('wss_price_ticks')
    .select('block_time').eq('token_address', addr)
    .order('block_number', { ascending: true }).order('log_index', { ascending: true })
    .limit(1);
  if (e3) throw new Error(`ticks: ${e3.message}`);
  const firstTick = tk && tk[0] ? tk[0].block_time : null;

  console.log(`\n== ${name} ${addr.slice(0, 8)}… 共 ${rows.length} 行 | 创建=${created} 首tick=${firstTick} ==`);
  if (name === 'MAI' && rows[0]) console.log(`  [列形状] ${Object.keys(rows[0]).join(',')}`);
  for (const r of rows) {
    const d = r.snapshot_digest || {};
    const g = d.grade ? `${d.grade}[${(d.gradeReasons || []).map((x) => x.code).join(',') || 'clean'}]` : '(无grade)';
    const t0 = firstTick ? (new Date(r.analyzed_at) - new Date(firstTick)) / 1000 : null;
    console.log(`  ${r.analyzed_at.slice(11, 19)} 锚=${String(r.anchor_tick_count).padEnd(5)} ${g} ${t0 === null ? '' : `距首tick ${Math.round(t0 / 60)}min`} ${r.verdict}`);
  }
  // 3) 该票在本实验的 signals（cheatCheck 轨迹）
  const { data: sig, error: e4 } = await sb.from('strategy_signals')
    .select('signal_type,action,created_at,metadata')
    .eq('experiment_id', EXP).eq('token_address', addr)
    .order('created_at', { ascending: true }).limit(20);
  if (e4) throw new Error(`signals: ${e4.message}`);
  for (const s of sig) {
    const cc = s.metadata && s.metadata.cheatCheck ? s.metadata.cheatCheck : null;
    if (cc) console.log(`  [signal ${s.created_at.slice(11, 19)} ${s.signal_type}/${s.action}] cheatCheck=${JSON.stringify(cc).slice(0, 220)}`);
  }
  if (!sig.length) console.log('  [signals] 本实验无行');
}
process.exit(0);
