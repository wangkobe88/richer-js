#!/usr/bin/env node
/**
 * 知识库 builder 纯函数单测（C164）——零 DB 零网络
 *
 *   A. normalizeRankRow → 标准化记录（字段映射/正数门/twitter URL 两形状）
 *   B. mergeRankRecords：三榜合并去重补名次/稳定币剔除/坏地址剔除
 *   C. extractAthMarketCapUsd 两形态：直读市值 / ATH价×供应 / 当前市值下界兜底 / 全缺 null
 *   D. buildBluechipEntry：id 域 b:/corpusTrigger 自动判定/aliases
 *   E. quasi：normalizeTrenchRow / filterQuasiByWindow（窗内/出窗/缺 ts 分流）/ buildQuasiEntry id 域 q:
 *   F. ATH 口径红线：>$1M 门（ATH_MARKET_CAP_USD_MIN=1_000_000）
 *
 * 用法：node scripts/_test_knowledge_builder_core.cjs
 */
'use strict';

let pass = 0, fail = 0;
function assert(cond, label, extra) {
  if (cond) { pass++; console.log(`  ✅ ${label}`); }
  else { fail++; console.error(`  ❌ ${label}${extra !== undefined ? ` | ${JSON.stringify(extra)}` : ''}`); }
}
const A = (hex) => `0x${hex.padStart(40, '0')}`;
const ADDR = A('ab1').slice(2); // 40 hex

