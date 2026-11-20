// FP16/T181 lifecycle_burst 阈值扫描：4 实验（v154/155/156/157）
// 目标：买信号 factorCheck gates 里 lifecycle_burst 值解析（ath/总额/静默/波买），
// 找「展示腿全过 ∧ 总额<15」的近失群，按阈值 T 扫描翻转面与已实现盈亏。
const { dbManager } = require('../src/services/dbManager');

const EXP_IDS = {
  '8d20f3ba': { window: 'win1012', label: 'bt-v154-fp19' },
  'dddbe79e': { window: 'win1012', label: 'bt-v155-fp20' },
  'b8ae9f2e': { window: 'win1019', label: 'bt-v156-fp20' },
  '2bdf98ab': { window: 'win1019', label: 'bt-v157-t189' },
};

function parseLifecycleValue(value) {
  if (typeof value !== 'string') return null;
  const m = value.match(/ath(-?[\d.]+)%\s*总额(-?[\d.]+)B\s*静默(-?[\d.]+)s\s*波买(-?[\d.]+)B/);
  if (!m) return null;
  const ath = parseFloat(m[1]), total = parseFloat(m[2]), gap = parseFloat(m[3]), waveBuy = parseFloat(m[4]);
  if ([ath, total, gap, waveBuy].some(v => !isFinite(v))) return null;
  return {
    ath, total, gap, waveBuy,
    // 展示腿（除波近锚/深破豁免两腿不可见外）是否全过
    legsShownPass: ath >= 100 && gap >= 30 && waveBuy >= 0.3,
  };
}

async function pullPaged(sb, table, filters, select) {
  const out = [];
  let from = 0;
  for (;;) {
    let q = sb.from(table).select(select).range(from, from + 999);
    for (const f of filters) q = q[f[0]](f[1], f[2]);
    const { data, error } = await q;
    if (error) throw new Error(`${table} p${from}: ${error.message}`);
    out.push(...(data || []));
    if (!data || data.length < 1000) break;
    from += 1000;
    if (from > 60000) throw new Error('页数异常上限');
  }
  return out;
}

