// 一次性对拍（182 跑）：CD380 豁免三不臂 + BP40 ④拉得过高单独成立
// - CD 侧：bt-v79（1b1f9ee3）六票被 CD379 豁免放行的 BUY 信号，anchorMs=信号时刻
//   真调 gateBuyPoint（persist:false 隔离），预期三臂在场=豁免失效原判保持（cheat/unhealthy）
//   + exemptDenied 留痕
// - BP 侧：三票 b788e63b/d0fbcc7b/4b3f1f7a 重析（BP40），预期④early_sniper_decay+poor·pattern_gate
// - 红线：無為 S072（neutral 保住）+ S073（mid 界外照拒 poor）
const { dbManager } = require('../../src/services/dbManager.js');
const { CheatCheckService } = require('../../src/market-analysis/CheatCheckService');
const { BuyPointCheckService } = require('../../src/market-analysis/BuyPointCheckService');

const EXP = '1b1f9ee3-0e9a-4fda-82de-121e968be45b'; // bt-v79
const SIX = [
  '0xcb70708ebe85cd4de4735776feef20d9c3654444',
  '0x94ea754b80bbafd776accf85d0df7f92dd73ffff',
  '0xb788e63b15c2dfa508bb9c52b34d287d07f47777',
  '0xd0fbcc7be56f6e8eb1e9be01f456de0093ee7777',
  '0x4b3f1f7a70fbc09b54c4ca209749c5124055ffff',
  '0x06810806709ae1082214624d447669e9014a7777',
];
const BP3 = [
  '0xb788e63b15c2dfa508bb9c52b34d287d07f47777',
  '0xd0fbcc7be56f6e8eb1e9be01f456de0093ee7777',
  '0x4b3f1f7a70fbc09b54c4ca209749c5124055ffff',
];
const WUWEI = '0xb97d5772bf70814161d29243b0e39ec62f734444';
const S072_MS = Date.parse('2026-11-05T08:11:58.211Z');
const S073_MS = Date.parse('2026-11-05T08:12:26.631Z');

const logger = { info() {}, warn() {}, error() {} };
const short = (a) => (a ? a.slice(0, 8) + '…' + a.slice(-4) : '-');

function mkCheatSvc() {
  return new CheatCheckService({
    enabled: true,
    gate: { awaitMs: 120000, activityExemptLevels: ['high', 'ultra'] },
    settleDelayMs: 0,
    memSource: { enabled: false },
    persist: false,
  }, logger, {});
}
function mkBpSvc() {
  return new BuyPointCheckService({
    enabled: true,
    gate: { awaitMs: 120000 },
    settleDelayMs: 0,
    persist: false,
  }, logger, {});
}

