/**
 * 独立测试脚本：尝试获取 Twitter Article 内容
 * 使用 GraphQL TweetDetail API
 */

import { promises as fs } from 'fs';

const API_KEY = 'llfo2ip8ghxvivzo77tugorx3dz7xf';
const BASE_URL = 'https://api.apidance.pro';

// 测试推文 ID (Article)
const TWEET_ID = '2034708006366044486';

async function testTweetDetailWithArticle() {
  console.log('=== 测试 GraphQL TweetDetail API (Article) ===');
  console.log('Tweet ID:', TWEET_ID);
  console.log('');

  // 构建 variables 参数
  const variables = {
    focalTweetId: TWEET_ID,
    referrer: 'profile',
    with_rux_injections: false,
    includePromotedContent: false,
    withCommunity: true,
    withQuickPromoteEligibilityTweetFields: true,
    withBirdwatchNotes: true,
    withVoice: true,
    withV2Timeline: true,
    // 添加 Article 相关参数
    fieldToggles: {
      withArticleRichContentState: true,
      withArticlePlainText: true
    }
  };

  const variablesStr = JSON.stringify(variables);
  const url = `${BASE_URL}/graphql/TweetDetail?variables=${encodeURIComponent(variablesStr)}`;

  console.log('请求 URL:');
  console.log(url.substring(0, 200) + '...');
  console.log('');

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'apikey': API_KEY,
        'Content-Type': 'application/json'
      }
    });

    console.log('响应状态:', response.status);

    if (!response.ok) {
      console.log('错误:', response.statusText);
      return;
    }

    const data = await response.json();

    console.log('\n=== 响应结构 ===');
    console.log('Keys:', Object.keys(data));

    // 检查是否有 article 相关字段
    console.log('\n=== Article 字段检查 ===');

    // 递归查找 article 相关字段
    function findArticleFields(obj, path = '') {
      if (!obj || typeof obj !== 'object') return;

      for (const [key, value] of Object.entries(obj)) {
        const currentPath = path ? `${path}.${key}` : key;

        if (key.toLowerCase().includes('article')) {
          console.log(`\n找到 Article 字段: ${currentPath}`);
          console.log('类型:', typeof value);
          if (typeof value === 'string') {
            console.log('内容:', value.substring(0, 200));
          } else if (typeof value === 'object' && value !== null) {
            console.log('Keys:', Object.keys(value));
            console.log('内容:', JSON.stringify(value).substring(0, 500));
          }
        }

        if (typeof value === 'object' && value !== null) {
          findArticleFields(value, currentPath);
        }
      }
    }

    findArticleFields(data);

    // 检查 tweet 数据
    console.log('\n=== Tweet 数据 ===');
    if (data.data) {
      console.log('data Keys:', Object.keys(data.data));

      // 查找 threaded_conversation_with_injections_v2 或类似字段
      if (data.data.threaded_conversation_with_injections_v2) {
        const instructions = data.data.threaded_conversation_with_injections_v2.instructions || [];
        console.log('instructions 数量:', instructions.length);

        for (const inst of instructions) {
          if (inst.type === 'TweetLookup' || inst.entryId?.includes('Tweet')) {
            console.log('\nTweet entry:');
            console.log('  entryId:', inst.entryId);
            if (inst.content) {
              console.log('  content Keys:', Object.keys(inst.content));

              if (inst.contenttweet_results) {
                const tweet = inst.content.tweet_results.result;
                console.log('\n  tweet Keys:', Object.keys(tweet));

                if (tweet.legacy) {
                  console.log('\n  legacy Keys:', Object.keys(tweet.legacy));
                  console.log('  text:', tweet.legacy.full_text || tweet.legacy.text);
                }

                if (tweet.note_tweet) {
                  console.log('\n  note_tweet (Article内容):');
                  console.log('    Keys:', Object.keys(tweet.note_tweet));

                  if (tweet.note_tweet.note_tweet_results) {
                    const result = tweet.note_tweet.note_tweet_results.result;
                    console.log('    result Keys:', Object.keys(result));

                    if (result.text) {
                      console.log('\n    Article Text:');
                      console.log(result.text.substring(0, 500));
                    }
                  }
                }
              }
            }
          }
        }
      }
    }

    // 专门提取 Article 内容
    console.log('\n=== Article 内容提取 ===');
    const instructions = data?.data?.threaded_conversation_with_injections_v2?.instructions || [];
    for (const inst of instructions) {
      if (inst.entries) {
        for (const entry of inst.entries) {
          const tweetResult = entry?.content?.itemContent?.tweet_results?.result;
          if (tweetResult?.article?.article_results?.result) {
            const article = tweetResult.article.article_results.result;
            console.log('✅ 找到完整 Article!');
            console.log('标题:', article.title);
            console.log('Rest ID:', article.rest_id);
            console.log('预览文本:', article.preview_text);
            console.log('\n封面图片:', article.cover_media?.media_info?.original_img_url);
            console.log('发布时间:', new Date((article.metadata?.first_published_at_secs || 0) * 1000).toISOString());
            console.log('修改时间:', new Date((article.lifecycle_state?.modified_at_secs || 0) * 1000).toISOString());

            // 保存到文件以便查看完整结构
            console.log('\n完整 Article 对象已保存到 /tmp/article_response.json');
            await fs.writeFile('/tmp/article_response.json', JSON.stringify(article, null, 2));
            break;
          }
        }
      }
    }

  } catch (error) {
    console.error('请求失败:', error.message);
    console.error('Stack:', error.stack);
  }
}

// 运行测试
testTweetDetailWithArticle().catch(console.error);
