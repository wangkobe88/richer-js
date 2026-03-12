/**
 * 获取两个实验的完整配置进行对比
 */

const http = require('http');

function get(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => resolve(JSON.parse(data)));
    }).on('error', reject);
  });
}

async function main() {
  console.log('=== 获取两个实验的完整配置 ===\n');

  const [exp1, exp2] = await Promise.all([
    get('http://localhost:3010/api/experiment/209a7796-f955-4d7a-ae21-0902fef3d7cc'),
    get('http://localhost:3010/api/experiment/2522cab9-721f-4922-86f9-7484d644e7cc')
  ]);

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('【实验1配置】');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const config1 = exp1.experiment?.config || {};
  console.log(JSON.stringify(config1, null, 2));

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('【实验2配置】');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const config2 = exp2.experiment?.config || {};
  console.log(JSON.stringify(config2, null, 2));

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('【关键差异】');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  // 对比 buyStrategies
  console.log(`实验1 buyStrategies 数量: ${config1.buyStrategies?.length || 0}`);
  console.log(`实验2 buyStrategies 数量: ${config2.buyStrategies?.length || 0}\n`);

  if (config1.buyStrategies) {
    config1.buyStrategies.forEach((s, i) => {
      console.log(`实验1 buyStrategy[${i}]:`);
      console.log(`  preBuyCheckCondition: ${s.preBuyCheckCondition || '无'}`);
      console.log(`  buyCondition: ${s.buyCondition || '无'}`);
      console.log('');
    });
  }

  if (config2.buyStrategies) {
    config2.buyStrategies.forEach((s, i) => {
      console.log(`实验2 buyStrategy[${i}]:`);
      console.log(`  preBuyCheckCondition: ${s.preBuyCheckCondition || '无'}`);
      console.log(`  buyCondition: ${s.buyCondition || '无'}`);
      console.log('');
    });
  }

  // maxExecutions
  console.log(`实验1 maxExecutions: ${config1.maxExecutions || '未设置'}`);
  console.log(`实验2 maxExecutions: ${config2.maxExecutions || '未设置'}`);
}

main().catch(console.error);
