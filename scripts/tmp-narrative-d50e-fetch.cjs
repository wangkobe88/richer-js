#!/usr/bin/env node
/** 排查:0xd50e…7777 抓取明细(classified_urls + data_fetch_results) */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');

const TOKEN = '0xd50e11204f7f3d63598b0118ee4151bf95917777';

async function main() {
  const db = dbManager.getClient();
  const { data: tn } = await db.from('token_narrative')
    .select('classified_urls, url_extraction_result, data_fetch_results, raw_api_data, twitter_info')
    .eq('token_address', TOKEN)
    .maybeSingle();
  if (!tn) { console.log('MISS'); process.exit(0); }

  console.log('########## [classified_urls] ##########');
  console.log(JSON.stringify(tn.classified_urls, null, 1));

  console.log('\n########## [url_extraction_result] ##########');
  console.log(tn.url_extraction_result === null ? 'null' : JSON.stringify(tn.url_extraction_result, null, 1).slice(0, 3000));

  console.log('\n########## [data_fetch_results] ##########');
  console.log(tn.data_fetch_results === null ? 'null' : JSON.stringify(tn.data_fetch_results, null, 1).slice(0, 4000));

  console.log('\n########## [raw_api_data 概要] ##########');
  const r = tn.raw_api_data || {};
  console.log('created_at:', r.created_at, '| name:', r.name, '| symbol:', r.symbol);
  console.log('description:', typeof r.description === 'string' ? r.description.slice(0, 500) : JSON.stringify(r.description)?.slice(0, 500));

  console.log('\n########## [twitter_info] ##########');
  console.log(tn.twitter_info === null ? 'null' : JSON.stringify(tn.twitter_info, null, 1).slice(0, 2500));
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
