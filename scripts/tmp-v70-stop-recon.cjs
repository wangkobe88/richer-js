// v70 停机对账：trades 按 token 分组净额（先验列名）+ experiments 行读取
const { dbManager } = require('../src/services/dbManager.js');
const EXP = 'f0898589-58f1-4101-a648-0dc9cad41f3a';

async function main() {
  const c = await dbManager.getClient();

  const probe = await c.from('experiments').select('*').limit(1);
  if (probe.error) throw probe.error;
  const expCols = Object.keys((probe.data || [])[0] || {});
  console.log('experiments 列:', expCols.join(','));
  const nameCol = expCols.includes('name') ? 'name' : expCols.includes('title') ? 'title' : 'experiment_name';

  const { data: exps, error: ee } = await c.from('experiments').select('*').eq('id', EXP).limit(1);
  if (ee) throw ee;
  const exp = (exps || [])[0];
  if (!exp) throw new Error('experiment 行不存在');
  console.log(`实验: ${exp[nameCol]} status=${exp.status} platform=${exp.config && exp.config.platform}`);
  const cfg = exp.config || {};
  console.log('config 键:', Object.keys(cfg).join(','));
  const fm = cfg.fourmemeWs || {};
  console.log('cheatCheck=', JSON.stringify(fm.cheatCheck || cfg.cheatCheck || null));
  console.log('live 段存在=', !!fm.live, ' narrative 相关=', Object.keys(fm).filter(k => /narr|cheat/i.test(k)).join(','));
  console.log('libraryRefs=', JSON.stringify((cfg.strategiesConfig && cfg.strategiesConfig.libraryRefs) || []));

  const { data: trades, error: te } = await c.from('trades')
    .select('token_symbol,token_address,trade_direction,trade_status,input_currency,output_currency,input_amount,output_amount,success,is_virtual_trade,created_at')
    .eq('experiment_id', EXP)
    .order('created_at', { ascending: true })
    .limit(500);
  if (te) throw te;
  console.log(`\ntrades 共 ${(trades || []).length} 行`);
  const byTok = {};
  for (const t of trades || []) {
    const k = t.token_address;
    byTok[k] = byTok[k] || { sym: t.token_symbol || '', buyN: 0, buyBnb: 0, sellN: 0, sellBnb: 0, netTok: 0, open: 0 };
    const isBuy = /buy/i.test(t.trade_direction || '');
    // 买=BNB 在 input 侧；卖=BNB 在 output 侧；token 数量在对侧
    const inA = Number(t.input_amount || 0), outA = Number(t.output_amount || 0);
    const inBnb = (t.input_currency || '').toUpperCase() === 'BNB';
    const outBnb = (t.output_currency || '').toUpperCase() === 'BNB';
    const bnb = inBnb ? inA : outBnb ? outA : 0;
    const tok = inBnb ? outA : outBnb ? inA : 0;
    if (isBuy) { byTok[k].buyN++; byTok[k].buyBnb += bnb; byTok[k].netTok += tok; }
    else { byTok[k].sellN++; byTok[k].sellBnb += bnb; byTok[k].netTok -= tok; }
    if (t.success && /buy/i.test(t.trade_direction || '')) byTok[k].open = 1;
  }
  let openCount = 0;
  for (const [k, v] of Object.entries(byTok)) {
    const openFlag = v.netTok > 1e-6 ? ' ←持仓未清' : '';
    if (v.netTok > 1e-6) openCount++;
    console.log(`${k} ${(v.sym || '').padEnd(10)} 买${v.buyN}/${v.buyBnb.toFixed(4)}BNB 卖${v.sellN}/${v.sellBnb.toFixed(4)}BNB 净代币${v.netTok.toFixed(0)}${openFlag}`);
  }
  console.log(`\n未清仓 token 数=${openCount}`);
  await dbManager.close?.();
}

main().catch(e => { console.error(e.message || e); process.exit(1); });
