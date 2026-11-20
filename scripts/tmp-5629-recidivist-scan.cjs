#!/usr/bin/env node
// 0x5629 敌敌畏 团队钱包·第二步：跨票惯犯扫描（wallet → 参与 token 分布 + 金额指纹 + 簇名单命中）
const { dbManager } = require('../src/services/dbManager');
const fs = require('fs');

// 第一步产出的核心团队钱包（creator + 初始筹码分发户 + 等额簇6 + 快闪1买1卖族；剔除 0x410e 散户）
const TEAM = [
  '0xa6bce800bb299696d1b235316d2249f2036a9a3d', // creator 自买自卖 4s
  '0x1c66789827e67302a57809c2edd8e572e16e3a81', // 零买纯卖 0.249B（初始筹码分发）
  '0x06f0a63c7f3df29d855c84c6cbfc55f35abc1cfc', // 等额簇 0.148×2
  '0x72a01defebb203e059f24af6effcac43712a002d',
  '0x242b357db25279d2a8ffd12f5788e34e1865d0be',
  '0xc78bbf022924d7587186efb0050b0e65b9f5425b',
  '0x5517852b06b28b97da2b648c78e56ea04d44f293',
  '0xe722d3ea6e09e55accbdbfe3d2750009686c764a',
  '0x731b89d29c15e8f04f0f5abbd1d2c115b53e7435',
  '0xf42887fbb6153a4c465e5576772c1938a4908bc7',
  '0xd5ac55f2f3e276caac5a2e97900a7b46cd4f434a',
  '0x0b2259e10d494f848ea1458acb39152ad9865424',
  '0xfb8c5a2f6ab749608486f42221d78fcb50d2652f',
  '0xa8662c60c79e467d1c8e3a24327a27061f09a6e6',
  '0x94e32d1449ad9fd36afc83e6c3f1c826f8aac1b8',
  '0x2b24ac667c24560827044af98c369d409cc2821e',
  '0xb9ace89a425c27e4ae26884bc64791461a1b2904',
  '0x727864fad9aef9b1049b1a724c66d2f91ecc0bf2',
  '0x96e413860d82fba5def1994ce7599008ed0b4f39',
  '0x2887f7722b56a454a3b8243351eda6b80892ffdb',
  '0xb7a7febb11c1b5d783c67b7efc9e9bf8aee14e7a',
  '0x3dcfdeafd1b8bbf6fc9c53acf9206a9931c4663f', // 尾笔 0 額（观察）
];
const lc = s => (s || '').toLowerCase();

