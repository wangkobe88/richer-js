// CD133 现场票现况：v67 cheat_detection 全行 + symbol 标注 + 末行 G11 重放
const path = require('path');
const { dbManager } = require(path.join(__dirname, '../src/services/dbManager'));
const { gradeObservation } = require(path.join(__dirname, '../src/market-analysis/cheat-grade.js'));

async function fetchAll(client) {
  const all = [];
  let from = 0;
  while (true) {
    const res = await client.from('cheat_detection')
      .select('token_address, analyzed_at, verdict, snapshot_digest')
      .eq('source_experiment_id', 'e3d00085-b796-4973-91fc-05013c438488')
      .order('analyzed_at', { ascending: true })
      .range(from, from + 199);
    if (res.error) throw new Error(res.error.message);
    all.push(...(res.data || []));
    if (!res.data || res.data.length < 200) break;
    from += 200;
  }
  return all;
}

async function main() {
  const client = dbManager.getClient();
  const rows = await fetchAll(client);
  const byToken = new Map();
  for (const r of rows) {
    if (!byToken.has(r.token_address)) byToken.set(r.token_address, []);
    byToken.get(r.token_address).push(r);
  }
  // symbol 批量（wss_events token_create payload 拿 name/symbol）
  const addrs = [...byToken.keys()];
  const nameMap = new Map();
  for (let i = 0; i < addrs.length; i += 50) {
    const batch = addrs.slice(i, i + 50);
    const res = await client.from('wss_events')
      .select('token_address, payload')
      .eq('kind', 'token_create')
      .in('token_address', batch)
      .limit(50);
    if (!res.error && res.data) for (const ev of res.data) {
      const p = ev.payload || {};
      nameMap.set(ev.token_address, p.symbol || p.name || '?');
    }
  }
  console.log('总行数', rows.length, 'token 数', byToken.size);
  const out = [];
  for (const [tok, rs] of byToken) {
    const first = rs[0], last = rs[rs.length - 1];
    const fDig = first.snapshot_digest || {}, lDig = last.snapshot_digest || {};
    let replay = '—', rreason = '';
    if (lDig.phenomena && lDig.anchors) {
      const obs = { phenomena: lDig.phenomena, extLevels: lDig.extLevels, activityLevel: lDig.activityLevel, bundledDominance: lDig.bundledDominance, anchors: lDig.anchors };
      const extras = {
        famousLevel: lDig.famous ? lDig.famous.level : null,
        famousFollowerTop3Pct: lDig.famous ? lDig.famous.followerTop3Pct : null,
        famousGroupBuyPct: null, anchorSellCount: lDig.anchorSellCount ?? null,
      };
      const g = gradeObservation(obs, extras);
      replay = g.grade;
      rreason = (g.reasons || []).map(x => x.code).join('|') || '（零留痕放行）';
    }
    out.push({ tok, sym: nameMap.get(tok) || '?', n: rs.length,
      firstAt: first.analyzed_at.slice(11, 19), firstGrade: fDig.grade || first.verdict,
      lastAt: last.analyzed_at.slice(11, 19), lastGrade: lDig.grade || last.verdict, lastVer: lDig.gradeVersion,
      replay, rreason,
      lv: (lDig.activityLevel || {}).bucket, dom: (lDig.bundledDominance || {}).bucket });
  }
  out.sort((a, b) => (b.replay === 'cheat') - (a.replay === 'cheat') || (b.replay === 'unhealthy') - (a.replay === 'unhealthy') || a.lastAt.localeCompare(b.lastAt));
  for (const o of out) {
    console.log(`${o.sym.padEnd(18)} ${o.tok.slice(0, 10)}…${o.tok.slice(-4)} 行${String(o.n).padStart(2)} | 生产轨迹 ${o.firstGrade}@${o.firstAt.slice(0,5)} → 末行 ${o.lastGrade}@${o.lastVer} ${o.lastAt} | G11 重放 ${o.replay.padEnd(9)} [${o.rreason}] | act=${o.lv} dom=${o.dom}`);
  }
  process.exit(0);
}
main().catch(e => { console.error('ERR', e.message); process.exit(1); });
