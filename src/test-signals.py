#!/usr/bin/env python3
"""测试交易信号页面的代币选择器"""

import asyncio
from playwright.async_api import async_playwright

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=False)
        context = await browser.new_context()
        page = await context.new_page()

        # 收集控制台日志
        console_messages = []

        async def handle_console(msg):
            if msg.type in ['log', 'warn', 'error']:
                text = msg.text
                console_messages.append(text)
                print(f"[Console] {text}")

        page.on('console', handle_console)

        # 收集网络请求
        async def handle_response(response):
            if '/tokens' in response.url:
                print(f"[Network] {response.url} -> {response.status}")
                try:
                    data = await response.json()
                    print(f"[Network] Response data keys: {list(data.keys())}")
                    if 'data' in data:
                        print(f"[Network] data length: {len(data['data'])}")
                    if 'tokens' in data:
                        print(f"[Network] tokens length: {len(data['tokens'])}")
                except:
                    pass

        page.on('response', handle_response)

        print("正在访问页面...")
        await page.goto('http://localhost:3010/experiment/90916ad8-9690-453c-8ae7-d17715e602e5/signals')

        # 等待页面加载
        await asyncio.sleep(5)

        # 检查代币选择器
        selector = await page.query_selector('#token-selector')
        if selector:
            options = await page.query_selector_all('#token-selector option')
            print(f"\n[Token Selector] 找到 {len(options)} 个选项:")
            for opt in options:
                value = await opt.get_attribute('value')
                text = await opt.text_content()
                print(f"  - value='{value}', text='{text}'")
        else:
            print("[ERROR] 找不到 #token-selector 元素")

        # 截图
        await page.screenshot(path='/tmp/signals-page.png', full_page=True)
        print("\n截图已保存到 /tmp/signals-page.png")

        # 分析控制台日志
        print("\n=== 控制台日志分析 ===")
        version_found = False
        tokens_length = None
        for msg in console_messages:
            if 'v2.7 已加载' in msg:
                version_found = True
            if '最终 tokens 长度:' in msg:
                try:
                    tokens_length = int(msg.split(':')[-1].strip())
                except:
                    pass

        print(f"版本 v2.7 已加载: {version_found}")
        print(f"tokens 长度: {tokens_length}")

        await asyncio.sleep(2)
        await browser.close()

if __name__ == '__main__':
    asyncio.run(main())
