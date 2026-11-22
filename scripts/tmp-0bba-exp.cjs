'use strict';
const path = require('path');
require('dotenv').config({ path: '../config/.env' });
const { dbManager } = require('../src/services/dbManager');
const EXP = '9e9163de-a677-4d39-9c33-9ec9df05e400';
(async () => {
  const sb = dbManager.getClient();
  const { data, error } = await sb.from('experiments')
    .select('*')
    .eq('id', EXP).limit(1);
  if (error) throw new Error(error.message);
  const e = data[0];
  console.log('desc:', JSON.stringify(e).slice(0,0), 'mode:', e.trading_mode, 'status:', e.status, 'created:', e.created_at);
  
  const c = e.config || {};
  console.log('backtest:', JSON.stringify(c.backtest, null, 1));
  console.log('platform:', c.platform, ' strategyId:', c.strategyId ? 'yes' : 'no');
  console.log('fourmemeWs keys:', c.fourmemeWs ? Object.keys(c.fourmemeWs).join(',') : '-');
  if (c.fourmemeWs && c.fourmemeWs.factorParams) console.log('factorParams:', JSON.stringify(c.fourmemeWs.factorParams));
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
