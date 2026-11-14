// 一次性对拍（182 跑）：BP41 真庄反锚判序前置+尾段占比锚——S072 红线恢复验收
// - 三票 b788e63b/d0fbcc7b/4b3f1f7a 仍④ early_sniper_decay+poor·pattern_gate
//   （b788e63b=关键判别票：尾段占比 20% 两成及以下=burst 已过不救）
// - 無為 S072 expect neutral（BP29/BP32 立法保护票红线恢复——贴顶 0%+尾段占比 50%）
// - 無為 S073 expect poor（mid 界外照拒）
// - 保护票 spot-check：SB S006（尾段占比 39%）/突突车 S109（57%）不落④
// - CD 侧（CD380）已验收达成，默认跳过；--cd 才重放
const { dbManager } = require('../../src/services/dbManager.js');
const { CheatCheckService } = require('../../src/market-analysis/CheatCheckService');
const { BuyPointCheckService } = require('../../src/market-analysis/BuyPointCheckService');

const EXP = '1b1f9ee3-0e9a-4fda-82de-121e968be45b'; // bt-v79
const RUN_CD = process.argv.includes('--cd');
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
const SB_S006 = '0x92aac04f03278ce7ac82ba0367dbaf9686437777';
const TTC_S109 = '0x78cd05cf0d0b2a8022fdda8c97baad31f2c07777';
const S072_MS = Date.parse('2026-11-05T08:11:58.211Z');
const S073_MS = Date.parse('2026-11-05T08:12:26.631Z');
const S006_MS = Date.parse('2026-11-05T05:10:05.679Z');
const S109_MS = Date.parse('2026-11-05T08:58:14.068Z');

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
  const allTokens = [...new Set([...SIX, WUWEI, SB_S006, TTC_S109])];
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

  let passN = 0, failN = 0;

  if (RUN_CD) {
    const cheatRows = [];
    for (const addr of SIX) {
      const list = byToken.get(addr) || [];
      for (const s of list) {
        let md = {};
        try { md = typeof s.metadata === 'string' ? JSON.parse(s.metadata) : (s.metadata || {}); } catch { md = {}; }
        const cc = md.cheatCheck;
        if (!cc) continue;
        cheatRows.push({ addr, sig: s, cc, bpOld: md.buyPoint || null });
      }
    }
    console.log('\n===== CD 侧：CD380 三不臂对拍（原判应恢复拒）=====');
    for (const r of cheatRows) {
      const anchorMs = Date.parse(r.sig.created_at);
      const svc = mkCheatSvc();
      const res = await svc.gateBuyPoint(r.addr, metaFor(r.addr), { experimentId: 'cd380-parity', signalId: r.sig.id },
        { awaitMs: 120000, anchorMs });
      const oldExempt = r.cc.exempt || null;
      const origGrade = oldExempt ? oldExempt.originalGrade : r.cc.grade;
      const denied = res && res.exemptDenied ? res.exemptDenied : null;
      let ok;
      if (oldExempt) ok = res.grade === origGrade && !!denied;
      else ok = res.grade === 'cheat' || res.grade === 'unhealthy';
      ok ? passN++ : failN++;
      console.log(`${ok ? '✅' : '❌'} ${short(r.addr)} sig=${r.sig.id.slice(0, 8)} | 旧=${r.cc.grade}${oldExempt ? `(豁免←${origGrade})` : ''} → 新=${res.grade}${denied ? ` denied=${denied}` : ''}`);
    }
  }

  // ───── BP 侧重析（BP41 验收：三票仍④ + S072 红线 + S073 界外 + 两保护票 spot-check）─────
  console.log('\n===== BP 侧：BP41 真庄反锚判序前置+尾段占比锚 =====');
  const bpTargets = [];
  for (const addr of BP3) {
    const list = (byToken.get(addr) || []).filter((s) => {
      let m = {};
      try { m = typeof s.metadata === 'string' ? JSON.parse(s.metadata) : (s.metadata || {}); } catch { m = {}; }
      return m.execution_status === 'executed';
    });
    const pick = list[0] || (byToken.get(addr) || [])[0];
    if (pick) bpTargets.push({ addr, label: short(addr), anchorMs: Date.parse(pick.created_at), expect4: true });
    else console.log(`⚠️ ${short(addr)} 无 BUY 信号行`);
  }
  bpTargets.push({ addr: WUWEI, label: '無為S072', anchorMs: S072_MS, expectBucket: 'neutral' });
  bpTargets.push({ addr: WUWEI, label: '無為S073', anchorMs: S073_MS, expectBucket: 'poor' });
  bpTargets.push({ addr: SB_S006, label: 'SB-S006', anchorMs: S006_MS, expectNot4: true });
  bpTargets.push({ addr: TTC_S109, label: '突突车S109', anchorMs: S109_MS, expectNot4: true });

  for (const t of bpTargets) {
    const svc = mkBpSvc();
    const res = await svc.gateBuyPoint(t.addr, metaFor(t.addr), { experimentId: 'bp41-parity', signalCreatedAt: new Date(t.anchorMs).toISOString() },
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
    if (t.expectBucket) ok = bucket === t.expectBucket;                // S072 红线 / S073 界外
    else if (t.expect4) ok = pattern === 'early_sniper_decay' && bucket === 'poor'; // 三票仍④
    else ok = pattern !== 'early_sniper_decay';                        // 保护票不落④
    ok ? passN++ : failN++;
    console.log(`${ok ? '✅' : '❌'} ${t.label} bucket=${bucket}(${prob}) rule=${rule} pattern=${pattern}`
      + ` | athVsLaunch=${anchors.athVsLaunchPct} maxChg5=${anchors.maxChg5Pct} vsLaunch=${anchors.currentVsLaunchPct ?? anchors.priceLevel}`
      + ` | 尾段占比=${anchors.actNearTail5BuySharePct} 贴顶回落=${anchors.currentVsAthPct === undefined ? '?' : anchors.currentVsAthPct}`);
  }
  console.log(`\n总：${passN} 达成 / ${failN} 未达成`);
  process.exit(failN > 0 ? 1 : 0);
}

main().catch((e) => { console.error('FATAL', e); process.exit(2); });
