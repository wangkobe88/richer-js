import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: 'config/.env' });

const client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function showAppendix() {
  const { data: tokens } = await client
    .from('experiment_tokens')
    .select('token_symbol, raw_api_data')
    .not('raw_api_data', 'is', null)
    .limit(30);

  console.log('=== appendix 内容示例 ===\n');

  let count = 0;
  if (tokens) {
    for (const t of tokens) {
      if (t.raw_api_data) {
        try {
          const parsed = JSON.parse(t.raw_api_data);

          if (parsed.appendix) {
            const appendix = typeof parsed.appendix === 'string' ? JSON.parse(parsed.appendix) : parsed.appendex;

            console.log('代币:', t.token_symbol);
            console.log('appendix 字段:', Object.keys(appendix).join(', '));
            console.log('appendix 内容:', JSON.stringify(appendix, null, 2));
            console.log('---\n');

            count++;
            if (count >= 3) break;
          }
        } catch (e) {
          console.log('解析错误:', e.message);
        }
      }
    }
  }
}

showAppendix().then(() => process.exit(0)).catch(() => process.exit(1));
