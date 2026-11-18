#!/usr/bin/env node
/** 临时诊断:0xba67…7777 活跃度 high 质疑——拉信号/cheat 行/锚窗 ticks 看 30s 窗内外分布 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');

const ADDR = '0xba67f3e17ebfc3e51645bb95122a747e9adf7777';
const EXP = '6e75ed6d-807a-4164-9551-d3b95d1fc37b';

async function main() {
  const db = dbManager.getClient();

  // 1) 该实验该 token 的 BUY 信号
  const sg = await db.from('strategy_signals').select('id,signal_type,action,executed,created_at,metadata,reason')
    .eq('experiment_id', EXP).eq('token_address', ADDR).order('created_at').limit(10);
  console.log('=== signals ===', (sg.data || []).length, 'err:', sg.error && sg.error.message);
  let anchor = null;
  for (const s of sg.data || []) {
    console.log('---', s.signal_type, s.action, 'executed=', s.executed, s.created_at, 'reason=', (s.reason || '').slice(0, 60));
    const md = s.metadata || {};
    const cc = md.cheatCheck || {};
    if (cc.grade) {
      console.log('  cheatCheck:', JSON.stringify({
        status: cc.status, grade: cc.grade, reasons: cc.gradeReasons || cc.reasons,
        levels: cc.levels, buckets: cc.buckets, activityLevel: cc.activityLevel, exempt: cc.exempt, exemptDenied: cc.exemptDenied,
        anchors_act: cc.anchors ? Object.fromEntries(Object.entries(cc.anchors).filter(([k]) => /act|near|idle|gap|span/i.test(k))) : null,
      }));
    }
    if (md.buyPoint) {
      const bp = md.buyPoint;
      console.log('  buyPoint.answers=', JSON.stringify(bp.answers || bp.qualities || null));
      console.log('  buyPoint.assess=', JSON.stringify(bp.assessment || bp.assessed || null));
      console.log('  buyPoint.anchors.act*=', JSON.stringify(Object.fromEntries(Object.entries(bp.anchors || {}).filter(([k]) => k.startsWith('act') || k.startsWith('win') || k.startsWith('near') || k.includes('span') || k.includes('Idle') || k.includes('Tick')))));
    }
    if (md.factorCheck) console.log('  factorCheck:', JSON.stringify(md.factorCheck).slice(0, 300));
    if (s.signal_type === 'BUY' && !anchor) anchor = s.created_at;
  }

  // 2) cheat_detection 行（该 token 全部，取最新几条）
  const cd = await db.from('cheat_detection').select('analyzed_at,verdict,snapshot_digest,question_version')
    .eq('token_address', ADDR).order('analyzed_at').limit(8);
  console.log('\n=== cheat_detection ===', (cd.data || []).length, 'err:', cd.error && cd.error.message);
  for (const r of cd.data || []) {
    const d = r.snapshot_digest || {};
    console.log('---', r.analyzed_at, 'verdict=', r.verdict, 'grade=', d.grade, 'qv=', r.question_version);
    if (d.activityLevel) console.log('  activityLevel=', JSON.stringify(d.activityLevel), 'actBucketKeys=', Object.keys(d));
    if (d.anchors) console.log('  anchors=', JSON.stringify(d.anchors).slice(0, 1500));
    if (d.gradeReasons) console.log('  gradeReasons=', JSON.stringify(d.gradeReasons));
  }

  // 3) 锚窗 ticks：信号前 6min（单 token 小范围）
  if (anchor) {
    const t = new Date(new Date(anchor).getTime() - 6 * 60 * 1000).toISOString();
    const tk = await db.from('wss_price_ticks')
      .select('block_time,block_number,price_bnb,bnb_amount,trade_type,trader_address,sender_address,price_outlier')
      .eq('token_address', ADDR).gte('block_time', t).lte('block_time', anchor)
      .order('id', { ascending: true }).limit(1000);
    const rows = tk.data || [];
    console.log('\n=== anchor window ticks ===', rows.length, 'anchor=', anchor, 'err:', tk.error && tk.error.message);
    const aTs = new Date(anchor).getTime();
    // 按 30s 桶聚合（锚前）
    const buckets = new Map();
    for (const r of rows) {
      const dt = (aTs - new Date(r.block_time).getTime()) / 1000;
      const b = Math.floor(dt / 30) * 30; // 距锚秒数桶起点
      if (!buckets.has(b)) buckets.set(b, { n: 0, buy: 0, sell: 0, buyBnb: 0, sellBnb: 0 });
      const x = buckets.get(b);
      x.n++;
      if (r.trade_type === 'buy') { x.buy++; x.buyBnb += Number(r.bnb_amount || 0); }
      else { x.sell++; x.sellBnb += Number(r.bnb_amount || 0); }
    }
    console.log('bucketStart(距锚s)  rows  buy  sell  buyBnb  sellBnb');
    for (const b of [...buckets.keys()].sort((x, y) => x - y)) {
      const x = buckets.get(b);
      console.log(String(b).padStart(5), String(x.n).padStart(5), String(x.buy).padStart(4), String(x.sell).padStart(4),
        x.buyBnb.toFixed(3).padStart(8), x.sellBnb.toFixed(3).padStart(8));
    }
    // 尾 30s 逐笔 + 30s~120s 逐笔概览
    console.log('\n=== 尾 60s 逐笔 ===');
    for (const r of rows) {
      const dt = (aTs - new Date(r.block_time).getTime()) / 1000;
      if (dt <= 60) {
        const w = (r.sender_address || r.trader_address || '').slice(0, 10);
        console.log(`-${dt.toFixed(1)}s`.padStart(8), r.trade_type, (Number(r.bnb_amount || 0)).toFixed(4).padStart(8),
          r.price_outlier ? 'OUTLIER' : '', w, 'blk', r.block_number);
      }
    }
  }

  await dbManager.close?.();
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
