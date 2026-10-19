#!/usr/bin/env node
// ============================================================================
// C110 结构扫描②：block_reason 三桶跨类空洞频率测量（182 跑，J1.44 形状）
//
// 背景（C2）：BLOCK_SCOPE 把 institution_routine 限 {C,D}、marketing_gimmick 限
// {W,B}——Jev 答题时看不见类别（另一题的输出），argmax 落在 scope 外=该桶不拦
// （blockInScope false 短路）。本扫描出裁定数据：
//   1) block_reason choice × event_category 全 cross-tab（含 in-scope 可拦/空洞分解）
//   2) 两处空洞票单：marketing_gimmick∧{C,D,E} / institution_routine∧∉{C,D}
//      ——各票现行评级 + 是否真被买入（trades buy 腿关联）
//   3) R1 两桶（ip_reuse/low_quality_derivative）argmax 存量票单（对拍票源）
//
// 口径：scope 表硬编码镜像 J1.44 BLOCK_SCOPE（tmp 脚本不 import 未导出常量；
// mapper blockInScope 语义 = scope 'all' 或 includes(category)，未知选项 true）。
// 现行评级用 resolveFinalRating（评级链单一真相源），不 replay——存量现状测量。
//
// 用法（182 上跑；本地 VPN 直连 Supabase 必超时，勿本地跑）：
//   node scripts/tmp-scan-blockreason-scope-holes.cjs
//   node scripts/tmp-scan-blockreason-scope-holes.cjs --json /tmp/scope-holes.json
// ============================================================================
'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require(path.join(__dirname, '../src/services/dbManager.js'));

const asObj = (v) => {
  if (v == null) return null;
  if (typeof v === 'object') return v;
  if (typeof v === 'string') { try { return JSON.parse(v); } catch { return null; } }
  return null;
};

// J1.44 BLOCK_SCOPE 镜像（改 mapper 时若再跑本脚本须同步——tmp 生命周期内锁定）
const SCOPE = {
  empty_content: 'all',
  marketing_gimmick: ['W', 'B'],
  niche_subculture: ['A'],
  ip_reuse: ['A'],
  baseless_speculation: ['G'],
  institution_routine: ['C', 'D'],
  subject_unqualified: [],
  regional_event: [],
  low_quality_derivative: [],
  negative_hard_news: 'all',
  routine_content_product: 'all',
};
const inScope = (choice, category) => {
  const scope = SCOPE[choice];
  if (scope === undefined) return true;
  return scope === 'all' || (Array.isArray(scope) && category != null && scope.includes(category));
};

async function fetchBuys(db, addrs) {
  // 红线：.in() 批 ≤50（URL 8KB）
  const out = new Map(); // addr -> [{experiment_id, n}]
  for (let i = 0; i < addrs.length; i += 50) {
    const batch = addrs.slice(i, i + 50);
    const { data, error } = await db.from('trades')
      .select('token_address,experiment_id')
      .eq('trade_direction', 'buy')
      .eq('success', true)
      .in('token_address', batch);
    if (error) throw error;
    for (const t of data || []) {
      const list = out.get(t.token_address) || [];
      const last = list[list.length - 1];
      if (last && last.experiment_id === t.experiment_id) last.n++;
      else list.push({ experiment_id: t.experiment_id, n: 1 });
      out.set(t.token_address, list);
    }
  }
  return out;
}

