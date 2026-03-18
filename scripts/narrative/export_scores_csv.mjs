import fs from 'fs';

/**
 * 生成代币叙事评分CSV文件
 */
function generateCSV() {
  const data = JSON.parse(fs.readFileSync('../data/combined_narrative_scores.json', 'utf-8'));

  const rows = [];

  // CSV表头
  rows.push([
    '实验ID',
    '代币符号',
    '代币地址',
    '叙事评级',
    '总分',
    '内容质量(35)',
    '可信度(30)',
    '传播力(20)',
    '完整性(15)',
    'Twitter文本',
    'Intro英文',
    'Intro中文'
  ]);

  for (const [expId, expData] of Object.entries(data)) {
    for (const t of expData.tokens) {
      const levelMap = { 'high': '高', 'mid': '中', 'low': '低' };

      rows.push([
        expId,
        t.symbol,
        t.address,
        levelMap[t.narrative_category],
        t.narrative_score,
        t.scores.content,
        t.scores.credibility,
        t.scores.virality,
        t.scores.completeness,
        (t.twitterText || '').replace(/"/g, '""').replace(/\n/g, ' '),
        (t.introEn || '').replace(/"/g, '""').replace(/\n/g, ' '),
        (t.introCn || '').replace(/"/g, '""').replace(/\n/g, ' ')
      ]);
    }
  }

  // 转换为CSV格式
  const csvContent = rows.map(row =>
    row.map(cell => `"${cell}"`).join(',')
  ).join('\n');

  // 保存
  fs.writeFileSync(
    '../data/token_narrative_scores.csv',
    '\uFEFF' + csvContent  // 添加BOM以支持中文
  );

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('          代币叙事评分CSV文件已生成');
  console.log('═══════════════════════════════════════════════════════════════\n');

  // 统计
  const stats = { high: 0, mid: 0, low: 0 };
  for (const [expId, expData] of Object.entries(data)) {
    for (const t of expData.tokens) {
      stats[t.narrative_category]++;
    }
  }

  console.log(`文件路径: data/token_narrative_scores.csv`);
  console.log(`\n总代币数: ${rows.length - 1}`);
  console.log(`🟢 高质量 (≥60分): ${stats.high}`);
  console.log(`🟡 中质量 (40-59分): ${stats.mid}`);
  console.log(`🔴 低质量 (<40分): ${stats.low}`);

  // 显示前10个示例
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('                      前10个代币示例');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const allTokens = [];
  for (const [expId, expData] of Object.entries(data)) {
    for (const t of expData.tokens) {
      allTokens.push({ expId, ...t });
    }
  }
  allTokens.sort((a, b) => b.narrative_score - a.narrative_score);

  console.log('排名  实验    代币          评分  评级  内容  可信  传播  完整');
  console.log('────  ──────  ───────────  ────  ────  ────  ────  ────  ────');

  allTokens.slice(0, 10).forEach((t, i) => {
    const level = t.narrative_category === 'high' ? '高' : t.narrative_category === 'mid' ? '中' : '低';
    console.log(
      `${String(i + 1).padStart(4)}  ${t.expId.padStart(7)}  ${t.symbol.padEnd(12)}  ` +
      `${String(t.narrative_score).padStart(5)}  ${level.padStart(4)}  ` +
      `${String(t.scores.content).padStart(4)}  ` +
      `${String(t.scores.credibility).padStart(4)}  ` +
      `${String(t.scores.virality).padStart(4)}  ` +
      `${String(t.scores.completeness).padStart(4)}`
    );
  });
}

generateCSV();
