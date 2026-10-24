#!/usr/bin/env node
/**
 * 门 A 存量扫描：abbreviation_alias 低置信降档（2026-10-17 JDI 案 0x4688…7777 立项）
 *
 * 背景：relevanceFrom 只吃 argmax（choice）+ levelIdx 查表——JDI 案 argmax=
 * abbreviation_alias 仅 0.48（none 0.18/exact 0.18/semantic 0.15），照拿满缩写档
 * 17 分。假想门：argmax=abbreviation_alias 且置信 <T1 且弱关联侧（none+semantic，
 * 即 argmax 之外的主要落点）合计 ≥T2 时 relevance 降档计（A-semantic / A-none
 * 两变体），降后 ≤10 自然走进现行「关联性不足」截断（mapper 逻辑不动）。
 *
 * 零写入纯扫描。输出：
 *   1) abbreviation 票全集概率形状
 *   2) 每组 (T1,T2,变体) 命中数 / mid→low 有效拦截 / high→low / high→mid 无效面
 *   3) 翻拦票 join trades 盈亏（误伤=翻拦票里实际买入且净赚的）
 *
 * 跑法：node scripts/scan-abbrev-low-confidence.cjs（182 上跑，本地 VPN 必超时）
 * 注意：RELEVANCE_TABLE 与 jev-result-mapper.mjs 手工同步（cjs require 不了 mjs）
 */
const { dbManager } = require('../src/services/dbManager');

// ── 与 jev-result-mapper.mjs 手工同步区 ──────────────────────────────
const RELEVANCE_TABLE = {
  exact_match:       [20, 20, 20, 20, 20],
  translation_match: [18, 18, 18, 18, 18],
  abbreviation_alias: [16, 16, 17, 18, 18],
  semantic:          [8, 10, 12, 15, 15],
  cultural:          [1, 5, 10, 14, 15],
  generic_concept:   [2, 4, 6, 7, 7],
  none:              [0, 1, 2, 2, 2],
};
const round2 = v => Math.round(v * 100) / 100;
// ─────────────────────────────────────────────────────────────────────

/** 重建单票 relevance 分布 + 假想重评（返回 null=数据不全跳过） */
function rebuild(row) {
  const s3 = row.relation_result || {};
  const jev = s3.details && s3.details.jev;
  if (!jev || !jev.probabilities || !jev.probabilities.name_event_relevance) return null;
  const dist = jev.probabilities.name_event_relevance;
  const argmax = Object.entries(dist).sort((a, b) => b[1] - a[1])[0];
  if (!argmax || argmax[0] !== 'abbreviation_alias') return null;
  const fin = row.final_result || {};
  const fd = fin.details || {};
  const weightedEventScore = fd.weightedEventScore ?? fd.eventScore;
  if (weightedEventScore == null || fd.qualityScore == null || fd.relevanceScore == null) return null;
  return {
    address: row.token_address,
    symbol: row.token_symbol || '?',
    analyzedAt: row.analyzed_at,
    abbrP: dist.abbreviation_alias,
    noneP: dist.none ?? 0,
    semanticP: dist.semantic ?? 0,
    weakP: (dist.none ?? 0) + (dist.semantic ?? 0),
    levelIdx: jev.relevanceLevelIdx ?? 2,
    oldRel: fd.relevanceScore,
    eventScore: weightedEventScore,
    qualityScore: fd.qualityScore,
    oldScore: fin.score,
    oldCategory: fin.category,
  };
}

/** 假想门下的新档（照抄 mapper：≤10 且无豁免 → 截断 low；否则总分重判档） */
function hypothetical(t, newType) {
  const newRel = RELEVANCE_TABLE[newType][t.levelIdx];
  if (newRel <= 10) return { newRel, newScore: null, newCategory: 'low', truncated: true };
  const newScore = round2(t.eventScore + newRel + t.qualityScore);
  const newCategory = newScore >= 70 ? 'high' : newScore >= 50 ? 'mid' : 'low';
  return { newRel, newScore, newCategory, truncated: false };
}

async function fetchAll() {
  const client = dbManager.getClient();
  const cols = 'id,token_address,token_symbol,analyzed_at,relation_result,final_result';
  const rows = [];
  let after = null;
  for (;;) {
    let q = client.from('token_narrative').select(cols).order('id', { ascending: true }).limit(800);
    if (after) q = q.gt('id', after); // id 是 uuid：字符串序 keyset
    const { data, error } = await q;
    if (error) throw error;
    rows.push(...data);
    if (data.length < 800) break;
    after = data[data.length - 1].id;
  }
  return rows;
}

async function fetchTrades(addresses) {
  const client = dbManager.getClient();
  const map = new Map();
  for (let i = 0; i < addresses.length; i += 50) { // .in() URL 8KB 坑：批 50
    const { data, error } = await client.from('trades')
      .select('token_address,trade_direction,input_currency,input_amount,output_currency,output_amount,success,created_at')
      .in('token_address', addresses.slice(i, i + 50))
      .eq('success', true)
      .limit(400);
    if (error) throw error;
    for (const t of data) {
      const e = map.get(t.token_address) || { buys: 0, sells: 0, n: 0 };
      e.n += 1;
      // BNB 腿金额：买入 input BNB / 卖出 output BNB（flap quote 非 BNB 盘的卖出腿
      // 计价币可能非 BNB——粗口径，净值仅供误伤面参考）
      if (t.trade_direction === 'buy' && t.input_currency === 'BNB') e.buys += Number(t.input_amount) || 0;
      if (t.trade_direction === 'sell' && t.output_currency === 'BNB') e.sells += Number(t.output_amount) || 0;
      map.set(t.token_address, e);
    }
  }
  return map;
}

