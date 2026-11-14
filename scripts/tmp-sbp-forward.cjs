// 一次性（182 跑）：强庄研究——锚价 vs 锚后 15/60min 前向收益（验证「庄是拉盘的」假设）
// 口径：锚=fixtures anchor.tickCount 行；锚价=锚行 price_bnb；前向=锚行时刻 t0 后 +15/+60min 窗内可靠价 max 与 last
const { dbManager } = require('../src/services/dbManager.js');
const fs = require('fs');
const FIX = require('./cheat-detection/fixtures.json');

// 研究票集：强庄 10 + 维持 3 + 反例 2 + v71 对照（cheat 代表 8 + unhealthy 代表 4）
const GROUPS = {
  强庄: ['CD21','CD23','CD41','CD45','CD60','CD73','CD98','CD127','CD191','CD223'],
  维持: ['CD87','CD142','CD93'],
  反例: ['CD72','CD76'],
  v71cheat: ['CD185','CD196','CD199','CD205','CD213','CD224','CD229','CD234'],
  v71unhealthy: ['CD189','CD227','CD230','CD235'],
};

async function fetchToken(c, addr, limit) {
  const { data: probe } = await c.from('wss_price_ticks').select('id').eq('token_address', addr).order('id', { ascending: true }).limit(1);
  if (!probe || !probe.length) return null;
  const firstId = probe[0].id;
  const { data: rows, error } = await c.from('wss_price_ticks')
    .select('id,block_time,trade_type,bnb_amount,price_bnb')
    .gt('id', firstId - 1).lt('id', firstId + 20000)
    .order('id', { ascending: true }).limit(limit);
  if (error) throw new Error(error.message);
  return rows.filter(r => r.price_bnb > 0);
}

async function main() {
  const c = await dbManager.getClient();
  console.log('caseId,组,代币,锚,锚价,+15max%,+60max%,+60last%,锚后60min行数');
  for (const [grp, ids] of Object.entries(GROUPS)) {
    for (const id of ids) {
      const f = FIX.cases.find(x => x.caseId === id);
      if (!f) { console.log(`${id},${grp},缺失`); continue; }
      const anchorN = f.anchor && f.anchor.tickCount;
      try {
        const rows = await fetchToken(c, f.addr, 3000);
        if (!rows || rows.length < (anchorN || 1)) { console.log(`${id},${grp},${f.symbol},${anchorN},无tick行`); continue; }
        const win = rows.slice(0, anchorN);
        const p0 = win[win.length - 1].price_bnb;
        const t0 = new Date(win[win.length - 1].block_time).getTime();
        const fwd = rows.slice(anchorN).filter(r => new Date(r.block_time).getTime() >= t0);
        const inWin = (ms) => fwd.filter(r => new Date(r.block_time).getTime() - t0 <= ms);
        const pct = (p) => p0 > 0 ? ((p / p0 - 1) * 100) : NaN;
        const m15 = inWin(15 * 60e3), m60 = inWin(60 * 60e3);
        const max15 = m15.length ? Math.max(...m15.map(r => r.price_bnb)) : null;
        const max60 = m60.length ? Math.max(...m60.map(r => r.price_bnb)) : null;
        const last60 = m60.length ? m60[m60.length - 1].price_bnb : null;
        console.log([id, grp, `"${f.symbol}"`, anchorN, p0.toPrecision(4),
          max15 ? pct(max15).toFixed(1) : '-',
          max60 ? pct(max60).toFixed(1) : '-',
          last60 ? pct(last60).toFixed(1) : '-',
          m60.length].join(','));
      } catch (e) { console.log(`${id},${grp},${f.symbol},${anchorN},ERR:${e.message.slice(0, 40)}`); }
    }
  }
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
