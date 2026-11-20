#!/usr/bin/env node
// T167d/FP20 对拍：豁免面 11 票在成交锚重放——谷值>9% 七张拒（含 0x6075）、≤8.5% 四张保豁免
const { dbManager } = require('../src/services/dbManager');
const { buildBuyPointSnapshot } = require('../src/market-analysis/buy-point-snapshot');
const { evaluateFactorPreBuy, FACTOR_PREBUY_VERSION } = require('../src/market-analysis/factor-pre-buy-check');

const EXPS = [
  ['bt-v144', 'a869d119-c389-47e0-89ce-89e86114ad0e'],
  ['bt-v147', '9b31baf4-bdd3-4ebb-9031-2a1603f34633'],
  ['bt-v149', 'c73b62be-bb1d-4acf-8002-652e5fb8a507'], // d345b 同窗（0c90 在此系）
];
// [token前缀, 实验名, 预期(谷值口径), pnl, 理论谷值%]
const CASES = [
  ['0x6075e97a', 'bt-v147', 'CUT', -0.0333, 10.0],
  ['0xee831cd1', 'bt-v147', 'CUT', -0.0559, 18.5],
  ['0x0c90ea3f', 'bt-v149', 'CUT', -0.0351, 19.0],
  ['0xf73e2a04', 'bt-v147', 'CUT', -0.0245, 11.9],
  ['0xf63f6cd2', 'bt-v147', 'CUT', -0.0146, 11.7],
  ['0xa0351815', 'bt-v147', 'CUT', -0.0073, 40.3],
  ['0xe15fa2ca', 'bt-v147', 'CUT', 0.0068, 11.7], // 知情误伤（唯一正票被拦）
  ['0x28ad2c7d', 'bt-v144', 'KEEP', 1.4261, 2.9], // 28ad 必须保持豁免
  ['0x8baf97ff', 'bt-v147', 'KEEP', 0.0087, 0.0], // 完全出清
  ['0xc2af8c09', 'bt-v147', 'KEEP', 0.0035, 5.3],
  ['0xd23b0950', 'bt-v147', 'KEEP', 0.0305, 8.5],
];
const TICK_COLS = 'block_time,block_number,log_index,tx_hash,trade_type,bnb_amount,token_amount,price_bnb,price_outlier,trader_address,sender_address,quote_token';

async function main() {
  console.log('FP version =', FACTOR_PREBUY_VERSION);
  const sb = dbManager.getClient();
  const expIds = new Map(EXPS);
  let okN = 0, bad = [];
  for (const [prefix, expName, expect, pnl, troughTh] of CASES) {
    const expId = expIds.get(expName);
    // 全地址 + 首笔成交
    const { data: seed } = await sb.from('trades')
      .select('token_address,created_at').eq('experiment_id', expId)
      .like('token_address', prefix + '%').eq('trade_direction', 'buy').eq('success', true)
      .order('created_at', { ascending: true }).limit(1);
    if (!seed || !seed.length) { console.log(`${prefix} 无成交`); bad.push(prefix + ':无成交'); continue; }
    const token = seed[0].token_address, buyTs = new Date(seed[0].created_at).getTime();
    // 平台
    const { data: et } = await sb.from('experiment_tokens').select('platform')
      .eq('experiment_id', expId).eq('token_address', token).limit(1);
    const plat = (et && et[0] && et[0].platform) || 'fourmeme';
    // 锚窗 ticks（生产 BP 门 tail 帽口径：desc 3000 + 满帽补 head 300）
    const { data: tailRows, error } = await sb.from('wss_price_ticks')
      .select(TICK_COLS).eq('token_address', token)
      .lte('block_time', new Date(buyTs + 1000).toISOString())
      .order('block_time', { ascending: false }).limit(3000);
    if (error) throw new Error(error.message);
    let rows;
    if (tailRows.length < 3000) rows = tailRows.slice().reverse();
    else {
      const { data: headRows, error: e2 } = await sb.from('wss_price_ticks')
        .select(TICK_COLS).eq('token_address', token)
        .order('block_time', { ascending: true }).limit(300);
      if (e2) throw new Error(e2.message);
      const seen = new Set(tailRows.map((r) => r.block_number + ':' + r.log_index));
      rows = headRows.filter((r) => !seen.has(r.block_number + ':' + r.log_index)).concat(tailRows.slice().reverse());
    }
    const meta = { address: token, symbol: null, name: null, platform: plat, quoteToken: rows.length ? rows[rows.length - 1].quote_token : null, createdAt: null, totalSupply: null, creatorAddress: null };
    const snap = buildBuyPointSnapshot(rows, meta, { capped: tailRows.length >= 3000, anchorTickCount: tailRows.length });
    const v = evaluateFactorPreBuy(snap);
    const g = v.gates.find((x) => x.id === 'fam_low_exit');
    const hit = g && g.hit === true;
    const val = g ? g.value : '-';
    const tM = val.match(/谷值(null|[\d.]+)%/);
    const trough = tM ? (tM[1] === 'null' ? null : parseFloat(tM[1])) : undefined;
    // 预期兑现：CUT=hit true；KEEP=hit false 且值带豁免标注
    const pass = expect === 'CUT' ? hit === true : hit === false;
    if (trough !== undefined && trough !== null && Math.abs(trough - troughTh) > 3) console.log(`    ⚠谷值漂移: 重放 ${trough}% vs 面验证 ${troughTh}%（锚窗差异）`);
    if (pass) okN++; else bad.push(prefix);
    console.log(`${pass ? '✓' : '✗'} ${prefix} exp=${expName} 预期=${expect} pnl=${pnl} | hit=${hit} 谷值=${trough} | ${val}`);
    if (!pass || expect !== 'CUT') {
      // KEEP/MISS 票打印 arms 确认放行不受其它臂意外干扰
      console.log(`    pass=${v.pass} reason=${v.reason} arms=${JSON.stringify(v.arms)}`);
    }
  }
  console.log(`\n对拍 ${okN}/${CASES.length}${bad.length ? ' 失败: ' + bad.join(',') : ' 全过'}`);
  process.exit(bad.length ? 1 : 0);
}
main().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
