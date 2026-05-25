/**
 * 钱包分析 - 共享配置
 * 初始化 GMGN API、Supabase 客户端，导出常量
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../config/.env') });

const { GMGNPortfolioAPI } = require('../../src/core/gmgn-api/portfolio-api');
const { GMGNTokenAPI } = require('../../src/core/gmgn-api/token-api');
const { GMGNMarketAPI } = require('../../src/core/gmgn-api/market-api');
const { preResolveGMGNHost } = require('../../src/core/gmgn-api/base-api');
const { createClient } = require('@supabase/supabase-js');

const WALLET_ADDRESS = 'CCCCQCrL6zVjnDeucDzcxJgxAs5ahNmrhw1CDexPhqrd';
const CHAIN = 'sol';
const DATA_DIR = path.resolve(__dirname, 'data');

let _portfolioApi = null;
let _tokenApi = null;
let _marketApi = null;
let _supabase = null;

async function init() {
  // DNS 预解析
  await preResolveGMGNHost();

  const apiKey = process.env.GMGN_API_KEY;
  const socksProxy = process.env.GMGN_SOCKS_PROXY;

  if (!apiKey) {
    throw new Error('GMGN_API_KEY 未配置，请在 config/.env 中设置');
  }

  const apiConfig = { apiKey, socksProxy };

  _portfolioApi = new GMGNPortfolioAPI(apiConfig);
  _tokenApi = new GMGNTokenAPI(apiConfig);
  _marketApi = new GMGNMarketAPI(apiConfig);

  // Supabase
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_KEY || process.env.SUPABASE_ANON_KEY;
  if (supabaseUrl && supabaseKey) {
    _supabase = createClient(supabaseUrl, supabaseKey);
  }

  console.log('[config] 初始化完成');
  console.log('[config] 钱包:', WALLET_ADDRESS);
  console.log('[config] 链:', CHAIN);
  console.log('[config] Supabase:', _supabase ? '已连接' : '未配置');
}

function getPortfolioApi() {
  if (!_portfolioApi) throw new Error('请先调用 init()');
  return _portfolioApi;
}

function getTokenApi() {
  if (!_tokenApi) throw new Error('请先调用 init()');
  return _tokenApi;
}

function getMarketApi() {
  if (!_marketApi) throw new Error('请先调用 init()');
  return _marketApi;
}

function getSupabase() {
  return _supabase;
}

module.exports = {
  WALLET_ADDRESS,
  CHAIN,
  DATA_DIR,
  init,
  getPortfolioApi,
  getTokenApi,
  getMarketApi,
  getSupabase,
};
