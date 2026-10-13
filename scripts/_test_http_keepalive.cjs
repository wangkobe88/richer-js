#!/usr/bin/env node
/**
 * _test_http_keepalive — 3a（2026-10-13 叙事提速第二批）undici 全局 keepAlive
 *
 * 零 DB 零网络：直接调 installKeepAlive 验证幂等（二次调用不再替换 dispatcher），
 * 源码口径锁定 Agent 参数与接线点（data-fetch-service 顶层 import + 即时调用——
 * 叙事大链必经此模块，早于任何 fetch 调用）。
 */

const path = require('path');
const fs = require('fs');

let pass = 0, fail = 0;
function assert(cond, name) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}`); }
}

async function main() {
  const { installKeepAlive } = await import(
    path.join(__dirname, '../src/narrative/analyzer/utils/http-keepalive.mjs')
  );

  console.log('[A] install 幂等');
  {
    const first = installKeepAlive();
    const second = installKeepAlive();
    assert(first === true, '首次 install 返回 true');
    assert(second === false, '二次 install 返回 false（幂等守卫）');
  }

  console.log('[B] package.json 依赖');
  {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'), 'utf8'));
    assert(!!pkg.dependencies?.undici, `undici 在 dependencies（实际 ${pkg.dependencies?.undici || '缺失'}）`);
    const lock = fs.readFileSync(path.join(__dirname, '../package-lock.json'), 'utf8');
    assert(lock.includes('"node_modules/undici"'), 'package-lock 有 undici 锁定行');
  }

  console.log('[C] 源码口径');
  {
    const src = fs.readFileSync(
      path.join(__dirname, '../src/narrative/analyzer/utils/http-keepalive.mjs'), 'utf8');
    assert(src.includes('import { Agent, setGlobalDispatcher } from \'undici\';'),
      '从 undici 导入 Agent + setGlobalDispatcher');
    assert(src.includes('let installed = false;'), '模块级幂等守卫布尔');
    assert(src.includes('if (installed) return false;'), '已装直接返回 false');
    assert(src.includes('keepAliveTimeout: 30_000'), 'keepAliveTimeout 30s');
    assert(src.includes('keepAliveMaxTimeout: 60_000'), 'keepAliveMaxTimeout 60s');

    const dfsSrc = fs.readFileSync(
      path.join(__dirname, '../src/narrative/analyzer/services/data-fetch-service.mjs'), 'utf8');
    assert(dfsSrc.includes("import { installKeepAlive } from '../utils/http-keepalive.mjs';"),
      'data-fetch-service 顶部 import');
    const importEnd = dfsSrc.indexOf('installKeepAlive();');
    assert(importEnd > -1 && importEnd < dfsSrc.indexOf('export async function fetchAllDataViaClassifier'),
      'installKeepAlive() 模块顶层即时调用（早于任何导出函数体执行）');
  }

  console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(e => {
  console.error('测试运行失败:', e);
  process.exit(1);
});
