require('dotenv').config({ path: './config/.env' });

const { WalletDataService } = require('./src/web/services/WalletDataService');

async function queryDevWallets() {
  const walletService = new WalletDataService();

  try {
    const wallets = await walletService.getWallets();

    console.log('=== 所有钱包 ===');
    wallets.forEach(w => {
      console.log(`Address: ${w.address}`);
      console.log(`Name: ${w.name}`);
      console.log(`Category: ${w.category}`);
      console.log('---');
    });

    const devWallets = wallets.filter(w => w.category === 'dev');
    console.log(`\n=== 流水盘Dev 钱包列表 (${devWallets.length}个) ===`);
    devWallets.forEach(w => {
      console.log(`${w.address} - ${w.name}`);
    });

    // 检查创建者地址是否在 dev 列表中
    const creatorAddress = '0x650162eeb1fe500ca4cc44f7ff291d4a903a3b73';
    const isDev = devWallets.some(w => w.address.toLowerCase() === creatorAddress.toLowerCase());

    console.log(`\n=== 检查结果 ===`);
    console.log(`代币: Valentine`);
    console.log(`代币地址: 0x0ce26b484357d20a9359a987f6e1653cb0494444`);
    console.log(`创建者地址: ${creatorAddress}`);
    console.log(`是否在Dev列表中: ${isDev ? '是' : '否'}`);

  } catch (error) {
    console.error('Error:', error);
  }

  process.exit(0);
}

queryDevWallets();
