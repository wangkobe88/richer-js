import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: 'config/.env' });

const client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function checkToken() {
  const tokenAddress = '0x98c51f3114e6e54e8182d84e3160fb54226a4444';

  const { data } = await client
    .from('experiment_tokens')
    .select('*')
    .eq('token_address', tokenAddress)
    .single();

  if (data) {
    console.log('=== 代币信息 ===');
    console.log('代币符号:', data.token_symbol);
    console.log('human_judges:', JSON.stringify(data.human_judges, null, 2));

    if (data.raw_api_data) {
      console.log('\n=== raw_api_data.appendix ===');
      if (data.raw_api_data.appendix) {
        try {
          const appendix = JSON.parse(data.raw_api_data.appendix);
          console.log(JSON.stringify(appendix, null, 2));
        } catch (e) {
          console.log('appendix:', data.raw_api_data.appendix);
        }
      }
    }
  } else {
    console.log('未找到代币');
  }
}

checkToken().then(() => process.exit(0)).catch(() => process.exit(1));
