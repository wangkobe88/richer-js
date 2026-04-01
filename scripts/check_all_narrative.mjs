import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: 'config/.env' });

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

async function checkNarrative() {
  const { data, error } = await supabase
    .from('token_narrative')
    .select('*')
    .eq('token_address', '0x45d5f6654dc8e3a82efb3d41f45d78a3e1404444')
    .order('created_at', { ascending: false })
    .limit(10);

  if (error) {
    console.error('Error:', error);
    return;
  }

  console.log(`找到 ${data.length} 条记录\n`);

  data.forEach((r, i) => {
    console.log(`--- 记录 ${i+1} ---`);
    console.log('ID:', r.id);
    console.log('分类:', r.llm_category);
    console.log('分析状态:', r.analysis_status);
    console.log('Prompt版本:', r.prompt_version);
    console.log('创建时间:', r.created_at);
    console.log('分析时间:', r.analyzed_at);
    console.log('raw_output存在:', !!r.llm_raw_output);
    if (r.llm_raw_output) {
      console.log('raw_output内容:', JSON.stringify(r.llm_raw_output, null, 2).substring(0, 500));
    }
    console.log('');
  });
}

checkNarrative();
