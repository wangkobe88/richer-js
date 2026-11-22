#!/usr/bin/env node
'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');
(async () => {
  const db = dbManager.getClient();
  const { data, error } = await db.from('wss_events')
    .select('platform, kind').eq('token_address', '0xa79e736482f55c89e42000151e04af630f2b7777')
    .eq('kind', 'token_create').limit(1);
  if (error) throw new Error(error.message);
  console.log('platform =', data[0]?.platform);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
