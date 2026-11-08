// 一次性：bt-v82 vs bt-v81 漏斗对比——到底哪里拦住的
// 182 跑。用法：node scripts/tmp-btv82-funnel.cjs
const { dbManager } = require('../src/services/dbManager.js');

const EXPS = [
  ['a5b43ad1-78b0-450e-bd9d-3dde74fbf713', 'v81'],
  ['d8d3f246-6767-4192-804c-3dabdeb15baa', 'v82'],
];
const parse = (m) => { try { return typeof m === 'string' ? JSON.parse(m) : (m || {}); } catch { return {}; } };
const short = (a) => (a ? a.slice(0, 8) + '…' : '-');

(async () => {
  const c = await dbManager.getClient();
  for (const [exp, tag] of EXPS) {
    const e = await c.from('experiments').select('status').eq('id', exp).single();
    let sigs = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await c.from('strategy_signals')
        .select('id,token_address,created_at,metadata,signal_type')
        .eq('experiment_id', exp).order('id').range(from, from + 999);
      if (error) throw error;
      sigs.push(...data);
      if (data.length < 1000) break;
    }
    let tRows = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await c.from('trades')
        .select('*').eq('experiment_id', exp).order('id').range(from, from + 999);
      if (error) throw error;
      tRows.push(...data);
      if (data.length < 1000) break;
    }
    const buys = tRows.filter(x => x.trade_direction === 'buy');
    const toks = new Set(buys.map(x => x.token_address));
    console.log(`\n===== ${tag} status=${e.data.status} signals=${sigs.length} trades=${tRows.length} buyTrades=${buys.length} buyTokens=${toks.size} =====`);

    // 门链漏斗（BUY 信号）
    const buysOnly = sigs.filter(s => s.signal_type === 'BUY');
    let noGate = 0, cheatRej = {}, cheatPass = 0, bpRej = {}, bpPass = 0, otherFail = {}, execCnt = 0;
    const executedToks = [];
    for (const s of buysOnly) {
      const m = parse(s.metadata);
      const st = m.execution_status || '?';
      if (st === 'executed') execCnt++;
      const cc = m.cheatCheck, bp = m.buyPoint;
      if (!cc) { noGate++; continue; }
      if (cc.grade === 'cheat' || (cc.grade === 'unhealthy' && !cc.exempt)) {
        const k = cc.grade + (cc.exemptDenied ? '[denied:' + cc.exemptDenied + ']' : '');
        cheatRej[k] = (cheatRej[k] || 0) + 1; continue;
      }
      cheatPass++;
      if (!bp) { otherFail['cheat过→无BP段(st=' + st + ')'] = (otherFail['cheat过→无BP段(st=' + st + ')'] || 0) + 1; continue; }
      const a = bp.assessment || {};
      const b = a.bucket || bp.status || '?';
      if (b === 'good' || b === 'neutral') bpPass++;
      else {
        const pat = bp.dimensions && bp.dimensions.market_pattern ? bp.dimensions.market_pattern.bucket : '';
        const k = b + (a.rule ? '(' + a.rule + (pat ? '/' + pat : '') + ')' : '') + '(st=' + st + ')';
        bpRej[k] = (bpRej[k] || 0) + 1;
      }
    }
    console.log(`BUY 信号: ${buysOnly.length} | 无cheat段: ${noGate} | cheat拒: ${JSON.stringify(cheatRej)}`);
    console.log(`cheat过: ${cheatPass} | BP过(买得资格): ${bpPass} | exec=${execCnt} | BP拒: ${JSON.stringify(bpRej)} | 其它: ${JSON.stringify(otherFail)}`);

    // 成交票 episode
    const perTok = new Map();
    for (const t of tRows) {
      if (!perTok.has(t.token_address)) perTok.set(t.token_address, []);
      perTok.get(t.token_address).push(t);
    }
    let totPnl = 0, winCnt = 0;
    const eps = [];
    for (const [tok, list] of perTok) {
      let buyBnb = 0, sellBnb = 0, nb = 0, ns = 0;
      for (const t of list) {
        if (t.trade_direction === 'buy') { buyBnb += Number(t.input_amount || 0); nb++; }
        else { sellBnb += Number(t.output_amount || 0); ns++; }
      }
      const pnl = Number((sellBnb - buyBnb).toFixed(4));
      eps.push({ tok, nb, ns, buyBnb, sellBnb, pnl });
      totPnl += pnl; if (pnl > 0) winCnt++;
    }
    eps.sort((a, b) => b.pnl - a.pnl);
    for (const e2 of eps) console.log(`  ${short(e2.tok)} 买${e2.nb}/${e2.buyBnb.toFixed(3)} 卖${e2.ns}/${e2.sellBnb.toFixed(3)} → PnL ${e2.pnl >= 0 ? '+' : ''}${e2.pnl}`);
    console.log(`合计 PnL: ${totPnl.toFixed(4)} BNB | 盈利票 ${winCnt}/${eps.length}`);
  }
  process.exit(0);
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
