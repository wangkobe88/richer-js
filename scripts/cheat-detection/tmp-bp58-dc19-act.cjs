// 一次性探针（182 跑）：bt-v95 dc191037 活跃度判定诊断——用户质疑「活跃度检测有问题，肯定不应该是 high」。
// 打印：act/heat 判定轨迹（全信号行）+ 信号锚窗末段 ticks 逐行（末 30s）+ 四臂判读原料自算。
const { dbManager } = require('../../src/services/dbManager.js');

const EXP = '675c71a1-0e19-49b6-924b-facffc073afd';
const TOKEN = '0xdc1910375c1c1c3d0c25c13ee6e5f2bec1887777';

async function main() {
  const client = await dbManager.getClient();
  const { data: sigs, error } = await client.from('strategy_signals')
    .select('id,created_at,signal_type,metadata')
    .eq('experiment_id', EXP).eq('token_address', TOKEN)
    .order('id', { ascending: true }).limit(30);
  if (error) throw new Error(error.message);
  console.log(`信号行=${(sigs || []).length}`);
  const anchors = [];
  for (const s of sigs || []) {
    const md = s.metadata || {};
    const bp = md.buyPoint || null;
    if (!bp) { console.log(`== ${s.created_at} ${s.signal_type} 无BP段`); continue; }
    const a = bp.assessment || {}, d = bp.dimensions || {}, an = bp.anchors || {};
    const dim = (k) => { const o = d[k] || {}; return `${o.bucket}(${o.prob != null ? Number(o.prob).toFixed(2) : '?'})`; };
    console.log(`== ${s.created_at} ${s.signal_type} 综=${a.bucket}(${a.rule}) act=${dim('activity_level')} heat=${dim('market_heat')} pattern=${dim('market_pattern')} entry=${dim('entry_shape')}`);
    console.log(`   锚 keys=${Object.keys(an).join(',')}`);
    console.log(`   尾窗/near 键值=${JSON.stringify(Object.fromEntries(Object.entries(an).filter(([k]) => /near|Tail|act|chg/i.test(k))))}`);
    if (bp.dimensions && bp.dimensions.activity_level && bp.dimensions.activity_level.evidence) {
      console.log(`   act evidence=${JSON.stringify(bp.dimensions.activity_level.evidence).slice(0, 600)}`);
    }
    anchors.push(s.created_at);
  }
  // 首个 BP 锚的末 30s ticks 逐行（四臂判读原料）
  const firstBp = (sigs || []).find((s) => s.metadata && s.metadata.buyPoint);
  if (firstBp) {
    const anchorMs = Date.parse(firstBp.created_at);
    const { data: rows, error: e2 } = await client.from('wss_price_ticks')
      .select('block_time,trade_type,bnb_amount,sender_address,trader_address')
      .eq('token_address', TOKEN).lte('block_time', firstBp.created_at)
      .order('block_number', { ascending: true }).order('log_index', { ascending: true }).limit(2000);
    if (e2) throw new Error(e2.message);
    const win = (rows || []).filter((r) => anchorMs - Date.parse(r.block_time) <= 30000);
    console.log(`\n锚=${firstBp.created_at} 前 30s 行数=${win.length}（全史行=${(rows || []).length}）`);
    for (const r of win) {
      const w = (r.sender_address || r.trader_address || '').slice(0, 8);
      const dt = ((anchorMs - Date.parse(r.block_time)) / 1000).toFixed(1);
      console.log(`  t-${dt}s ${r.trade_type} ${Number(r.bnb_amount || 0).toFixed(4)} ${w}`);
    }
    // 四臂原料自算：末 10s 独立卖钱包/尾 5s 买入/前 20s vs 末 10s 吞吐
    const last10 = win.filter((r) => anchorMs - Date.parse(r.block_time) <= 10000);
    const last5 = win.filter((r) => anchorMs - Date.parse(r.block_time) <= 5000);
    const pre20 = win.filter((r) => { const d = anchorMs - Date.parse(r.block_time); return d > 10000 && d <= 30000; });
    const sellW = new Set(last10.filter((r) => r.trade_type === 'sell').map((r) => (r.sender_address || r.trader_address || '').toLowerCase()));
    const buy10 = last10.filter((r) => r.trade_type === 'buy');
    const buy5 = last5.filter((r) => r.trade_type === 'buy');
    const bnbsum = (arr) => arr.reduce((a, r) => a + Number(r.bnb_amount || 0), 0);
    console.log(`\n四臂原料：末10s 行=${last10.length}(买${buy10.length}/${bnbsum(buy10).toFixed(3)} 卖${last10.length - buy10.length}/${bnbsum(last10.filter((r) => r.trade_type === 'sell')).toFixed(3)}) 独立卖钱包=${sellW.size} | 尾5s 行=${last5.length} 买=${buy5.length}/${bnbsum(buy5).toFixed(3)} | 前20s 行=${pre20.length}/${bnbsum(pre20).toFixed(3)}`);
  }
  const { data: trs } = await client.from('trades')
    .select('trade_type,input_amount,output_amount,success,executed_at')
    .eq('experiment_id', EXP).eq('token_address', TOKEN).order('id', { ascending: true }).limit(50);
  const ok = (trs || []).filter((r) => r.success);
  if (ok.length) {
    const inB = ok.filter((r) => r.trade_type === 'buy').reduce((a, r) => a + Number(r.input_amount || 0), 0);
    const outB = ok.filter((r) => r.trade_type === 'sell').reduce((a, r) => a + Number(r.output_amount || 0), 0);
    console.log(`trades: ${ok.length} 笔 净=${(outB - inB).toFixed(4)}`);
  }
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e && e.stack || e); process.exit(1); });
