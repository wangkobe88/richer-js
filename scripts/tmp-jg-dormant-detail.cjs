#!/usr/bin/env node
// 一次性：休眠强庄 7 票深挖——点火者身份/新鲜度、top1=creator?、拉盘后 top1 派发。
// 182 跑。用后可删。
'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');

const COL = 'a8414632-7c24-4762-9253-c49bb0f53105';
const TARGETS = [
  '0x1a0810861af30ed2b85ec2c195f36fb58fc97777', // cloutLab MATCH
  '0xe83626c404ee63b68ae2a7cdb17fd7d4d2c77777', // MATCH
  '0xac505555', '0xb71209', '0x898af4', '0x2335bc', '0x0bba00', // 差一旗
].map(s => s.toLowerCase());
const SUB = 0.05, IGN = 0.1;

(async () => {
  const sb = dbManager.getClient();
  const { data: members } = await sb.from('case_collection_tokens')
    .select('token_address, token_meta').eq('collection_id', COL);
  const byAddr = new Map(members.map(m => [m.token_address, m]));

  for (const prefix of TARGETS) {
    const m = members.find(x => x.token_address.startsWith(prefix));
    if (!m) { console.log(`!! 未找到 ${prefix}`); continue; }
    const rows = [];
    let cursor = 0;
    for (;;) {
      const { data: page } = await sb.from('case_ticks')
        .select('id, trade_type, bnb_amount, token_amount, price_bnb, price_outlier, block_number, log_index, block_time, sender_address, trader_address')
        .eq('collection_id', COL).eq('token_address', m.token_address)
        .gt('id', cursor).order('id', { ascending: true }).limit(1000);
      rows.push(...page);
      if (page.length < 1000) break;
      cursor = page[page.length - 1].id;
    }
    const ticks = rows.map(r => ({
      ts: new Date(r.block_time).getTime(), side: r.trade_type,
      bnb: Number(r.bnb_amount || 0), tok: Number(r.token_amount || 0),
      px: Number(r.price_bnb || 0), out: !!r.price_outlier,
      w: ((r.sender_address || r.trader_address) || '?').toLowerCase(),
      bn: Number(r.block_number || 0), li: Number(r.log_index || 0),
    })).sort((a, b) => a.bn - b.bn || a.li - b.li);

    const meta = m.token_meta || {};
    const sym = meta.symbol || m.token_address.slice(0, 8);
    const creator = (meta.creator || '').toLowerCase();
    const iso = ts => new Date(ts).toISOString().slice(11, 19);

    // 价格路径：ATH / 坑底 / 点火（同扫描器）
    const pr = ticks.filter(t => !t.out && t.px > 0);
    let athPx = 0, tAth = null;
    for (const t of pr) if (t.px > athPx) { athPx = t.px; tAth = t.ts; }
    let pMin = Infinity, tTrough = null;
    for (const t of pr) { if (t.ts > tAth) break; if (t.px <= pMin) { pMin = t.px; tTrough = t.ts; } }
    let ign = null;
    for (const t of ticks) { if (t.ts > tTrough && t.ts <= tAth && t.side === 'buy' && t.bnb >= IGN) { ign = t; break; } }
    const tS = ign ? ign.ts : tTrough;

    // t_ign 前状态 + 点火者前史
    const pos = new Map();
    for (const t of ticks) {
      if (t.ts >= tS) break;
      let a = pos.get(t.w); if (!a) { a = { netTok: 0, buyBnb: 0, sellBnb: 0, firstTs: null, sellCnt: 0 }; pos.set(t.w, a); }
      if (t.side === 'buy') { a.netTok += t.tok; a.buyBnb += t.bnb; if (!a.firstTs) a.firstTs = t.firstTs || a.firstTs || t.ts; a.firstTs = a.firstTs || t.ts; }
      else { a.netTok -= t.tok; a.sellBnb += t.bnb; a.sellCnt++; }
    }
    // 修正 firstTs（上面写得绕，重算一遍）
    for (const [w, a] of pos) { a.firstTs = null; }
    for (const t of ticks) { if (t.ts >= tS) break; const a = pos.get(t.w); if (a && t.side === 'buy' && !a.firstTs) a.firstTs = t.ts; }

    const holders = [...pos.entries()].filter(([, a]) => a.netTok > 0)
      .map(([w, a]) => ({ w, ...a, val: a.netTok * pMin })).sort((x, y) => y.val - x.val);
    const totVal = holders.reduce((s, h) => s + h.val, 0) || 1;
    const top1 = holders[0];

    // 点火者画像
    const igniter = ign ? ign.w : null;
    const ignPos = igniter ? (pos.get(igniter) || null) : null;
    const igniterIsCreator = igniter && creator && igniter === creator;
    const top1IsCreator = top1 && creator && top1.w === creator;

    // 拉盘后（tS 起）：top1 与点火者的卖出
    const post = { top1SellBnb: 0, ignSellBnb: 0, top1SellCnt: 0, ignSellCnt: 0 };
    const finalPos = new Map(holders.map(h => [h.w, h.netTok]));
    for (const t of ticks) {
      if (t.ts < tS) continue;
      if (t.side === 'buy') { const a = finalPos.get(t.w) || 0; finalPos.set(t.w, a + t.tok); }
      else {
        const a = finalPos.get(t.w) || 0; finalPos.set(t.w, a - t.tok);
        if (top1 && t.w === top1.w) { post.top1SellBnb += t.bnb; post.top1SellCnt++; }
        if (igniter && t.w === igniter) { post.ignSellBnb += t.bnb; post.ignSellCnt++; }
      }
    }
    const lastPx = pr[pr.length - 1].px;

    console.log(`\n===== ${sym} ${m.token_address} =====`);
    console.log(`  created=${meta.blockTimeIso ? meta.blockTimeIso.slice(11, 19) : iso(ticks[0].ts)} 点火=${iso(tS)} 坑底=${iso(tTrough)} ATH=${iso(tAth)}（点火后${((tAth - tS) / 60000).toFixed(1)}min）`);
    console.log(`  ×${(athPx / pMin).toFixed(1)} 坑底→末笔${(lastPx / pMin).toFixed(2)}x | 休眠: quiet=${Math.round((tS - ([...ticks].filter(t => t.ts < tS && t.bnb >= SUB).pop() || { ts: ticks[0].ts }).ts) / 1000)}s`);
    console.log(`  点火单: ${igniter ? igniter.slice(0, 12) : '-'} ${ign ? ign.bnb.toFixed(2) + 'B' : '-'} | 点火者前史: ${ignPos ? `老持仓者(netTok>0 首买${iso(ignPos.firstTs || 0)})` : igniter ? '全新钱包(票上首动作即点火)' : '-'}` + (igniterIsCreator ? ' ★=creator' : ''));
    console.log(`  持仓结构@点火: ${holders.length} 户 top1=${((top1.val / totVal) * 100).toFixed(1)}%=${top1.w.slice(0, 12)}${top1IsCreator ? '(=creator)' : ''} 值${top1.val.toFixed(2)}B | top1 休眠期零卖出=${top1.sellCnt === 0 ? '是(不砸盘)' : `否(${top1.sellCnt}笔/${top1.sellBnb.toFixed(2)}B, 回收比${(top1.sellBnb / Math.max(top1.buyBnb, 1e-9)).toFixed(2)})`}`);
    console.log(`  拉盘后: top1 卖出 ${post.top1SellCnt}笔/${post.top1SellBnb.toFixed(2)}B 终态净持≈${Math.max(finalPos.get(top1.w) || 0, 0).toFixed(0)}tok(值${((finalPos.get(top1.w) || 0) * lastPx).toFixed(2)}B)` + (igniter && igniter !== (top1 && top1.w) ? ` | 点火者卖出 ${post.ignSellCnt}笔/${post.ignSellBnb.toFixed(2)}B` : ''));
  }
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
