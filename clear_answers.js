/**
 * 明确回答两个问题
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'config/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function clearAnswers() {
  const oldExpId = '933be40d-1056-463f-b629-aa226a2ea064';
  const newExpId = '5072373e-b79d-4d66-b471-03c7c72730ec';

  // 新增代币列表（新实验执行但旧实验未执行）
  const addedTokens = [
    '0x6b0fd53e4676b99dd80051b73cb7260d926c4444',
    '0x32b1792f9e34b5f9b83324fd34802a102791ffff',
    '0x67af02b5e5624da2bbafe9621e42fb54cc0944444',
    '0x3217f78a55d544667538524f3b56f9d0983044444',
    '0x2bf6635545fd2a908d7912537fbb8584c51f4444',
    '0xa322f68af1dd4078d0e72998921f546391274444',
    '0xfbbf59bc00815b8fae78ff0bb136fae20f594444',
    '0xc3ca235bb3ac1bb951ce2833a9c8525f524e4444',
    '0x4240cf814aa7b0b30c308e7daaeae4f465c94444',
    '0x0f14933b0ccad8d31cb7ffb457667f919a6f4444',
    '0x340b4bb0ca122f949b2a32f5caf0fe0803324444'
  ];

  console.log('=== 问题1: 新增代币在老回测中是否有信号 ===\n');

  // 获取老回测的所有信号
  const { data: oldSignals } = await supabase
    .from('strategy_signals')
    .select('*')
    .eq('experiment_id', oldExpId);

  console.log('老回测总信号数:', oldSignals.length);

  let withSignals = 0;
  let withoutSignals = 0;

  console.log('\n新增代币在老回测中的信号状态:');
  console.log('代币                                  | 信号数 | 有/无信号');
  console.log('-------------------------------------|--------|----------');

  for (const token of addedTokens) {
    const tokenSignals = oldSignals.filter(s => s.token_address === token);
    const has = tokenSignals.length > 0;
    
    if (has) {
      withSignals++;
      console.log(`${token} | ${tokenSignals.length.toString().padStart(6)} | 有`);
    } else {
      withoutSignals++;
      console.log(`${token} | ${'0'.padStart(6)} | 无`);
    }
  }

  console.log('\n统计:');
  console.log('  有信号的代币:', withSignals, '个');
  console.log('  无信号的代币:', withoutSignals, '个');

  console.log('\n=== 问题2: 新增代币在新回测中的迭代轮次 ===\n');

  // 获取新回测的信号
  const { data: newSignals } = await supabase
    .from('strategy_signals')
    .select('*')
    .eq('experiment_id', newExpId);

  console.log('新增代币在新回测中的第一个信号的迭代轮次:\n');
  console.log('代币                                  | loop_count | timestamp');
  console.log('-------------------------------------|-----------|------------------');

  for (const token of addedTokens) {
    const tokenSignals = newSignals
      .filter(s => s.token_address === token)
      .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

    if (tokenSignals.length > 0) {
      const first = tokenSignals[0];
      const loopCount = first.metadata?.loop_count;
      console.log(`${token} | ${loopCount || 'N/A'} | ${first.created_at}`);
    }
  }

  // 检查新回测的迭代轮次分布
  console.log('\n新回测的所有信号的迭代轮次分布:');
  
  const loopCounts = {};
  newSignals.forEach(s => {
    const lc = s.metadata?.loop_count;
    if (lc !== undefined) {
      loopCounts[lc] = (loopCounts[lc] || 0) + 1;
    }
  });

  Object.entries(loopCounts).sort((a, b) => a[0] - b[0]).forEach(([loop, count]) => {
    console.log(`  第 ${loop} 轮: ${count} 个信号`);
  });
}

clearAnswers().catch(console.error);
