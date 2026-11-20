#!/usr/bin/env node
// T183 影响面扫描：bt-v150 全部策略腿 SELL 信号在新门（smartHold+pump 管辖）下的
// 翻转面 + 前向 5min 价格对照。只拉每信号 ±窗口 ticks（小结果读取）。
const fs = require('fs');
const { dbManager } = require('../src/services/dbManager');

const EXP = '8ebaccce-62c6-4209-a2a0-40f361c49bf9';

async function main() {
  const sb = dbManager.getClient();
  const smRoster = new Set(Object.keys((JSON.parse(fs.readFileSync(__dirname + '/../data/kol-study/smartmoney-accum.json', 'utf8')).sources || {}).smartmoney || {}).map(s => s.toLowerCase()));
  const famRoster = new Set((JSON.parse(fs.readFileSync(__dirname + '/../config/rosters/famous-copy-wallets.json', 'utf8')).wallets || []).map(w => String(w).toLowerCase()));
  console.log(`rosters: smart=${smRoster.size} famous=${famRoster.size}`);

  // 泵失衡腿识别（引擎同口径：condition 含 sinceEntryNetBuyRatio 签名键）
  const { data: expRow } = await sb.from('experiments').select('config').eq('id', EXP).limit(1);
  const sellLegs = ((expRow[0].config || {}).strategiesConfig || {}).sellStrategies || [];
  const pumpIds = new Set();
  const pumpPriorities = new Set();
  const idName = new Map();
  for (const l of sellLegs) {
    idName.set(l.id, l.name);
    if (typeof l.condition === 'string' && l.condition.includes('sinceEntryNetBuyRatio')) {
      pumpIds.add(l.id);
      pumpPriorities.add(l.priority);
      console.log(`  pump 腿: P${l.priority} cond=${l.condition}`);
    }
  }

  // 全部 SELL 信号（分页）
  const sigs = [];
  let from = 0;
  while (true) {
    const { data } = await sb.from('strategy_signals')
      .select('created_at,token_address,reason,executed,metadata')
      .eq('experiment_id', EXP).eq('signal_type', 'SELL')
      .order('created_at', { ascending: true }).range(from, from + 499);
    if (!data || data.length === 0) break;
    sigs.push(...data); from += 500;
    if (data.length < 500) break;
  }
  // 只要策略腿（stallClose/graduation/stopLoss/cheatExit/manual 保命腿不管辖）
  const LEG_IDS = new Set(['stallClose', 'graduation', 'stopLoss', 'cheatExit', 'manual']);
  const stratSigs = sigs.filter(s => {
    const sid = s.metadata?.strategyId;
    return sid && !LEG_IDS.has(sid);
  });
  console.log(`SELL 总=${sigs.length} 策略腿=${stratSigs.length}`);

  async function ticksFor(token, t0) {
    const { data } = await sb.from('wss_price_ticks')
      .select('block_time,block_number,log_index,trade_type,bnb_amount,price_bnb,sender_address,trader_address,price_outlier')
      .eq('token_address', token)
      .gte('block_time', new Date(t0 - 400000).toISOString()).lte('block_time', new Date(t0 + 400000).toISOString())
      .order('block_time', { ascending: true }).limit(4000);
    return data || [];
  }

  let flips = [], pumps = 0, pp100 = 0;
  for (let i = 0; i < stratSigs.length; i++) {
    const s = stratSigs[i];
    const md = s.metadata || {};
    const sid = String(md.strategyId || '');
    // config 腿无 id（load 时分配 sell_{i}_{p}），按 reason 尾缀 priority 反查签名腿
    const prioMatch = /\bP(\d+)\s*$/.exec(String(s.reason || ''));
    const isPump = pumpIds.has(sid) || (prioMatch && pumpPriorities.has(parseInt(prioMatch[1], 10)));
    const pp = typeof md.profitPercent === 'number' ? md.profitPercent : null;
    const t0 = Date.parse(s.created_at);
    const rows = await ticksFor(s.token_address, t0);
    const wallet = r => String(r.sender_address || r.trader_address || '').toLowerCase();
    const ok = r => !r.price_outlier && (r.bnb_amount || 0) >= 0.002;
    // smart/famous 流（近似 FA 口径：可靠价门=outlier+尘门；chainLate 同秒乱序忽略）
    let smartLast = null, smartSell60 = 0, famLast = null, famSell60 = 0;
    for (const r of rows) {
      const t = Date.parse(r.block_time);
      if (t > t0 || t < t0 - 200000) continue;
      if (!ok(r)) continue;
      const w = wallet(r);
      const isSm = smRoster.has(w), isFam = famRoster.has(w);
      if (r.trade_type === 'buy') {
        if (isSm && r.bnb_amount >= 0.02 && (smartLast === null || t > smartLast)) smartLast = t;
        if (isFam && r.bnb_amount >= 0.1 && (famLast === null || t > famLast)) famLast = t;
      } else {
        if (isSm && t > t0 - 60000) smartSell60 += r.bnb_amount;
        if (isFam && t > t0 - 60000) famSell60 += r.bnb_amount;
      }
    }
    const famHit = famLast !== null && (t0 - famLast) / 1000 <= 180 && famSell60 < 0.4;
    const smHit = smartLast !== null && (t0 - smartLast) / 1000 <= 180 && smartSell60 < 0.4;
    const governedOld = pp != null && pp >= 100;
    const governedNew = governedOld || isPump;
    const blockedOld = governedOld && famHit;
    const blockedNew = governedNew && (famHit || smHit);
    if (isPump) pumps++;
    if (governedOld) pp100++;
    if (blockedNew && !blockedOld) {
      // 前向 5min max price（近似持有效益上界）——卖价锚=同源 tick 集 t0 前最后
      //可靠价（md.price 单位口径不一弃用）
      let fwdMax = null, sellPx = null;
      for (const r of rows) {
        const t = Date.parse(r.block_time);
        if (r.price_bnb > 0 && !r.price_outlier && (r.bnb_amount || 0) >= 0.002) {
          if (t <= t0) sellPx = r.price_bnb;
          else if (t <= t0 + 300000 && (fwdMax === null || r.price_bnb > fwdMax)) fwdMax = r.price_bnb;
        }
      }
      flips.push({
        at: s.created_at, token: s.token_address, leg: md.strategyName || sid, pp,
        isPump, smSec: smartLast !== null ? +((t0 - smartLast) / 1000).toFixed(0) : null,
        famSec: famLast !== null ? +((t0 - famLast) / 1000).toFixed(0) : null,
        fwdMaxPct: fwdMax != null && sellPx ? +((fwdMax / sellPx - 1) * 100).toFixed(1) : null,
      });
    }
    if ((i + 1) % 25 === 0) console.log(`  …${i + 1}/${stratSigs.length}`);
  }
  console.log(`\n策略腿 SELL=${stratSigs.length}（pump 腿=${pumps}、pp≥100 域=${pp100}）→ 新增拦截=${flips.length}`);
  for (const f of flips) {
    console.log(`  [${String(f.at).replace('T', ' ').slice(0, 19)}] ${f.token.slice(0, 12)} leg=${f.leg} pp=${f.pp?.toFixed(1)} ${f.isPump ? '[pump]' : ''} sm=${f.smSec}s fam=${f.famSec}s 卖后5min最高=${f.fwdMaxPct != null ? f.fwdMaxPct + '%' : '?'}`);
  }
  const withFwd = flips.filter(f => f.fwdMaxPct != null);
  if (withFwd.length) {
    const pos = withFwd.filter(f => f.fwdMaxPct > 0).length;
    console.log(`\n前向对照：卖后5min最高价>卖价 ${pos}/${withFwd.length}；中位 max=${median(withFwd.map(f => f.fwdMaxPct))}%`);
  }
  function median(a) { const b = [...a].sort((x, y) => x - y); return b[Math.floor(b.length / 2)]; }
}
main().catch(e => { console.error(e); process.exit(1); });
