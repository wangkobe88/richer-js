const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();
  const context = browser.contexts()[0];

  try {
    const url = 'http://localhost:3010/experiment/38225250-aae6-410f-bd37-946c4c9844f8/trades#token=0xb5d23e722ea54177711f79d0a1f5f056dd464444';

    console.log('🌐 访问页面:', url);
    await page.goto(url, { waitUntil: 'networkidle' });

    // 等待页面加载
    await page.waitForTimeout(3000);

    // 检查控制台日志
    page.on('console', msg => {
      if (msg.type() === 'error') {
        console.log('❌ 页面错误:', msg.text());
      } else {
        console.log('📝', msg.text());
      }
    });

    // 获取代币选择器
    const tokenSelector = await page.locator('#token-selector').all();
    console.log(`📋 代币选择器数量: ${tokenSelector.length}`);

    if (tokenSelector.length > 0) {
      const selected = await page.locator('#token-selector').inputValue();
      console.log(`✅ 当前选择: ${selected || 'all'}`);
    }

    // 检查交易卡片
    const tradeCards = await page.locator('.trade-card').count();
    console.log(`💳 交易卡片数量: ${tradeCards}`);

    // 检查图表区域
    const chartCanvas = await page.locator('#trade-kline-chart').count();
    console.log(`📊 图表 canvas 存在: ${chartCanvas > 0 ? '是' : '否'}`);

    // 获取页面标题
    const title = await page.title();
    console.log(`📄 页面标题: ${title}`);

    // 截图保存
    await page.screenshot({ path: '/tmp/trades-page-test.png', fullPage: false });
    console.log('📸 截图已保存: /tmp/trades-page-test.png');

  } catch (error) {
    console.error('❌ 测试失败:', error.message);
  } finally {
    await browser.close();
  }
})();
