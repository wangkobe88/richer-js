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
    .order('analyzed_at', { ascending: false, nullsFirst: false })
    .limit(1);

  if (error) {
    console.error('Error:', error);
    return;
  }

  if (data && data.length > 0) {
    const result = data[0];
    console.log('=== 代币叙事分析结果 ===');
    console.log('代币地址:', result.token_address);
    console.log('代币名:', result.token_name || 'N/A');
    console.log('代币符号:', result.token_symbol || 'N/A');
    console.log('');
    console.log('分析状态:', result.analysis_status);
    console.log('Prompt版本:', result.prompt_version);
    console.log('分析阶段:', result.analysis_stage ?? 'N/A');
    console.log('');
    console.log('LLM分类:', result.llm_category);
    console.log('');

    if (result.llm_summary) {
      console.log('=== LLM摘要 ===');
      console.log(JSON.stringify(result.llm_summary, null, 2));
    }

    if (result.extracted_info) {
      console.log('\n=== 提取信息 ===');
      console.log(JSON.stringify(result.extracted_info, null, 2));
    }

    if (result.llm_raw_output) {
      console.log('\n=== LLM原始输出 ===');
      const raw = result.llm_raw_output;
      if (raw.stage) console.log('失败阶段:', raw.stage);
      if (raw.scenario) console.log('失败场景:', raw.scenario);
      if (raw.reasoning) console.log('推理:', raw.reasoning);
      if (raw.core_event) console.log('核心事件:', raw.core_event);
      if (raw.narrative_summary) console.log('叙事摘要:', raw.narrative_summary);
      if (raw.meme_potential) console.log('Meme潜力:', raw.meme_potential);
    }

    console.log('\n=== 完整原始JSON ===');
    console.log(JSON.stringify(result.llm_raw_output, null, 2));
  } else {
    console.log('未找到叙事分析数据');
  }
}

checkNarrative();
