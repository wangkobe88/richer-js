#!/usr/bin/env node
// ============================================================================
// 一次性（182 跑）：BP 回归集通过点位 ↔ bt-v76（b67513a8）实买对照 + SI 价格疑点
//   A. bt-v76：BP39 通过 8 token + 已买 5 token 的全部 BUY 信号——时刻/价/腿/
//      cheat grade/BP bucket·rule/anchorTickCount/executed/拒因
//   B. bt-v76 SI trades 全行（unit_price 口径疑点）+ v73 SI 信号与 trades 对照
//   C. 汇总：通过 token 逐个「买没买/卡在哪」
// ============================================================================
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const BT = 'b67513a8-a389-4297-86d0-868a5b8eab1a';
const V73 = 'c6efed13-ce9d-41b0-89a5-8ca8b029a609';
const SI = '0x04a65d5c79bc57797b5bb25397053c6a9a084444';

const PASS_TOKENS = [
  ['0x92aac04f03278ce7ac82ba0367dbaf9686437777', 'S004 無為'],
  ['0xb97d5772bf70814161d29243b0e39ec62f734444', 'S072 無為'],
  ['0x24436292ae46bb4f0bdc4389d7180eaa82747777', 'S110'],
  ['0xc88bf78562ad5b5212dc31750a694c1cf5d17777', 'S125'],
  ['0x275c17eb37d8e5d4184d2f12565e4b4722727777', 'S127/S128'],
  ['0xb88113c98d5e33b15925edd635170e80a0fbffff', 'S132'],
  ['0xbcb27c14a0faec17461cb6101810aee9fb554444', 'S138'],
  ['0x5a8d94c69998daffcfdc365f1d333dc4ab087777', 'S156 羊王'],
];
const BOUGHT = ['0x1ff6da98', '0xdc191037', '0xcba062de'].map((p) => p.toLowerCase()); // 前缀