async function main() {
  const client = await dbManager.getClient();

  // 1) 六票 BUY 信号（含旧 metadata 作基线；执行态在 metadata.execution_status）
  const { data: sigs, error: e1 } = await client.from('strategy_signals')
    .select('id,token_address,created_at,metadata')
    .eq('experiment_id', EXP)
    .in('token_address', SIX)
    .eq('signal_type', 'BUY')
    .order('created_at');
  if (e1) throw e1;

  // 2) token_create meta（symbol/name/platform/block_time）
  const allTokens = [...new Set([...SIX, WUWEI])];
  const { data: creates, error: e2 } = await client.from('wss_events')
    .select('token_address,payload,block_time')
    .eq('kind', 'token_create')
    .in('token_address', allTokens);
  if (e2) throw e2;
  const createByToken = new Map(creates.map((r) => [r.token_address, r]));

  const metaFor = (addr) => {
    const c = createByToken.get(addr);
    const p = (c && c.payload) || {};
    return {
      address: addr,
      symbol: p.symbol || null,
      name: p.name || null,
      platform: p.platform || (addr.endsWith('7777') || addr.endsWith('ffff') ? 'fourmeme' : null),
      createdAtMs: c ? Date.parse(c.block_time) : null,
    };
  };

  const byToken = new Map();
  for (const s of sigs) {
    if (!byToken.has(s.token_address)) byToken.set(s.token_address, []);
    byToken.get(s.token_address).push(s);
  }

  const cheatRows = [];
  for (const addr of SIX) {
    const list = byToken.get(addr) || [];
    for (const s of list) {
      let md = {};
      try { md = typeof s.metadata === 'string' ? JSON.parse(s.metadata) : (s.metadata || {}); } catch { md = {}; }
      const cc = md.cheatCheck;
      if (!cc) continue; // 无门判定行（门拒前短路等）不重放
      cheatRows.push({ addr, sig: s, cc, bpOld: md.buyPoint || null });
    }
  }
  console.log(`六票 BUY 信号带 cheatCheck 行=${cheatRows.length}（其中豁免放行=${cheatRows.filter((r) => r.cc.exempt).length}）`);

  // ───── CD 侧重放（每信号 fresh 实例防粘滞串扰）─────
  console.log('\n===== CD 侧：CD380 三不臂对拍（原判应恢复拒）=====');
  let passN = 0, failN = 0;
  for (const r of cheatRows) {
    const anchorMs = Date.parse(r.sig.created_at);
    const svc = mkCheatSvc();
    const res = await svc.gateBuyPoint(r.addr, metaFor(r.addr), { experimentId: 'cd380-parity', signalId: r.sig.id },
      { awaitMs: 120000, anchorMs });
    const oldExempt = r.cc.exempt || null;
    const origGrade = oldExempt ? oldExempt.originalGrade : r.cc.grade;
    const newGrade = res && res.grade ? res.grade : (res && res.status) || 'none';
    const denied = res && res.exemptDenied ? res.exemptDenied : null;
    // 判定：豁免票（旧 healthy via exempt）→ 新 grade 须=originalGrade 且 denied 在场；
    //       旧本来就拒的票 → 新照拒（grade∈{cheat,unhealthy}），denied 不要求
    let ok;
    if (oldExempt) {
      ok = res.grade === origGrade && !!denied;
    } else {
      ok = res.grade === 'cheat' || res.grade === 'unhealthy';
    }
    ok ? passN++ : failN++;
    const lv = res && res.levels ? res.levels : {};
    console.log(`${ok ? '✅' : '❌'} ${short(r.addr)} sig=${r.sig.id.slice(0, 8)} @${r.sig.created_at.slice(11, 19)}`
      + ` | 旧=${r.cc.grade}${oldExempt ? `(豁免←${origGrade})` : ''}`
      + ` → 新=${newGrade}${denied ? ` denied=${denied}` : ''}${res && res.exempt ? ` ⚠️仍豁免(${res.exempt.code})` : ''}`
      + ` | pump=${lv.slowGrindPump} wash=${lv.washPair}/${lv.equalAmountSplit}/${lv.coordinatedSellBack} hold=${lv.holdingsBalance} act=${res && res.buckets ? res.buckets.activityLevel : '?'}`
      + `${res && res.cached ? ' [cached]' : ''}`);
  }
  console.log(`CD 侧：${passN} 达成 / ${failN} 未达成`);

  // ───── BP 侧重析（三票 + 無為红线两锚）─────
  console.log('\n===== BP 侧：BP40 ④拉得过高对拍 =====');
  const bpTargets = [];
  for (const addr of BP3) {
    const list = (byToken.get(addr) || []).filter((s) => {
      let m = {};
      try { m = typeof s.metadata === 'string' ? JSON.parse(s.metadata) : (s.metadata || {}); } catch { m = {}; }
      return m.execution_status === 'executed';
    });
    const pick = list[0] || (byToken.get(addr) || [])[0];
    if (pick) bpTargets.push({ addr, label: short(addr), anchorMs: Date.parse(pick.created_at), old: cheatRows.find((r) => r.addr === addr)?.bpOld || null });
    else console.log(`⚠️ ${short(addr)} 无 BUY 信号行`);
  }
  bpTargets.push({ addr: WUWEI, label: '無為S072', anchorMs: S072_MS, old: null, expectBucket: 'neutral' });
  bpTargets.push({ addr: WUWEI, label: '無為S073', anchorMs: S073_MS, old: null, expectBucket: 'poor' });

  for (const t of bpTargets) {
    const svc = mkBpSvc();
    const res = await svc.gateBuyPoint(t.addr, metaFor(t.addr), { experimentId: 'bp40-parity', signalCreatedAt: new Date(t.anchorMs).toISOString() },
      { awaitMs: 120000, anchorMs: t.anchorMs });
    if (!res || res.status !== 'assessed') {
      console.log(`❌ ${t.label} status=${res && res.status}（预期 assessed）`);
      failN++;
      continue;
    }
    const bucket = res.assessment && res.assessment.bucket;
    const rule = res.assessment && res.assessment.rule;
    const prob = res.assessment && res.assessment.prob;
    const pattern = res.dimensions && res.dimensions.market_pattern ? res.dimensions.market_pattern.bucket : null;
    const anchors = res.anchors || {};
    let ok;
    if (t.expectBucket) ok = bucket === t.expectBucket;           // 無氏红线
    else ok = pattern === 'early_sniper_decay' && bucket === 'poor'; // 三票④
    ok ? passN++ : failN++;
    console.log(`${ok ? '✅' : '❌'} ${t.label} bucket=${bucket}(${prob}) rule=${rule} pattern=${pattern}`
      + ` | athVsLaunch=${anchors.athVsLaunchPct} maxChg5=${anchors.maxChg5Pct} currentVsLaunch=${anchors.currentVsLaunchPct ?? anchors.priceLevel}`
      + (t.old && t.old.dimensions && t.old.dimensions.market_pattern ? `（旧 pattern=${t.old.dimensions.market_pattern.bucket}/${t.old.assessment && t.old.assessment.bucket}）` : ''));
  }
  console.log(`\n总：${passN} 达成 / ${failN} 未达成`);
  process.exit(failN > 0 ? 1 : 0);
}

main().catch((e) => { console.error('FATAL', e); process.exit(2); });
