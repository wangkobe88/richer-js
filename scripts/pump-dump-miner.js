#!/usr/bin/env node

/**
 * 流水盘钱包挖掘工具
 *
 * 三阶段流水线：
 *   1. detect  — 从时序数据识别流水盘代币
 *   2. wallets — 从早期交易记录提取参与钱包并统计
 *   3. import  — 将重复参与钱包写入 wallets 表
 *
 * 用法：
 *   node pump-dump-miner.js --experiments id1,id2,id3
 *   node pump-dump-miner.js --step detect --experiments id1
 *   node pump-dump-miner.js --step wallets,import --input ./output/tokens.csv
 *   node pump-dump-miner.js --dry-run --experiments id1,id2
 */

require('dotenv').config({ path: './config/.env' });
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const PAGE_SIZE = 1000;

// ─── CLI 参数解析 ───

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    experiments: [],
    steps: ['detect', 'wallets', 'import'],
    scoreThreshold: 85,
    walletMinTokens: 2,
    chain: 'solana',
    outputDir: null,
    input: null,
    dryRun: false,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--experiments':
        opts.experiments = args[++i].split(',').map(s => s.trim());
        break;
      case '--step':
        opts.steps = args[++i].split(',').map(s => s.trim());
        break;
      case '--score-threshold':
        opts.scoreThreshold = parseInt(args[++i]);
        break;
      case '--wallet-min-tokens':
        opts.walletMinTokens = parseInt(args[++i]);
        break;
      case '--chain':
        opts.chain = args[++i];
        break;
      case '--output-dir':
        opts.outputDir = args[++i];
        break;
      case '--input':
        opts.input = args[++i];
        break;
      case '--dry-run':
        opts.dryRun = true;
        break;
      case '--help':
        printHelp();
        process.exit(0);
    }
  }

  if (!opts.outputDir) {
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    opts.outputDir = path.join(__dirname, '..', 'output', `pump-dump-${ts}`);
  }

  return opts;
}

function printHelp() {
  console.log(`
流水盘钱包挖掘工具

用法:
  node pump-dump-miner.js [选项]

选项:
  --experiments <ids>       逗号分隔的实验ID（detect 阶段必填）
  --step <steps>            执行阶段: detect,wallets,import（默认全部）
  --score-threshold <n>     流水盘代币分数阈值（默认 85）
  --wallet-min-tokens <n>   钱包最少参与的流水盘代币数（默认 2）
  --chain <chain>           区块链（默认 solana）
  --output-dir <dir>        输出目录（默认 ./output/pump-dump-{timestamp}）
  --input <csv>             跳过 detect，从已有 CSV 开始
  --dry-run                 只分析不写入数据库
  --help                    显示帮助

示例:
  # 完整流程
  node pump-dump-miner.js --experiments id1,id2,id3

  # 只识别流水盘代币
  node pump-dump-miner.js --step detect --experiments id1

  # 从已有 CSV 继续钱包分析和导入
  node pump-dump-miner.js --step wallets,import --input ./output/tokens.csv

  # 试运行（不写库）
  node pump-dump-miner.js --dry-run --experiments id1,id2
`);
}

// ─── Supabase 客户端 ───

function getClient(useServiceKey = false) {
  const key = useServiceKey
    ? process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY
    : process.env.SUPABASE_ANON_KEY;
  return createClient(process.env.SUPABASE_URL, key);
}

// ─── 阶段 1: Detect — 识别流水盘代币 ───