async function main() {
  const sb = dbManager.getClient();

  // 0) 名单命中：sybil 簇 / copy roster / famous / smartmoney
  for (const f of ['config/rosters/sybil-clusters.json', 'config/rosters/sybil-clusters-manual.json', 'config/rosters/copy-wallet-roster.json', 'config/rosters/famous-copy-wallets.json', 'data/kol-study/smartmoney-accum.json']) {
    try {
      const j = JSON.parse(fs.readFileSync(f, 'utf8'));
      const txt = JSON.stringify(j);
      const hits = TEAM.filter(w => txt.includes(w));
      console.log(`[名单] ${f} 命中: ${hits.length ? hits.join(',') : '无'}`);
    } catch (e) { console.log(`[名单] ${f} 读取失败(${e.code || '?'}) 跳过`); }
  }

  // 1) wallet_offline_profiles 画像
  try {
    const { data: prof, error } = await sb.from('wallet_offline_profiles').select('*').in('address', TEAM.slice(0, 20));
    if (error) throw error;
    console.log(`\n[画像] wallet_offline_profiles 命中 ${prof?.length || 0}/${TEAM.length}`);
    for (const p of prof || []) console.log(JSON.stringify(p).slice(0, 300));
  } catch (e) { console.log('[画像] 查询失败:', e.message); }

  // 2) 跨票参与：or(sender in ..., trader in ...)
  const orExpr = `sender_address.in.(${TEAM.join(',')}),trader_address.in.(${TEAM.join(',')})`;
  const want = ['id', 'token_address', 'block_time', 'trade_type', 'bnb_amount', 'price_bnb', 'sender_address', 'trader_address'].join(',');
  const rows = [];
  let cursor = 0;
  const t0 = Date.now();
  for (;;) {
    const { data, error } = await sb.from('wss_price_ticks').select(want).or(orExpr).gt('id', cursor).limit(1000);
    if (error) throw error;
    if (!data.length) break;
    rows.push(...data);
    for (const r of data) if (r.id > cursor) cursor = r.id;
    if (data.length < 1000) break;
  }
  console.log(`\n[跨票] 团队钱包全史行数=${rows.length}  耗时=${((Date.now() - t0) / 1000).toFixed(1)}s`);

  // per wallet×token 聚合
  const WT = new Map(); // wallet -> Map(token -> agg)
  const TOK = new Map(); // token -> { rows, buy, sell, wallets:Set, first, last }
  for (const r of rows) {
    const w = lc(r.sender_address) || lc(r.trader_address);
    const t = r.token_address;
    if (!w || !t) continue;
    if (!TEAM.includes(w)) continue; // or 双列命中另一列时，行归属只认 sender||trader 口径的团队钱包
    let m = WT.get(w); if (!m) { m = new Map(); WT.set(w, m); }
    let o = m.get(t); if (!o) { o = { t, buyBnb: 0, sellBnb: 0, buyN: 0, sellN: 0, first: r.block_time, last: r.block_time, amts: [] }; m.set(t, o); }
    const bnb = +r.bnb_amount || 0;
    if (r.trade_type === 'buy') { o.buyBnb += bnb; o.buyN++; } else { o.sellBnb += bnb; o.sellN++; }
    if (bnb >= 0.05) o.amts.push(bnb.toFixed(4));
    if (r.block_time < o.first) o.first = r.block_time;
    if (r.block_time > o.last) o.last = r.block_time;
    let k = TOK.get(t); if (!k) { k = { rows: 0, wallets: new Set(), first: r.block_time, last: r.block_time }; TOK.set(t, k); }
    k.rows++; k.wallets.add(w);
    if (r.block_time < k.first) k.first = r.block_time;
    if (r.block_time > k.last) k.last = r.block_time;
  }

  console.log(`\n=== per-wallet 参与票数 ===`);
  const wArr = [...WT.entries()].map(([w, m]) => ({ w, n: m.size, span: [...m.values()] })).sort((a, b) => b.n - a.n);
  for (const x of wArr) {
    const buys = x.span.filter(o => o.buyBnb > 0).length;
    const oneShot = x.span.filter(o => o.buyN <= 1 && o.sellN <= 1).length;
    const amts = {}; x.span.forEach(o => o.amts.forEach(a => amts[a] = (amts[a] || 0) + 1));
    const topAmts = Object.entries(amts).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([a, n]) => `${a}×${n}`).join(' ');
    console.log(`${x.w} 票数=${x.n} (有买${buys}) 一买一卖票占比=${oneShot}/${x.n} 金额指纹: ${topAmts || '-'}`);
  }

  console.log(`\n=== 团队共同参与的票（按团队钱包数排序 top30）===`);
  const tArr = [...TOK.entries()].sort((a, b) => b[1].wallets.size - a[1].wallets.size);
  console.log(`共 ${tArr.length} 票；≥3 团队钱包的票 ${tArr.filter(x => x[1].wallets.size >= 3).length} 张`);
  for (const [t, k] of tArr.slice(0, 30)) {
    console.log(`${t} 团队钱包=${k.wallets.size} 行=${k.rows} ${k.first.slice(0, 16)}→${k.last.slice(0, 16)}`);
  }

  // 时间簇：团队成员按天分布
  const day = new Map();
  for (const r of rows) {
    const w = lc(r.sender_address) || lc(r.trader_address);
    if (!TEAM.includes(w)) continue;
    const d = r.block_time.slice(0, 10);
    day.set(d, (day.get(d) || 0) + 1);
  }
  console.log(`\n=== 团队活跃按天 ===`);
  [...day.entries()].sort().forEach(([d, n]) => console.log(`${d} ${n}行`));

  // 全量票清单（落文件备查）
  const dump = tArr.map(([t, k]) => ({ token: t, teamWallets: k.wallets.size, rows: k.rows, span: `${k.first}→${k.last}`, wallets: [...k.wallets] }));
  fs.writeFileSync('/tmp/tmp-5629-team-tokens.json', JSON.stringify(dump, null, 1));
  console.log(`\n全量票清单落 /tmp/tmp-5629-team-tokens.json`);
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
