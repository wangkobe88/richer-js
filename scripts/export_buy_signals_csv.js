require('dotenv').config({ path: './config/.env' });
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY
);

async function exportStrategySignalsCSV() {
  const experimentId = '21b23e96-e25d-4ea2-bcf8-1762ffffc702';

  // 获取所有策略信号
  const { data: signals, error } = await supabase
    .from('strategy_signals')
    .select('*')
    .eq('experiment_id', experimentId)
    .order('created_at', { ascending: true });

  if (error) {
    console.log('查询错误:', error.message);
    return;
  }

  console.log('找到 ' + signals.length + ' 条策略信号');

  if (signals.length === 0) {
    console.log('没有信号数据');
    return;
  }

  // 只导出买入信号
  const buySignals = signals.filter(s => s.action === 'buy' || s.action === 'BUY');
  console.log('其中买入信号: ' + buySignals.length);

  // 提取所有 metadata 字段
  const allMetadataFields = new Set();
  buySignals.forEach(s => {
    if (s.metadata && typeof s.metadata === 'object') {
      Object.keys(s.metadata).forEach(k => allMetadataFields.add(k));
    }
  });

  // 基础字段
  const baseFields = ['id', 'token_address', 'token_symbol', 'chain', 'action', 'confidence', 'reason', 'strategyId', 'strategyName', 'created_at', 'executed'];
  const metadataFields = Array.from(allMetadataFields).sort();

  const headers = [...baseFields, ...metadataFields];
  const csvRows = [];
  csvRows.push(headers.join(','));

  // 添加数据行
  buySignals.forEach(signal => {
    const row = headers.map(field => {
      let value;

      if (baseFields.includes(field)) {
        value = signal[field];
      } else {
        value = signal.metadata?.[field];
      }

      if (value === null || value === undefined || value === '') return '';
      const str = String(value);
      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return '"' + str.replace(/"/g, '""') + '"';
      }
      return str;
    });

    csvRows.push(row.join(','));
  });

  const csvContent = csvRows.join('\n');

  // 写入文件
  const filename = 'experiment_' + experimentId.slice(0, 8) + '_buy_signals.csv';
  fs.writeFileSync(filename, csvContent, 'utf8');

  console.log('\nCSV 文件已生成: ' + filename);
  console.log('\n基础字段:');
  baseFields.forEach((h, i) => {
    console.log('  ' + (i + 1) + '. ' + h);
  });
  console.log('\nMetadata 字段:');
  metadataFields.forEach((f, i) => {
    console.log('  ' + (baseFields.length + i + 1) + '. ' + f);
  });

  // 显示预览
  console.log('\n买入信号预览 (前5个):');
  buySignals.slice(0, 5).forEach((sig, i) => {
    const meta = sig.metadata || {};
    console.log((i + 1) + '. ' + sig.token_symbol + ' - ' + (sig.reason || '(null)'));
    console.log('   执行状态: ' + (sig.executed ? '已执行' : '未执行'));
    console.log('   age: ' + (meta.age?.toFixed(2) || '(null)') + ' 分钟');
    console.log('   earlyReturn: ' + (meta.earlyReturn?.toFixed(2) || '(null)') + '%');
    console.log('   riseSpeed: ' + (meta.riseSpeed?.toFixed(2) || '(null)'));
    console.log('   holders: ' + (meta.holders || '(null)'));
    console.log('   drawdownFromHighest: ' + (meta.drawdownFromHighest?.toFixed(2) || '(null)') + '%');
    console.log('   cards: ' + (meta.cards || '(null)'));
    console.log('   strategyName: ' + (meta.strategyName || '(null)'));
    console.log('');
  });
}

exportStrategySignalsCSV().catch(console.error);
