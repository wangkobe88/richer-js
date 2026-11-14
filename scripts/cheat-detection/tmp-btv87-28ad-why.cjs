// 一次性查询（182 跑）：0x28ad2c7d 在 bt-v87 / bt-v86 / bt-v84 三实验的 BUY 信号门链全轨迹——定位为何 bt-v87 没买入
const path = require('path'); require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../../src/services/dbManager.js');
const db = dbManager.getClient();
const TOKEN = '0x28ad2c7d08d83a85467bd4afcfd673dfce564444';
const EXPS = [
  ['bt-v87(BP50)', 'c84fc413-4928-45ca-9a55-b0791921820e'],
  ['bt-v86(常量锚)', 'eba75ebc-85c1-4a3a-9b56-d522d1f76c66'],
  ['bt-v84(旧锚)', 'cd5759bf-2b82-43f1-8465-8b512bb43d33'],
];

async function main() {
  for (const [label, exp] of EXPS) {
    const { data } = await db.from('strategy_signals')
      .select('created_at,metadata,reason')
      .eq('experiment_id', exp).eq('signal_type', 'BUY').eq('token_address', TOKEN)
      .order('created_at');
    console.log(`\n===== ${label} ${exp.slice(0, 8)} | BUY 信号 ${(data || []).length} 条 =====`);
    for (const s of data || []) {
      const m = s.metadata || {};
      const sg = m.signalGate || {}; const cc = m.cheatCheck || {}; const bp = m.buyPoint || {};
      const cci = cc.info || cc;
      const bpA = bp.assessment || {}; const dims = bp.dimensions || {}; const an = bp.anchors || {};
      const mp = dims.market_pattern || {}; const chip = dims.holder_concentration || {};
      console.log(`\n· ${s.created_at.slice(5, 19)} leg=${(sg.legId || '-').replace('buy_', '')} exec=${m.execution_status || '?'}${m.execution_reason ? ' reason=' + m.execution_reason : ''}`);
      console.log(`  signalGate: triggerNo=${sg.triggerNo ?? '?'} ${sg.status ? 'status=' + sg.status : ''}`);
      if (Object.keys(cc).length) {
        console.log(`  cheat: status=${cci.status ?? cc.status} grade=${cci.grade} cached=${cci.cached}` +
          `${cci.exempt ? ' exempt=' + JSON.stringify(cci.exempt) : ''}` +
          `${cci.gradeReasons ? ' reasons=' + JSON.stringify(cci.gradeReasons) : ''}` +
          `${cci.marketReset != null ? ' reset=' + cci.marketReset : ''}${cci.anchorTickCount != null ? ' ticks=' + cci.anchorTickCount : ''}`);
      } else console.log('  cheat: (无段)');
      if (Object.keys(bp).length) {
        console.log(`  bp: status=${bp.status} bucket=${bpA.bucket} rule=${bpA.rule}` +
          `${bpA.exempt ? ' exempt=' + bpA.exempt.code : ''}` +
          ` pattern=${mp.bucket}(${mp.prob != null ? Number(mp.prob).toFixed(2) : '?'}) chip=${chip.bucket || '?'}` +
          ` curVs=${an.currentVsLaunchPct ?? '?'} minVs=${an.minVsLaunchPct ?? '?'}` +
          `${bp.insufficientReason ? ' insuff=' + bp.insufficientReason : ''}`);
      } else console.log('  bp: (无段)');
      if (m.failureReason) console.log('  failureReason:', m.failureReason);
    }
  }
  // 成交对照：trades 里该票在三实验的买卖
  for (const [label, exp] of EXPS) {
    const { data: tr } = await db.from('trades')
      .select('trade_direction,input_amount,output_amount,input_currency,output_currency,success,created_at')
      .eq('experiment_id', exp).eq('token_address', TOKEN).order('created_at');
    const buys = (tr || []).filter((t) => t.trade_direction === 'buy');
    const sells = (tr || []).filter((t) => t.trade_direction === 'sell');
    const bnb = (t, dir) => (dir === 'buy' ? (t.input_currency === 'BNB' ? t.input_amount : t.output_currency === 'BNB' ? t.output_amount : 0) : (t.output_currency === 'BNB' ? t.output_amount : t.input_currency === 'BNB' ? t.input_amount : 0));
    const bSum = buys.reduce((x, t) => x + Number(bnb(t, 'buy') || 0), 0);
    const sSum = sells.reduce((x, t) => x + Number(bnb(t, 'sell') || 0), 0);
    console.log(`\n${label} trades: 买 ${buys.length} 笔 ${bSum.toFixed(4)} BNB / 卖 ${sells.length} 笔 ${sSum.toFixed(4)} BNB / 净 ${(sSum - bSum).toFixed(4)}`);
  }
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e && e.stack || e); process.exit(1); });
