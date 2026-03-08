/**
 * 调试脚本：查看实际的信号数据
 */

const { dbManager } = require('../src/services/dbManager');
const supabase = dbManager.getClient();

// 测试代币
const TEST_TOKENS = [
  '0x244b0d8273ae7a9a290b18746ebfc12d5d484444',  // 拉砸
  '0x09fd8d7311be4b824f92a3752594e88402d9ffff'   // 非拉砸
];

async function main() {
  console.log('【查看信号数据】\n');

  // 1. 查看所有信号
  const { data: allSignals } = await supabase
    .from('strategy_signals')
    .select('*')
    .in('token_address', TEST_TOKENS)
    .limit(10);

  console.log(`找到 ${allSignals?.length || 0} 条信号\n`);

  if (allSignals && allSignals.length > 0) {
    console.log('信号示例:');
    const s = allSignals[0];
    console.log(JSON.stringify({
      id: s.id,
      token_address: s.token_address,
      token_symbol: s.token_symbol,
      signal_type: s.signal_type,
      action: s.action,
      executed: s.executed,
      created_at: s.created_at,
      metadata: s.metadata,
      experiment_id: s.experiment_id
    }, null, 2));
  }

  // 2. 查看实验类型
  console.log('\n\n【查看实验数据】\n');

  const { data: experiments } = await supabase
    .from('experiments')
    .select('*')
    .limit(5);

  console.log(`找到 ${experiments?.length || 0} 个实验\n`);

  if (experiments && experiments.length > 0) {
    experiments.forEach(e => {
      console.log(`- ${e.experiment_name}: ${e.trading_mode}`);
    });
  }

  // 3. 直接联表查询
  console.log('\n\n【联表查询信号】\n');

  const { data: joinedSignals, error } = await supabase
    .from('strategy_signals')
    .select(`
      token_address,
      token_symbol,
      signal_type,
      action,
      executed,
      created_at,
      experiment_id,
      experiments (
        id,
        trading_mode
      )
    `)
    .in('token_address', TEST_TOKENS)
    .limit(20);

  if (error) {
    console.error('查询错误:', error);
  } else {
    console.log(`找到 ${joinedSignals?.length || 0} 条联表信号\n`);

    if (joinedSignals && joinedSignals.length > 0) {
      joinedSignals.forEach(s => {
        const exp = s.experiments;
        const expInfo = exp ? `${exp.trading_mode}` : 'no_exp';
        console.log(`  ${s.token_symbol || s.token_address.slice(0,10)}: signal_type=${s.signal_type}, action=${s.action}, executed=${s.executed}, experiment=${expInfo}`);
      });
    }
  }

  // 4. 查看虚拟实验的信号
  console.log('\n\n【查找虚拟实验】\n');

  const { data: virtualExps } = await supabase
    .from('experiments')
    .select('id, experiment_name, trading_mode')
    .eq('trading_mode', 'virtual')
    .limit(5);

  console.log(`找到 ${virtualExps?.length || 0} 个虚拟实验\n`);

  if (virtualExps && virtualExps.length > 0) {
    for (const exp of virtualExps) {
      console.log(`实验: ${exp.experiment_name} (${exp.id})`);

      // 查询这个实验的信号
      const { data: expSignals } = await supabase
        .from('strategy_signals')
        .select('token_address, token_symbol, signal_type, action, executed')
        .eq('experiment_id', exp.id)
        .limit(5);

      console.log(`  信号数: ${expSignals?.length || 0}`);
      if (expSignals && expSignals.length > 0) {
        expSignals.forEach(s => {
          console.log(`    - ${s.token_symbol || s.token_address.slice(0,8)}: ${s.signal_type} / ${s.action} / executed=${s.executed}`);
        });
      }
      console.log('');
    }
  }
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
