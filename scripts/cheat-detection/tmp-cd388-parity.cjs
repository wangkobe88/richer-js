// 一次性对拍（182 跑）：CD388 ultra 档豁免资格收紧（ultra∧原判 cheat 不豁免）
// - bt-v90（cebf56f5）12 张 activity_ultra 豁免票全部带 cheatCheck 的 BUY 信号，
//   anchorMs=信号时刻真调 gateBuyPoint（persist:false 隔离，fresh 实例防粘滞串扰）
// - 预期：旧 exempt=activity_ultra∧originalGrade=cheat → 新 grade=cheat+denied=ultra_cheat
//         旧 exempt∧originalGrade=unhealthy → 照旧豁免（CD379 原语义）
//         旧 exempt=activity_high（cheat/high 不在收紧域）→ 照旧豁免
// - 已知方差：Jev run-to-run 方差（CD319/M4GA 先例）可能让个别票重放 grade 摆动，
//   与 CD388 无关的摆动留痕不计失败（标 ⚠️）
const { dbManager } = require('../../src/services/dbManager.js');
const { CheatCheckService } = require('../../src/market-analysis/CheatCheckService');

const EXP = 'cebf56f5-7d41-403e-9f9e-b6812a2c7127'; // bt-v90
const TWELVE = [
  '0x45ec048990b80b70448cf352b7064fda47557777',
  '0x68bb8cd436bdc8b178ab886b5a7abed5e6177777',
  '0xc62d2dffb9567746a5c883ede552d231e3967777',
  '0x04323e04c5f48587951c2d974b7f1f007b6e7777',
  '0x75d5286d3ac478334fe098f015624486d7a77777',
  '0xb30f0b8a8270271989e37d6bc00e627a07637777',
  '0x92aac04f03278ce7ac82ba0367dbaf9686437777',
  '0xaf7ee1418a51536b3c6da32fec678bc382197777',
  '0x9f001e6ab28d82c3f4182618d0d72524db937777',
  '0x32f18a98e4fc3b33013f80454faae710a6367777',
  '0xf485ec1d518185e73ca53164ddaa85dcfde77777',
  '0xc84a0ff2e7bab3d32cb6426f07855b70694f7777',
];
const logger = { info() {}, warn() {}, error() {} };
const short = (a) => (a ? a.slice(0, 8) + '…' + a.slice(-4) : '-');

(async () => {
  const client = await dbManager.getClient();
  const { data: sigs, error: e1 } = await client.from('strategy_signals')
    .select('id,token_address,created_at,metadata')
    .eq('experiment_id', EXP)
    .in('token_address', TWELVE)
    .eq('signal_type', 'BUY')
    .order('created_at');
  if (e1) throw e1;
  const { data: creates, error: e2 } = await client.from('wss_events')
    .select('token_address,payload,block_time')
    .eq('kind', 'token_create')
    .in('token_address', TWELVE);
  if (e2) throw e2;
  const createByToken = new Map(creates.map((r) => [r.token_address, r]));
  const metaFor = (addr) => {
    const c = createByToken.get(addr);
    const p = (c && c.payload) || {};
    return { address: addr, symbol: p.symbol || null, name: p.name || null, platform: p.platform || 'fourmeme', createdAtMs: c ? Date.parse(c.block_time) : null };
  };

  const rows = [];
  for (const s of sigs) {
    let md = {};
    try { md = typeof s.metadata === 'string' ? JSON.parse(s.metadata) : (s.metadata || {}); } catch { md = {}; }
    const cc = md.cheatCheck;
    if (!cc) continue;
    rows.push({ addr: s.token_address, sig: s, cc });
  }
  console.log(`12 票 BUY 信号带 cheatCheck 行=${rows.length}（旧豁免=${rows.filter((r) => r.cc.exempt).length}）`);

  let passN = 0, failN = 0, varN = 0;
  for (const r of rows) {
    const svc = new CheatCheckService({
      enabled: true,
      gate: { awaitMs: 120000, activityExemptLevels: ['high', 'ultra'] },
      settleDelayMs: 0, memSource: { enabled: false }, persist: false,
    }, logger, {});
    const res = await svc.gateBuyPoint(r.addr, metaFor(r.addr), { experimentId: 'cd388-parity', signalId: r.sig.id },
      { awaitMs: 120000, anchorMs: Date.parse(r.sig.created_at) });
    const oldEx = r.cc.exempt || null;
    const oldCode = oldEx ? oldEx.code : null;
    const oldOrig = oldEx ? oldEx.originalGrade : null;
    const newGrade = res && res.grade ? res.grade : (res && res.status) || 'none';
    const newEx = res && res.exempt ? res.exempt.code : null;
    const denied = res && res.exemptDenied ? res.exemptDenied : null;
    const act = res && res.buckets ? res.buckets.activityLevel : '?';

    let ok, tag;
    if (oldCode === 'activity_ultra' && oldOrig === 'cheat') {
      // CD388 收紧域：原判 cheat 的 ultra 票翻拒
      if (res.grade === 'cheat' && denied === 'ultra_cheat') { ok = true; tag = '收紧拒'; }
      else if (res.grade === 'cheat' || res.grade === 'unhealthy') { ok = true; tag = '拒(grade方差)'; varN++; } // Jev 摆动致 grade/桶不同→仍拒即达标
      else { ok = false; tag = '未拒'; }
    } else if (oldCode === 'activity_ultra' && oldOrig === 'unhealthy') {
      // CD379 原语义保持：ultra∧unhealthy 照旧豁免
      ok = res.grade === 'healthy' && !!res.exempt; tag = ok ? '豁免保持' : '豁免丢失';
    } else if (oldCode === 'activity_high') {
      // high 桶不在收紧域：照旧豁免
      ok = res.grade === 'healthy' && !!res.exempt; tag = ok ? 'high豁免保持' : 'high豁免丢失';
    } else {
      // 旧本来就拒（failed 信号）：照旧拒
      ok = res.grade === 'cheat' || res.grade === 'unhealthy'; tag = ok ? '照拒' : '翻豁免⚠️';
    }
    ok ? passN++ : failN++;
    console.log(`${ok ? '✅' : '❌'} ${short(r.addr)} @${r.sig.created_at.slice(11, 19)}`
      + ` | 旧=${oldCode ? `${oldCode}←${oldOrig}` : r.cc.grade}`
      + ` → 新=${newGrade}${newEx ? `(豁免:${newEx})` : ''}${denied ? ` denied=${denied}` : ''}`
      + ` act=${act} [${tag}]${res && res.cached ? ' [cached]' : ''}`);
  }
  console.log(`\nCD388 对拍：${passN} 达成 / ${failN} 未达成（grade 方差留痕 ${varN}）`);
  process.exit(failN > 0 ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(2); });