async function main() {
  const sb = dbManager.getClient();
  // 解析完整实验 id
  const { data: allExps, error: eErr } = await sb.from('experiments').select('id,experiment_name').limit(500);
  if (eErr) throw eErr;
  const expMap = {};
  for (const e of (allExps || [])) {
    const pfx = e.id.slice(0, 8);
    if (EXP_IDS[pfx]) expMap[e.id] = { ...EXP_IDS[pfx], name: e.experiment_name };
  }
  console.log('实验命中:', Object.entries(expMap).map(([k, v]) => `${k.slice(0, 8)}=${v.label}`).join(' | '));

  // 每 token episode pnl（BNB 域）+ 执行买信号 id 集
  const results = [];
  for (const [expId, meta] of Object.entries(expMap)) {
    // 信号：BUY + factorCheck 在场
    const sigs = await pullPaged(sb, 'strategy_signals', [
      ['eq', 'experiment_id', expId], ['eq', 'signal_type', 'BUY'],
    ], 'id,created_at,token_address,reason,metadata->factorCheck');
    // 成交
    const trades = await pullPaged(sb, 'trades', [
      ['eq', 'experiment_id', expId],
    ], 'id,signal_id,token_address,trade_direction,input_currency,output_currency,input_amount,output_amount,created_at');

    // token 级 pnl
    const tokenPnl = {}; const tokenBuys = {}; const tokenSells = {};
    for (const t of trades) {
      if (t.trade_direction === 'buy' && t.input_currency === 'BNB') {
        tokenBuys[t.token_address] = (tokenBuys[t.token_address] || 0) + (t.input_amount || 0);
      } else if (t.trade_direction === 'sell' && t.output_currency === 'BNB') {
        tokenSells[t.token_address] = (tokenSells[t.token_address] || 0) + (t.output_amount || 0);
      }
    }
    for (const tok of new Set([...Object.keys(tokenBuys), ...Object.keys(tokenSells)])) {
      tokenPnl[tok] = {
        buys: tokenBuys[tok] || 0,
        sells: tokenSells[tok] || 0,
        pnl: (tokenSells[tok] || 0) - (tokenBuys[tok] || 0),
        open: (tokenBuys[tok] || 0) > 0 && !(tokenSells[tok] > 0),
      };
    }
    // 执行买信号集合
    const executedSignalIds = new Set(trades.filter(t => t.trade_direction === 'buy' && t.signal_id).map(t => t.signal_id));

    // 逐信号解析 lifecycle_burst
    const rows = [];
    let nFc = 0, nHit = 0;
    for (const s of sigs) {
      const fc = s.factorCheck || (s.metadata && s.metadata.factorCheck);
      if (!fc || !Array.isArray(fc.gates)) continue;
      nFc++;
      const g = fc.gates.find(x => x.id === 'lifecycle_burst');
      if (!g) continue;
      const parsed = parseLifecycleValue(g.value);
      const executed = executedSignalIds.has(s.id);
      if (g.hit) nHit++;
      rows.push({
        exp: meta.label, window: meta.window, expId,
        sigId: s.id, token: s.token_address, at: s.created_at, reason: s.reason,
        pass: fc.pass === true, executed, hit: g.hit === true,
        parsed,
      });
    }
    console.log(`\n[${meta.label}] BUY 信号带 factorCheck=${nFc} | lifecycle 命中(现行拦)=${nHit} | 解析成功=${rows.filter(r => r.parsed).length}`);
    results.push({ meta, rows, tokenPnl, executedSignalIds });
  }

  // ═══ 近失群：展示腿全过 ∧ hit=false（含总额≥15 的 near-anchor/豁免票，分开展示）═══
  const nearMiss = [];
  for (const { meta, rows, tokenPnl, executedSignalIds } of results) {
    for (const r of rows) {
      if (!r.parsed || !r.parsed.legsShownPass || r.hit) continue;
      nearMiss.push({ ...r, pnl: tokenPnl[r.token] });
    }
  }
  nearMiss.sort((a, b) => a.parsed.total - b.parsed.total);

  console.log('\n════════ 近失群明细（ath≥100 ∧ 静默≥30 ∧ 波买≥0.3 ∧ hit=false，按总额升序）════════');
  console.log('总额带 | token | 实验 | 信号时刻 | pass | executed | ath | 静默 | 波买 | token_pnl(B) | 未平仓');
  for (const r of nearMiss) {
    const band = r.parsed.total >= 15 ? '≥15(非总额腿失)' : r.parsed.total >= 12 ? '12~15' : r.parsed.total >= 10 ? '10~12' : '<10';
    const p = r.pnl || {};
    console.log(`${band.padEnd(6)} | ${r.token.slice(0, 10)}… | ${r.exp} | ${r.at.slice(11, 19)} | ${r.pass ? '过' : '拒'} | ${r.executed ? '✅买' : ' — '} | ${r.parsed.ath}% | ${r.parsed.gap}s | ${r.parsed.waveBuy}B | ${p.pnl !== undefined ? p.pnl.toFixed(4) : '(未买)'}${p.open ? ' ⚠未平' : ''}`);
  }

  // ═══ 阈值扫描：token 级「全部执行买信号都翻转」= 完全拦下 ═══
  // 每 token 的执行买信号集合（含各自 parsed）
  const byWindow = {};
  for (const { meta, rows, tokenPnl, executedSignalIds } of results) {
    byWindow[meta.window] = byWindow[meta.window] || {};
    for (const r of rows) {
      if (!r.executed || !r.parsed) continue;
      byWindow[meta.window][r.token] = byWindow[meta.window][r.token] || { exps: {}, pnl: tokenPnl[r.token] };
      byWindow[meta.window][r.token].exps[meta.label] = byWindow[meta.window][r.token].exps[meta.label] || [];
      byWindow[meta.window][r.token].exps[meta.label].push(r);
    }
  }

  console.log('\n════════ 阈值扫描（token 全执行信号翻转才计「完全拦下」，pnl 为该 token episode 盈亏）════════');
  const THRESHOLDS = [8, 9, 10, 11, 12, 13, 14];
  for (const win of Object.keys(byWindow)) {
    // 同窗双实验去重：每 token 取较新实验的记录（v155/v157），另票报告不一致
    console.log(`\n── 窗口 ${win} ──`);
    for (const T of THRESHOLDS) {
      let sumPnl = 0, nTok = 0, nPos = 0, nNeg = 0; const names = [];
      for (const [tok, info] of Object.entries(byWindow[win])) {
        const expKeys = Object.keys(info.exps);
        const pick = expKeys.includes('bt-v157-t189') ? 'bt-v157-t189' : expKeys.includes('bt-v156-fp20') ? 'bt-v156-fp20' : expKeys.includes('bt-v155-fp20') ? 'bt-v155-fp20' : expKeys[0];
        const sigs = info.exps[pick];
        const allFlip = sigs.every(s => s.parsed.legsShownPass && !s.hit && s.parsed.total >= T && s.parsed.total < 15);
        if (!allFlip) continue;
        nTok++; const pnl = info.pnl ? info.pnl.pnl : 0;
        sumPnl += pnl;
        if (pnl > 0) nPos++; else nNeg++;
        names.push(`${tok.slice(0, 8)}(${pnl >= 0 ? '+' : ''}${pnl.toFixed(3)})`);
      }
      console.log(`T=${T}: 完全拦下 ${nTok} token | Σpnl=${sumPnl >= 0 ? '+' : ''}${sumPnl.toFixed(4)} B | 正票(误伤)${nPos} 负票(止血)${nNeg} | ${names.join(' ')}`);
    }
  }

  // ═══ 现行 15 已拦群参考 ═══
  console.log('\n════════ 现行 15B 已拦（hit=true）信号数 ════════');
  for (const { meta, rows } of results) {
    const hits = rows.filter(r => r.hit);
    const toks = new Set(hits.map(r => r.token));
    console.log(`${meta.label}: ${hits.length} 信号 / ${toks.size} token`);
  }

  process.exit(0);
}
main().catch(e => { console.error('FATAL', e); process.exit(1); });
