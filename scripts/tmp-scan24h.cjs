#!/usr/bin/env node
/**
 * 临时扫描（182 跑）：作弊票候选因子影响面三合一
 *  A. 过去 24h token_create 票：首窗 90s 钱包结构因子（tradesPerWallet/maxPerWallet/
 *     uniformCluster/routerPct/top1）× 结局（t+90s→t+600s / t+1800s 收益、崩盘标记）
 *  B. 近 7d strategy_signals：narrativeCorpusLagSec / earlyReturn / rating 联合分布 × 结局
 *     （earlyReturn>=100 豁免分支删除影响面 + lag<300 去留数据）
 *  C. 近 24h token_narrative：宣告推文语言（CJK 占比）分布 × 找角度分类 × 结局
 *     （「找角度推文必须中文」门影响面）
 * 全程点查/分页，182 直连 Supabase。
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');
const { AGGREGATOR_ROUTER_ADDRS } = require('../src/trading-engine/pre-check/aggregator-routers');

const NOW = Date.now();
const D24H = 24 * 3600 * 1000;
const MIN_TICK_BNB = 0.001;     // collector 尘 tick 口径
const DUST_UNIFORM = 0.01;      // uniform 簇尘埃门槛（EarlyParticipant 同款）
const WIN_MS = 90 * 1000;       // 首窗
const END1_MS = 600 * 1000;     // 结局观察点 1
const END2_MS = 1800 * 1000;    // 结局观察点 2

function cjkRatio(text) {
  if (!text) return null;
  const s = String(text);
  const cjk = (s.match(/[一-鿿㐀-䶿]/g) || []).length;
  const latin = (s.match(/[a-zA-Z]/g) || []).length;
  if (cjk + latin === 0) return null;
  return cjk / (cjk + latin);
}

async function main() {
  const db = dbManager.getClient();

  // ===== A. 24h token_create（id keyset 分页：order(block_time) 形状会 planner 超时，无 order 被 max-rows=1000 截断）=====
  const tokens = [];
  {
    let curId = 0;
    for (;;) {
      const r = await db.from('wss_events')
        .select('id,token_address,block_time,payload->meta->>platform,payload->>symbol')
        .eq('kind', 'token_create')
        .gte('block_time', new Date(NOW - D24H).toISOString())
        .gt('id', curId)
        .limit(1000);
      const page = r.data || [];
      if (r.error) { console.log('A 分页 error:', r.error.message); break; }
      tokens.push(...page);
      if (page.length < 1000) break;
      curId = Math.max(...page.map(p => p.id));
    }
  }
  console.log(`[A] 24h token_create 票数: ${tokens.length}`);

  const rows = [];
  let done = 0;
  // 窗口结构统计（尘剔除，wallet=sender||trader；买入口径累计）
  const winStats = (ticks, createMs, winMs) => {
    const wStat = new Map();
    let buyBnb = 0, routerBuyBnb = 0;
    const buyByWallet = new Map();
    for (const t of ticks) {
      if (new Date(t.block_time).getTime() - createMs > winMs) continue;
      const bnb = Number(t.bnb_amount) || 0;
      if (bnb < MIN_TICK_BNB || !(Number(t.token_amount) > 0)) continue;
      const w = (t.sender_address || t.trader_address || '').toLowerCase();
      const e = wStat.get(w) || { n: 0 };
      e.n++; wStat.set(w, e);
      if (t.trade_type === 'buy') {
        buyBnb += bnb;
        if (AGGREGATOR_ROUTER_ADDRS.has(t.trader_address)) routerBuyBnb += bnb;
        buyByWallet.set(w, (buyByWallet.get(w) || 0) + bnb);
      }
    }
    const wallets = wStat.size;
    const tradeCount = [...wStat.values()].reduce((s, e) => s + e.n, 0);
    const maxPerWallet = wallets ? Math.max(...[...wStat.values()].map(e => e.n)) : 0;
    // uniform 簇（EarlyParticipant 口径复刻）+ 记录最大簇等额值（区分 GMGN 默认档位 vs 奇异值）
    const amounts = [...buyByWallet.values()].filter(a => a >= DUST_UNIFORM);
    let clusterN = 0, uniRatio = 0, clusterAmount = null;
    if (amounts.length >= 3) {
      const buckets = new Map();
      for (const a of amounts) { const k = a.toFixed(2); buckets.set(k, (buckets.get(k) || 0) + 1); }
      let best = null;
      for (const [k, n] of buckets) if (!best || n > best[1]) best = [k, n];
      clusterN = best[1]; clusterAmount = Number(best[0]); uniRatio = clusterN / amounts.length * 100;
    }
    return {
      wallets, tradeCount, tpw: wallets ? +(tradeCount / wallets).toFixed(2) : 0, maxPerWallet,
      clusterN, uniRatio: +uniRatio.toFixed(1), clusterAmount,
      routerPct: buyBnb > 0 ? +(routerBuyBnb / buyBnb * 100).toFixed(1) : 0,
      top1: buyBnb > 0 ? +([...buyByWallet.values()].reduce((m, a) => Math.max(m, a), 0) / buyBnb * 100).toFixed(1) : 0,
      buyBnb: +buyBnb.toFixed(2),
    };
  };
  for (const ev of tokens) {
    const addr = ev.token_address;
    const createMs = new Date(ev.block_time).getTime();
    try {
      const r = await db.from('wss_price_ticks')
        .select('block_time,price_bnb,bnb_amount,token_amount,trade_type,sender_address,trader_address')
        .eq('token_address', addr)
        .gte('block_time', ev.block_time)
        .lte('block_time', new Date(createMs + END2_MS).toISOString())
        .limit(4000);
      const ticks = r.data || [];
      if (!ticks.length) { done++; continue; }

      const s90 = winStats(ticks, createMs, WIN_MS);
      const s30 = winStats(ticks, createMs, 30000);

      // 价格轨迹（price_bnb 非空行）
      const pricePts = ticks.map(t => [new Date(t.block_time).getTime() - createMs, Number(t.price_bnb)]).filter(([, p]) => p > 0);
      const at = (ms) => { let v = null; for (const [d, p] of pricePts) if (d <= ms) v = p; return v; };
      const peakAfter = (ms) => { let v = null; for (const [d, p] of pricePts) if (d >= ms && (v === null || p > v)) v = p; return v; };
      const p90 = at(WIN_MS), p600 = at(END1_MS), p1800 = at(END2_MS), peak600 = peakAfter(WIN_MS);

      rows.push({
        addr, platform: ev.platform || '?', symbol: ev.symbol || '?',
        ...Object.fromEntries(Object.entries(s90).map(([k, v]) => [k, v])),
        tpw30: s30.tpw, max30: s30.maxPerWallet, wallets30: s30.wallets, uni30N: s30.clusterN,
        ret600: p90 && p600 ? +((p600 / p90 - 1) * 100).toFixed(1) : null,
        ret1800: p90 && p1800 ? +((p1800 / p90 - 1) * 100).toFixed(1) : null,
        drawdownPeak: p90 && peak600 ? +((p600 / peak600 - 1) * 100).toFixed(1) : null,
      });
    } catch (e) { /* 单票失败继续 */ }
    if (++done % 500 === 0) console.log(`  进度 ${done}/${tokens.length}`);
  }
  console.log(`[A] 有效票: ${rows.length}`);

  // 汇总输出
  const med = arr => { const a = arr.filter(x => x !== null && Number.isFinite(x)).sort((x, y) => x - y); return a.length ? a[Math.floor(a.length / 2)] : null; };
  const bucketize = (arr, keyFn, buckets) => {
    for (const [label, lo, hi] of buckets) {
      const sub = arr.filter(r => { const v = keyFn(r); return v >= lo && v < hi; });
      if (!sub.length) continue;
      console.log(`  ${label}: 票数=${sub.length} t90→600中位=${med(sub.map(r => r.ret600))}% t90→1800中位=${med(sub.map(r => r.ret1800))}% 崩盘率(ret600<-50)=${(sub.filter(r => r.ret600 !== null && r.ret600 < -50).length / sub.filter(r => r.ret600 !== null).length * 100 || 0).toFixed(0)}%`);
    }
  };
  console.log('\n=== tradesPerWallet(90s) 分布 × 结局 ===');
  bucketize(rows, r => r.tpw, [['tpw 1.0-2.0', 1, 2], ['tpw 2.0-3.0', 2, 3], ['tpw 3.0-4.0', 3, 4], ['tpw 4.0-5.0', 4, 5], ['tpw 5.0-7.0', 5, 7], ['tpw 7+', 7, 1e9]]);
  console.log('\n=== maxPerWallet(90s) 分布 × 结局 ===');
  bucketize(rows, r => r.maxPerWallet, [['max 1-2', 1, 3], ['max 3-5', 3, 6], ['max 6-9', 6, 10], ['max 10-14', 10, 15], ['max 15+', 15, 1e9]]);
  console.log('\n=== early30 子窗：tpw(0-30s) 分布 × 结局 ===');
  bucketize(rows.filter(r => r.wallets30 > 0), r => r.tpw30, [['tpw30 1.0-2.0', 1, 2], ['tpw30 2.0-3.0', 2, 3], ['tpw30 3.0-4.0', 3, 4], ['tpw30 4.0-6.0', 4, 6], ['tpw30 6+', 6, 1e9]]);
  console.log('\n=== early30 子窗：maxPerWallet(0-30s) 分布 × 结局 ===');
  bucketize(rows.filter(r => r.wallets30 > 0), r => r.max30, [['max30 1-2', 1, 3], ['max30 3-5', 3, 6], ['max30 6-9', 6, 10], ['max30 10+', 10, 1e9]]);
  console.log('\n=== uniformClusterRatio（N>=3）分布 × 结局（辅助维度） ===');
  bucketize(rows.filter(r => r.clusterN >= 3), r => r.uniRatio, [['uni 0-20', 0, 20], ['uni 20-40', 20, 40], ['uni 40-60', 40, 60], ['uni 60-80', 60, 80], ['uni 80+', 80, 1000]]);

  // 最大簇等额值分布（区分 GMGN 默认档位热门值 vs 奇异分仓值）
  const amtDist = new Map();
  for (const r of rows) if (r.clusterN >= 3 && r.clusterAmount !== null) amtDist.set(r.clusterAmount, (amtDist.get(r.clusterAmount) || 0) + 1);
  const topAmts = [...amtDist.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15);
  console.log('\n=== 最大簇等额值 Top15（GMGN 默认档位=高频值，奇异值=分仓脚本） ===');
  for (const [v, n] of topAmts) console.log(`  ${v.toFixed(2)} BNB × ${n} 票`);

  // 候选门模拟（笔数维度为主；uniform 仅复合）
  const gates = {
    'G1 tpw90>=4': r => r.tpw >= 4,
    'G2 tpw90>=5': r => r.tpw >= 5,
    'G3 maxPerWallet90>=8': r => r.maxPerWallet >= 8,
    'G4 tpw30>=4(前30s)': r => r.tpw30 >= 4,
    'G5 max30>=5(前30s)': r => r.max30 >= 5,
    'G6 复合 tpw90>=4 且 uni(N>=5,ratio>=40)': r => r.tpw >= 4 && r.clusterN >= 5 && r.uniRatio >= 40,
    'G7 G1||G4': r => r.tpw >= 4 || r.tpw30 >= 4,
  };
  console.log('\n=== 候选门模拟（拦截=买到就亏的票被拦） ===');
  for (const [name, fn] of Object.entries(gates)) {
    const hit = rows.filter(fn);
    const hitRet = hit.map(r => r.ret600).filter(x => x !== null);
    const keep = rows.filter(r => !fn(r));
    console.log(`${name}: 拦 ${hit.length}/${rows.length} (${(hit.length / rows.length * 100).toFixed(1)}%) | 被拦票 ret600 中位=${med(hitRet)}% | 放行票 ret600 中位=${med(keep.map(r => r.ret600).filter(x => x !== null))}% | 被拦票里 ret600>0 的(误伤)=${hitRet.filter(x => x > 0).length}`);
  }

  // 参照票：猪五花 + v17 买过的
  const ref = rows.find(r => r.addr.startsWith('0x7603c74b'));
  if (ref) console.log('\n参照(猪五花):', JSON.stringify(ref));

  // ===== B. 近 7d signals lag 分析（id keyset 分页）=====
  console.log('\n===== B. 近 7d signals lag/earlyReturn 分析 =====');
  const sigByToken = new Map();
  {
    let curId = 0;
    for (;;) {
      const r = await db.from('strategy_signals').select('id,token_address,created_at,metadata->preBuyCheckFactors')
        .gte('created_at', new Date(NOW - 7 * D24H).toISOString())
        .gt('id', curId)
        .limit(1000);
      const page = r.data || [];
      if (r.error) { console.log('B 分页 error:', r.error.message); break; }
      for (const s of page) {
        const f = s.preBuyCheckFactors;
        if (!f || !s.token_address) continue;
        if (!sigByToken.has(s.token_address)) sigByToken.set(s.token_address, f); // 首条
      }
      if (page.length < 1000) break;
      curId = Math.max(...page.map(p => p.id));
    }
  }
  console.log(`[B] 7d 有 preBuy 因子的 token 数: ${sigByToken.size}`);
  const rowByAddr = new Map(rows.map(r => [r.addr.toLowerCase(), r]));
  const lagBuckets = [['lag<0(宣告竞态)', -1e9, 0], ['lag 0-300', 0, 300], ['lag 300-600', 300, 600], ['lag 600-3600', 600, 3600], ['lag>=3600', 3600, 1e9], ['lag null', null, null]];
  for (const [label, lo, hi] of lagBuckets) {
    const sub = [...sigByToken.entries()].filter(([, f]) => {
      const lag = f.narrativeCorpusLagSec;
      if (lo === null) return lag === null || lag === undefined;
      return lag !== null && lag !== undefined && lag >= lo && lag < hi;
    }).map(([a]) => a);
    const withEnd = sub.map(a => rowByAddr.get(a)).filter(Boolean).map(r => r.ret600).filter(x => x !== null);
    // 7d 范围大于 24h，很多 token 结局不在 A 集；统计有结局的部分
    console.log(`  ${label}: tokens=${sub.length} 有结局=${withEnd.length} ret600中位=${med(withEnd)}%`);
  }
  // earlyReturn>=100 豁免分支的受益者（lag>=300 且 earlyReturn>=100 才能进的票）
  const exempt = [...sigByToken.entries()].filter(([, f]) => (f.narrativeCorpusLagSec ?? 1e9) >= 300 && (f.earlyReturn ?? 0) >= 100);
  const exemptEnd = exempt.map(([a]) => rowByAddr.get(a)).filter(Boolean).map(r => r.ret600).filter(x => x !== null);
  console.log(`  删 earlyReturn>=100 豁免 → 额外被拦的 token: ${exempt.length}（有结局 ${exemptEnd.length}，ret600 中位=${med(exemptEnd)}%，正收益 ${exemptEnd.filter(x => x > 0).length}）`);
  const exemptList = exempt.slice(0, 40).map(([a, f]) => `${a.slice(0, 10)}… lag=${f.narrativeCorpusLagSec} er=${(f.earlyReturn || 0).toFixed(0)} ret600=${rowByAddr.get(a)?.ret600 ?? 'NA'}`);
  console.log(exemptList.join('\n'));

  // ===== C. 近 24h token_narrative 语言分布 =====
  console.log('\n===== C. 近 24h 宣告推文语言分布 =====');
  {
    let curId = 0; const nars = [];
    for (;;) {
      const r = await db.from('token_narrative').select('id,token_address,created_at,twitter_info->text,twitter_info->author_screen_name,twitter_info->author_followers_count,pre_check_result->rating,prompt_type')
        .gte('created_at', new Date(NOW - D24H).toISOString())
        .gt('id', curId)
        .limit(1000);
      const page = r.data || [];
      if (r.error) { console.log('C 分页 error:', r.error.message); break; }
      nars.push(...page);
      if (page.length < 1000) break;
      curId = Math.max(...page.map(p => p.id));
    }
    console.log(`[C] 24h narrative 行数: ${nars.length}`);
    const langB = [['纯英文(cjk<5%)', 0, 0.05], ['微中文(5-20%)', 0.05, 0.2], ['中英混(20-50%)', 0.2, 0.5], ['中文为主(>=50%)', 0.5, 1.01], ['无语料', null, null]];
    for (const [label, lo, hi] of langB) {
      const sub = nars.filter(n => {
        const ratio = cjkRatio(n.text);
        if (lo === null) return ratio === null;
        return ratio !== null && ratio >= lo && ratio < hi;
      });
      const ends = sub.map(n => rowByAddr.get(n.token_address)?.ret600).filter(x => x !== null);
      console.log(`  ${label}: 票数=${sub.length} 有结局=${ends.length} ret600中位=${med(ends)}% rating分布=${JSON.stringify(countBy(sub.map(n => n.rating ?? (n.prompt_type || '?'))))}`);
    }
    // 纯英文语料明细（前 30）
    const en = nars.filter(n => { const r0 = cjkRatio(n.text); return r0 !== null && r0 < 0.05; }).slice(0, 30);
    for (const n of en) console.log(`  EN ${n.token_address.slice(0, 10)}… @${n.author_screen_name} 粉=${n.author_followers_count} ret600=${rowByAddr.get(n.token_address)?.ret600 ?? 'NA'}`);
  }

  await dbManager.close?.();
  process.exit(0);
}
function countBy(arr) { const m = {}; for (const x of arr) m[x] = (m[x] || 0) + 1; return m; }
main().catch(e => { console.error(e); process.exit(1); });