async function detect(opts) {
  if (opts.experiments.length === 0) {
    console.error('❌ detect 阶段需要 --experiments 参数');
    process.exit(1);
  }

  const supabase = getClient();

  // 1. 获取代币元信息
  console.log('\n📋 获取代币元信息...');
  const tokenMeta = new Map();
  for (const expId of opts.experiments) {
    let offset = 0;
    let hasMore = true;
    while (hasMore) {
      const { data, error } = await supabase
        .from('experiment_tokens')
        .select('token_address, token_symbol, blockchain, raw_api_data')
        .eq('experiment_id', expId)
        .range(offset, offset + PAGE_SIZE - 1);
      if (error) throw error;
      if (data && data.length > 0) {
        for (const t of data) {
          if (!tokenMeta.has(t.token_address)) {
            tokenMeta.set(t.token_address, {
              address: t.token_address,
              symbol: t.token_symbol || '(unnamed)',
              chain: t.blockchain,
              launchPrice: parseFloat(t.raw_api_data?.launch_price) || 0,
            });
          }
        }
        offset += PAGE_SIZE;
        hasMore = data.length === PAGE_SIZE;
      } else {
        hasMore = false;
      }
    }
  }
  console.log(`  共 ${tokenMeta.size} 个独立代币`);

  // 2. 批量获取时序数据
  const tokenPrices = new Map();
  for (const expId of opts.experiments) {
    console.log(`\n📦 拉取实验 ${expId.slice(0, 8)}... 的时序数据`);
    let lastId = 0;
    let hasMore = true;
    let totalRows = 0;
    const startTime = Date.now();

    while (hasMore) {
      const { data, error } = await supabase
        .from('experiment_time_series_data')
        .select('id, token_address, timestamp, price_usd')
        .eq('experiment_id', expId)
        .gt('id', lastId)
        .order('id', { ascending: true })
        .limit(PAGE_SIZE);

      if (error) throw error;
      if (data && data.length > 0) {
        for (const row of data) {
          const price = parseFloat(row.price_usd) || 0;
          if (price <= 0) continue;
          if (!tokenPrices.has(row.token_address)) {
            tokenPrices.set(row.token_address, []);
          }
          tokenPrices.get(row.token_address).push({
            time: new Date(row.timestamp).getTime(),
            price,
          });
        }
        totalRows += data.length;
        lastId = data[data.length - 1].id;
        hasMore = data.length === PAGE_SIZE;
        if (totalRows % 100000 < PAGE_SIZE) {
          const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
          console.log(`    已拉取 ${totalRows} 行 (${elapsed}s), ${tokenPrices.size} 个代币`);
        }
      } else {
        hasMore = false;
      }
    }
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`  ✅ 完成: ${totalRows} 行, ${tokenPrices.size} 个代币 (${elapsed}s)`);
  }

  // 排序去重
  for (const [addr, prices] of tokenPrices) {
    prices.sort((a, b) => a.time - b.time);
    const seen = new Set();
    const deduped = [];
    for (const p of prices) {
      if (!seen.has(p.time)) {
        seen.add(p.time);
        deduped.push(p);
      }
    }
    tokenPrices.set(addr, deduped);
  }

  // 3. 分析
  console.log(`\n🔍 开始分析 ${tokenPrices.size} 个代币...`);
  const results = [];
  let noMeta = 0;
  for (const [addr, prices] of tokenPrices) {
    const meta = tokenMeta.get(addr);
    if (!meta) { noMeta++; continue; }
    const analysis = analyzePumpDump(prices, meta);
    if (analysis) results.push(analysis);
  }
  results.sort((a, b) => b.score - a.score);

  // 4. 输出文件
  const csvPath = path.join(opts.outputDir, 'pump_dump_tokens.csv');
  const mdPath = path.join(opts.outputDir, 'pump_dump_report.md');

  writeTokenCSV(results, csvPath);
  writeTokenReport(results, mdPath);

  const high = results.filter(r => r.score >= opts.scoreThreshold);
  console.log(`\n📊 Detect 摘要:`);
  console.log(`   分析代币: ${results.length} (无元信息: ${noMeta})`);
  console.log(`   ≥${opts.scoreThreshold} 分: ${high.length}`);
  if (high.length > 0) {
    console.log(`   Top 流水盘:`);
    high.slice(0, 5).forEach((r, i) => {
      console.log(`   ${i + 1}. ${r.symbol} — 跌幅 ${r.maxSingleDropPct}%, 集中度 ${r.crashConcentration.toFixed(2)}, 评分 ${r.score}`);
    });
  }

  return { results, csvPath };
}

// ─── 阶段 2: Wallets — 分析早期交易者钱包 ───

