// 单票买入失败排查 d：钱包地址 + 上链查 nonce 归属
const { dbManager } = require('../src/services/dbManager.js');

const V59 = '260e9339-2a6d-4739-a6e1-90c94a6fe001';

(async () => {
  const db = dbManager.getClient();
  const { data: exp, error } = await db
    .from('experiments')
    .select('experiment_name,config')
    .eq('id', V59)
    .single();
  if (error) throw error;
  console.log('实验名:', exp.experiment_name);
  const cfg = exp.config || {};
  const wc = cfg.walletConfig || {};
  console.log('walletConfig keys:', Object.keys(wc).join(','));
  if (wc.address) console.log('address:', wc.address);
  // 找 config 里所有含 address 的钱包段
  for (const k of Object.keys(cfg)) {
    if (cfg[k] && typeof cfg[k] === 'object' && cfg[k].address) console.log('段', k, 'address:', cfg[k].address);
  }
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
