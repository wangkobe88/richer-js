#!/usr/bin/env node
/** netvol 回放：v26/v27/v28 买入票 20 只——90s 窗内毛/净买入曲线（价格段口径，尘<0.001 剔除）
 *  目的：评估 buyVolumeBnb(毛) 换/加 netBuyVolumeBnb(净=买−卖) 的区分度（腰斩族 vs 赢家） */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');

// [sym, addr, pnlBnb]（pnl=v26/27/28 trades BNB 盈亏）；e8da=未买对照
const SAMPLES = [
  ['SL', '0x58417f3f9ac500ee40a3882119cbb8a4686affff', -0.0022],
  ['FOURGE', '0xf9de0ca25d667c7dedbc1765bb05680a1828ffff', -0.0023],
  ['MAYA-eb2f', '0xeb2f6eab24672fd5cc1805e45de95abe891e7777', -0.0019],
  ['喵方丈', '0xc865723e30461cb77c2be00acef1d3b72cf57777', -0.0012],
  ['Pepina', '0x30586fc94b925bcad1930bbd84c6ac42cacc7777', -0.001],
  ['蝴蝶', '0x60d5c6991eae4253a6784af4c03d9bdc22487777', -0.001],
  ['binance', '0x1b381810e26e35ce7479334be3cc1ba0c12a7777', -0.002],
  ['啾总AI', '0x83a61126606737aaaf74dbb7f645c29642027777', -0.002],
  ['SUMMER', '0xaba831126dd69c604c424f5dc8483f69108d7777', -0.002],
  ['雪球', '0x2b87c082171ae4315307ebf9a2723d059d137777', -0.001],
  ['PIKACAT', '0x061cf9d8477680d32aa57542b114197e0bdc7777', -0.002],
  ['MEOW', '0x1c7a4176c1a71e5a3f1b7aea3787a01325317777', -0.002],
  ['海龟', '0x0adad648d69fa916fb5f30a380b9d3eaf2ac7777', -0.0023],
  ['乌龟', '0xb2782a4a27b1fc104c377a06e3cf455ca0fe7777', -0.0018],
  ['DeepSeek', '0x3d67f27df5241d947baedc96d8d24da977047777', -0.0013],
  ['辣条', '0x67252d73f1a46cb02f9a64c6ef42ada006c17777', 0.0025],
  ['JURTLE', '0xae2eb27ece3145ed18e1554038cabe7d26577777', 0.0019],
  ['케로로', '0x5b126f8e7d8d34666ba3e8ca04645b102dec7777', 0.0021],
  ['PHP', '0x7c70d72546a9b053da7a0831b45e471534017777', 0.0001],
  ['社会狗哥', '0x5410b96c2294889a68ebd2b7d198e76da4b57777', -0.0008],
  ['挠头女孩', '0xedc3fd03b1e64ac171fc83905333ea2fcb797777', -0.0008],
  ['抹茶旦旦', '0xfc001ae0434a9ef12924b35ee9a143a824d17777', -0.0010],
  ['가나디', '0xa270d34a39f8796de6a113a5596d5fc5ee627777', -0.0008],
  ['MAYA-e8da', '0xe8da305a2ea91281592e5a8e4565ad9aaa3c7777', null],
];
const DUST = 0.001;
const NET_BINS = [0.5, 0.75, 1.0, 1.25];

