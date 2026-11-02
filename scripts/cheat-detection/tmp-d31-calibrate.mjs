#!/usr/bin/env node
// tmp：D3.1 持仓占比锚阈值校准（182 跑，零 Jev 配额——DB 锚值实测 × D3.0 存档 answers 重放）
// 1) 逐 fixture 锚截窗拉 ticks → buildSnapshotFromRows → {sameBlockHoldPct, equalBandHoldPct}
// 2) 与 D3.0 存档 answersRaw 联合：现象臂（A1-A4/B1）走现行 mapper（anchors=null 分解），
//    A5 锚臂在本地网格扫描 (tsb, teq)——A5 与现象臂 OR 独立、B1 仅在无 cheat 臂时生效，分解精确
// 3) 输出：按类锚分布 + 网格命中率 + 逐票锚值表（错票点名）
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { readFileSync, readdirSync } from 'fs';
import { createRequire } from 'module';
import { loadAndValidateFixtures } from './lib.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const require_ = createRequire(import.meta.url);
const { buildSnapshotFromRows } = require_('../../src/market-analysis/cheat-snapshot.js');
const { mapCheatAnswers } = require_('../../src/market-analysis/cheat-result-mapper.js');

const TICK_COLS = 'block_time,block_number,log_index,trade_type,bnb_amount,price_bnb,price_outlier,trader_address,sender_address,quote_token';
function sb() {
  const { dbManager } = require_('../../src/services/dbManager.js');
  return dbManager.getClient();
}
async function pullTicksToAnchor(token, n) {
  const { data, error } = await sb().from('wss_price_ticks').select(TICK_COLS)
    .eq('token_address', token).order('block_number', { ascending: true }).order('log_index', { ascending: true }).limit(n);
  if (error) throw new Error(error.message);
  const rows = data ?? [];
  if (rows.length < n) throw new Error(`锚截窗不足：锚=${n} 实际=${rows.length}`);
  return rows;
}
async function loadTokenMeta(token) {
  const { data, error } = await sb().from('wss_events').select('platform,payload,block_time')
    .eq('kind', 'token_create').eq('token_address', token).order('id', { ascending: true }).limit(5);
  if (error) throw new Error(error.message);
  const hit = (data ?? []).find((r) => r.payload && (r.payload.symbol || r.payload.name || r.payload.creator));
  const p = hit ? hit.payload : {};
  return { address: token, symbol: p.symbol || null, name: p.name || null, platform: hit ? hit.platform : null,
    createdAt: p.blockTimeMs ? new Date(p.blockTimeMs).toISOString() : (hit ? hit.block_time : null), creatorAddress: p.creator || null };
}
const quoteTokenOf = (rows) => { for (let i = rows.length - 1; i >= 0; i--) if (rows[i].quote_token) return rows[i].quote_token; return null; };

// D3.0 存档（最新 cd-run-*）
const files = readdirSync(resolve(HERE, 'data')).filter((f) => f.startsWith('cd-run-') && f.endsWith('.json')).sort();
const archive = JSON.parse(readFileSync(resolve(HERE, 'data', files[files.length - 1]), 'utf8'));
console.log(`存档: ${files[files.length - 1]}  version=${archive.questionVersion}  rows=${archive.results.length}`);
const answersBy = new Map(archive.results.filter((r) => r.answersRaw).map((r) => [r.caseId, r.answersRaw]));

const fxDoc = JSON.parse(readFileSync(resolve(HERE, 'fixtures.json'), 'utf8'));
const { cases, errors } = loadAndValidateFixtures(fxDoc);
if (errors.length) { console.error(errors.join('\n')); process.exit(2); }

const tickets = [];
for (const c of cases) {
  const answers = answersBy.get(c.caseId);
  if (!answers) { console.log(`${c.caseId} 无存档 answers，跳过`); continue; }
  const addr = c.addr.toLowerCase();
  const rows = await pullTicksToAnchor(addr, c.anchor.tickCount);
  const meta = { ...await loadTokenMeta(addr), quoteToken: quoteTokenOf(rows) };
  const snap = buildSnapshotFromRows(rows, meta, { capped: c.anchor.capped === true, anchorTickCount: c.anchor.tickCount });
  const d = snap.derived;
  const phen = mapCheatAnswers(answers, null); // 现象臂分解（A5 不评）
  tickets.push({
    id: c.caseId, symbol: c.symbol, want: c.expect?.verdict,
    sb: d.sameBlockHoldPct, eq: d.equalBandHoldPct,
    phenCheat: phen.verdict === 'cheat', phenArm: phen.ruleAudit.hitArm,
    sdModerate: phen.ruleAudit.levels.sell_dispersion !== 'none' && phen.ruleAudit.levels.sell_dispersion !== 'weak',
    wallets: d.walletCount,
  });
  console.log(`${c.caseId.padEnd(5)} ${String(c.symbol).slice(0, 10).padEnd(10)} ${String(c.expect?.verdict).padEnd(9)} sb=${d.sameBlockHoldPct === null ? 'null' : d.sameBlockHoldPct.toFixed(1)} eq=${d.equalBandHoldPct === null ? 'null' : d.equalBandHoldPct.toFixed(1)} 钱包${d.walletCount} 现象臂=${phen.ruleAudit.hitArm}/${phen.verdict}`);
}

