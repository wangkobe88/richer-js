async function main() {
  const EXP_ID = "4101ee2e-6e9c-437b-a44f-6c7e96a32085";

  // 1. 获取实验配置
  const expRes = await fetch(`http://localhost:3010/api/experiment/${EXP_ID}`);
  const expData = await expRes.json();

  const buyCondition = expData.data.config.strategiesConfig.buyStrategies[0].condition;
  console.log("=== 买入条件 ===");
  console.log(buyCondition);
  console.log("");

  // 2. 获取代币列表
  const tokensRes = await fetch(`http://localhost:3010/api/experiment/${EXP_ID}/tokens?limit=1000`);
  const tokensData = await tokensRes.json();
  const tokens = tokensData.tokens || [];

  // 3. 筛选：最高涨幅>50% 且 没买入的代币
  const highReturnNoBuy = tokens.filter(t => {
    const maxChange = t.analysis_results?.max_change_percent || 0;
    const status = t.status;
    return maxChange > 50 && status !== 'bought' && status !== 'selling' && status !== 'exited';
  });

  console.log("=== 高涨幅但未买入的代币 ===");
  console.log(`总数: ${highReturnNoBuy.length}`);
  console.log("");

  // 显示前20个
  highReturnNoBuy.slice(0, 20).forEach((t, i) => {
    console.log(`[${i+1}] ${t.symbol} - 涨幅: ${t.analysis_results?.max_change_percent}% - 状态: ${t.status}`);
  });

  return { EXP_ID, buyCondition, highReturnNoBuy };
}
main().catch(console.error);
