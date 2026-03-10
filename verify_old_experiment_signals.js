/**
 * 验证新增代币在旧实验中的信号状态
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'config/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function verifyOldExperimentSignals() {
  const oldExpId = '933be40d-1056-463f-b629-aa226a2ea064';
  const sourceExpId = '6b17ff18-002d-4ce0-a745-b8e02676abd4';

  // 新增代币列表
  const addedTokens = [
    '0x32b1792f9e34b5f9b83324fd34802a102791ffff',
    '0x7a8c4f9097ca55b66527f12ad8e4824602dc4444',
    '0x67af02b5e5624da2bbafe9621e42fb54cc094444',
    '0x3217f78a55d544667538524f3b56f9d098304444',
    '0x2bf6635545fd2a908d7912537fbb8584c51f4444',
    '0xa322f68af1dd4078d0e72998921f546391274444',
    '0xfbbf59bc00815b8fae78ff0bb136fae20f594444',
    '0xc3ca235bb3ac1bb951ce2833a9c8525f524e4444',
    '0x6b0fd53e4676b99dd80051b73cb7260d926c4444',
    '0x4240cf814aa7b0b30c308e7daaeae4f465c94444',
    '0x0f14933b0ccad8d31cb7ffb457667f919a6f4444',
    '0x340b4bb0ca122f949b2a32f5caf0fe0803324444'
  ];

  console.log('=== 验证新增代币在旧实验中的状态 ===\n');

  // 检查旧实验中这些代币的信号
  const { data: oldSignals } = await supabase
    .from('strategy_signals')
    .select('*')
    .eq('experiment_id', oldExpId);

  console.log('新增代币在旧实验中的信号情况:\n');
  console.log('代币                                  | 信号数 | 是否执行 | 状态 | 拒绝原因');
  console.log('-------------------------------------|--------|----------|------|----------');

  for (const token of addedTokens) {
    const tokenSignals = oldSignals.filter(s => s.token_address === token);
    
    if (tokenSignals.length > 0) {
      // 检查是否有执行的信号
      const executedSignals = tokenSignals.filter(s => s.metadata?.execution_status === 'executed');
      const failedSignals = tokenSignals.filter(s => s.metadata?.execution_status === 'failed');
      const filteredSignals = tokenSignals.filter(s => s.metadata?.execution_status === 'filtered');

      const hasExecuted = executedSignals.length > 0;
      const status = hasExecuted ? '执行' : (failedSignals.length > 0 ? '失败' : (filteredSignals.length > 0 ? '过滤' : '其他'));

      // 获取拒绝原因
      let reason = '';
      if (!hasExecuted && tokenSignals.length > 0) {
        const firstSignal = tokenSignals[0];
        reason = firstSignal.metadata?.execution_reason || '';
        if (!reason) {
          // 检查 preBuyCheckResult
          const preBuyResult = firstSignal.metadata?.preBuyCheckResult;
          if (preBuyResult && !preBuyResult.canBuy) {
            reason = preBuyResult.reason?.substring(0, 30) || 'preBuyCheck失败';
          }
        }
      }

      console.log(`${token} | ${tokenSignals.length.toString().padStart(6)} | ${hasExecuted ? '是 ' : '否 '} | ${status.padEnd(4)} | ${reason}`);
    } else {
      console.log(`${token} | ${'无'.padStart(6)} | 否   | 无信号 | -`);
    }
  }

  // 统计
  console.log('\n=== 统计 ===');
  
  let withSignals = 0;
  let withoutSignals = 0;
  let executedCount = 0;
  let rejectedCount = 0;

  for (const token of addedTokens) {
    const tokenSignals = oldSignals.filter(s => s.token_address === token);
    
    if (tokenSignals.length > 0) {
      withSignals++;
      const executedSignals = tokenSignals.filter(s => s.metadata?.execution_status === 'executed');
      if (executedSignals.length > 0) {
        executedCount++;
      } else {
        rejectedCount++;
      }
    } else {
      withoutSignals++;
    }
  }

  console.log('有信号的代币:', withSignals, '个');
  console.log('无信号的代币:', withoutSignals, '个');
  console.log('执行了的代币:', executedCount, '个');
  console.log('被拒绝的代币:', rejectedCount, '个');

  console.log('\n=== 结论 ===');
  if (withSignals === addedTokens.length && rejectedCount === addedTokens.length) {
    console.log('✓ 所有新增代币在旧实验中都有信号，但都被拒绝了');
    console.log('  这验证了你的假设：这些代币不是"新增"的，而是之前被 preBuyCheck 拒绝的');
  } else if (withSignals < addedTokens.length) {
    console.log('⚠️  部分代币在旧实验中完全没有信号');
    console.log('  这可能是 BacktestEngine 数据加载的问题');
  }
}

verifyOldExperimentSignals().catch(console.error);
