/**
 * 统计各平台导致 unrated 的数量
 */

// 设置环境变量
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 读取 .env 文件
const envPath = resolve(__dirname, '../../../config/.env');
let supabase;

try {
  const envContent = readFileSync(envPath, 'utf-8');
  for (const line of envContent.split('\n')) {
    const [key, ...valueParts] = line.split('=');
    if (key && valueParts.length > 0) {
      const value = valueParts.join('=').trim();
      process.env[key.trim()] = value;
    }
  }

  // 创建 supabase 客户端
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_KEY;

  if (supabaseUrl && supabaseKey) {
    supabase = createClient(supabaseUrl, supabaseKey);
  }
} catch (err) {
  console.warn('无法加载 .env 文件:', err.message);
}

if (!supabase) {
  console.error('无法创建 supabase 客户端，请检查环境变量');
  process.exit(1);
}

// 平台识别规则
const PLATFORM_PATTERNS = {
  '抖音': ['douyin.com', 'iesdouyin.com'],
  'TikTok': ['tiktok.com'],
  'B站': ['bilibili.com', 'b23.tv'],
  'YouTube': ['youtube.com', 'youtu.be'],
  '快手': ['kuaishou.com', 'chenzhongtech.com'],
  '小红书': ['xiaohongshu.com', 'xhslink.com'],
  'Instagram': ['instagram.com'],
  'Facebook': ['facebook.com', 'fb.com'],
  '知乎': ['zhihu.com'],
  'Telegram': ['t.me', 'telegram.org'],
  'Discord': ['discord.com', 'discord.gg'],
  'X社区': ['x.com/i/communities', 'x.com/i/articles'],
  '微信公众号': ['mp.weixin.qq.com'],
  '微博': ['weibo.com'],
  'Twitter': ['twitter.com', 'x.com/status']
};

/**
 * 识别URL所属平台
 */
function identifyPlatform(url) {
  if (!url) return '无链接';

  for (const [platform, patterns] of Object.entries(PLATFORM_PATTERNS)) {
    for (const pattern of patterns) {
      if (url.toLowerCase().includes(pattern)) {
        return platform;
      }
    }
  }

  return '其他网站';
}

/**
 * 统计分析
 */
async function analyzeUnrated() {
  console.log('正在查询 unrated 的代币...\n');

  // 查询所有 unrated 的记录
  const { data, error } = await supabase
    .from('token_narrative')
    .select('token_address, token_symbol, extracted_info, llm_summary')
    .eq('llm_category', 'unrated');

  if (error) {
    console.error('查询失败:', error.message);
    return;
  }

  if (!data || data.length === 0) {
    console.log('没有 unrated 的代币');
    return;
  }

  console.log(`找到 ${data.length} 个 unrated 代币\n`);

  // 统计各平台数量
  const platformCount = {};
  const details = [];

  for (const record of data) {
    const extracted = record.extracted_info || {};
    const website = extracted.website || '';
    const twitterUrl = extracted.twitter_url || '';

    // 识别主要平台
    let mainPlatform = identifyPlatform(website);
    let secondaryPlatform = twitterUrl ? identifyPlatform(twitterUrl) : null;

    // 如果没有website，检查twitter
    if (mainPlatform === '无链接' && secondaryPlatform) {
      mainPlatform = secondaryPlatform;
    }

    // 统计
    if (!platformCount[mainPlatform]) {
      platformCount[mainPlatform] = 0;
    }
    platformCount[mainPlatform]++;

    // 收集详细信息
    const summary = record.llm_summary || {};
    details.push({
      symbol: record.token_symbol,
      address: record.token_address.slice(0, 8) + '...',
      platform: mainPlatform,
      website: website || '无',
      twitterUrl: twitterUrl || '无',
      reason: summary.reasoning || '无原因'
    });
  }

  // 打印统计结果
  console.log('=== 按平台统计 ===\n');
  const sortedPlatforms = Object.entries(platformCount).sort((a, b) => b[1] - a[1]);

  for (const [platform, count] of sortedPlatforms) {
    const percentage = ((count / data.length) * 100).toFixed(1);
    console.log(`${platform.padEnd(20)} ${count.toString().padStart(4)} (${percentage}%)`);
  }

  console.log(`\n总计: ${data.length}\n`);

  // 分类统计
  console.log('=== 分类统计 ===\n');

  const videoPlatforms = ['抖音', 'TikTok', 'B站', 'YouTube', '快手'];
  const socialPlatforms = ['小红书', 'Instagram', 'Facebook', '知乎'];
  const communityPlatforms = ['Telegram', 'Discord', 'X社区'];
  const weiboCount = platformCount['微博'] || 0;
  const twitterCount = platformCount['Twitter'] || 0;
  const noLinkCount = platformCount['无链接'] || 0;
  const otherCount = platformCount['其他网站'] || 0;

  let videoCount = 0;
  for (const p of videoPlatforms) {
    videoCount += platformCount[p] || 0;
  }

  let socialCount = 0;
  for (const p of socialPlatforms) {
    socialCount += platformCount[p] || 0;
  }

  let communityCount = 0;
  for (const p of communityPlatforms) {
    communityCount += platformCount[p] || 0;
  }

  console.log(`视频平台 (抖音/TikTok/B站/YouTube/快手): ${videoCount} (${(videoCount/data.length*100).toFixed(1)}%)`);
  console.log(`社交平台 (小红书/Instagram/Facebook/知乎): ${socialCount} (${(socialCount/data.length*100).toFixed(1)}%)`);
  console.log(`社区平台 (Telegram/Discord/X社区): ${communityCount} (${(communityCount/data.length*100).toFixed(1)}%)`);
  console.log(`微博: ${weiboCount} (${(weiboCount/data.length*100).toFixed(1)}%)`);
  console.log(`Twitter: ${twitterCount} (${(twitterCount/data.length*100).toFixed(1)}%)`);
  console.log(`无链接: ${noLinkCount} (${(noLinkCount/data.length*100).toFixed(1)}%)`);
  console.log(`其他网站: ${otherCount} (${(otherCount/data.length*100).toFixed(1)}%)`);

  // 输出详细列表（前20个）
  console.log('\n=== 详细列表 (前20个) ===\n');
  details.slice(0, 20).forEach((item, index) => {
    console.log(`${index + 1}. ${item.symbol} - ${item.platform}`);
    console.log(`   地址: ${item.address}`);
    console.log(`   Website: ${item.website.substring(0, 60)}${item.website.length > 60 ? '...' : ''}`);
    console.log(`   原因: ${item.reason.substring(0, 80)}${item.reason.length > 80 ? '...' : ''}`);
    console.log('');
  });
}

// 运行分析
analyzeUnrated().catch(console.error);
