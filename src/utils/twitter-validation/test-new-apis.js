#!/usr/bin/env node

/**
 * 测试新增的Twitter API功能
 * 使用 elonmusk 作为测试案例
 */

const { getUserByScreenName, getUserTweets, getTweetDetail } = require('./index');

async function testNewAPIs() {
    console.log('🧪 开始测试新增的Twitter API功能...\n');

    const testUser = 'elonmusk';

    try {
        // 1. 测试获取用户信息
        console.log('📋 1. 测试获取用户信息');
        console.log('====================');

        const userInfo = await getUserByScreenName(testUser);
        console.log('✅ 用户信息获取成功');
        console.log(`👤 用户名: ${userInfo.name} (@${userInfo.screen_name})`);
        console.log(`🆔 用户ID: ${userInfo.id}`);
        console.log(`👥 粉丝数: ${userInfo.followers_count.toLocaleString()}`);
        console.log(`📝 推文数: ${userInfo.statuses_count.toLocaleString()}`);
        console.log(`✅ 认证状态: ${userInfo.verified ? '已认证' : '未认证'}`);
        console.log(`🔵 Blue认证: ${userInfo.is_blue_verified ? '是' : '否'}`);
        console.log(`📍 位置: ${userInfo.location || '未设置'}`);
        console.log(`📅 创建时间: ${userInfo.created_at || '未知'}`);
        console.log(`🔗 个人网站: ${userInfo.url || '未设置'}\n`);

        // 2. 测试获取用户推文列表 (使用用户ID)
        console.log('📋 2. 测试获取用户推文列表');
        console.log('==========================');

        const tweets = await getUserTweets(userInfo.id, { count: '5' });
        console.log(`✅ 成功获取 ${tweets.length} 条推文`);

        if (tweets.length > 0) {
            console.log('\n📄 最近推文:');
            tweets.forEach((tweet, index) => {
                const preview = tweet.text?.substring(0, 100) || '无内容';
                console.log(`${index + 1}. ${preview}${tweet.text?.length > 100 ? '...' : ''}`);
                console.log(`   📅 ${tweet.created_at || '未知时间'}`);
                console.log(`   ❤️ ${tweet.favorite_count || 0}  🔁 ${tweet.retweet_count || 0}  💬 ${tweet.reply_count || 0}\n`);
            });

            // 3. 测试获取推文详情 (使用第一条推文的ID)
            if (tweets[0]?.tweet_id) {
                console.log('📋 3. 测试获取推文详情');
                console.log('=====================');

                const firstTweetId = tweets[0].tweet_id;
                const tweetDetail = await getTweetDetail(firstTweetId);

                console.log('✅ 推文详情获取成功');
                console.log(`🆔 推文ID: ${tweetDetail.tweet_id}`);
                console.log(`📝 推文内容: ${tweetDetail.text}`);
                console.log(`👤 用户: ${tweetDetail.user?.name} (@${tweetDetail.user?.screen_name})`);
                console.log(`📅 发布时间: ${tweetDetail.created_at}`);
                console.log(`📊 互动数据: ❤️ ${tweetDetail.favorite_count || 0}  🔁 ${tweetDetail.retweet_count || 0}  💬 ${tweetDetail.reply_count || 0}  📎 ${tweetDetail.quote_count || 0}`);
                console.log(`🔄 转发状态: ${tweetDetail.is_retweet ? '是转发' : '原创'}`);
                console.log(`💬 回复状态: ${tweetDetail.is_reply ? '是回复' : '非回复'}`);
                console.log(`📎 引用状态: ${tweetDetail.is_quote ? '是引用' : '非引用'}`);

                if (tweetDetail.medias && tweetDetail.medias.length > 0) {
                    console.log(`📷 媒体文件: ${tweetDetail.medias.length}个`);
                }

                if (tweetDetail.urls && tweetDetail.urls.length > 0) {
                    console.log(`🔗 链接: ${tweetDetail.urls.length}个`);
                    console.log(`   链接列表: ${tweetDetail.urls.join(', ')}`);
                }
            } else {
                console.log('⚠️ 没有可用的推文ID来测试详情功能');
            }
        } else {
            console.log('⚠️ 没有获取到推文，跳过后续测试');
        }

        console.log('\n🎉 所有API测试完成！');

    } catch (error) {
        console.error('❌ API测试失败:', error.message);
        console.error('详细错误:', error);
        process.exit(1);
    }
}

// 运行测试
if (require.main === module) {
    testNewAPIs();
}

module.exports = { testNewAPIs };