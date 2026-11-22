// 真实数据端到端：本地 web /api/ticks + /api/rosters/arb-bot-wallets → 复算机器标记点位
(async () => {
  const ADDR = '0x2ee9458681c134e9c7cd933b7af94be50a1f7777';
  const roster = await (await fetch('http://localhost:3010/api/rosters/arb-bot-wallets')).json();
  const set = new Set(roster.data.wallets);
  const profiles = roster.data.profiles;
  const all = [];
  let offset = 0;
  while (true) {
    const r = await (await fetch(`http://localhost:3010/api/ticks?tokenAddress=${ADDR}&limit=1000&offset=${offset}`)).json();
    const page = r?.data || [];
    all.push(...page);
    offset += page.length;
    const total = r?.pagination?.total;
    if (!page.length || (Number.isFinite(total) && all.length >= total)) break;
  }
  console.log('ticks 总数:', all.length, ' 机器集:', set.size);
  let buyN = 0, sellN = 0;
  const per = new Map();
  for (const t of all) {
    const w = (t.sender_address || t.trader_address || '').toLowerCase();
    if (!w || !set.has(w)) continue;
    const bnb = parseFloat(t.bnb_amount) || 0;
    const usd = parseFloat(t.price_usd);
    if (bnb < 0.005 || !usd || usd <= 0) continue;
    t.trade_type === 'buy' ? buyN++ : sellN++;
    const e = per.get(w) || { w, buy: 0, sell: 0, bnb: 0 };
    e[t.trade_type === 'buy' ? 'buy' : 'sell']++;
    e.bnb += bnb;
    per.set(w, e);
  }
  console.log(`图上将标记: 机器买 ${buyN} 点 / 机器卖 ${sellN} 点`);
  for (const e of per.values()) {
    const p = profiles[e.w] || {};
    console.log(`  ${e.w} 买${e.buy}/卖${e.sell} 共${e.bnb.toFixed(3)}B [${(p.tags || []).join(',')}] 30d:${p.buyCount}/${p.sellCount}·${p.tokenNum}票`);
  }
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
