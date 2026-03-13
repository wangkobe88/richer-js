/**
 * 步骤4: 过滤有效钱包
 * 使用累积的钱包数据
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const INPUT_FILE = path.join(DATA_DIR, 'wallet_data_valid.json');
const OUTPUT_FILE = path.join(DATA_DIR, 'wallet_data_valid.json'); // 覆盖写入

async function main() {
  console.log('=== 步骤4: 过滤有效钱包 ===\n');

  if (!fs.existsSync(INPUT_FILE)) {
    console.error('请先运行 step3_fetch_cumulative.js');
    process.exit(1);
  }

  const walletData = JSON.parse(fs.readFileSync(INPUT_FILE, 'utf8'));
  console.log(`总钱包数: ${walletData.length}`);

  // 过滤条件
  const MIN_TRADES = 100;
  const validWallets = walletData.filter(w =>
    !w.error &&
    (w.total_trades || 0) >= MIN_TRADES
  );

  console.log(`有效钱包数 (trades >= ${MIN_TRADES}): ${validWallets.length}`);

  // 保存（覆盖）
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(validWallets, null, 2));
  console.log(`\n✅ 有效钱包数据已保存到 ${OUTPUT_FILE}`);
}

main().catch(error => {
  console.error('错误:', error);
  process.exit(1);
});
