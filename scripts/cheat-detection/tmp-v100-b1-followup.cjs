// 一次性（182 跑）：bt-v100 第一批四案取证（v100-R1~R4，用户反馈定位）。
// R1 정책콕：launch 锚取证——token_create payload+首 N 笔买入价 vs 四常量+信号 anchors
// R2 阿拉伯：散户 PVP 盘形丢失——锚窗 per-wallet 买入聚合+大户参与双臂事实
// R3 苹果SI：速跌尾声——全周期轨迹量化（ATH/锚前多窗跌幅/锚后走势）
// R4 苍蝇68bb：famous 识别——两址买卖聚合（锚窗+全史）+门链顺序事实
const { dbManager } = require('../../src/services/dbManager.js');
const EXP = '11fc182a-b051-4665-857c-5c14e6713334';
const FM_CONST = 4496173469e-18;
const ROSTER = require('../../config/rosters/famous-copy-wallets.json');
const parse = (m) => { try { return typeof m === 'string' ? JSON.parse(m) : (m || {}); } catch { return {}; } };
const short = (a) => (a ? a.slice(0, 8) + '…' + a.slice(-4) : '-');
const ts = (s) => String(s || '').slice(11, 19);

const CASES = [
  { id: 'R1', name: '정책콕', addr: '0x9d147fa0e447d98cf1a7ac32f114f6d0b9877777' },
  { id: 'R2', name: '阿拉伯', addr: '0xa8e70ca07b68a07683c963513a26f2fa91647777' },
  { id: 'R3', name: '苹果SI', addr: '0xc9bf4530033f6497002d228296fedb45036f7777', desc: true },
  { id: 'R4', name: '苍蝇68bb', addr: '0x68bb8cd436bdc8b178ab886b5a7abed5e6177777' },
];
const R4_FAMOUS = ['0xd44e17d5daeab4ec126e2c8395758b55f959298b', '0x3472ccf6209925204b9cf352171ee150904fda7e'];

async function firstSignal(c, addr) {
  const { data, error } = await c.from('strategy_signals')
    .select('id,created_at,metadata').eq('experiment_id', EXP)
    .eq('signal_type', 'BUY').eq('token_address', addr).order('id').limit(1);
  if (error) throw new Error('signals: ' + error.message);
  return data[0];
}

async function pullTicks(c, addr, withDesc) {
  const q = 'id,block_time,trade_type,bnb_amount,price_bnb,sender_address,trader_address';
  const asc = await c.from('wss_price_ticks').select(q).eq('token_address', addr)
    .order('id', { ascending: true }).limit(6000);
  if (asc.error) throw new Error('ticks asc: ' + asc.error.message);
  let rows = asc.data || [];
  const ids = new Set(rows.map((r) => r.id));
  if (withDesc) {
    const desc = await c.from('wss_price_ticks').select(q).eq('token_address', addr)
      .order('id', { ascending: false }).limit(2000);
    if (desc.error) throw new Error('ticks desc: ' + desc.error.message);
    for (const r of desc.data || []) if (!ids.has(r.id)) { rows.push(r); ids.add(r.id); }
  }
  rows.sort((a, b) => a.id - b.id);
  return rows;
}

function anchorWindow(rows, anchorMs) {
  return rows.filter((r) => Date.parse(r.block_time) <= anchorMs);
}

// ---------- R1：launch 锚 ----------
async function probeR1(c, cs, sig, rows) {
  console.log(`\n===== ${cs.id} ${cs.name} ${cs.addr} =====`);
  const m = parse(sig.metadata);
  const an = (m.buyPoint || {}).anchors || {};
  console.log(`锚=${ts(sig.created_at)} BP.anchors: launchPriceBnb=${an.launchPriceBnb} curVs=${an.currentVsLaunchPct} minVs=${an.minVsLaunchPct} athVs=${an.athVsLaunchPct}`);
  // token_create payload
  const { data: ev, error: eErr } = await c.from('wss_events')
    .select('kind,block_time,payload').eq('token_address', cs.addr).eq('kind', 'token_create').limit(1);
  if (eErr) console.log('wss_events err:', eErr.message);
  else if (ev && ev[0]) {
    const p = typeof ev[0].payload === 'string' ? parse(ev[0].payload) : (ev[0].payload || {});
    console.log(`token_create @${ts(ev[0].block_time)} payload keys: ${Object.keys(p).join(',')}`);
    console.log('payload:', JSON.stringify(p).slice(0, 800));
  } else console.log('token_create 行未找到');
  // 首 N 笔 buy 明细
  const buys = rows.filter((r) => r.trade_type === 'buy');
  console.log(`总行 ${rows.length}（buy ${buys.length}）· FM 常量=${FM_CONST.toExponential(4)}`);
  console.log('首 8 笔买入（价 vs 常量 偏差% = (p/const-1)*100，负=低于常量）：');
  buys.slice(0, 8).forEach((r, i) => {
    const p = Number(r.price_bnb || 0);
    console.log(`  #${i + 1} ${ts(r.block_time)} ${short(r.sender_address || r.trader_address)} bnb=${Number(r.bnb_amount).toFixed(4)} p=${p.toExponential(4)} vs常量${p > 0 ? ((p / FM_CONST - 1) * 100).toFixed(1) + '%' : '-'}`);
  });
  const p30 = buys.slice(0, 30).map((r) => Number(r.price_bnb)).filter((p) => p > 0);
  if (p30.length) {
    console.log(`首 30 笔买入价 min=${Math.min(...p30).toExponential(4)} max=${Math.max(...p30).toExponential(4)}（vs常量 ${(Math.min(...p30) / FM_CONST - 1) * 100 <= 0 ? '首段低于常量 → 真实发布价<常量' : '首段≥常量'}）`);
  }
}

