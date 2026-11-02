#!/usr/bin/env node
/**
 * tmp：CD121 持续推价质询数据支撑（2026-11-01 组 22 用户裁定附注
 * 「持续推价很明显了，我直观看应该给 strong，不过可能购买时间点还没有那么明显」）
 * 拉 token 全生命 ticks：①观察窗（锚 44 笔=买点+4s）内外价格斜率对比
 * ②窗内同钱包连续主动买分布（D3.23 ⑤判据「连推=同钱包多笔连续主动买入」）
 * 182 跑：node scripts/cheat-detection/tmp-g22-cd121-pump.mjs
 */
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { createRequire } from 'module';

const HERE = dirname(fileURLToPath(import.meta.url));
const require_ = createRequire(import.meta.url);

const TOKEN = '0xac9c455faedc7d7b81566c93c4fbcc17a8337777'; // CD121 币安大股东
const ANCHOR_N = 44;

function sb() {
  const { dbManager } = require_('../../src/services/dbManager.js');
  return dbManager.getClient();
}

async function main() {
  const { data, error } = await sb()
    .from('wss_price_ticks')
    .select('block_time,block_number,log_index,trade_type,bnb_amount,price_bnb,price_outlier,trader_address,sender_address')
    .eq('token_address', TOKEN)
    .order('block_number', { ascending: true })
    .order('log_index', { ascending: true })
    .limit(3000);
  if (error) throw error;
  const rows = data.filter(r => r.price_bnb && !r.price_outlier);
  console.log('total ticks(with price):', rows.length, '/ raw:', data.length);

  const t0 = new Date(rows[0].block_time).getTime();
  const at = i => ((new Date(rows[i].block_time).getTime() - t0) / 1000).toFixed(1);
  const p = i => rows[i].price_bnb;

  // ① 全生命分桶价格轨迹（每 10 笔）+ 锚窗边界
  console.log('\n== 价格轨迹（每 10 笔一桶；ANCHOR=' + ANCHOR_N + ' 为观察窗尾=买点+4s）==');
  console.log('idx  t(s)    side(买x/卖y)  price           delta%');
  for (let i = 0; i < rows.length; i += 10) {
    const seg = rows.slice(i, Math.min(i + 10, rows.length));
    const nb = seg.filter(r => r.trade_type === 'buy').length;
    const ns = seg.length - nb;
    const dpct = i === 0 ? '-' : (((p(i) - p(0)) / p(0)) * 100).toFixed(1);
    const mark = (i < ANCHOR_N && i + 10 > ANCHOR_N) ? '  ←锚窗尾#' + ANCHOR_N : (i === 0 ? '  ←窗首' : '');
    console.log(String(i + 1).padStart(4), String(at(i)).padStart(6), ` b${nb}/s${ns}`.padEnd(9), p(i).toPrecision(6), String(dpct).padStart(8) + '%' + mark);
  }
  // 锚窗内/外关键数
  const winPct = ((p(ANCHOR_N - 1) - p(0)) / p(0)) * 100;
  let peak = 0, peakIdx = 0;
  rows.forEach((r, i) => { if (r.price_bnb > peak) { peak = r.price_bnb; peakIdx = i; } });
  console.log(`\n窗内(#1-#${ANCHOR_N})涨幅: ${winPct.toFixed(1)}%  (t=${at(ANCHOR_N - 1)}s)`);
  console.log(`全生命峰值: #${peakIdx + 1} t=${at(peakIdx)}s  +${(((peak - p(0)) / p(0)) * 100).toFixed(1)}%  (峰值在锚窗${peakIdx < ANCHOR_N ? '内' : '外，距窗尾 +' + (peakIdx + 1 - ANCHOR_N) + ' 笔 / +' + (at(peakIdx) - at(ANCHOR_N - 1)).toFixed(1) + 's'})`);
  console.log(`窗外峰值前买/卖: ${rows.slice(ANCHOR_N, peakIdx + 1).filter(r => r.trade_type === 'buy').length}b/${rows.slice(ANCHOR_N, peakIdx + 1).filter(r => r.trade_type === 'sell').length}s`);

  // ② 观察窗内同钱包连续主动买（D3.23 ⑤）
  console.log('\n== 窗内买笔钱包分布（wallet=sender||trader）==');
  const buys = rows.slice(0, ANCHOR_N).filter(r => r.trade_type === 'buy');
  const cnt = new Map();
  for (const r of buys) {
    const w = (r.sender_address || r.trader_address || '').toLowerCase();
    cnt.set(w, (cnt.get(w) || 0) + 1);
  }
  const top = [...cnt.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  console.log('买笔', buys.length, '钱包', cnt.size, 'top5:', top.map(([w, n]) => `${w.slice(0, 8)}×${n}`).join(' '));
  // 相邻买笔同钱包次数（连续性）
  let adj = 0;
  for (let i = 1; i < buys.length; i++) {
    const w1 = (buys[i - 1].sender_address || buys[i - 1].trader_address || '').toLowerCase();
    const w2 = (buys[i].sender_address || buys[i].trader_address || '').toLowerCase();
    if (w1 === w2) adj++;
  }
  console.log('相邻买笔同钱包次数:', adj, '/', buys.length - 1);
  // 窗内钱包笔均/中位
  const amts = buys.map(r => r.bnb_amount).sort((a, b) => a - b);
  const med = amts.length ? amts[Math.floor(amts.length / 2)] : 0;
  console.log('窗内买额: Σ', buys.reduce((s, r) => s + r.bnb_amount, 0).toFixed(4), '笔均', (buys.reduce((s, r) => s + r.bnb_amount, 0) / buys.length).toFixed(4), '中位', med.toFixed(4));
}

main().catch(e => { console.error(e); process.exit(1); });
