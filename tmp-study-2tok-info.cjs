// 本地小结果读取：实验 54dac9c5 两票（0x29921a53…/0x8fef738d…）基础信息
const path = require('path');
const { dbManager } = require(path.join(__dirname, 'src/services/dbManager'));

const EXP = '54dac9c5-6fdf-4759-8b5a-2195313b6820';
const TOKS = [
  '0x29921a532878bf66efc9ca92694b8a40e6157777',
  '0x8fef738d4a5c4cdc312cf53f949fb57e8a557777',
];

async function main() {
  const c = dbManager.getClient();

  const { data: exp, error: e1 } = await c.from('experiments')
    .select('*')
    .eq('id', EXP).single();
  if (e1) { console.error('exp err', e1.message); }
  else {
    console.log('=== 实验 ===');
    console.log('keys:', Object.keys(exp).join(','));
    console.log('label:', exp.label, '| status:', exp.status, '| platform:', exp.platform, '| mode:', exp.mode, '| created:', exp.created_at);
    const cfg = exp.config || {};
    console.log('config keys:', Object.keys(cfg).join(','));
    console.log('libraryRefs:', JSON.stringify((cfg.strategiesConfig || {}).libraryRefs || null));
    for (const k of ['flapWs', 'fourmemeWs']) {
      const seg = cfg[k] || {};
      console.log(`${k} keys:`, Object.keys(seg).join(','));
      if (seg.buyPointCheck) console.log(`${k}.buyPointCheck:`, JSON.stringify(seg.buyPointCheck));
      if (seg.cheatCheck) console.log(`${k}.cheatCheck.enabled:`, seg.cheatCheck.enabled, 'gate:', JSON.stringify(seg.cheatCheck.gate || {}));
      if (seg.buySignalMaxPerToken != null) console.log(`${k}.buySignal*: maxPerToken=`, seg.buySignalMaxPerToken, 'cooldownMs=', seg.buySignalCooldownMs);
    }
  }

  for (const tok of TOKS) {
    console.log('\n===== token', tok, '=====');
    const { data: sig0 } = await c.from('strategy_signals')
      .select('*').eq('experiment_id', EXP).eq('token_address', tok).limit(1);
    if (!sig0 || !sig0.length) { console.log('no signals'); }
    else console.log('signal cols:', Object.keys(sig0[0]).join(','));

    const { data: sigs, error: e2 } = await c.from('strategy_signals')
      .select('*')
      .eq('experiment_id', EXP).eq('token_address', tok)
      .order('created_at', { ascending: true }).limit(200);
    if (e2) { console.error('sig err', e2.message); continue; }
    console.log('signals:', sigs.length);
    for (const s of sigs) {
      const md = s.metadata || {};
      const gate = md.signalGate ? `gate=${md.signalGate.status || ''}/t${md.signalGate.triggerNo != null ? md.signalGate.triggerNo : ''}` : '';
      const cheat = md.cheatCheck ? `cheat=${md.cheatCheck.status || md.cheatCheck.grade || ''}` : '';
      const bp = md.buyPoint ? `bp=${md.buyPoint.status || md.buyPoint.rule || ''}` : '';
      console.log(`  [${s.created_at}] ${s.signal_type} ${s.action} sid=${s.strategy_id} status=${s.status} ${gate} ${cheat} ${bp} reason=${String(s.reason || '').slice(0, 90)}`);
    }

    const { data: tr0 } = await c.from('trades')
      .select('*').eq('experiment_id', EXP).eq('token_address', tok).limit(1);
    if (tr0 && tr0.length) console.log('trade cols:', Object.keys(tr0[0]).join(','));

    const { data: trs, error: e3 } = await c.from('trades')
      .select('*')
      .eq('experiment_id', EXP).eq('token_address', tok)
      .order('created_at', { ascending: true }).limit(100);
    if (e3) { console.error('trade err', e3.message); continue; }
    console.log('trades:', trs.length);
    let buyBnb = 0, sellBnb = 0;
    for (const t of trs) {
      const md = t.metadata || {};
      const why = md.why || md.signalReason || md.whyCode || md.reason || '';
      const card = md.cardTrade ? `cards=${md.cardTrade.cards}(${md.cardTrade.before}->${md.cardTrade.after})` : '';
      const px = t.price != null ? t.price : (md.price != null ? md.price : '');
      console.log(`  [${t.created_at}] ${t.side} qty=${t.quantity} price=${px} bnb=${t.bnb_amount} status=${t.status} ${card} why=${String(why).slice(0, 90)}`);
      if (t.side === 'buy') buyBnb += Number(t.bnb_amount) || 0;
      else sellBnb += Number(t.bnb_amount) || 0;
    }
    console.log(`  Σ: buyBnb=${buyBnb.toFixed(4)} | sellBnb=${sellBnb.toFixed(4)} | PnL=${(sellBnb - buyBnb).toFixed(4)} BNB`);

    const { count: tickN } = await c.from('wss_price_ticks')
      .select('id', { count: 'exact', head: true })
      .eq('token_address', tok);
    const { data: tA } = await c.from('wss_price_ticks')
      .select('block_time,price').eq('token_address', tok).order('block_time', { ascending: true }).limit(1);
    const { data: tB } = await c.from('wss_price_ticks')
      .select('block_time,price').eq('token_address', tok).order('block_time', { ascending: false }).limit(1);
    console.log('ticks:', tickN, '| first:', tA && tA[0] && `${tA[0].block_time} ${tA[0].price}`, '| last:', tB && tB[0] && `${tB[0].block_time} ${tB[0].price}`);
  }
  process.exit(0);
}
main().catch(e => { console.error('FATAL', e.stack || e); process.exit(1); });