// ---------- R2：散户 PVP ----------
async function probeR2(c, cs, sig, rows) {
  console.log(`\n===== ${cs.id} ${cs.name} ${cs.addr} =====`);
  const anchorMs = Date.parse(sig.created_at);
  const w = anchorWindow(rows, anchorMs);
  const wb = new Map();
  let buyN = 0, buyBnb = 0, ge03 = 0;
  for (const r of w) {
    if (r.trade_type !== 'buy') continue;
    buyN++; buyBnb += Number(r.bnb_amount || 0);
    if (Number(r.bnb_amount || 0) >= 0.3) ge03++;
    const a = (r.sender_address || r.trader_address || '').toLowerCase();
    const e = wb.get(a) || { bnb: 0, n: 0, first: r.block_time };
    e.bnb += Number(r.bnb_amount || 0); e.n++;
    wb.set(a, e);
  }
  console.log(`锚=${ts(sig.created_at)} 锚窗 ${w.length} 行；买入 ${buyN} 笔 ${buyBnb.toFixed(2)} BNB`);
  const top = [...wb.entries()].sort((x, y) => y[1].bnb - x[1].bnb).slice(0, 10);
  console.log('锚窗买入 top10 钱包：');
  top.forEach(([a, e], i) => console.log(`  ${i + 1}. ${short(a)} ${e.bnb.toFixed(4)} BNB / ${e.n} 笔 首见 ${ts(e.first)}`));
  const n02 = top.filter(([, e]) => e.bnb >= 0.19).length;
  console.log(`大户参与双臂（BP26）：累计买入 ≥0.19 的钱包数=${n02}（判据 ≥2 才满足）/ 单笔 ≥0.3 的笔数=${ge03}（判据 ≥1）`);
  console.log(`→ 大户参与${n02 >= 2 || ge03 >= 1 ? '满足（不应落②）' : '不满足（BP26 判序前置应直接落②retail_pvp）——BP 判 none 放行 = 判据未被 Jev 采信或锚窗事实与此不符'}`);
  // 近 30s 买入（活跃度佐证）
  const last = w.length ? Date.parse(w[w.length - 1].block_time) : anchorMs;
  let n30 = 0, b30 = 0;
  for (const r of w) if (r.trade_type === 'buy' && Date.parse(r.block_time) > last - 30000) { n30++; b30 += Number(r.bnb_amount || 0); }
  console.log(`锚前末 30s：买 ${n30} 笔 ${b30.toFixed(2)} BNB`);
}

// ---------- R3：速跌轨迹 ----------
async function probeR3(c, cs, sig, rows) {
  console.log(`\n===== ${cs.id} ${cs.name} ${cs.addr} =====`);
  const anchorMs = Date.parse(sig.created_at);
  const pr = rows.filter((r) => Number(r.price_bnb) > 0).map((r) => ({ t: Date.parse(r.block_time), p: Number(r.price_bnb) }));
  const asc = pr.slice().sort((a, b) => a.t - b.t);
  const first = asc[0], ath = asc.reduce((m, r) => (r.p > m.p ? r : m), asc[0]);
  const anchorP = asc.filter((r) => r.t <= anchorMs).pop();
  console.log(`锚=${ts(sig.created_at)} 可靠价行 ${pr.length}（时间跨度 ${((asc[asc.length - 1].t - first.t) / 60000).toFixed(1)} 分钟）`);
  console.log(`首可靠价=${first.p.toExponential(4)} @${ts(new Date(first.t))}；ATH=${ath.p.toExponential(4)} @${ts(new Date(ath.t))}（生命周期涨幅 +${((ath.p / first.p - 1) * 100).toFixed(1)}%）`);
  if (anchorP) {
    console.log(`锚时刻价=${anchorP.p.toExponential(4)}（vs ATH ${((anchorP.p / ath.p - 1) * 100).toFixed(1)}%，距 ATH ${((anchorMs - ath.t) / 1000).toFixed(0)}s）`);
    const win = (sec) => {
      const start = asc.filter((r) => r.t <= anchorMs - sec * 1000).pop();
      if (!start || !anchorP) return `  锚前 ${sec}s：无起点价`;
      return `  锚前 ${sec}s 段跌幅：${((anchorP.p / start.p - 1) * 100).toFixed(1)}%（起点 ${start.p.toExponential(4)} @${ts(new Date(start.t))}）`;
    };
    console.log(win(5)); console.log(win(30)); console.log(win(120));
    // 锚前 120s 每 10s 桶
    const buckets = [];
    for (let i = 12; i > 0; i--) {
      const lo = anchorMs - i * 10000, hi = anchorMs - (i - 1) * 10000;
      const seg = asc.filter((r) => r.t > lo && r.t <= hi);
      if (seg.length) buckets.push(`${ts(new Date(hi))} ${Math.min(...seg.map((r) => r.p)).toExponential(3)}~${Math.max(...seg.map((r) => r.p)).toExponential(3)}(${seg.length}行)`);
    }
    console.log('锚前 120s 每 10s 桶（min~max）：'); buckets.forEach((b) => console.log('  ' + b));
  }
  const after = asc.filter((r) => r.t > anchorMs);
  if (after.length) {
    const a5 = after.filter((r) => r.t <= anchorMs + 300000);
    const hi5 = a5.length ? Math.max(...a5.map((r) => r.p)) : null;
    console.log(`锚后走势：5min 内最高 ${hi5 ? hi5.toExponential(4) + `（vs 锚 ${(hi5 / (anchorP ? anchorP.p : hi5) * 100 - 100).toFixed(1)}%）` : '-'}；全程末价 ${after[after.length - 1].p.toExponential(4)} @${ts(new Date(after[after.length - 1].t))}（vs 锚 ${((after[after.length - 1].p / (anchorP ? anchorP.p : 1) - 1) * 100).toFixed(1)}%）`);
  }
}

