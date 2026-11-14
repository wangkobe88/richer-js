// T135 年龄门锚对照分析（182 跑）：t0/t0a `tokenAgeSec >= 15`（创建锚 createdAtMs）
// vs 「距第一笔交易 >= 15s」（firstTickAt 锚）。数学关系：firstTradeTs >= createTs ⟹
// firstTradeAge <= tokenAgeSec ⟹ 新门更严；差异带 = 创建后冷场 gap 秒才开张、首笔进来
// 15s 内冲到 6/9 笔的票。对 btv110/btv111 set（实验实际成交票）全窗 FA 重放，per (token,leg)
// 双门首触发对照 + 前向收益/episode 盈亏 join。
import { createRequire } from 'module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const require_ = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SETS = process.argv[2] ? process.argv[2].split(',') : ['btv110-trades', 'btv111-trades'];
const SETS_DIR = path.resolve(__dirname, 'sets');
const AGE_RE = /\s*AND\s*tokenAgeSec\s*>=\s*\d+/;

const FourMemeFactorAggregator = require_('../../src/services/FourMemeFactorAggregator.js');
const { ConditionEvaluator } = require_('../../src/strategies/ConditionEvaluator.js');

function rowToTick(row) {
  return {
    token_address: row.token_address,
    trade_type: row.trade_type,
    trader_address: row.trader_address,
    sender_address: row.sender_address || null,
    price_bnb: Number(row.price_bnb),
    bnb_amount: Number(row.bnb_amount || 0),
    token_amount: Number(row.token_amount || 0),
    block_number: row.block_number,
    timestamp: Date.parse(row.block_time),
    tx_hash: row.tx_hash,
    log_index: row.log_index,
    price_outlier: row.price_outlier || false,
    platform: row.platform || null,
  };
}

// ── signals 腿名（signalId → metadata.strategyName；本地小批量查询）──
const { dbManager } = await import('../../src/services/dbManager.js');
const c = await dbManager.getClient();
const legNameBySignal = new Map();
async function fetchLegNames(signalIds) {
  const ids = [...new Set(signalIds.filter(Boolean).map(String))];
  for (let i = 0; i < ids.length; i += 50) {
    const { data, error } = await c.from('strategy_signals').select('id,metadata').in('id', ids.slice(i, i + 50));
    if (error) throw new Error('signals: ' + error.message);
    for (const s of data) legNameBySignal.set(s.id, s.metadata?.strategyName || s.metadata?.signalGate?.legId || null);
  }
}

// ── 库快照：signal-source-ladder-v1 现行版全部腿 ──
const lib = await c.from('strategy_library').select('name,version,legs').eq('name', 'signal-source-ladder-v1').single();
if (lib.error) throw new Error('strategy_library: ' + lib.error.message);
const LIB_VERSION = lib.data.version;
const allLegs = (lib.data.legs.buy || lib.data.legs).map(l => ({ id: `p${l.priority}`, priority: l.priority, condition: l.condition }));
console.log(`[lib] signal-source-ladder-v1 v${LIB_VERSION} legs=${allLegs.length}`);
const ageLegs = allLegs.filter(l => AGE_RE.test(l.condition));
const otherLegs = allLegs.filter(l => !AGE_RE.test(l.condition));
console.log(`[legs] 带年龄门腿=${ageLegs.map(l => `${l.id}:${l.condition.slice(0, 50)}…`).join(' | ')}`);
console.log(`[legs] 其余腿 ${otherLegs.length} 条（新旧门同条件）`);

const ev = new ConditionEvaluator();
const parse = s => ev.parseCondition(s);
const evalAst = (ast, f) => { try { return ev.evaluate(ast, f) === true; } catch { return false; } };
const fget = (f, k) => f.get ? f.get(k) : f[k];