async function main() {
  const rows = await fetchAll();
  console.log(`token_narrative 全表（keyset 分页）: ${rows.length} 行`);

  // 走到 stage3 且 argmax=abbreviation_alias 的票
  const targets = rows.map(rebuild).filter(Boolean);
  console.log(`argmax=abbreviation_alias 且字段齐全: ${targets.length} 票\n`);

  // 概率形状总览
  const p50 = v => { const s = [...v].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
  const abbrPs = targets.map(t => t.abbrP);
  const weakPs = targets.map(t => t.weakP);
  console.log(`abbrP 分布: min=${Math.min(...abbrPs).toFixed(2)} p50=${p50(abbrPs).toFixed(2)} max=${Math.max(...abbrPs).toFixed(2)}`);
  console.log(`weakP(none+semantic) 分布: min=${Math.min(...weakPs).toFixed(2)} p50=${p50(weakPs).toFixed(2)} max=${Math.max(...weakPs).toFixed(2)}`);
  console.log(`现行 rating: high=${targets.filter(t => t.oldCategory === 'high').length} mid=${targets.filter(t => t.oldCategory === 'mid').length} low=${targets.filter(t => t.oldCategory === 'low').length}\n`);

  // 阈值网格 × 两变体
  const grid = [];
  for (const t1 of [0.4, 0.5, 0.6, 0.7]) {
    for (const t2 of [0.15, 0.25, 0.35]) {
      for (const action of ['semantic', 'none']) {
        const hit = targets.filter(t => t.abbrP < t1 && t.weakP >= t2);
        const flips = { midToLow: [], highToLow: [], highToMid: [] };
        for (const t of hit) {
          const h = hypothetical(t, action);
          if (t.oldCategory === 'mid' && h.newCategory === 'low') flips.midToLow.push({ t, h });
          else if (t.oldCategory === 'high' && h.newCategory === 'low') flips.highToLow.push({ t, h });
          else if (t.oldCategory === 'high' && h.newCategory === 'mid') flips.highToMid.push({ t, h });
        }
        grid.push({ t1, t2, action, hit: hit.length, ...flips });
      }
    }
  }

  // JDI 现场反证（任意合理参数组都应命中并翻 low）
  const jdi = targets.find(t => t.address === '0x4688681cd5f1882b3ba12f6f4a79951914e87777');
  console.log('=== JDI 现场反证 ===');
  if (jdi) {
    console.log(`JDI: abbrP=${jdi.abbrP} weakP=${jdi.weakP} lv=${jdi.levelIdx} old=${jdi.oldScore}/${jdi.oldCategory}`);
    for (const action of ['semantic', 'none']) {
      const h = hypothetical(jdi, action);
      console.log(`  A-${action}: newRel=${h.newRel} → ${h.truncated ? '截断' : h.newScore} / ${h.newCategory}`);
    }
  } else {
    console.log('!! JDI 不在目标集（数据形状变化，先查）');
  }
  console.log('');

  // 翻拦票（mid→low ∪ high→low）join trades 盈亏——逐参数组输出
  const tradeAddrs = new Set();
  for (const g of grid) for (const f of [...g.midToLow, ...g.highToLow]) tradeAddrs.add(f.t.address);
  const tradeMap = await fetchTrades([...tradeAddrs]);

  console.log('=== 阈值网格（有效拦截面 = midToLow+highToLow；highToMid 无实际效果均可买） ===');
  for (const g of grid) {
    const eff = g.midToLow.length + g.highToLow.length;
    if (g.hit === 0) continue;
    console.log(`T1<${g.t1} T2≥${g.t2} A-${g.action}: 命中${g.hit} | 翻low ${eff}(mid${g.midToLow.length}+high${g.highToLow.length}) | high→mid ${g.highToMid.length}`);
  }
  console.log('');

  // 明细：挑代表参数组（T1=0.6 T2=0.25 两变体）展示全部翻拦票+盈亏
  for (const action of ['semantic', 'none']) {
    const g = grid.find(x => x.t1 === 0.6 && x.t2 === 0.25 && x.action === action);
    console.log(`=== 明细 T1<0.6 T2≥0.25 A-${action} 翻拦票 ===`);
    for (const { t, h } of [...g.midToLow, ...g.highToLow]) {
      const tr = tradeMap.get(t.address);
      const net = tr ? round2(tr.sells - tr.buys) : null;
      const pnl = tr && tr.buys > 0 ? `${net >= 0 ? '+' : ''}${net} BNB(${tr.n}笔)` : tr ? '有trade无BNB腿' : '未买';
      console.log(`  ${t.symbol} ${t.address} ${t.analyzedAt?.slice(0, 10)} abbrP=${t.abbrP} weakP=${t.weakP} lv=${t.levelIdx} ${t.oldScore}/${t.oldCategory}→${h.truncated ? '截断' : h.newScore}/${h.newCategory} | ${pnl}`);
    }
    console.log('');
  }

  // 误伤汇总：所有翻拦票里实际买入且净赚的
  console.log('=== 误伤面（任一参数组翻拦 ∪ 实际买入且净赚>0） ===');
  const everFlipped = new Map();
  for (const g of grid) for (const f of [...g.midToLow, ...g.highToLow]) everFlipped.set(f.t.address, f.t);
  let hurt = 0;
  for (const [addr, t] of everFlipped) {
    const tr = tradeMap.get(addr);
    if (!tr) continue;
    const net = round2(tr.sells - tr.buys);
    if (tr.buys > 0 && net > 0) {
      hurt += 1;
      console.log(`  ⚠ ${t.symbol} ${addr} abbrP=${t.abbrP} weakP=${t.weakP} ${t.oldCategory} 净+${net} BNB(${tr.n}笔)`);
    }
  }
  if (!hurt) console.log('  （无净赚翻拦票）');
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