async function wallets(opts, tokenResults) {
  let tokens;
  let tokenMeta = new Map();

  if (tokenResults) {
    // 从内存直接获取
    tokens = tokenResults.filter(r => r.score >= opts.scoreThreshold);
  } else if (opts.input) {
    // 从 CSV 读取
    const lines = fs.readFileSync(opts.input, 'utf8').trim().split('\n');
    tokens = [];
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(',');
      const score = parseInt(cols[3]);
      if (score >= opts.scoreThreshold) {
        tokens.push({
          symbol: cols[0],
          address: cols[1],
          chain: cols[2],
          score,
        });
      }
    }
  } else {
    console.error('❌ wallets 阶段需要先运行 detect 或提供 --input');
    process.exit(1);
  }

  for (const t of tokens) {
    tokenMeta.set(t.address, t);
  }

  console.log(`\n🔍 分析 ${tokens.length} 个流水盘代币（score ≥ ${opts.scoreThreshold}）的早期交易者`);

  const supabase = getClient();
  const tokenRecords = await fetchEarlyTrades(supabase, tokens.map(t => t.address));
  console.log(`  有早期交易数据: ${tokenRecords.size}/${tokens.length}`);

  const walletMap = analyzeWallets(tokenRecords, tokenMeta);

  // 输出
  const csvPath = path.join(opts.outputDir, 'pump_dump_wallets.csv');
  const mdPath = path.join(opts.outputDir, 'pump_dump_wallets_report.md');

  writeWalletCSV(walletMap, csvPath);
  writeWalletReport(walletMap, tokens.length, mdPath);

  const sorted = [...walletMap.values()].sort((a, b) => b.tokenCount - a.tokenCount);
  const qualified = sorted.filter(w => w.tokenCount >= opts.walletMinTokens);
  console.log(`\n📊 Wallets 摘要:`);
  console.log(`   独立钱包: ${sorted.length}`);
  console.log(`   参与 ≥${opts.walletMinTokens} 个流水盘: ${qualified.length}`);
  if (qualified.length > 0) {
    console.log(`   Top 重复钱包:`);
    qualified.slice(0, 5).forEach((w, i) => {
      console.log(`   ${i + 1}. ${w.wallet.slice(0, 16)}... — ${w.tokenCount} 个流水盘 (买${w.buyCount}/卖${w.sellCount})`);
    });
  }

  return { walletMap, csvPath };
}

// ─── 阶段 3: Import — 写入 wallets 表 ───

async function importWallets(opts, walletData) {
  let wallets;
  let csvPath;

  if (walletData) {
    // 从内存
    wallets = [...walletData.values()]
      .filter(w => w.tokenCount >= opts.walletMinTokens)
      .sort((a, b) => b.tokenCount - a.tokenCount);
  } else {
    // 从 CSV 读取
    const inputCsv = path.join(opts.outputDir, 'pump_dump_wallets.csv');
    if (!fs.existsSync(inputCsv)) {
      console.error(`❌ 找不到钱包数据: ${inputCsv}，请先运行 wallets 阶段`);
      process.exit(1);
    }
    const lines = fs.readFileSync(inputCsv, 'utf8').trim().split('\n');
    wallets = [];
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(',');
      const tokenCount = parseInt(cols[1]);
      if (tokenCount >= opts.walletMinTokens) {
        wallets.push({ wallet: cols[0], tokenCount, buyCount: parseInt(cols[2]), sellCount: parseInt(cols[3]) });
      }
    }
  }

  console.log(`\n📥 导入 ${wallets.length} 个钱包 (参与 ≥${opts.walletMinTokens} 个流水盘)`);

  if (opts.dryRun) {
    console.log(`   [dry-run] 跳过数据库写入`);
    console.log(`\n✅ Import 完成 (dry-run): ${wallets.length} 个钱包待导入`);
    return;
  }

  const supabase = getClient(true);
  const rows = wallets.map(w => ({
    address: w.wallet,
    chain: opts.chain,
    category: 'pump_group',
    name: `流水盘钱包(参与${w.tokenCount}个)`,
  }));

  const BATCH = 100;
  let upserted = 0;
  let failed = 0;

  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const { error } = await supabase
      .from('wallets')
      .upsert(batch, { onConflict: 'address,chain', ignoreDuplicates: false });

    if (error) {
      for (const row of batch) {
        const { error: e2 } = await supabase
          .from('wallets')
          .upsert(row, { onConflict: 'address,chain', ignoreDuplicates: false });
        if (e2) { failed++; console.warn(`  ⚠️ ${row.address}: ${e2.message}`); }
        else { upserted++; }
      }
    } else {
      upserted += batch.length;
    }

    if ((i + BATCH) % 500 === 0 || i + BATCH >= rows.length) {
      console.log(`  进度: ${Math.min(i + BATCH, rows.length)}/${rows.length}`);
    }
  }

  console.log(`\n✅ Import 完成: ${upserted} 个 (失败 ${failed})`);

  const { count } = await supabase
    .from('wallets')
    .select('*', { count: 'exact', head: true })
    .eq('chain', opts.chain)
    .eq('category', 'pump_group');
  console.log(`   wallets 表中 pump_group 总数: ${count}`);
}