// ── 收集 per-token 重放任务（两 set 去重，取最早 set）──
const jobs = [];
const seenToken = new Map();
for (const setName of SETS) {
  const setPath = path.resolve(SETS_DIR, `${setName}.json`);
  if (!fs.existsSync(setPath)) { console.error(`✗ set 缺失: ${setName}`); process.exit(2); }
  const set = JSON.parse(fs.readFileSync(setPath, 'utf8'));
  const tickDir = path.resolve(SETS_DIR, `${setName}-ticks`);
  const sigIds = [];
  for (const p of set.points || []) if (p.signalId) sigIds.push(p.signalId);
  await fetchLegNames(sigIds);
  for (const [addr, meta] of Object.entries(set.tokens || {})) {
    if (seenToken.has(addr)) continue;
    if (!fs.existsSync(path.resolve(tickDir, `${addr}.json`))) { console.error(`  ✗ ticks 缺失 ${addr}`); continue; }
    seenToken.set(addr, setName);
    jobs.push({ addr, meta, setName, set });
  }
}

const out = [];
let gapGe14 = 0;
const diffTokens = [];

for (const job of jobs) {
  const { addr, meta, setName, set } = job;
  const tf = JSON.parse(fs.readFileSync(path.resolve(SETS_DIR, `${setName}-ticks`, `${addr}.json`), 'utf8'));
  const rowsAsc = tf.rows || [];
  if (!rowsAsc.length) continue;
  const createMs = meta.createdAt ? Date.parse(meta.createdAt) : Date.parse(rowsAsc[0].block_time);
  const firstTradeMs = Date.parse(rowsAsc[0].block_time);
  const gapSec = (firstTradeMs - createMs) / 1000;
  if (gapSec >= 14) gapGe14++;

  const pts = (set.points || []).filter(p => p.tokenAddress === addr);
  const fwd = pts[0]?.forwardReturns?.byHorizon || null;
  const episodePnl = pts.reduce((s, p) => s + (p.trade?.episode?.pnlBnb || 0), 0);
  const execLegs = [...new Set(pts.map(p => legNameBySignal.get(String(p.signalId))).filter(Boolean))];

  const fa = new FourMemeFactorAggregator({}, null);
  fa.registerToken(addr.toLowerCase(), {
    createdAtMs: Number.isFinite(createMs) ? createMs : firstTradeMs,
    totalSupply: meta.totalSupply || 0,
    symbol: meta.symbol || '',
    creatorAddress: meta.creatorAddress || null,
    platform: meta.platform || null,
    graduationThresholdBnb: null,
  });
  const ageLegDefs = ageLegs.map(l => ({ id: l.id, ast: parse(l.condition.replace(AGE_RE, '')), withAge: parse(l.condition) }));
  const otherDefs = otherLegs.map(l => ({ id: l.id, ast: parse(l.condition) }));
  const res = { old: {}, new: {}, core: {} };
  const snap = (legId, variant, ts, i, factors) => {
    if (res[variant][legId]) return;
    res[variant][legId] = {
      hhmmss: new Date(ts).toISOString().slice(11, 19),
      ageSec: +(fget(factors, 'tokenAgeSec') ?? 0).toFixed(1),
      fAge: +((ts - firstTradeMs) / 1000).toFixed(1),
      n: fget(factors, 'tradeCount') ?? null,
      curVs: fget(factors, 'currentVsLaunchPct') ?? null,
      tickIdx: i + 1,
    };
  };

  for (let i = 0; i < rowsAsc.length; i++) {
    const row = rowsAsc[i];
    const ts = Date.parse(row.block_time);
    if (!Number.isFinite(ts)) continue;
    fa.processTick(rowToTick(row), { emitFactors: false });
    const factors = fa.buildFactorMap(addr.toLowerCase(), ts);
    if (!factors) continue;
    const newGate = (ts - firstTradeMs) / 1000 >= 15;
    for (const leg of ageLegDefs) {
      const corePass = evalAst(leg.ast, factors);
      if (corePass && !res.core[leg.id]) res.core[leg.id] = { hhmmss: new Date(ts).toISOString().slice(11, 19), fAge: +((ts - firstTradeMs) / 1000).toFixed(1), n: fget(factors, 'tradeCount') ?? null };
      if (evalAst(leg.withAge, factors)) snap(leg.id, 'old', ts, i, factors);
      if (corePass && newGate) snap(leg.id, 'new', ts, i, factors);
    }
    for (const leg of otherDefs) {
      if (evalAst(leg.ast, factors)) { snap(leg.id, 'old', ts, i, factors); snap(leg.id, 'new', ts, i, factors); }
    }
  }

  const diff = ageLegDefs
    .map(leg => ({ legId: leg.id, old: res.old[leg.id] || null, new: res.new[leg.id] || null }))
    .filter(d => (d.old || d.new) && !(d.old && d.new && d.old.hhmmss === d.new.hhmmss));
  if (diff.length) diffTokens.push(addr);

  const first = o => { let b = null; for (const [k, v] of Object.entries(o)) if (!b || v.hhmmss < b.hhmmss) b = { leg: k, ...v }; return b; };

  out.push({
    token: addr, symbol: meta.symbol || '?', set: setName,
    gapSec: +gapSec.toFixed(1), startBasis: tf.startBasis || null,
    execLegs, episodePnlBnb: +episodePnl.toFixed(4),
    fwd1Max: fwd?.['60']?.maxRisePct ?? null, fwd5Max: fwd?.['300']?.maxRisePct ?? null,
    fwd15Max: fwd?.['900']?.maxRisePct ?? null, fwd15Last: fwd?.['900']?.lastPct ?? null,
    ageLegs: Object.fromEntries(ageLegDefs.map(l => [l.id, { old: res.old[l.id] || null, new: res.new[l.id] || null, coreFirst: res.core[l.id] || null }])),
    diff, ladderFirstOld: first(res.old), ladderFirstNew: first(res.new),
  });
}

