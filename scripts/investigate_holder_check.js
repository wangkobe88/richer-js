/**
 * 调查代币 4 在持有者黑名单检查中的结果
 */

const { dbManager } = require('../src/services/dbManager');
const { TokenHolderService } = require('../src/trading-engine/holders/TokenHolderService');

async function investigateHolderCheck() {
  const supabase = dbManager.getClient();
  const experimentId = '6853949c-ad60-40ac-b4b3-cfd457de99e3';
  const tokenAddress = '0x2fbee5e7dd23c2daf47bddfc042f9a1d471e4444';

  console.log('🔍 调查代币 4 的持有者黑名单检查:\n');

  // 1. 获取代币信息
  const { data: token } = await supabase
    .from('experiment_tokens')
    .select('*')
    .eq('experiment_id', experimentId)
    .eq('token_address', tokenAddress)
    .single();

  console.log('代币信息:');
  console.log('  symbol:', token?.token_symbol);
  console.log('  creator_address:', token?.creator_address || 'null');
  console.log('  chain:', token?.chain || 'bsc (default)');

  // 2. 手动检查持有者黑名单
  const holderService = new TokenHolderService();

  console.log('\n开始检查持有者黑名单...');

  try {
    const holderCheck = await holderService.checkHolderRisk(
      tokenAddress,
      experimentId,
      token?.chain || 'bsc',
      ['pump_group', 'negative_holder']
    );

    console.log('\n检查结果:');
    console.log('  hasNegative:', holderCheck.hasNegative);
    console.log('  reason:', holderCheck.reason || 'none');
    console.log('  negativeHolders:', holderCheck.negativeHolders || []);

    if (holderCheck.hasNegative) {
      console.log('\n⚠️ 持有者黑名单检查失败!');
      console.log('这就是代币 4 没有被买入的原因。');
      console.log('但是，信号应该被保存到 strategy_signals 表中！');
    } else {
      console.log('\n✅ 持有者黑名单检查通过');
      console.log('那么问题出在别的地方...');
    }

  } catch (error) {
    console.log('\n❌ 检查失败:', error.message);
    console.log('检查失败时，代码会继续执行，所以这不是失败原因');
  }

  // 3. 检查 Dev 钱包
  console.log('\n\n检查 Dev 钱包...');

  // 获取 VirtualTradingEngine 实例来访问 isNegativeDevWallet 方法
  // 这里我们直接查询数据库

  const { data: negativeWallets } = await supabase
    .from('negative_dev_wallets')
    .select('*')
    .eq('wallet_address', token?.creator_address);

  if (negativeWallets && negativeWallets.length > 0) {
    console.log('  ⚠️ 创建者在 Dev 钱包黑名单中!');
    console.log('  记录:', JSON.stringify(negativeWallets, null, 2));
  } else {
    console.log('  ✅ 创建者不在 Dev 钱包黑名单中');
  }

  console.log('\n\n💡 结论:');
  console.log('需要查看实际的日志来确定是哪个预检查失败了。');
  console.log('建议：添加更详细的调试日志，或者修改代码确保所有信号都被保存。');
}

investigateHolderCheck()
  .then(() => process.exit(0))
  .catch(err => { console.error(err); process.exit(1); });
