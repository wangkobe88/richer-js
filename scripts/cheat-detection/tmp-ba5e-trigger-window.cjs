// 一次性（182 跑）：ba5e（M4GA）v100 零 BUY 信号归因——ladder v16 十四腿在
// 27.5 价格门下是否曾有触发窗。输出 curVs 轨迹分桶 + 各里程碑（7/9/15 笔）
// 时刻的 curVs（fourmeme 盘，launch=T130 地板锚口径近似用首买价）。
const { dbManager } = require('../../src/services/dbManager.js');

const T = '0xba5ed45b42479e0a75316de7bf990ec90a3e4444';

async function main() {
  const sb = await dbManager.getClient();
  const rows = [];
  let fromId = 0;
  for (;;) {
    const { data, error } = await sb.from('wss_price_ticks')
      .select('id,block_time,trade_type,bnb_amount,price_bnb,trader_address,sender_address')
      .eq('token_address', T).gt('id', fromId).order('id', { ascending: true }).limit(1000);
    if (error) throw error;
    if (!data || !data.length) break;
    rows.push(...data);
    if (data.length < 1000) break;
    fromId = data[data.length - 1].id;
  }
  console.log('ba5e 全史 ticks:', rows.length, rows.length ? `${rows[0].block_time.slice(5, 19)} → ${rows[rows.length - 1].block_time.slice(5, 19)}` : '');
  // launch = min(FM 常量 4.496e-9, 首笔买入价)（T130 地板锚）
  const FM = 4496173469e-18;
  let firstBuy = null;
  for (const r of rows) if (r.trade_type === 'buy' && r.price_bnb > 0) { firstBuy = r.price_bnb; break; }
  const launch = Math.min(FM, firstBuy || FM);
  console.log(`首买价=${firstBuy} launch=min(FM,首买)=${launch.toExponential(4)}`);
  // 逐 tick 累计：tradeCount / buyVolume / curVs（可靠价=price_bnb>0）
  let trades = 0, buyVol = 0;
  const marks = [];
  const seen = new Set(); // tradeCount 里程碑打卡
  for (const r of rows) {
    trades++;
    if (r.trade_type === 'buy') buyVol += r.bnb_amount || 0;
    if (r.price_bnb > 0) {
      const curVs = (r.price_bnb / launch - 1) * 100;
      for (const m of [7, 9, 12, 15, 20, 25, 30, 36, 45]) {
        if (trades >= m && !seen.has(m)) {
          seen.add(m);
          marks.push(`n=${m} t=${r.block_time.slice(11, 19)} curVs=${curVs.toFixed(1)}% buyVol=${buyVol.toFixed(2)}B`);
        }
      }
    }
  }
  console.log('笔数里程碑时刻（t0=7笔/t0a=9笔/NL=15笔 门=tradeCount∧buyVol∧curVs≤27.5）:');
  for (const m of marks) console.log('  ' + m);
  // curVs 轨迹分桶：每 5 笔打印一次 curVs（看 ≤27.5 的窗口什么时候关闭）
  console.log('curVs 轨迹（每 5 笔）:');
  let n = 0;
  for (const r of rows) {
    n++;
    if (n % 5 === 0 && r.price_bnb > 0) {
      const curVs = (r.price_bnb / launch - 1) * 100;
      if (n <= 60 || n % 20 === 0) console.log(`  n=${n} t=${r.block_time.slice(11, 19)} curVs=${curVs.toFixed(1)}%`);
    }
  }
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e && e.stack || e); process.exit(1); });
