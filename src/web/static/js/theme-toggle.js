/**
 * 主题切换器 - 深色/浅色主题切换功能
 */

(function() {
  'use strict';

  // 主题配置
  const THEMES = {
    dark: {
      name: '深色主题',
      icon: '🌙',
      bodyClass: 'bg-gray-900 text-gray-100',
      navClass: 'bg-gray-800 border-gray-700',
      buttonClass: 'text-gray-300 hover:bg-gray-700'
    },
    light: {
      name: '浅色主题',
      icon: '☀️',
      bodyClass: 'bg-white text-gray-900 force-light',
      navClass: 'nav-light',
      buttonClass: 'text-gray-600 hover:bg-gray-100'
    }
  };

  // 当前主题
  let currentTheme = localStorage.getItem('rich-trading-theme') || 'light';

  // 创建主题切换按钮
  function createThemeToggle() {
    const button = document.createElement('button');
    button.className = 'theme-toggle';
    button.title = `切换到${currentTheme === 'light' ? THEMES.dark.name : THEMES.light.name}`;
    button.setAttribute('aria-label', '主题切换');
    button.innerHTML = THEMES[currentTheme].icon;

    // 点击事件
    button.addEventListener('click', toggleTheme);

    // 添加到页面
    document.body.appendChild(button);

    // 防止重复创建
    button.dataset.themeToggle = 'true';
  }

  // 切换主题
  function toggleTheme() {
    const newTheme = currentTheme === 'light' ? 'dark' : 'light';
    setTheme(newTheme);
  }

  // 设置主题
  function setTheme(theme) {
    const themeConfig = THEMES[theme];
    if (!themeConfig) return;

    // 更新body类名
    document.body.className = document.body.className
      .replace(/force-light|bg-gray-900 text-gray-100/g, '')
      .trim() + ' ' + themeConfig.bodyClass;

    // 更新导航栏
    const nav = document.querySelector('nav');
    if (nav) {
      nav.className = nav.className
        .replace(/nav-light|bg-gray-800 border-gray-700/g, '')
        .trim() + ' ' + themeConfig.navClass;
    }

    // 更新按钮
    const toggleBtn = document.querySelector('.theme-toggle');
    if (toggleBtn) {
      toggleBtn.innerHTML = themeConfig.icon;
      toggleBtn.title = `切换到${theme === 'light' ? THEMES.dark.name : THEMES.light.name}`;
    }

    // 更新其他元素
    updateThemeElements(themeConfig);

    // 保存到本地存储
    localStorage.setItem('rich-trading-theme', theme);

    // 更新当前主题
    currentTheme = theme;

    // 触发主题变化事件
    window.dispatchEvent(new CustomEvent('themechange', {
      detail: { theme, config: themeConfig }
    }));

    console.log(`🎨 主题已切换到: ${themeConfig.name}`);
  }

  // 更新主题元素
  function updateThemeElements(themeConfig) {
    // 更新所有卡片
    const cards = document.querySelectorAll('.card');
    cards.forEach(card => {
      card.classList.add('card-enhanced-light');
    });

    // 更新按钮
    const buttons = document.querySelectorAll('button');
    buttons.forEach(button => {
      if (!button.classList.contains('theme-toggle')) {
        button.classList.add('bg-blue-600', 'hover:bg-blue-700', 'text-white');
        button.classList.remove('bg-gray-700');
      }
    });

    // 更新状态徽章
    const statusBadges = document.querySelectorAll('.status-badge');
    statusBadges.forEach(badge => {
      if (badge.classList.contains('status-running')) {
        badge.classList.add('status-running-light');
      } else if (badge.classList.contains('status-stopped')) {
        badge.classList.add('status-stopped-light');
      } else if (badge.classList.contains('status-completed')) {
        badge.classList.add('status-completed-light');
      }
    });

    // 更新输入框
    const inputs = document.querySelectorAll('input, select, textarea');
    inputs.forEach(input => {
      input.classList.add('border-gray-300');
      input.style.backgroundColor = '#ffffff';
      input.style.color = '#111827';
    });

    // 更新表格
    const tables = document.querySelectorAll('table');
    tables.forEach(table => {
      table.classList.add('table-light');
    });
  }

  // 初始化
  function init() {
    // 等待DOM加载完成
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', initThemeToggle);
    } else {
      initThemeToggle();
    }
  }

  // 初始化主题切换器
  function initThemeToggle() {
    // 防止重复创建
    if (document.querySelector('.theme-toggle')) {
      console.log('⚠️ 主题切换按钮已存在');
      return;
    }

    createThemeToggle();
    setTheme(currentTheme);
    console.log('✅ 主题切换器初始化完成:', currentTheme);
  }

  // 获取当前主题
  function getCurrentTheme() {
    return currentTheme;
  }

  // 监听系统主题变化
  if (window.matchMedia) {
    const darkModeQuery = window.matchMedia('(prefers-color-scheme: dark)');
    darkModeQuery.addListener((e) => {
      // 如果用户没有手动设置主题，跟随系统
      const userSetTheme = localStorage.getItem('rich-trading-theme');
      if (!userSetTheme) {
        const systemTheme = e.matches ? 'dark' : 'light';
        console.log('🌍 系统主题变化:', systemTheme);
        // setTheme(systemTheme); // 可选：自动跟随系统主题
      }
    });
  }

  // 暴露全局方法
  window.ThemeToggle = {
    init,
    toggle: toggleTheme,
    set: setTheme,
    get: getCurrentTheme,
    THEMES
  };

  // 启动初始化
  init();

})();