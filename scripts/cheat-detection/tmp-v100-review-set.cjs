// 一次性（182 跑）：bt-v100（11fc182a）cheat/BP review 测试集 v2——per 代币首个 BUY 点位，
// 在 v1 基础上加核心维度：BP 六维答案（盘形/点位/活跃度/筹码/价格档）+ cheat reasons 通道码。
// 输出一行一 token（| 分隔），本地排批次用。
const { dbManager } = require('../../src/services/dbManager.js');
const EXP = '11fc182a-b051-4665-857c-5c14e6713334';
const short = (a) => (a ? a.slice(0, 6) + '…' + a.slice(-4) : '-');
const parse = (m) => { try { return typeof m === 'string' ? JSON.parse(m) : (m || {}); } catch { return {}; } };

// reasons 码压缩映射（通道:题名 → 短码）
const TOPIC_SHORT = {
  equal_amount_split: 'equal', coordinated_sell_back: 'coordSell', same_block_buy_wave: 'sameBlock',
  slow_grind_pump: 'pump', burst_spike_concentration: 'spike', amount_tiering: 'tier',
  wash_pair: 'wash', creator_front_run: 'frontRun', sell_dispersion: 'disp',
};
const CODE_SHORT = {
  A_strong: 'A强', J_holdings_strong: 'J_hold', R_abnormal_dominant: 'R_abn', M_hyper_activity: 'M_ultra',
  N_no_retail_entry: 'N_noRetail', L_insider_sell: 'L_insider', D_famous_near_band: 'D_famous邻',
  D_famous_dominance: 'D_famous', E_low_activity_weak_burst: 'E_low弱',
};
function compactReasons(reasons) {
  if (!Array.isArray(reasons) || !reasons.length) return '';
  return reasons.map((r) => {
    const raw = String(r.code || '');
    const colon = raw.indexOf(':');
    const chan = colon > 0 ? raw.slice(0, colon) : raw;
    const chanS = CODE_SHORT[chan.replace(/_\d+.*/, '')] || CODE_SHORT[chan] || chan;
    const topics = colon > 0 ? raw.slice(colon + 1).split('+').map((t) => TOPIC_SHORT[t] || t).join('+') : '';
    return topics ? `${chanS}:${topics}` : chanS;
  }).join(' ');
}

async function pullAll(c, table, cols) {
  const rows = [];
  let from = 0;
  for (;;) {
    const { data, error } = await c.from(table).select(cols).eq('experiment_id', EXP).order('id').range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...data);
    if (data.length < 1000) break;
    from += 1000;
  }
  return rows;
}

(async () => {
  const c = await dbManager.getClient();
  const sigs = await pullAll(c, 'strategy_signals', 'id,token_address,token_symbol,signal_type,created_at,metadata');
  const trades = await pullAll(c, 'trades', 'id,token_address,trade_direction,input_amount,output_amount');

  const pnlBy = new Map();
  for (const t of trades) {
    const isBuy = /buy|买入/i.test(t.trade_direction || '');
    const bnb = isBuy ? Number(t.input_amount ?? 0) : Number(t.output_amount ?? 0);
    const e = pnlBy.get(t.token_address) || { buy: 0, sell: 0 };
    if (isBuy) e.buy += bnb; else e.sell += bnb;
    pnlBy.set(t.token_address, e);
  }

  const firstBy = new Map(), statBy = new Map();
  for (const s of sigs) {
    if (s.signal_type !== 'BUY') continue;
    const m = parse(s.metadata);
    const st = statBy.get(s.token_address) || { buys: 0, exec: 0, sym: s.token_symbol };
    st.buys++;
    if (m.execution_status === 'executed') st.exec++;
    statBy.set(s.token_address, st);
    if (!firstBy.has(s.token_address)) {
      const cc = m.cheatCheck || {};
      const bp = m.buyPoint || {}; const a = bp.assessment || {}; const an = bp.anchors || {};
      const d = bp.dimensions || {};
      const dim = (k) => { const o = d[k] || {}; return o.bucket ? `${o.bucket}${o.prob != null ? '(' + Number(o.prob).toFixed(2) + ')' : ''}` : '-'; };
      firstBy.set(s.token_address, {
        at: s.created_at, sym: s.token_symbol || st.sym,
        leg: (m.strategyName || '?').replace('买入策略 ', '').replace('·首买', ''), trig: (m.signalGate || {}).triggerNo,
        cheat: cc.grade ? cc.grade + (cc.exempt ? '(豁免←' + cc.exempt.originalGrade + ',' + cc.exempt.code + ')' : '') : (cc.status || '无段'),
        reasons: compactReasons(cc.reasons),
        pattern: dim('market_pattern'), entry: dim('entry_shape'), act: dim('activity_level'),
        hold: dim('holder_concentration'), plevel: dim('price_level'),
        bp: a.bucket ? a.bucket + '/' + (a.rule || '-') : (bp.status || '无段'),
        curVs: an.currentVsLaunchPct, minVs: an.minVsLaunchPct,
        status: m.execution_status || '?',
      });
    }
  }

  const rows = [...firstBy.entries()].map(([tok, f]) => {
    const st = statBy.get(tok) || { buys: 0, exec: 0 };
    const p = pnlBy.get(tok);
    return { tok, ...f, buys: st.buys, exec: st.exec, pnl: p ? Number((p.sell - p.buy).toFixed(4)) : null };
  }).sort((x, y) => String(x.at).localeCompare(String(y.at)));

  console.log(`# bt-v100 review 测试集 v2：${rows.length} 代币（BUY 首点位，时间序）`);
  console.log('# idx|symbol|addr|时刻|腿|trig|BUY数|成交数|cheat|reasons码|盘形|点位|活跃度|筹码|价格档|BP综判|curVs|minVs|首点状态|净盈亏BNB');
  rows.forEach((r, i) => {
    console.log([i + 1, r.sym || short(r.tok), r.tok, String(r.at).slice(11, 19), r.leg, r.trig ?? '-',
      r.buys, r.exec, r.cheat, r.reasons || '-', r.pattern, r.entry, r.act, r.hold, r.plevel,
      r.bp, r.curVs ?? '?', r.minVs ?? '?', r.status, r.pnl == null ? '-' : (r.pnl >= 0 ? '+' : '') + r.pnl].join('|'));
  });
  process.exit(0);
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