(async () => {
  const B = await import('../scripts/narrative/build-knowledge-bluechips.mjs');
  const Q = await import('../scripts/narrative/build-knowledge-quasi.mjs');
  const { normalizeRankRow, mergeRankRecords, extractAthMarketCapUsd, buildBluechipEntry, extractRankRows, normalizeTwitterUrl, ATH_MARKET_CAP_USD_MIN, EXCLUDE_ADDRS } = B;

  console.log('A. normalizeRankRow');
  {
    const def = { key: 'mc24h', interval: '24h', order_by: 'marketcap' };
    const rec = normalizeRankRow({
      address: '0x' + ADDR.toUpperCase(), symbol: 'BIAOGE', name: '彪哥',
      market_cap: 2500000, volume: 1e6, holder_count: 900, renowned_count: 5,
      creation_timestamp: 1760000000, open_timestamp: 0,
      launchpad_platform: 'four.meme', twitter_username: 'https://x.com/biaoge',
      website: 'https://biaoge.example',
    }, def, 0);
    assert(rec.address === A('ab1') && rec.symbol === 'BIAOGE' && rec.marketCapUsd === 2500000
      && rec.openTimestampSec === 1760000000 && rec.ranks.mc24h === 1
      && rec.twitterUrl === 'https://x.com/biaoge' && rec.launchpad === 'four.meme', 'A1 字段映射 + 大写地址归一', rec);
    assert(normalizeTwitterUrl('biaoge') === 'https://x.com/biaoge' && normalizeTwitterUrl('') === null, 'A2 裸 handle 补 URL / 空为 null');
    const rec0 = normalizeRankRow({ address: '0x' + ADDR, market_cap: 0, volume: -5, open_timestamp: 0 }, def, 2);
    assert(rec0.marketCapUsd === null && rec0.volume24hUsd === null && rec0.openTimestampSec === null, 'A3 0/负值视为无效（pickPos 正数门）', rec0);
    assert(extractRankRows({ data: { rank: [{ address: '0x1' }] } }).length === 1
      && extractRankRows({ data: { rank: [] } }).length === 0, 'A4 extractRankRows 外壳形状');
  }

  console.log('B. mergeRankRecords');
  {
    const def1 = { key: 'mc24h' }, def2 = { key: 'vol24h' };
    const m = new Map();
    const { kept: k1 } = mergeRankRecords(m, [normalizeRankRow({ address: '0x' + ADDR, symbol: 'X', name: 'X币', market_cap: 1 }, def1, 3)]);
    const { kept: k2 } = mergeRankRecords(m, [normalizeRankRow({ address: '0x' + ADDR, symbol: 'X', volume: 9 }, def2, 7)]);
    const rec = m.get(A('ab1'));
    assert(k1 === 1 && k2 === 0 && rec.ranks.mc24h === 4 && rec.ranks.vol24h === 8 && rec.marketCapUsd === 1 && rec.volume24hUsd === 9, 'B1 同地址合并补名次/补缺失指标', rec);
    const { merged } = mergeRankRecords(new Map(), [
      normalizeRankRow({ address: '0x55d398326f99059ff775485246999027b3197955', symbol: 'USDT' }, def1, 0),
      normalizeRankRow({ address: '0x123', symbol: 'bad' }, def1, 0),
      normalizeRankRow({ address: '0x' + ADDR, symbol: 'X' }, def1, 0),
    ]);
    assert(merged.size === 1 && EXCLUDE_ADDRS.has('0x55d398326f99059ff775485246999027b3197955'), 'B2 稳定币剔除 + 坏地址剔除', [...merged.keys()]);
  }

  console.log('C. extractAthMarketCapUsd 两形态');
  {
    let r = extractAthMarketCapUsd({ ath_market_cap: 2_500_000 });
    assert(r && r.usd === 2_500_000 && r.via === 'info.ath_market_cap', 'C1 直读市值形态', r);
    r = extractAthMarketCapUsd({ ath_price: 0.005, circulating_supply: 400_000_000 });
    assert(r && r.usd === 2_000_000 && r.via.includes('×supply'), 'C2 ATH 价×供应形态', r);
    r = extractAthMarketCapUsd({ market_cap: 800_000 });
    assert(r && r.usd === 800_000 && r.via === 'current_floor', 'C3 当前市值下界兜底（ATH ≥ 现值数学事实）', r);
    r = extractAthMarketCapUsd({ pool: { market_cap: '1234567' } });
    assert(r && r.usd === 1234567, 'C4 字符串数字容限 + pool 嵌套', r);
    r = extractAthMarketCapUsd({ symbol: 'X' });
    assert(r === null, 'C5 全缺 → null');
    r = extractAthMarketCapUsd(null, { marketCapUsd: 5e6 });
    assert(r === null, 'C6 info null → null（榜单市值只在 info 在场时兜底）', r);
  }

  console.log('D. buildBluechipEntry');
  {
    const rec = normalizeRankRow({ address: '0x' + ADDR, symbol: 'BIAOGE', name: '彪哥', twitter_username: 'biaoge', market_cap: 1 }, { key: 'mc24h' }, 0);
    const e = buildBluechipEntry(rec, { usd: 2_500_000, via: 'info.ath_market_cap' }, { narrative: 'n', rating: 'high', updatedAt: '2026-10-22T00:00:00Z' });
    assert(e.id === 'b:' + A('ab1') && e.kind === 'bluechip' && e.athMarketCapUsd === 2_500_000 && e.corpusTrigger === true
      && e.aliases.includes('BIAOGE') && e.twitter === 'https://x.com/biaoge' && e.ranks.mc24h === 1, 'D1 条目映射 + id 域 b:', e);
    const e2 = buildBluechipEntry(normalizeRankRow({ address: '0x' + 'ff'.repeat(20), symbol: 'PEPE2', name: 'PEPE 2.0' }, { key: 'mc24h' }, 0), { usd: 5e6, via: 'x' });
    assert(e2.corpusTrigger === false, 'D2 denylist 名自动 corpusTrigger=false', e2);
  }

  console.log('E. quasi 纯函数');
  {
    const now = 1_770_000_000;
    const rows = [
      Q.normalizeTrenchRow({ address: '0x' + ADDR, symbol: 'QQ', name: '近期票', creation_timestamp: now - 86400, market_cap: 50000, twitter_username: 'qq' }, 'fourmeme'),
      Q.normalizeTrenchRow({ address: '0x' + 'ee'.repeat(20), symbol: 'OLD', name: '老票', creation_timestamp: now - 30 * 86400 }, 'flap'),
      Q.normalizeTrenchRow({ address: '0x' + 'dd'.repeat(20), symbol: 'NOTS', name: '缺时间戳票' }, 'fourmeme'),
      Q.normalizeTrenchRow({ symbol: 'NOADDR', name: '缺地址' }, 'fourmeme'),
    ];
    assert(rows[0].platform === 'fourmeme' && rows[0].marketCapUsd === 50000, 'E1 normalizeTrenchRow 平台/字段映射', rows[0]);
    const { kept, noTs } = Q.filterQuasiByWindow(rows, now);
    assert(kept.length === 1 && kept[0].symbol === 'QQ' && noTs.length === 1 && noTs[0].symbol === 'NOTS', 'E2 7d 窗过滤 + 缺 ts 分流（宁保留待点查；缺地址剔除）', { kept: kept.map((r) => r.symbol), noTs: noTs.map((r) => r.symbol) });
    const e = Q.buildQuasiEntry(rows[0], { graduatedAt: '2026-10-21T00:00:00Z', narrative: 'x', rating: 'mid' });
    assert(e.id === 'q:' + A('ab1') && e.kind === 'quasi' && e.source === 'graduations' && e.graduatedAt === '2026-10-21T00:00:00Z', 'E3 buildQuasiEntry id 域 q:（与 feedback 同域——后写覆盖）', e);
  }

  console.log('F. ATH 口径红线');
  assert(ATH_MARKET_CAP_USD_MIN === 1_000_000, 'F1 蓝筹门=$1M（用户裁定口径常量锁定）');
  assert(extractAthMarketCapUsd({ ath_market_cap: 999_999 }) && extractAthMarketCapUsd({ ath_market_cap: 999_999 }).usd <= ATH_MARKET_CAP_USD_MIN, 'F2 $999,999 不越门');
  assert(extractAthMarketCapUsd({ ath_market_cap: 1_000_001 }).usd > ATH_MARKET_CAP_USD_MIN, 'F3 $1,000,001 越门');

  console.log('G. ATH sanity 上界（182 冒烟实证 2026-10-22：XRP 克隆票 ath_price 污染反证）');
  {
    let r = extractAthMarketCapUsd({ ath_price: 2190.057420151, circulating_supply: '325799999' }, { marketCapUsd: 438592000 });
    assert(r && r.usd === 438592000 && r.via === 'sanity_floor', 'G1 ath_price×supply 越界（$713B 全球不可能）→ 降级 floor 留痕 sanity_floor', r);
    assert(B.ATH_MCAP_SANITY_CEILING_USD === 2e10, 'G2 上界常量锁定 $20B（BSC meme 历史真实 ATH 远低于此）');
    r = extractAthMarketCapUsd({ ath_market_cap: 5e11 }, { marketCapUsd: 1e6 });
    assert(r && r.usd === 1e6 && r.via === 'sanity_floor', 'G3 直读形态污染同样降级 floor', r);
    r = extractAthMarketCapUsd({ ath_price: 0.505, circulating_supply: '2563999999' });
    assert(r && Math.abs(r.usd - 1_294_819_999.495) < 1 && r.via === 'info.ath_price×supply', 'G4 正常 ATH（DOGE 冒烟实测形状）不受上界影响', r);
  }

  console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