fs.writeFileSync('/tmp/t135-firsttrade-gate.json', JSON.stringify(out, null, 1));

console.log(`\n===== 汇总（${SETS.join(', ')}｜per-token 去重 ${out.length} 票）=====`);
console.log(`创建→首笔 gap≥14s（两门有分界空间的票）= ${gapGe14}`);
console.log(`t0/t0a 双门行为有差异 = ${diffTokens.length} 票：${diffTokens.map(a => (out.find(o => o.token === a) || {}).symbol).join(' / ')}`);

console.log('\n----- 差异票明细 -----');
for (const t of out.filter(x => x.diff.length)) {
  console.log(`\n◆ ${t.symbol} ${t.token} [${t.set}] gap=${t.gapSec}s execLeg=${t.execLegs.join('&')||'?'} episodePnl=${t.episodePnlBnb}`);
  for (const d of t.diff) {
    if (d.old && d.new) console.log(`  [${d.legId}] 推迟 ${Math.round((Date.parse('1970-01-01T'+d.new.hhmmss+'Z') - Date.parse('1970-01-01T'+d.old.hhmmss+'Z'))/1000)}s: ${d.old.hhmmss}(age=${d.old.ageSec},fAge=${d.old.fAge},n=${d.old.n}) → ${d.new.hhmmss}(fAge=${d.new.fAge},n=${d.new.n},curVs=${d.new.curVs})`);
    else if (d.old && !d.new) console.log(`  [${d.legId}] ★新门整窗拦住（旧门 ${d.old.hhmmss} age=${d.old.ageSec} fAge=${d.old.fAge} n=${d.old.n} curVs=${d.old.curVs}）`);
  }
  console.log(`    fwd max: +1m ${t.fwd1Max} / +5m ${t.fwd5Max} / +15m ${t.fwd15Max}（last ${t.fwd15Last}）| 整梯首触发 old=${t.ladderFirstOld?.leg ?? '无'}@${t.ladderFirstOld?.hhmmss ?? '-'} → new=${t.ladderFirstNew?.leg ?? '无'}@${t.ladderFirstNew?.hhmmss ?? '-'}`);
}

console.log('\n----- gap 分布（创建→首笔）-----');
const b = { '<1s': 0, '1-5s': 0, '5-15s': 0, '15-60s': 0, '>60s': 0 };
for (const t of out) { const g = t.gapSec; if (g < 1) b['<1s']++; else if (g < 5) b['1-5s']++; else if (g < 15) b['5-15s']++; else if (g < 60) b['15-60s']++; else b['>60s']++; }
console.log(JSON.stringify(b));
console.log('明细 /tmp/t135-firsttrade-gate.json');
process.exit(0);