const classes = ['cheat', 'unhealthy', 'healthy'];
const stat = (arr) => {
  const s = arr.filter((v) => v != null).sort((a, b) => a - b);
  if (!s.length) return 'n/a';
  return `med=${s[Math.floor(s.length / 2)].toFixed(1)} q25=${s[Math.floor(s.length * 0.25)].toFixed(1)} q75=${s[Math.min(s.length - 1, Math.floor(s.length * 0.75))].toFixed(1)} min=${s[0].toFixed(1)} max=${s[s.length - 1].toFixed(1)} n=${s.length}`;
};
console.log('\n== 按类锚分布 ==');
for (const key of ['sb', 'eq']) {
  for (const k of classes) {
    console.log(`  ${key} ${k.padEnd(9)} ${stat(tickets.filter((t) => t.want === k).map((t) => t[key]))}`);
  }
}

// 网格：cheat = phenCheat ∨ sb≥tsb ∨ eq≥teq；healthy = ¬cheat ∧ sdModerate；else unhealthy
console.log('\n== 阈值网格（tsb×teq → 总命中 + cheat/unhealthy/healthy）==');
const grid = [];
for (let tsb = 35; tsb <= 75; tsb += 5) {
  for (let teq = 35; teq <= 75; teq += 5) {
    const ok = { cheat: 0, unhealthy: 0, healthy: 0 }, tot = { cheat: 0, unhealthy: 0, healthy: 0 };
    const wrong = [];
    for (const t of tickets) {
      if (!t.want) continue;
      tot[t.want]++;
      const cheat = t.phenCheat || (t.sb !== null && t.sb >= tsb) || (t.eq !== null && t.eq >= teq);
      const got = cheat ? 'cheat' : (t.sdModerate ? 'healthy' : 'unhealthy');
      if (got === t.want) ok[t.want]++; else wrong.push(`${t.id}:${t.want}→${got}`);
    }
    const all = tot.cheat + tot.unhealthy + tot.healthy;
    grid.push({ tsb, teq, score: ok.cheat + ok.unhealthy + ok.healthy, ok, tot, wrong });
  }
}
grid.sort((a, b) => b.score - a.score);
for (const g of grid.slice(0, 12)) {
  console.log(`  tsb=${g.tsb} teq=${g.teq}  总 ${g.score}/${g.tot.cheat + g.tot.unhealthy + g.tot.healthy}  cheat ${g.ok.cheat}/${g.tot.cheat} unhealthy ${g.ok.unhealthy}/${g.tot.unhealthy} healthy ${g.ok.healthy}/${g.tot.healthy}`);
  console.log(`    错票: ${g.wrong.join(' ') || '无'}`);
}
const best = grid[0];
console.log(`\n最优: tsb=${best.tsb} teq=${best.teq}`);
// 最优阈值下的逐类错票锚值（诊断：锚臂误伤 vs 漏检）
console.log('\n== 最优阈值下锚相关错票（sb/eq 锚值）==');
for (const w of best.wrong) {
  const t = tickets.find((x) => x.id === w.split(':')[0]);
  console.log(`  ${t.id} ${t.symbol} ${t.want}→${w.split('→')[1]} sb=${t.sb?.toFixed(1) ?? 'null'} eq=${t.eq?.toFixed(1) ?? 'null'} 现象臂=${t.phenArm} 钱包${t.wallets}`);
}
// 纯锚臂视角：只看现象臂没抓到的 cheat（A5 的目标人群）与非 cheat 票的锚重叠
console.log('\n== A5 目标人群（现象臂漏检 cheat）vs 非 cheat 票的锚对比 ==');
for (const t of tickets) {
  if (t.want === 'cheat' && !t.phenCheat) console.log(`  [漏检cheat] ${t.id} sb=${t.sb?.toFixed(1)} eq=${t.eq?.toFixed(1)} 现象臂=${t.phenArm}`);
}
for (const t of tickets) {
  if (t.want !== 'cheat' && ((t.sb ?? 0) >= 45 || (t.eq ?? 0) >= 45)) console.log(`  [高锚非cheat] ${t.id} ${t.want} sb=${t.sb?.toFixed(1)} eq=${t.eq?.toFixed(1)} 现象臂=${t.phenArm} 钱包${t.wallets}`);
}
