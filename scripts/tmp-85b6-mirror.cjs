#!/usr/bin/env node
// 临时查证：0x85b605b4…b794 跨票行为 + 与 famous roster 同块镜像多发度（182 跑）
const fs = require('fs');
const path = require('path');
const { dbManager } = require('../src/services/dbManager');

const W = '0x85b605b47a5323912615cb8af834bb1c4716b794';
const A83B = '0xa83b73f5644cde337b61da79589f10ea15548811';

function loadRoster() {
  const j = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../config/rosters/famous-copy-wallets.json'), 'utf8'));
  return j.wallets.map((w) => w.toLowerCase());
}

async function pullAll(sb, filters) {
  // 分页拉全（1000/页）
  const out = [];
  let from = 0;
  for (;;) {
    let q = sb.from('wss_price_ticks')
      .select('token_address,block_time,block_number,log_index,trade_type,bnb_amount,sender_address')
      .order('id', { ascending: true }).range(from, from + 999);
    for (const [k, v] of Object.entries(filters)) q = q.eq(k, v);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    out.push(...(data || []));
    if (!data || data.length < 1000) break;
    from += 1000;
    if (from > 50000) throw new Error('over 50k rows, abort');
  }
  return out;
}

async function main() {
  const sb = dbManager.getClient();
  const roster = loadRoster();
  const rosterSet = new Set(roster.filter((w) => w !== A83B)); // 其余 33 址
  console.log(`roster=${roster.length}（a83b 单列）`);

  // 1) 目标钱包全史
  const rows = await pullAll(sb, { sender_address: W });
  console.log(`\n${W.slice(0, 10)} 全史行数=${rows.length}`);
  const byToken = {};
  for (const r of rows) {
    const t = (byToken[r.token_address] = byToken[r.token_address] || { buy: 0, sell: 0, n: 0, first: r.block_time, rows: [] });
    if (String(r.trade_type).toLowerCase() === 'buy') t.buy += Number(r.bnb_amount || 0); else t.sell += Number(r.bnb_amount || 0);
    t.n++;
    t.rows.push(r);
  }
  const tokens = Object.keys(byToken);
  console.log(`出现 token 数=${tokens.length}`);
  for (const [tok, t] of Object.entries(byToken)) {
    console.log(`  ${tok} 行=${t.n} 买=${t.buy.toFixed(3)}B 卖=${t.sell.toFixed(3)}B 卖比=${t.buy > 0 ? (t.sell / t.buy).toFixed(2) : '-'} 首见=${t.first}`);
  }

  // 2) 每票查 a83b 行（单地址）
  let a83bTok = 0, mirrorEq = 0, mirrorCoBlock = 0;
  const detail = [];
  for (const tok of tokens) {
    const arows = await pullAll(sb, { token_address: tok, sender_address: A83B });
    if (!arows.length) {
      // 3) a83b 不在场 → 查其余 roster
      const otherRows = [];
      for (let i = 0; i < roster.filter((w) => w !== A83B).length; i += 30) {
        const batch = roster.filter((w) => w !== A83B).slice(i, i + 30);
        const r2 = await pullAllWithIn(sb, tok, batch);
        otherRows.push(...r2);
      }
      if (otherRows.length) {
        const who = [...new Set(otherRows.map((r) => r.sender_address.toLowerCase()))];
        const co = coBlockPairs(byToken[tok].rows, otherRows);
        detail.push({ tok, partner: who, coBlock: co.count, equal: co.equal });
        console.log(`  [其它roster在场] ${tok}: ${who.map((w) => w.slice(0, 8)).join(',')} 同块对=${co.count} 等额对=${co.equal}`);
      } else {
        detail.push({ tok, partner: [], coBlock: 0, equal: 0 });
        console.log(`  [无roster] ${tok}`);
      }
      continue;
    }
    a83bTok++;
    const co = coBlockPairs(byToken[tok].rows, arows);
    if (co.count > 0) mirrorCoBlock++;
    if (co.equal > 0) mirrorEq++;
    detail.push({ tok, partner: ['a83b'], coBlock: co.count, equal: co.equal, pairs: co.sample });
    console.log(`  [a83b在场] ${tok}: 同块同向对=${co.count} 等额对=${co.equal}${co.sample ? ' 例:' + co.sample : ''}`);
  }

  console.log(`\n=== 汇总: token=${tokens.length} a83b在场=${a83bTok} 同块同向票=${mirrorCoBlock} 等额镜像票=${mirrorEq}`);
  process.exit(0);
}

async function pullAllWithIn(sb, tok, addrs) {
  const out = [];
  let from = 0;
  for (;;) {
    const { data, error } = await sb.from('wss_price_ticks')
      .select('token_address,block_time,block_number,trade_type,bnb_amount,sender_address')
      .eq('token_address', tok).in('sender_address', addrs)
      .order('id', { ascending: true }).range(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...(data || []));
    if (!data || data.length < 1000) break;
    from += 1000;
  }
  return out;
}

function coBlockPairs(rowsA, rowsB) {
  let count = 0, equal = 0;
  const sample = [];
  for (const a of rowsA) {
    for (const b of rowsB) {
      if (a.block_number !== b.block_number) continue;
      if (String(a.trade_type).toLowerCase() !== String(b.trade_type).toLowerCase()) continue;
      count++;
      const x = Number(a.bnb_amount), y = Number(b.bnb_amount);
      if (x > 0 && y > 0 && Math.abs(x - y) / Math.max(x, y) <= 0.01) {
        equal++;
        if (sample.length < 3) sample.push(`blk${a.block_number}:${a.trade_type} ${x.toFixed(4)}/${y.toFixed(4)}`);
      }
    }
  }
  return { count, equal, sample };
}

main().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
