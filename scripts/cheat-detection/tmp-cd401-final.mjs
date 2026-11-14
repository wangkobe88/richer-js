#!/usr/bin/env node
// CD401 最终查证 v4（182 跑）：对拍命中 14 张纯增量票，按 token 拉该实验全部
// BUY 信号轨迹（signalId 断链 → token 级近似），确认成交信号的豁免通道与 sbw
// → 方案 A（sbw 资格）/ 方案 B（全通道）净账。成交信号不可精确对齐的近似判据：
// 该 token 轨迹中最后一条 cheatCheck 有值的信号（cheat 门每信号都写 metadata）。
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { dbManager } = require('../../src/services/dbManager.js');

// [基底, 实验, pid, sym, addr, pct, sellBnb, pnl]
const HITS = [
  ['btv109', '029bd863-55e5-4319-91d5-10803a6a9a82', 'T019', 'Q币安', '0x9b1fb6a6', 89.4, 1.0643, -0.007286],
  ['btv109', '029bd863-55e5-4319-91d5-10803a6a9a82', 'T027', '比格多栋', '0x5fdb4835', 60.7, 0.7634, 0.029817],
  ['btv109', '029bd863-55e5-4319-91d5-10803a6a9a82', 'T039', '蝴蝶人生2.0', '0x088fdf75', 84.7, 1.9372, -0.000235],
  ['btv109', '029bd863-55e5-4319-91d5-10803a6a9a82', 'T045', '魔渊', '0x92953636', 53.4, 0.3508, -0.006063],
  ['btv109', '029bd863-55e5-4319-91d5-10803a6a9a82', 'T081', 'Callcat大写', '0x77a835b4', 49.3, 21.6847, -0.036724],
  ['btv109', '029bd863-55e5-4319-91d5-10803a6a9a82', 'T082', 'callcat小写', '0x7c373f45', 30.5, 0.3848, -0.011791],
  ['btv104', '18db4a3e-b25d-44f3-9fc6-32d3c2f2857b', 'T035', '我靠', '0xcbfe6b2b', 39.6, 0.3085, 0],
  ['btv104', '18db4a3e-b25d-44f3-9fc6-32d3c2f2857b', 'T045', 'MBF', '0xa29fefb9', 34.7, 0.3321, -0.0089],
  ['btv104', '18db4a3e-b25d-44f3-9fc6-32d3c2f2857b', 'T057', 'SPP', '0xb20a8aab', 50.6, 3.488, 0.079732],
  ['btv103-r2', 'b9e0f341-dbd2-4aca-a027-b22c598733a2', 'T007', '谷歌SI', '0xb714df9f', 98.8, 0.5899, -0.001998],
  ['btv103-r2', 'b9e0f341-dbd2-4aca-a027-b22c598733a2', 'T036', '我靠', '0xcbfe6b2b', 39.6, 0.3085, 0],
  ['btv103-r2', 'b9e0f341-dbd2-4aca-a027-b22c598733a2', 'T046', 'MBF', '0xa29fefb9', 34.7, 0.3321, -0.0089],
  ['btv103-r2', 'b9e0f341-dbd2-4aca-a027-b22c598733a2', 'T058', 'SPP', '0xb20a8aab', 50.6, 3.488, 0.079732],
  ['btv103-r2', 'b9e0f341-dbd2-4aca-a027-b22c598733a2', 'T084', '屎壳郎自拉', '0x2ef6c0e6', 64.1, 1.863, -0.02613],
];
const c = dbManager.getClient();

let sumA = 0, sumB = 0, nA = 0, nB = 0;
for (const [set, exp, pid, sym, addr, pct, sell, pnl] of HITS) {
  let sigs = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await c.from('strategy_signals')
      .select('id,created_at,token_address,metadata').eq('experiment_id', exp)
      .eq('action', 'buy').order('id', { ascending: true }).range(from, from + 999);
    if (error) throw new Error(error.message);
    sigs = sigs.concat((data ?? []).filter((r) => r.token_address?.toLowerCase().startsWith(addr)));
    if (!data || data.length < 1000) break;
  }
  const withCc = sigs.filter((r) => r.metadata?.cheatCheck);
  const last = withCc[withCc.length - 1]?.metadata?.cheatCheck ?? null;
  if (!last) { console.log(`${set} ${pid} ${sym} 无cheatCheck信号`); continue; }
  const exempt = last.exempt?.code ?? null;
  const sbw = last.levels?.stallBurstWave ?? null;
  const grade = last.grade;
  const exemptLive = exempt === 'stall_burst' || (exempt ?? '').startsWith('activity_');
  const effB = exemptLive;                                  // 方案 B：全通道
  const effA = exemptLive && sbw === 1;                     // 方案 A：限 sbw 资格
  if (effB) { sumB += -pnl; nB++; }
  if (effA) { sumA += -pnl; nA++; }
  const tag = effA ? 'A拦' : (effB ? 'B拦(A放)' : '不生效');
  console.log(`${set} ${pid} ${sym} ${addr} grade=${grade} exempt=${exempt} sbw=${sbw} → ${tag} Δpnl=${(-pnl).toFixed(4)}`);
}
console.log(`\n方案A(限sbw=1): 生效 ${nA} 票 净=${sumA.toFixed(4)}`);
console.log(`方案B(全通道): 生效 ${nB} 票 净=${sumB.toFixed(4)}`);