// ─── 核心分析函数 ───

function analyzePumpDump(prices, token) {
  if (prices.length < 5) return null;

  let maxP = -Infinity, minP = Infinity;
  for (const p of prices) {
    if (p.price > maxP) maxP = p.price;
    if (p.price < minP) minP = p.price;
  }
  if (maxP <= 0 || (maxP - minP) / maxP < 0.3) return null;

  let maxSingleDrop = 0, maxDropIdx = -1;
  for (let i = 1; i < prices.length; i++) {
    const prev = prices[i - 1].price;
    const curr = prices[i].price;
    if (prev > 0) {
      const drop = (prev - curr) / prev;
      if (drop > maxSingleDrop) { maxSingleDrop = drop; maxDropIdx = i; }
    }
  }
  if (maxDropIdx <= 0) return null;

  const totalDrop = maxP - minP;
  const singleDrop = prices[maxDropIdx - 1].price - prices[maxDropIdx].price;
  const crashConcentration = totalDrop > 0 ? singleDrop / totalDrop : 0;

  const postCrashPrices = prices.slice(maxDropIdx).map(p => p.price);
  let postCrashCV = 0;
  if (postCrashPrices.length >= 3) {
    const mean = postCrashPrices.reduce((s, v) => s + v, 0) / postCrashPrices.length;
    const std = Math.sqrt(postCrashPrices.reduce((s, v) => s + (v - mean) ** 2, 0) / postCrashPrices.length);
    postCrashCV = mean > 0 ? std / mean : 0;
  }

  const preCrashPrices = prices.slice(0, maxDropIdx).map(p => p.price);
  let preCrashMaxDrawdown = 0;
  if (preCrashPrices.length >= 2) {
    let runningMax = preCrashPrices[0];
    for (let i = 1; i < preCrashPrices.length; i++) {
      if (preCrashPrices[i] > runningMax) runningMax = preCrashPrices[i];
      const dd = (runningMax - preCrashPrices[i]) / runningMax;
      if (dd > preCrashMaxDrawdown) preCrashMaxDrawdown = dd;
    }
  }

  const crashDurationMs = prices[maxDropIdx].time - prices[maxDropIdx - 1].time;

  let score = 0;
  if (maxSingleDrop > 0.6) score += 40;
  else if (maxSingleDrop > 0.4) score += 25;
  else if (maxSingleDrop > 0.2) score += 10;
  if (crashConcentration > 0.7) score += 30;
  else if (crashConcentration > 0.5) score += 15;
  if (postCrashCV < 0.1) score += 20;
  else if (postCrashCV < 0.3) score += 10;
  if (preCrashMaxDrawdown < 0.1) score += 10;
  else if (preCrashMaxDrawdown < 0.2) score += 5;

  let maxChangePct = null, finalChangePct = null;
  if (token.launchPrice > 0) {
    maxChangePct = ((maxP - token.launchPrice) / token.launchPrice) * 100;
    finalChangePct = ((prices[prices.length - 1].price - token.launchPrice) / token.launchPrice) * 100;
  }

  return {
    symbol: token.symbol, address: token.address, chain: token.chain,
    launchPrice: token.launchPrice, totalPoints: prices.length,
    maxPrice: maxP, minPrice: minP, finalPrice: prices[prices.length - 1].price,
    maxSingleDrop,
    maxSingleDropPct: (maxSingleDrop * 100).toFixed(1),
    crashConcentration, postCrashCV, preCrashMaxDrawdown,
    preCrashMaxDrawdownPct: (preCrashMaxDrawdown * 100).toFixed(1),
    crashDurationSec: (crashDurationMs / 1000).toFixed(1),
    maxChangePct: maxChangePct !== null ? maxChangePct.toFixed(1) : 'N/A',
    finalChangePct: finalChangePct !== null ? finalChangePct.toFixed(1) : 'N/A',
    score,
  };
}

