// 一次性（182 跑）：三案二轮取证。
// R1 정책콕：前 20 笔 (ts,type,bnb,token_amount,postPrice)——price_bnb=成交后边际价（flap collector
//    源码 d[6]=postPrice），需曲线反演真实发布价 P0（T130 地板锚=滑点后边际价≠发布价，用户质疑成立）
// R2 阿拉伯：两钱包（0.2309/0.2286）完整地址+行级 tick 明细（用户 signals 页没找到——给 tx 级证据）
// R3 苹果SI：executed 成交信号+trades 行+成交点位价格（用户指的是成交点位非首信号）
const { dbManager } = require('../../src/services/dbManager.js');
const EXP = '11fc182a-b051-4665-857c-5c14e6713334';
const parse = (m) => { try { return typeof m === 'string' ? JSON.parse(m) : (m || {}); } catch { return {}; } };
const ts = (s) => String(s || '').slice(11, 19);

async function pullTicks(c, addr, n) {
  const { data, error } = await c.from('wss_price_ticks')
    .select('id,block_time,trade_type,bnb_amount,token_amount,price_bnb,sender_address,trader_address,tx_hash,platform')
    .eq('token_address', addr).order('id', { ascending: true }).limit(n || 300);
  if (error) throw new Error('ticks: ' + error.message);
  return data || [];
}

(async () => {
  const c = await dbManager.getClient();

  // ===== R1 정책콕 前 20 笔明细（曲线反演原料）=====
  {
    const rows = await pullTicks(c, '0x9d147fa0e447d98cf1a7ac32f114f6d0b9877777', 40);
    console.log('===== R1 정책콕 前 20 笔（price_bnb=成交后边际价）=====');
    rows.slice(0, 20).forEach((r, i) => {
      console.log(`${i + 1}|${ts(r.block_time)}|${r.trade_type}|bnb=${Number(r.bnb_amount).toFixed(6)}|tok=${Number(r.token_amount).toFixed(1)}|postP=${Number(r.price_bnb).toExponential(5)}|${r.platform}`);
    });
  }

  // ===== R2 阿拉伯 两钱包行级明细 =====
  {
    const rows = await pullTicks(c, '0xa8e70ca07b68a07683c963513a26f2fa91647777', 600);
    console.log('\n===== R2 阿拉伯 锚窗买入聚合复核+两钱包行明细 =====');
    // 重新聚合（完整地址）
    const wb = new Map();
    for (const r of rows) {
      if (Date.parse(r.block_time) > Date.parse('2026-11-10T04:46:51')) continue;
      if (r.trade_type !== 'buy') continue;
      const a = (r.sender_address || r.trader_address || '').toLowerCase();
      const e = wb.get(a) || { bnb: 0, n: 0 };
      e.bnb += Number(r.bnb_amount || 0); e.n++;
      wb.set(a, e);
    }
    const top = [...wb.entries()].sort((x, y) => y[1].bnb - x[1].bnb).slice(0, 6);
    top.forEach(([a, e], i) => console.log(`top${i + 1} ${a} 累计 ${e.bnb.toFixed(4)} BNB / ${e.n} 笔`));
    // 两钱包的行级明细
    for (const [a, e] of top.slice(0, 2)) {
      console.log(`--- ${a} 的行明细 ---`);
      rows.filter((r) => (r.sender_address || r.trader_address || '').toLowerCase() === a)
        .forEach((r) => console.log(`  ${ts(r.block_time)} ${r.trade_type} bnb=${Number(r.bnb_amount).toFixed(4)} tok=${Number(r.token_amount || 0).toFixed(1)} postP=${Number(r.price_bnb).toExponential(4)} trader=${r.trader_address} tx=${r.tx_hash}`));
    }
  }

  // ===== R3 苹果SI 成交信号+trades =====
  {
    const addr = '0xc9bf4530033f6497002d228296fedb45036f7777';
    const { data: sigs } = await c.from('strategy_signals')
      .select('id,created_at,metadata').eq('experiment_id', EXP)
      .eq('signal_type', 'BUY').eq('token_address', addr).order('id');
    console.log('\n===== R3 苹果SI 全部 BUY 信号执行状态 =====');
    for (const s of sigs.data || []) {
      const m = parse(s.metadata);
      console.log(`${ts(s.created_at)} ${m.execution_status || '?'} ${(m.strategyName || '').replace('买入策略 ', '')} trig=${(m.signalGate || {}).triggerNo ?? '-'} cheat=${(m.cheatCheck || {}).grade} bp=${((m.buyPoint || {}).assessment || {}).rule || '无段'}`);
    }
    const { data: trades } = await c.from('trades')
      .select('*').eq('experiment_id', EXP).eq('token_address', addr).order('id');
    console.log(`--- trades ${trades ? trades.length : 0} 行 ---`);
    for (const t of trades || []) {
      console.log(`${ts(t.executed_at || t.created_at)} ${t.trade_direction} in=${t.input_amount} out=${t.output_amount} ${Object.keys(t).filter((k) => /price/i.test(k)).map((k) => k + '=' + t[k]).join(' ')}`);
    }
    // 成交时刻附近价格（前后各 5min 的 tick 采样）
    if (trades && trades.length) {
      const firstBuy = trades.find((t) => /buy|买入/i.test(t.trade_direction || ''));
      if (firstBuy) {
        const at = Date.parse(firstBuy.executed_at || firstBuy.created_at);
        const rows = await pullTicks(c, addr, 4000);
        const near = rows.filter((r) => Math.abs(Date.parse(r.block_time) - at) <= 300000 && Number(r.price_bnb) > 0);
        // 每 30s 采样
        const by30 = new Map();
        for (const r of near) {
          const k = Math.floor((Date.parse(r.block_time) - at) / 30000);
          const e = by30.get(k) || [];
          e.push(Number(r.price_bnb)); by30.set(k, e);
        }
        console.log(`--- 首笔成交 ${ts(firstBuy.executed_at || firstBuy.created_at)} 前后 5min 价格（30s 桶 min~max）---`);
        [...by30.entries()].sort((x, y) => x[0] - y[0]).forEach(([k, ps]) => {
          console.log(`  ${k < 0 ? '' : '+'}${(k * 30)}s ${Math.min(...ps).toExponential(4)}~${Math.max(...ps).toExponential(4)} (${ps.length}行)`);
        });
      }
    }
  }
  process.exit(0);
})().catch((e) => { console.error('FATAL', e && e.stack || e); process.exit(1); });
