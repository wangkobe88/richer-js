#!/usr/bin/env node

const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();

  // 监听控制台消息
  page.on('console', msg => {
    if (msg.type() === 'log' || msg.type() === 'warn' || msg.type() === 'error') {
      const text = msg.text();
      if (text.includes('🔄') || text.includes('📦') || text.includes('🔍') || text.includes('⚠️')) {
        console.log('[Browser Console]', text);
      }
    }
  });

  // 监听网络请求
  page.on('response', async response => {
    const url = response.url();
    if (url.includes('/tokens')) {
      console.log('[Network]', url, '→', response.status());
      try {
        const data = await response.json();
        console.log('[Network] /tokens response:', JSON.stringify(data).substring(0, 200));
      } catch (e) {
        console.log('[Network] /tokens response: not JSON');
      }
    }
  });

  try {
    console.log('正在访问页面...');
    await page.goto('http://localhost:3010/experiment/90916ad8-9690-453c-8ae7-d17715e602e5/signals', {
      waitUntil: 'networkidle',
      timeout: 30000
    });

    // 等待页面加载
    await page.waitForTimeout(3000);

    // 检查 token-selector 元素
    const selector = await page.$('#token-selector');
    if (!selector) {
      console.log('[ERROR] 找不到 #token-selector 元素');
    } else {
      const options = await page.$$eval('#token-selector option', opts =>
        opts.map(o => ({ value: o.value, text: o.text }))
      );
      console.log('[Token Selector] 选项数量:', options.length);
      console.log('[Token Selector] 选项:', options);
    }

    // 获取页面截图
    await page.screenshot({ path: '/tmp/signals-page.png', fullPage: true });
    console.log('[Screenshot] 已保存到 /tmp/signals-page.png');

  } catch (error) {
    console.error('[Error]', error.message);
  } finally {
    await browser.close();
  }
})();