async function fetchEarlyTrades(supabase, tokenAddresses) {
  const allRecords = new Map();
  const BATCH = 20;
  for (let i = 0; i < tokenAddresses.length; i += BATCH) {
    const batch = tokenAddresses.slice(i, i + BATCH);
    const { data, error } = await supabase
      .from('early_participant_trades')
      .select('token_address, trades_data')
      .in('token_address', batch);
    if (error) { console.warn(`  ⚠️ 查询失败: ${error.message}`); continue; }
    if (data) {
      for (const row of data) {
        if (!allRecords.has(row.token_address)) {
          allRecords.set(row.token_address, row.trades_data || []);
        }
      }
    }
    if ((i + BATCH) % 500 === 0 || i + BATCH >= tokenAddresses.length) {
      console.log(`  进度: ${Math.min(i + BATCH, tokenAddresses.length)}/${tokenAddresses.length}, 有数据: ${allRecords.size}`);
    }
  }
  return allRecords;
}

function analyzeWallets(tokenRecords, tokenMeta) {
  const walletMap = new Map();
  for (const [tokenAddr, trades] of tokenRecords) {
    const meta = tokenMeta.get(tokenAddr);
    const symbol = meta ? meta.symbol : tokenAddr.slice(0, 8) + '...';
    for (const trade of trades) {
      const wallet = trade.wallet_address;
      if (!wallet) continue;
      if (!walletMap.has(wallet)) {
        walletMap.set(wallet, { wallet, tokenCount: 0, tokens: new Set(), buyCount: 0, sellCount: 0 });
      }
      const info = walletMap.get(wallet);
      if (!info.tokens.has(tokenAddr)) { info.tokens.add(tokenAddr); info.tokenCount++; }
      if (trade.type === 'swap') {
        if (trade.to_token === tokenAddr) info.buyCount++; else info.sellCount++;
      }
    }
  }
  return walletMap;
}

// ─── 输出函数 ───

function writeTokenCSV(results, csvPath) {
  const header = 'symbol,address,chain,score,maxSingleDropPct,crashConcentration,postCrashCV,preCrashMaxDrawdownPct,crashDurationSec,maxChangePct,finalChangePct,totalPoints,maxPrice,minPrice,finalPrice,launchPrice\n';
  const rows = results.map(r =>
    `${r.symbol},${r.address},${r.chain},${r.score},${r.maxSingleDropPct},${r.crashConcentration.toFixed(4)},${r.postCrashCV.toFixed(4)},${r.preCrashMaxDrawdownPct},${r.crashDurationSec},${r.maxChangePct},${r.finalChangePct},${r.totalPoints},${r.maxPrice},${r.minPrice},${r.finalPrice},${r.launchPrice}`
  ).join('\n');
  fs.writeFileSync(csvPath, header + rows);
  console.log(`📄 代币 CSV: ${csvPath}`);
}

function writeTokenReport(results, mdPath) {
  const high = results.filter(r => r.score >= 60);
  const medium = results.filter(r => r.score >= 30 && r.score < 60);
  const low = results.filter(r => r.score < 30);

  let md = '# 流水盘代币识别报告\n\n';
  md += `> 基于时序数据库价格走势分析\n`;
  md += `> 生成时间: ${new Date().toISOString().slice(0, 19)}\n\n`;
  md += `共分析 **${results.length}** 个代币\n\n`;
  md += `- 高置信度 (score ≥ 60): **${high.length}**\n`;
  md += `- 中置信度 (30-59): **${medium.length}**\n`;
  md += `- 低置信度 (<30): **${low.length}**\n\n`;

  if (high.length > 0) {
    md += '## 高置信度\n\n';
    md += '| # | 代币 | 地址 | 单步跌幅 | 集中度 | 砸盘后CV | 砸盘前回撤 | 耗时(s) | 最大涨幅% | 最终涨幅% | 评分 | 数据点 |\n';
    md += '|---|------|------|---------|-------|---------|-----------|--------|----------|----------|------|------|\n';
    high.forEach((r, i) => {
      md += `| ${i + 1} | ${r.symbol} | ${r.address} | ${r.maxSingleDropPct}% | ${r.crashConcentration.toFixed(2)} | ${r.postCrashCV.toFixed(3)} | ${r.preCrashMaxDrawdownPct}% | ${r.crashDurationSec} | ${r.maxChangePct} | ${r.finalChangePct} | ${r.score} | ${r.totalPoints} |\n`;
    });
    md += '\n';
  }

  if (medium.length > 0) {
    md += '## 中置信度\n\n';
    md += '| # | 代币 | 地址 | 单步跌幅 | 集中度 | 砸盘后CV | 砸盘前回撤 | 最大涨幅% | 最终涨幅% | 评分 | 数据点 |\n';
    md += '|---|------|------|---------|-------|---------|-----------|----------|----------|------|------|\n';
    medium.forEach((r, i) => {
      md += `| ${i + 1} | ${r.symbol} | ${r.address} | ${r.maxSingleDropPct}% | ${r.crashConcentration.toFixed(2)} | ${r.postCrashCV.toFixed(3)} | ${r.preCrashMaxDrawdownPct}% | ${r.maxChangePct} | ${r.finalChangePct} | ${r.score} | ${r.totalPoints} |\n`;
    });
    md += '\n';
  }

  md += '## 评分规则\n\n| 条件 | 分数 |\n|------|------|\n';
  md += '| 单步跌幅 > 60% | +40 |\n| 单步跌幅 > 40% | +25 |\n| 单步跌幅 > 20% | +10 |\n';
  md += '| 集中度 > 0.7 | +30 |\n| 集中度 > 0.5 | +15 |\n';
  md += '| 砸盘后 CV < 0.1 | +20 |\n| 砸盘后 CV < 0.3 | +10 |\n';
  md += '| 砸盘前回撤 < 10% | +10 |\n| 砸盘前回撤 < 20% | +5 |\n';

  fs.writeFileSync(mdPath, md);
  console.log(`📄 代币报告: ${mdPath}`);
}