async function main() {
  const db = dbManager.getClient();
  const addrs = SAMPLES.map(s => s[1]);
  // 创建时间 + 买入执行时刻（一次 .in）
  const creates = {};
  for (let i = 0; i < addrs.length; i += 50) {
    const ev = await db.from('wss_events').select('token_address,block_time').eq('kind', 'token_create').in('token_address', addrs.slice(i, i + 50)).limit(100);
    if (ev.error) throw ev.error;
    for (const e of ev.data) if (!creates[e.token_address]) creates[e.token_address] = Date.parse(e.block_time);
  }
  const buyAt = {};
  for (let i = 0; i < addrs.length; i += 50) {
    const tr = await db.from('trades').select('token_address,executed_at').eq('trade_direction', 'buy').eq('success', true).in('token_address', addrs.slice(i, i + 50)).order('executed_at').limit(200);
    if (tr.error) throw tr.error;
    for (const t of tr.data) if (!buyAt[t.token_address]) buyAt[t.token_address] = Date.parse(t.executed_at);
  }
  console.log('creates=' + Object.keys(creates).length + '/24, buyAt=' + Object.keys(buyAt).length + '/23');

  const rows = [];
  for (const [sym, addr, pnl] of SAMPLES) {
    const createMs = creates[addr];
    if (!createMs) { console.log(sym, 'NO CREATE EVENT, skip'); continue; }
    const endMs = createMs + 90000;
    const fireMs = buyAt[addr] || null;
    // ticks 分页（链上真序）
    const ticks = []; let off = 0;
    while (true) {
      const q = await db.from('wss_price_ticks')
        .select('block_time,block_number,log_index,trade_type,bnb_amount')
        .eq('token_address', addr).gte('block_time', new Date(createMs - 2000).toISOString()).lte('block_time', new Date(endMs).toISOString())
        .order('block_number', { ascending: true }).order('log_index', { ascending: true })
        .range(off, off + 999);
      if (q.error) throw q.error;
      if (!q.data.length) break;
      ticks.push(...q.data); off += q.data.length;
      if (off > 6000) break;
    }
    let gross = 0, net = 0, sellSum = 0;
    let crossG125 = null, crossN = {}; NET_BINS.forEach(b => crossN[b] = null);
    let fireG = null, fireN = null, netAtG125 = null;
    let endG = 0, endN = 0, lastAge = 0;
    for (const r of ticks) {
      const t = Date.parse(r.block_time);
      if (t < createMs || t > endMs) continue;
      const age = (t - createMs) / 1000;
      const bnb = Number(r.bnb_amount) || 0;
      if (bnb >= DUST) {
        if (r.trade_type === 'buy') { gross += bnb; net += bnb; }
        else if (r.trade_type === 'sell') { net -= bnb; sellSum += bnb; }
      }
      if (crossG125 === null && gross >= 1.25) { crossG125 = age; netAtG125 = net; }
      for (const b of NET_BINS) if (crossN[b] === null && net >= b) crossN[b] = age;
      if (fireMs && t <= fireMs) { fireG = gross; fireN = net; }
      endG = gross; endN = net; lastAge = age;
    }
    rows.push({ sym, pnl, fireAge: fireMs ? ((fireMs - createMs) / 1000).toFixed(1) : '-', fireG, fireN, crossG125, netAtG125, crossN, endG, endN, sellSum, lastAge, nTicks: ticks.length });
    const fmt = v => v == null ? ' -' : v.toFixed(2);
    console.log(
      (pnl == null ? '[对照]' : pnl >= 0.0015 ? '[赢家]' : pnl >= -0.0010 ? '[平/微]' : '[输家]').padEnd(6),
      sym.padEnd(9), 'pnl=' + (pnl == null ? '  未买' : pnl.toFixed(4)),
      '| fire@' + (rows[rows.length - 1].fireAge + 's').padStart(6),
      '毛=' + fmt(fireG), '净=' + fmt(fireN),
      '| 毛首破1.25@' + (crossG125 == null ? 'never' : crossG125.toFixed(0) + 's(净' + netAtG125.toFixed(2) + ')'),
      '| 净首破1.25@' + (crossN[1.25] == null ? 'never' : crossN[1.25].toFixed(0) + 's'),
      '| 90s末 毛=' + endG.toFixed(2), '净=' + endN.toFixed(2), '净/毛=' + (endG > 0 ? Math.round(endN / endG * 100) : 0) + '%',
      '卖Σ=' + sellSum.toFixed(2), 'ticks=' + ticks.length
    );
  }

  // 分层汇总：fire 时刻与 90s 末的净/毛比
  const grp = {};
  for (const r of rows) {
    const g = r.pnl == null ? '对照' : r.pnl >= 0.0015 ? '赢家' : r.pnl >= -0.0010 ? '平微' : '输家';
    (grp[g] = grp[g] || []).push(r);
  }
  console.log('\n=== 分层汇总 ===');
  for (const [g, rs] of Object.entries(grp)) {
    const ratioEnd = rs.map(r => r.endG > 0 ? r.endN / r.endG : NaN).filter(v => !isNaN(v));
    const netAtFire = rs.filter(r => r.fireN != null).map(r => r.fireN);
    const gAtFire = rs.filter(r => r.fireG != null).map(r => r.fireG);
    const avg = a => a.length ? (a.reduce((x, y) => x + y, 0) / a.length) : NaN;
    console.log(g, 'n=' + rs.length,
      '| fire毛均值=' + avg(gAtFire).toFixed(2), 'fire净均值=' + avg(netAtFire).toFixed(2),
      '| 90s末净/毛均值=' + (ratioEnd.length ? Math.round(avg(ratioEnd) * 100) + '%' : '-'),
      '| 净首破1.25 比例=' + rs.filter(r => r.crossN[1.25] != null).length + '/' + rs.length);
  }
  await dbManager.close?.(); process.exit(0);
}
main().catch(e => { console.error('FATAL', e); process.exit(1); });