async function main() {
  const { dbManager } = require('../src/services/dbManager');
  const db = dbManager.getClient();

  // ── A. bt-v76 相关 token 全 BUY 信号 ──
  const tokens = [...PASS_TOKENS.map((t) => t[0])];
  const { data: sigs, error: e1 } = await db.from('strategy_signals')
    .select('id,token_address,token_symbol,executed,reason,metadata,created_at')
    .eq('experiment_id', BT).eq('signal_type', 'BUY')
    .in('token_address', tokens);
  if (e1) throw new Error('bt76 信号读取失败: ' + e1.message);
  // 已买但不在通过集的（前缀匹配补拉）
  for (const pre of BOUGHT) {
    if (tokens.some((t) => t.startsWith(pre))) continue;
    const { data: d, error } = await db.from('strategy_signals')
      .select('id,token_address,token_symbol,executed,reason,metadata,created_at')
      .eq('experiment_id', BT).eq('signal_type', 'BUY').ilike('token_address', pre + '%');
    if (!error && d) sigs.push(...d);
  }
  console.log(`[A] bt-v76 通过集+补拉 BUY 信号共 ${sigs.length} 行`);
  if (sigs[0]) console.log('[A] metadata 顶层键:', Object.keys(sigs[0].metadata || {}).join(','));

  const priceOf = (m) => {
    if (m == null) return null;
    if (typeof m.currentPriceBnb === 'number') return m.currentPriceBnb;
    if (m.factorResults && typeof m.factorResults.currentPriceBnb === 'number') return m.factorResults.currentPriceBnb;
    if (typeof m.price === 'number') return m.price;
    return null;
  };
  const byTok = new Map();
  for (const s of sigs) {
    if (!byTok.has(s.token_address)) byTok.set(s.token_address, []);
    byTok.get(s.token_address).push(s);
  }
  for (const [addr, label] of PASS_TOKENS) {
    const rows = (byTok.get(addr) || []).sort((a, b) => a.created_at.localeCompare(b.created_at));
    console.log(`\n== 通过票 ${label} ${addr} — 信号 ${rows.length} 条`);
    if (!rows.length) { console.log('   ❌ 零信号（腿未触发/节流拦截）'); continue; }
    for (const s of rows) {
      const m = s.metadata || {};
      const sg = m.signalGate || {};
      const c = m.cheatCheck || {};
      const b = m.buyPoint || {};
      const asm = b.assessment || {};
      const p = priceOf(m);
      console.log(`   ${s.created_at.slice(11, 19)} p=${p != null ? Number(p).toExponential(3) : '?'} leg=${(sg.legId || '?')}#${sg.triggerNo ?? '?'} `
        + `cheat=${c.grade || c.status || '-'}${c.cached ? '(cached)' : ''} bp=${b.status || asm.bucket || '-'}${asm.bucket ? '/' + asm.bucket + '(' + (asm.rule || '') + ' p=' + (asm.prob != null ? Number(asm.prob).toFixed(2) : '?') + ')' : ''} `
        + `anchorTicks=${b.anchorTickCount ?? '-'} → ${s.executed ? '✅执行' : '拒(' + (m.execution_reason || s.reason || '未执行') + (m.execution_status ? '/' + m.execution_status : '') + ')'}`);
    }
  }

  // ── B. SI 对照 ──
  console.log('\n===== B. SI 0x04a65d5c 价格对照 =====');
  const { data: siBt, error: e2 } = await db.from('strategy_signals')
    .select('id,executed,reason,metadata,created_at')
    .eq('experiment_id', BT).eq('signal_type', 'BUY').eq('token_address', SI);
  if (e2) throw new Error(e2.message);
  const priceOf2 = (m) => {
    if (m == null) return null;
    if (typeof m.currentPriceBnb === 'number') return m.currentPriceBnb;
    if (m.factorResults && typeof m.factorResults.currentPriceBnb === 'number') return m.factorResults.currentPriceBnb;
    if (typeof m.price === 'number') return m.price;
    return null;
  };
  const DIM_KEYS = ['market_heat', 'activity_level', 'famous_domination', 'holder_concentration', 'price_level', 'market_pattern', 'entry_position', 'price_trend'];
  for (const s of siBt.sort((a, b) => a.created_at.localeCompare(b.created_at))) {
    const m = s.metadata || {}; const b = m.buyPoint || {}; const asm = b.assessment || {};
    const anchors = b.anchors || {};
    const dims = b.dimensions || m.dimensions || {};
    console.log(`[bt76信号] ${s.created_at.slice(11, 19)} price=${Number(priceOf2(m)).toExponential(4)} leg=${(m.signalGate || {}).legId} `
      + `bp=${b.status}${asm.bucket ? '/' + asm.bucket : ''} p=${asm.prob ?? '-'} rule=${asm.rule || '-'} → ${s.executed ? '执行' : '拒(' + (m.execution_reason || s.reason || '未执行') + ')'}`);
    if (b.status === 'assessed') {
      console.log(`   anchors: lastPrice=${anchors.lastPriceBnb != null ? Number(anchors.lastPriceBnb).toExponential(4) : '?'} launchPrice=${anchors.launchPriceBnb != null ? Number(anchors.launchPriceBnb).toExponential(4) : '?'} spanSec=${anchors.spanSec} tickCount=${anchors.tickCount} curVsLaunch=${anchors.currentVsLaunchPct} mcap=${anchors.mcapBnb} maxChg5=${anchors.maxChg5Pct}`);
      const dimStr = DIM_KEYS.map((k) => dims[k] ? `${k}=${dims[k].bucket}(${dims[k].prob != null ? Number(dims[k].prob).toFixed(2) : '?'})` : '').filter(Boolean).join(' ');
      console.log(`   dims: ${dimStr}`);
      console.log(`   qualities: ${JSON.stringify(b.qualities || m.qualities || {})}`);
    }
  }
  const { data: siBtT, error: e3 } = await db.from('trades')
    .select('trade_direction,input_currency,input_amount,output_currency,output_amount,unit_price,executed_at')
    .eq('experiment_id', BT).eq('token_address', SI).order('executed_at');
  if (e3) throw new Error(e3.message);
  for (const t of siBtT) console.log(`[bt76成交] ${t.executed_at.slice(11, 19)} ${t.trade_direction} in=${t.input_amount}(${t.input_currency}) out=${t.output_amount}(${t.output_currency}) unit=${t.unit_price != null ? Number(t.unit_price).toExponential(4) : '?'}`);

  const { data: siV73, error: e4 } = await db.from('strategy_signals')
    .select('id,executed,reason,created_at,metadata')
    .eq('experiment_id', V73).eq('signal_type', 'BUY').eq('token_address', SI).order('created_at');
  if (e4) throw new Error(e4.message);
  for (const s of siV73) {
    const m = s.metadata || {}; const b = m.buyPoint || {}; const asm = b.assessment || {};
    const anchors = b.anchors || {};
    const dims = b.dimensions || m.dimensions || {};
    console.log(`[v73信号] ${s.created_at.slice(11, 19)} price=${Number(priceOf2(m)).toExponential(4)} leg=${(m.strategyName || (m.signalGate || {}).legId || '?')} bp=${b.status}${asm.bucket ? '/' + asm.bucket : ''} → ${s.executed ? '执行' : '拒(' + (m.execution_reason || s.reason || '未执行') + ')'}`);
    if (b.status === 'assessed') {
      console.log(`   anchors: lastPrice=${anchors.lastPriceBnb != null ? Number(anchors.lastPriceBnb).toExponential(4) : '?'} launchPrice=${anchors.launchPriceBnb != null ? Number(anchors.launchPriceBnb).toExponential(4) : '?'} spanSec=${anchors.spanSec} tickCount=${anchors.tickCount} curVsLaunch=${anchors.currentVsLaunchPct} mcap=${anchors.mcapBnb} maxChg5=${anchors.maxChg5Pct}`);
      const dimStr = DIM_KEYS.map((k) => dims[k] ? `${k}=${dims[k].bucket}(${dims[k].prob != null ? Number(dims[k].prob).toFixed(2) : '?'})` : '').filter(Boolean).join(' ');
      if (dimStr) console.log(`   dims: ${dimStr}`);
    }
  }
  const { data: siV73T, error: e5 } = await db.from('trades')
    .select('trade_direction,input_amount,output_amount,unit_price,executed_at')
    .eq('experiment_id', V73).eq('token_address', SI).order('executed_at');
  if (e5) throw new Error(e5.message);
  for (const t of siV73T) console.log(`[v73成交] ${t.executed_at.slice(11, 19)} ${t.trade_direction} in=${t.input_amount} out=${t.output_amount} unit=${t.unit_price != null ? Number(t.unit_price).toExponential(4) : '?'}`);

  // ── C. SI 平台/quote 状态（wss_events）+ v73 SI 信号原始 metadata.price 逐条 ──
  console.log('\n===== C. SI wss_events（平台/quote） =====');
  const { data: evs, error: e6 } = await db.from('wss_events')
    .select('kind,block_time,payload')
    .eq('token_address', SI).order('block_time');
  if (e6) console.log('wss_events 查询失败:', e6.message);
  else for (const e of evs) {
    const p = e.payload || {};
    const brief = { platform: p.platform, quoteToken: p.quoteToken ?? p.quote_token ?? p.quote, name: p.name, symbol: p.symbol, creator: (p.creatorAddress || '').slice(0, 12) };
    console.log(`   ${String(e.block_time).slice(11, 19)} ${e.kind} ${JSON.stringify(brief)}`);
  }
  // v73 SI 全信号 price 键逐条（fire 价体系直读）
  console.log('----- v73 SI 信号 metadata.price 逐条 -----');
  for (const s of siV73) {
    const m = s.metadata || {};
    console.log(`   ${s.created_at.slice(11, 19)} metadata.price=${typeof m.price === 'number' ? m.price.toExponential(4) : '?'} currentPriceBnb=${m.currentPriceBnb != null ? Number(m.currentPriceBnb).toExponential(4) : '-'} buyPriceBnb=${m.buyPriceBnb != null ? Number(m.buyPriceBnb).toExponential(4) : '-'} executed=${s.executed}`);
  }

  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