function writeWalletCSV(walletMap, csvPath) {
  const sorted = [...walletMap.values()].sort((a, b) => b.tokenCount - a.tokenCount);
  let csv = 'wallet_address,token_count,buy_count,sell_count\n';
  for (const w of sorted) {
    csv += `${w.wallet},${w.tokenCount},${w.buyCount},${w.sellCount}\n`;
  }
  fs.writeFileSync(csvPath, csv);
  console.log(`📄 钱包 CSV: ${csvPath}`);
}

function writeWalletReport(walletMap, tokenCount, mdPath) {
  const sorted = [...walletMap.values()].sort((a, b) => b.tokenCount - a.tokenCount);

  let md = '# 流水盘早期交易者钱包分析\n\n';
  md += `> 生成时间: ${new Date().toISOString().slice(0, 19)}\n\n`;
  md += `## 概览\n\n`;
  md += `- 流水盘代币数: **${tokenCount}**\n`;
  md += `- 独立钱包数: **${sorted.length}**\n`;
  md += `- 参与 ≥2 个流水盘: **${sorted.filter(w => w.tokenCount >= 2).length}**\n`;
  md += `- 参与 ≥5 个流水盘: **${sorted.filter(w => w.tokenCount >= 5).length}**\n`;
  md += `- 参与 ≥10 个流水盘: **${sorted.filter(w => w.tokenCount >= 10).length}**\n\n`;

  const top = sorted.slice(0, 100);
  if (top.length > 0) {
    md += '## 钱包参与排名（Top 100）\n\n';
    md += '| # | 钱包地址 | 参与代币数 | 买入 | 卖出 |\n';
    md += '|---|---------|-----------|-----|-----|\n';
    top.forEach((w, i) => {
      md += `| ${i + 1} | ${w.wallet} | ${w.tokenCount} | ${w.buyCount} | ${w.sellCount} |\n`;
    });
  }

  fs.writeFileSync(mdPath, md);
  console.log(`📄 钱包报告: ${mdPath}`);
}

// ─── Main ───

async function main() {
  const opts = parseArgs();

  console.log('🚀 流水盘钱包挖掘工具');
  console.log(`   阶段: ${opts.steps.join(' → ')}`);
  console.log(`   输出: ${opts.outputDir}`);
  if (opts.dryRun) console.log('   模式: dry-run');
  console.log('');

  fs.mkdirSync(opts.outputDir, { recursive: true });

  let tokenResults = null;
  let walletData = null;

  // 阶段间数据传递优先走内存，仅在跳步时走文件
  const hasDetect = opts.steps.includes('detect');
  const hasWallets = opts.steps.includes('wallets');
  const hasImport = opts.steps.includes('import');

  if (hasDetect) {
    tokenResults = (await detect(opts)).results;
  }

  if (hasWallets) {
    walletData = (await wallets(opts, tokenResults)).walletMap;
  }

  if (hasImport) {
    await importWallets(opts, walletData);
  }

  console.log(`\n📁 输出目录: ${opts.outputDir}`);
}

main().catch(err => {
  console.error('❌ 执行失败:', err);
  process.exit(1);
});
