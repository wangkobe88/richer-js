#!/usr/bin/env python3
"""详细测试实验页面渲染情况"""

from playwright.sync_api import sync_playwright
import json

with sync_playwright() as p:
    print("启动浏览器...")
    browser = p.chromium.launch(headless=False)
    page = browser.new_page()

    print("访问页面...")
    page.goto('http://localhost:3010/experiments')

    # 等待页面加载
    page.wait_for_load_state('networkidle')
    page.wait_for_timeout(3000)

    print("\n=== 检查控制台错误 ===")
    # 检查控制台日志
    errors = []
    def handle_console(msg):
        if msg.type == 'error':
            errors.append(msg.text)
            print(f"  错误: {msg.text}")

    page.on('console', handle_console)

    print("\n=== 检查实验卡片 ===")
    # 查找所有实验卡片
    cards = page.query_selector_all('.bg-white.rounded-lg')
    print(f"找到 {len(cards)} 个卡片")

    if cards:
        print("\n=== 第一个卡片详细信息 ===")
        first_card = cards[0]

        # 获取h3元素
        h3 = first_card.query_selector('h3')
        if h3:
            text_content = h3.text_content()
            class_name = h3.get_attribute('class')
            title_attr = h3.get_attribute('title')

            print(f"  h3 文本内容: {text_content}")
            print(f"  h3 class属性: {class_name}")
            print(f"  h3 title属性: {title_attr}")

            # 获取computed styles
            font_size = h3.evaluate('el => getComputedStyle(el).fontSize')
            font_weight = h3.evaluate('el => getComputedStyle(el).fontWeight')
            color = h3.evaluate('el => getComputedStyle(el).color')
            display = h3.evaluate('el => getComputedStyle(el).display')

            print(f"  computed fontSize: {font_size}")
            print(f"  computed fontWeight: {font_weight}")
            print(f"  computed color: {color}")
            print(f"  computed display: {display}")
        else:
            print("  ❌ 没有找到h3元素!")

        # 打印卡片的HTML
        html = first_card.inner_html()
        print(f"\n  卡片HTML (前2000字符):")
        print("  " + html[:2000])

    # 截图
    screenshot_path = '/tmp/experiments_detailed.png'
    page.screenshot(path=screenshot_path, full_page=True)
    print(f"\n截图已保存到: {screenshot_path}")

    # 检查是否有JavaScript错误
    print(f"\n=== JavaScript 错误汇总 ===")
    if errors:
        print(f"发现 {len(errors)} 个错误:")
        for err in errors:
            print(f"  - {err}")
    else:
        print("没有发现JavaScript错误")

    browser.close()