// ---------- R4：famous 两址 ----------
async function probeR4(c, cs, sig, rows) {
  console.log(`\n===== ${cs.id} ${cs.name} ${cs.addr} =====`);
  const m = parse(sig.metadata);
  const cc = m.cheatCheck || {};
  console.log(`锚=${ts(sig.created_at)} cheat: grade=${cc.grade} status=${cc.status} reasons=${JSON.stringify((cc.reasons || []).map((r) => r.code))}`);
  console.log(`buyPoint 段=${m.buyPoint ? '在' : '无（cheat 拒在 BP 前）'}`);
  const anchorMs = Date.parse(sig.created_at);
  const rosterList = (Array.isArray(ROSTER) ? ROSTER : (ROSTER.wallets || ROSTER.addresses || []))
    .map((f) => String(typeof f === 'string' ? f : (f.address || '')).toLowerCase());
  const agg = (win, label) => {
    const buy = new Map(), sell = new Map(); let buyBnb = 0, buyN = 0;
    for (const r of win) {
      const a = (r.sender_address || r.trader_address || '').toLowerCase();
      const b = Number(r.bnb_amount || 0);
      if (r.trade_type === 'buy') { buyN++; buyBnb += b; buy.set(a, (buy.get(a) || 0) + b); }
      else sell.set(a, (sell.get(a) || 0) + b);
    }
    console.log(`${label}：${win.length} 行；买入 ${buyN} 笔 ${buyBnb.toFixed(2)} BNB`);
    for (const f of R4_FAMOUS) {
      const b = buy.get(f) || 0, s = sell.get(f) || 0;
      console.log(`  ${short(f)}${rosterList.includes(f) ? '[roster]' : '[未收录]'} 买 ${b.toFixed(4)} 卖 ${s.toFixed(4)} 净 ${(b - s).toFixed(4)} 占买 ${buyBnb > 0 && b > 0 ? (b / buyBnb * 100).toFixed(1) + '%' : '-'}`);
    }
    const otherFam = rosterList.filter((a) => !R4_FAMOUS.includes(a) && (buy.get(a) || 0) + (sell.get(a) || 0) > 0);
    if (otherFam.length) console.log(`  其余 roster 命中：${otherFam.map((a) => short(a) + ` 买${(buy.get(a) || 0).toFixed(2)}`).join(' ')}`);
    const top = [...buy.entries()].sort((x, y) => y[1] - x[1]).slice(0, 5);
    console.log('  买入 top5：' + top.map(([a, b]) => `${short(a)} ${b.toFixed(2)}B(${(b / Math.max(buyBnb, 1e-9) * 100).toFixed(1)}%)`).join(' '));
  };
  agg(anchorWindow(rows, anchorMs), '锚窗');
  agg(rows, '全史');
}

(async () => {
  const c = await dbManager.getClient();
  for (const cs of CASES) {
    const sig = await firstSignal(c, cs.addr);
    if (!sig) { console.log(`\n===== ${cs.id} ${cs.name}：无 BUY 信号 =====`); continue; }
    const rows = await pullTicks(c, cs.addr, !!cs.desc);
    if (!rows.length) { console.log(`\n===== ${cs.id} ${cs.name}：ticks 0 行（索引坑？）=====`); continue; }
    if (cs.id === 'R1') await probeR1(c, cs, sig, rows);
    else if (cs.id === 'R2') await probeR2(c, cs, sig, rows);
    else if (cs.id === 'R3') await probeR3(c, cs, sig, rows);
    else await probeR4(c, cs, sig, rows);
  }
  process.exit(0);
})().catch((e) => { console.error('FATAL', e && e.stack || e); process.exit(1); });
