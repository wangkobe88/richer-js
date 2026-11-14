// 一次性（182 跑）：dump bt-v100 三个样本信号（cheat 拒/豁免过/直过）的 cheatCheck+buyPoint
// 结构，确认维度键名后定稿 review 集清单脚本。
const { dbManager } = require('../../src/services/dbManager.js');
const EXP = '11fc182a-b051-4665-857c-5c14e6713334';
const SAMPLES = [
  '0x45ec048990b80b70448cf352b7064fda47557777', // cheat 拒（OCTO）
  '0x67ad68e06abb97572fe24c5c7b7c0fe47b8d7777', // healthy 直过成交
  '0x04323e04c5f48587951c2d974b7f1b007b6e7777', // 豁免过 + BP pattern_gate 拒
];
const parse = (m) => { try { return typeof m === 'string' ? JSON.parse(m) : (m || {}); } catch { return {}; } };
(async () => {
  const c = await dbManager.getClient();
  for (const addr of SAMPLES) {
    const { data, error } = await c.from('strategy_signals')
      .select('id,token_symbol,created_at,metadata').eq('experiment_id', EXP)
      .eq('signal_type', 'BUY').eq('token_address', addr).order('id').limit(1);
    if (error) throw new Error(error.message);
    const m = parse(data[0].metadata);
    console.log(`\n===== ${data[0].token_symbol} ${addr.slice(0, 8)}… #${data[0].id} =====`);
    const cc = m.cheatCheck || {};
    console.log('grade:', cc.grade, 'exempt:', JSON.stringify(cc.exempt), 'reasons:', JSON.stringify(cc.reasons));
    console.log('levels:', JSON.stringify(cc.levels));
    const bp = m.buyPoint || {};
    console.log('buyPoint keys:', Object.keys(bp).join(','));
    console.log('dimensions:', (JSON.stringify(bp.dimensions, null, 1) || '无').slice(0, 1400));
    console.log('assessment:', JSON.stringify(bp.assessment));
  }
  process.exit(0);
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
