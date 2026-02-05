const { chromium } = require('@playwright/test');

(async () => {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();

  console.log('正在访问实验列表页面...');
  await page.goto('http://localhost:3010/experiments');

  // 等待页面加载
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000);

  console.log('页面已加载，等待实验卡片渲染...');

  // 等待实验容器出现
  await page.waitForSelector('#experiments-container', { timeout: 5000 });

  // 再等待一会儿让JS执行完成
  await page.waitForTimeout(3000);

  // 检查是否有实验卡片
  const cards = await page.$$('.bg-white.rounded-lg');
  console.log(`找到 ${cards.length} 个实验卡片`);

  if (cards.length > 0) {
    // 获取第一个卡片的内容
    const firstCard = cards[0];
    const html = await firstCard.innerHTML();

    console.log('\n=== 第一个实验卡片的HTML ===');
    console.log(html.substring(0, 2000));

    // 检查是否有标题元素
    const h3 = await firstCard.$('h3');
    if (h3) {
      const text = await h3.textContent();
      const className = await h3.getAttribute('class');
      console.log('\n=== 标题元素 ===');
      console.log('文本内容:', text);
      console.log('CSS类名:', className);
    } else {
      console.log('\n没有找到h3标题元素');
    }
  } else {
    console.log('没有找到实验卡片');
  }

  // 截图
  const screenshotPath = '/tmp/experiments-page.png';
  await page.screenshot({
    path: screenshotPath,
    fullPage: true
  });
  console.log(`\n截图已保存到: ${screenshotPath}`);

  await browser.close();
})();