async function main() {
  const db = dbManager.getClient();
  const { resolveFinalRating, categoryToRating } = await import('../src/narrative/utils/rating-utils.mjs');

  const COLS = [
    'token_address', 'token_symbol',
    'pre_check_result', 'prestage_result', 'stage1_raw_output',
    'stage1_result', 'stage2_result', 'stage3_result', 'stage_final_result',
    'token_category', 'analyzed_at',
  ].join(',');
  const PAGE = 1000;

  const cross = {}; // `${choice}|${cat}` -> {n, inScope}
  const mktHoles = [], instHoles = [], r1Tickets = [];
  let total = 0, noStd = 0, cursor = null;

  while (true) {
    let q = db.from('token_narrative').select(COLS).order('token_address').limit(PAGE);
    if (cursor) q = q.gt('token_address', cursor);
    const { data: page, error } = await q;
    if (error) throw error;
    if (!page || page.length === 0) break;
    cursor = page[page.length - 1].token_address;

    for (const row of page) {
      total++;
      const answers = asObj(row.stage1_raw_output)?.answers;
      const choice = answers?.block_reason?.choice;
      const cat = answers?.event_category?.choice;
      if (!choice || !cat) { noStd++; continue; }

      const key = `${choice}|${cat}`;
      const cell = cross[key] = cross[key] || { n: 0, inScopeN: 0 };
      cell.n++;
      if (inScope(choice, cat)) cell.inScopeN++;

      const ticket = {
        addr: row.token_address, symbol: row.token_symbol, cat, choice,
        pChoice: answers.block_reason.probabilities?.[choice] ?? null,
        noneP: answers.block_reason.probabilities?.none ?? null,
        rating: resolveFinalRating(row),
        ratingNum: categoryToRating(resolveFinalRating(row)),
        analyzed_at: row.analyzed_at,
      };
      if (choice === 'marketing_gimmick' && ['C', 'D', 'E'].includes(cat)) mktHoles.push(ticket);
      if (choice === 'institution_routine' && !['C', 'D'].includes(cat)) instHoles.push(ticket);
      if (choice === 'ip_reuse' || choice === 'low_quality_derivative') r1Tickets.push(ticket);
    }
    if (page.length < PAGE) break;
  }

  console.log(`\n===== block_reason 空洞扫描（token_narrative 全表 ${total} 行；无 choice/category ${noStd}）=====`);

  console.log('\n── cross-tab：choice × category（inScope 可拦 / 空洞=scope 外不拦）──');
  const choices = Object.keys(cross).map(k => k.split('|')[0]);
  [...new Set(choices)].sort().forEach(ch => {
    const cats = Object.entries(cross).filter(([k]) => k.split('|')[0] === ch)
      .sort((a, b) => b[1].n - a[1].n);
    const totalN = cats.reduce((s, [, v]) => s + v.n, 0);
    const scope = SCOPE[ch];
    const scopeStr = scope === undefined ? '未知(按通用拦)' : (scope === 'all' ? 'all' : `[${scope.join(',')}]`);
    console.log(`  ${ch}（scope=${scopeStr}，n=${totalN}）：`);
    cats.forEach(([k, v]) => {
      const cat = k.split('|')[1];
      const hole = !inScope(ch, cat);
      console.log(`    ${cat}: ${v.n}${hole ? ` ← 空洞 ${v.n}（scope 外不拦）` : ''}`);
    });
  });

  // ── 买入关联（空洞票 + R1 票源）──
  const wantBuys = [...new Set([...mktHoles, ...instHoles, ...r1Tickets].map(t => t.addr))];
  const buys = wantBuys.length ? await fetchBuys(db, wantBuys) : new Map();

  const printGroup = (title, list) => {
    console.log(`\n── ${title}（${list.length} 行）──`);
    const bought = list.filter(t => buys.has(t.addr));
    list.slice(0, 40).forEach(t => {
      const b = buys.get(t.addr);
      console.log(`  ${t.symbol} ${t.addr} cat=${t.cat} ${t.choice} p=${t.pChoice} none=${t.noneP} rating=${t.rating}(${t.ratingNum})`
        + (b ? ` 【已买×${b.reduce((s, e) => s + e.n, 0)} exp=${b.map(e => e.experiment_id).join(',').slice(0, 60)}】` : ''));
    });
    if (list.length > 40) console.log(`  …（其余 ${list.length - 40} 行见 --json）`);
    console.log(`  小计：被买入 ${bought.length}/${list.length}；评级分布 high=${list.filter(t => t.rating === 'high').length} mid=${list.filter(t => t.rating === 'mid').length} low=${list.filter(t => t.rating === 'low').length} unrated=${list.filter(t => t.rating === 'unrated').length} 其他=${list.filter(t => !['high', 'mid', 'low', 'unrated'].includes(t.rating)).length}`);
  };

  printGroup('空洞①：marketing_gimmick ∧ category∈{C,D,E}（gimmick 桶只拦 W/B）', mktHoles);
  printGroup('空洞②：institution_routine ∧ category∉{C,D}（routine 桶只拦 C/D）', instHoles);
  printGroup('R1 对拍票源：ip_reuse / low_quality_derivative argmax 存量（J1.44 合桶）', r1Tickets);

  const jsonIdx = process.argv.indexOf('--json');
  if (jsonIdx > 0 && process.argv[jsonIdx + 1]) {
    require('fs').writeFileSync(process.argv[jsonIdx + 1], JSON.stringify({
      total, noStd, cross, mktHoles, instHoles, r1Tickets,
      buys: Object.fromEntries([...buys.entries()]),
    }, null, 1));
    console.log(`\n全量 JSON 已落盘: ${process.argv[jsonIdx + 1]}`);
  }
  process.exit(0);
}

main().catch(err => { console.error('扫描异常:', err); process.exit(1); });
