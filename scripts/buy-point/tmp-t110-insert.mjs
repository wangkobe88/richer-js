// bt-v110 创建：INSERT experiments（V108 行克隆改 name/desc/config）
import { readFileSync } from 'node:fs';
import { dbManager } from '../../src/services/dbManager.js';
const c = await dbManager.getClient();
const row = JSON.parse(readFileSync('/tmp/btv110-row.json', 'utf8'));
const V108 = '8e2b37ac-d144-4de5-a0b0-d265f1585cb4';
const { data: src } = await c.from('experiments').select('*').eq('id', V108).single();
const id = crypto.randomUUID();
const ins = {
  id,
  experiment_name: row.experiment_name,
  experiment_description: row.experiment_description,
  status: 'created',
  trading_mode: src.trading_mode,
  strategy_type: src.strategy_type,
  blockchain: src.blockchain,
  kline_type: src.kline_type,
  config: row.config,
};
const { data, error } = await c.from('experiments').insert(ins).select('id,experiment_name').single();
if (error) throw new Error(error.message);
console.log('INSERTED', JSON.stringify(data));
