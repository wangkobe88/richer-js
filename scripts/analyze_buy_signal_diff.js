/**
 * 分析为什么实验2多买了14个代币
 * 检查 buy signals 的差异
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
  console.log('=== 分析两个实验的 buy signals 差异 ===\n');

  const [signals1, signals2] = await Promise.all([
    get('http://localhost:3010/api/experiment/209a7796-f955-4d7a-ae21-0902fef3d7cc/signals?limit=1000'),
    get('http://localhost:3010/api/experiment/2522cab9-721f-4922-86f9-7484d644e7cc/signals?limit=1000')
  ]);

  const buySignals1 = signals1.signals?.filter(s => s.action === 'buy') || [];
  const buySignals2 = signals2.signals?.filter(s => s.action === 'buy') || [];

  const executed1 = buySignals1.filter(s => s.executed === true);
  const executed2 = buySignals2.filter(s => s.executed === true);

  console.log(`实验1 buy signals: ${buySignals1.length} (executed: ${executed1.length})`);
  console.log(`实验2 buy signals: ${buySignals2.length} (executed: ${executed2.length})\n`);

  // 找出实验2独有的代币
  const tokens1 = new Set(executed1.map(s => s.token_symbol));
  const tokens2 = new Set(executed2.map(s => s.token_symbol));

  const onlyInExp2 = Array.from(tokens2).filter(sym => !tokens1.has(sym));
  const inBoth = Array.from(tokens2).filter(sym => tokens1.has(sym));

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('【实验2独有的14个代币的 buy signals 分析】');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  onlyInExp2.forEach(symbol => {
    const signals = executed2.filter(s => s.token_symbol === symbol);
    console.log(`${symbol}:`);
    signals.forEach(s => {
      const reason = s.reason || '无';
      const confidence = s.confidence || 'N/A';
      const createdAt = new Date(s.created_at).toLocaleString('zh-CN');
      const factors = s.metadata?.preBuyCheckFactors || {};
      const trendFactors = s.metadata?.trendFactors || {};

      console.log(`  信号时间: ${createdAt}`);
      console.log(`  原因: ${reason}, 置信度: ${confidence}`);
      console.log(`  earlyReturn: ${trendFactors.earlyReturn?.toFixed(1) || 'N/A'}%`);
      console.log(`  countPerMin: ${factors.earlyTradesCountPerMin?.toFixed(1) || 'N/A'}`);
      console.log(`  top2Ratio: ${factors.walletClusterTop2Ratio?.toFixed(2) || 'N/A'}`);
      console.log('');
    });
  });

  // 检查实验配置的差异
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('【检查实验配置】');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  // 获取实验详细信息
  const [exp1Detail, exp2Detail] = await Promise.all([
    get('http://localhost:3010/api/experiment/209a7796-f955-4d7a-ae21-0902fef3d7cc'),
    get('http://localhost:3010/api/experiment/2522cab9-721f-4922-86f9-7484d644e7cc')
  ]);

  console.log('实验1:');
  console.log(`  ID: ${exp1Detail.experiment?.id || 'N/A'}`);
  console.log(`  Name: ${exp1Detail.experiment?.name || 'N/A'}`);
  console.log(`  Type: ${exp1Detail.experiment?.type || 'N/A'}`);
  console.log(`  Source Experiment: ${exp1Detail.experiment?.source_experiment_id || 'N/A'}`);
  console.log('');

  console.log('实验2:');
  console.log(`  ID: ${exp2Detail.experiment?.id || 'N/A'}`);
  console.log(`  Name: ${exp2Detail.experiment?.name || 'N/A'}`);
  console.log(`  Type: ${exp2Detail.experiment?.type || 'N/A'}`);
  console.log(`  Source Experiment: ${exp2Detail.experiment?.source_experiment_id || 'N/A'}`);
  console.log('');

  // 检查配置字符串
  const config1 = exp1Detail.experiment?.config || {};
  const config2 = exp2Detail.experiment?.config || {};

  console.log('实验1配置:');
  console.log(JSON.stringify(config1, null, 2));
  console.log('');

  console.log('实验2配置:');
  console.log(JSON.stringify(config2, null, 2));
  console.log('');

  // 找出配置差异
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('【配置差异】');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const allKeys = new Set([...Object.keys(config1), ...Object.keys(config2)]);
  allKeys.forEach(key => {
    const v1 = config1[key];
    const v2 = config2[key];
    if (JSON.stringify(v1) !== JSON.stringify(v2)) {
      console.log(`${key}:`);
      console.log(`  实验1: ${JSON.stringify(v1)}`);
      console.log(`  实验2: ${JSON.stringify(v2)}`);
      console.log('');
    }
  });
}

main().catch(console.error);
