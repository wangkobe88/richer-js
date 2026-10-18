// 一次性查询：0x5f5076639db7232c98494420afeabc9ef4337777 叙事分析行（单条读取）
const { dbManager } = require('../src/services/dbManager.js');

async function main() {
  const addr = '0x5f5076639db7232c98494420afeabc9ef4337777';
  const client = await dbManager.getClient();
  const { data, error } = await client
    .from('token_narrative')
    .select('*')
    .eq('token_address', addr)
    .maybeSingle();
  if (error) throw error;
  if (!data) {
    console.log('NO ROW');
    return;
  }
  console.log('=== 基本字段 ===');
  for (const k of Object.keys(data)) {
    const v = data[k];
    if (v === null || v === undefined) { console.log(`${k}: null`); continue; }
    const s = typeof v === 'string' ? v : JSON.stringify(v);
    if (s.length > 2000) {
      console.log(`${k}: <${s.length} chars>`);
    } else {
      console.log(`${k}: ${s}`);
    }
  }
  // 大字段单独落文件
  const fs = require('fs');
  for (const k of ['raw_api_data', 'parsed_output', 'stage1_prompt']) {
    if (data[k]) fs.writeFileSync(`/tmp/5f5076_${k}.json`, typeof data[k] === 'string' ? data[k] : JSON.stringify(data[k], null, 2));
  }
  console.log('\n大字段已落 /tmp/5f5076_*.json');
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
