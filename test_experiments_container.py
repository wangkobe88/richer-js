#!/usr/bin/env python3
"""测试实验容器内的卡片"""

from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    print("启动浏览器...")
    browser = p.chromium.launch(headless=False)
    page = browser.new_page()

    print("访问页面...")
    page.goto('http://localhost:3010/experiments')

    page.wait_for_load_state('networkidle')
    page.wait_for_timeout(3000)

    print("\n=== 检查实验容器 ===")
    # 只查找experiments-container内的卡片
    container = page.query_selector('#experiments-container')
    if container:
        cards = container.query_selector_all('.bg-white.rounded-lg')
        print(f"找到 {len(cards)} 个实验卡片")

        if cards:
            print("\n=== 第一个实验卡片 ===")
            first_card = cards[0]

            # 查找h3
            h3 = first_card.query_selector('h3')
            if h3:
                text_content = h3.text_content()
                class_name = h3.get_attribute('class')

                print(f"  h3 文本: '{text_content}'")
                print(f"  h3 class: {class_name}")

                # 获取computed styles
                font_size = h3.evaluate('el => getComputedStyle(el).fontSize')
                font_weight = h3.evaluate('el => getComputedStyle(el).fontWeight')
                color = h3.evaluate('el => getComputedStyle(el).color')

                print(f"  fontSize: {font_size}")
                print(f"  fontWeight: {font_weight}")
                print(f"  color: {color}")
            else:
                print("  ❌ 没有找到h3")

            # 打印完整HTML
            print(f"\n  完整卡片HTML:")
            print("=" * 60)
            html = first_card.inner_html()
            print(html)
            print("=" * 60)
    else:
        print("❌ 没有找到 #experiments-container")

    # 截图
    page.screenshot(path='/tmp/experiments_container.png', full_page=True)
    print(f"\n截图: /tmp/experiments_container.png")

    browser.close()
