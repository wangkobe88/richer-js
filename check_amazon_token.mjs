import pkg from './src/services/dbManager.js';
const { dbManager } = pkg;

const db = dbManager;
const target = '0x45f1c3c8264c6c32d5defa4df1027febb3044444';

async function checkToken() {
  const { data, error } = await db.client
    .from('narrative_tokens')
    .select('*')
    .ilike('address', target);
  
  if (error) {
    console.error('Error:', error);
    return;
  }
  
  if (data && data.length > 0) {
    console.log('找到代币:');
    console.log('Name:', data[0].name);
    console.log('Symbol:', data[0].symbol);
    console.log('Website:', data[0].website);
    console.log('Twitter:', data[0].twitter_url);
  } else {
    console.log('代币不存在于narrative_tokens表中');
  }
}

checkToken().then(() => process.exit(0));
