// v18 重建前盘点：v17 持仓 / v17 config / buy-v2 库现状（182 跑，dbManager service key）
require('dotenv').config({ path: 'config/.env' });
const { dbManager } = require('../src/services/dbManager');

const V17 = '203570e3-6117-4841-bc50-936461e78a8a';

(async () => {
  const sb = dbManager.getClient();
  // 1. v17 experiments 行（列名按表实际：用 * 后打印键）
  const { data: expRows, error: e0 } = await sb.from('experiments').select('*').eq('id', V17).limit(1);
  if (e0) { console.log('exp error:', e0.message); return; }
  const exp = expRows[0];
  console.log('== v17 行 ==');
  console.log('cols:', Object.keys(exp).join(','));
  for (const k of ['id', 'name', 'experiment_name', 'title', 'status', 'platform', 'mode', 'created_at', 'started_at']) {
    if (exp[k] !== undefined) console.log(`  ${k}: ${JSON.stringify(exp[k])}`);
  }

  // 2. 净持仓（trades 买卖差）
  const { data: trades, error: e2 } = await sb.from('trades').select('*').eq('experiment_id', V17).order('executed_at').limit(500);
  if (e2) console.log('trades error:', e2.message);
  console.log('\n== v17 交易/持仓概览 ==  总 trades 行:', (trades || []).length);
  if ((trades || []).length) {
    console.log('trades cols:', Object.keys(trades[0]).join(','));
    const pos = {};
    for (const t of trades) {
      const k = t.token_symbol || t.token_address || '?';
      pos[k] = pos[k] || { buyN: 0, sellN: 0, buyBnb: 0, sellBnb: 0 };
      if (String(t.side).toLowerCase() === 'buy') { pos[k].buyN++; pos[k].buyBnb += Number(t.amount_bnb || t.bnb_amount || 0); }
      else { pos[k].sellN++; pos[k].sellBnb += Number(t.amount_bnb || t.bnb_amount || 0); }
    }
    console.log(JSON.stringify(pos, null, 2));
  }

  // 3. buy-v2 库现状
  const { data: libRows, error: e3 } = await sb.from('strategy_library').select('*').eq('name', 'buy-v2').limit(1);
  if (e3) console.log('lib error:', e3.message);
  const lib = libRows?.[0];
  console.log('\n== buy-v2 库 ==');
  console.log(JSON.stringify({ id: lib?.id, name: lib?.name, side: lib?.side, version: lib?.version, updated_at: lib?.updated_at }));
  for (const [i, leg] of (lib?.legs || []).entries()) {
    console.log(`--- leg[${i}] keys: ${Object.keys(leg).join(',')}`);
    for (const k of ['condition', 'preBuyCheckCondition', 'narrativeCallCondition', 'gmgnCheckCondition', 'repeatBuyCheckCondition']) {
      if (leg[k]) console.log(`  ${k}: ${leg[k]}`);
    }
  }

  // 4. v17 config 关键段
  console.log('\n== v17 config 关键段 ==');
  const cfg = exp.config || {};
  console.log('config 顶层 keys:', Object.keys(cfg).join(','));
  console.log('strategiesConfig:', JSON.stringify(cfg.strategiesConfig, null, 1).slice(0, 4000));
  const fm = cfg.fourmemeWs || {};
  console.log('fourmemeWs keys:', Object.keys(fm).join(','));
  console.log('dataPrefetch:', JSON.stringify(fm.dataPrefetch));
  console.log('narrativePrefetch:', JSON.stringify(fm.narrativePrefetch));
  console.log('visionPrefetch:', JSON.stringify(fm.visionPrefetch));
  console.log('faPreFilter:', fm.faPreFilter, '| gmgnCheck:', JSON.stringify(fm.gmgnCheck));
  console.log('narrativeRetry:', JSON.stringify(fm.narrativeRetry));
  console.log('positionManagement:', JSON.stringify(cfg.positionManagement));
  console.log('tokenPositionAnalyzer 段存在:', !!cfg.tokenPositionAnalyzer, '| gmgnFilter:', JSON.stringify(cfg.tokenPositionAnalyzer?.gmgnFilter));
  process.exit(0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
