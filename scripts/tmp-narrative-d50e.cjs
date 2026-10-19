#!/usr/bin/env node
/** 排查:0xd50e…7777 为啥没过叙事分析(单 token 小结果,本地 OK) */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');

const TOKEN = '0xd50e11204f7f3d63598b0118ee4151bf95917777';

async function main() {
  const db = dbManager.getClient();
  const { data: tn } = await db.from('token_narrative')
    .select('token_symbol, analyzed_at, pre_check_result, prestage_result, stage1_result, stage3_result, stage_final_result')
    .eq('token_address', TOKEN)
    .maybeSingle();

  if (!tn) { console.log('token_narrative MISS'); }
  else {
    console.log('symbol:', tn.token_symbol, '| analyzed_at:', tn.analyzed_at);
    console.log('\n########## [pre_check_result] ##########');
    console.log(tn.pre_check_result === null ? 'null(过)' : JSON.stringify(tn.pre_check_result, null, 1));
    console.log('\n########## [prestage_result] ##########');
    console.log(tn.prestage_result === null ? 'null' : JSON.stringify(tn.prestage_result, null, 1).slice(0, 2000));
    console.log('\n########## [stage_final_result] ##########');
    console.log(tn.stage_final_result === null ? 'null' : JSON.stringify(tn.stage_final_result, null, 1).slice(0, 3000));
    console.log('\n########## [stage1_result] ##########');
    console.log(tn.stage1_result === null ? 'null' : JSON.stringify(tn.stage1_result, null, 1).slice(0, 6000));
    console.log('\n########## [stage3_result] ##########');
    console.log(tn.stage3_result === null ? 'null' : JSON.stringify(tn.stage3_result, null, 1).slice(0, 3000));
  }

  console.log('\n########## [narrative_analysis_rounds] ##########');
  const { data: rounds } = await db.from('narrative_analysis_rounds')
    .select('experiment_id, round_no, reason, status, rating, error, started_at, completed_at')
    .eq('token_address', TOKEN)
    .order('id', { ascending: true })
    .limit(20);
  console.log(rounds && rounds.length ? JSON.stringify(rounds, null, 1) : '(无轮次行)');

  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
