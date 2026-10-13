/**
 * undici 全局 keepAlive（2026-10-13 叙事提速第二批 3a）
 *
 * 全仓 fetch（node 内置）默认每连接一次性——同上游连续调用（apidance/jina/
 * t.co/SiliconFlow/GMGN）每次重付 TCP+TLS 握手 ~50-300ms。setGlobalDispatcher
 * 换 undici Agent 开连接复用（node 内置 fetch 走全局 dispatcher，零调用点改动）。
 *
 * 幂等守卫=模块级布尔（模块单例，多入口 import 只生效一次）；只影响连接层，
 * 无请求语义变化（bit 一致）。接线点：data-fetch-service 顶层（叙事大链必经，
 * 早于任何 fetch 调用）。
 */
import { Agent, setGlobalDispatcher } from 'undici';

let installed = false;

export function installKeepAlive() {
  if (installed) return false;
  installed = true;
  setGlobalDispatcher(new Agent({
    keepAliveTimeout: 30_000,     // 空闲连接保活 30s（同上游短间隔复用）
    keepAliveMaxTimeout: 60_000,  // 服务端 keep-alive 上限钳制
  }));
  return true;
}
