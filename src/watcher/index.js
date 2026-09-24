#!/usr/bin/env node
/**
 * WSS watcher 入口（常驻进程，182 screen 部署）
 *
 * 用法：node src/watcher/index.js
 *
 * - pid 单实例锁（pids/wss-watcher.pid + kill(pid,0) 探活，rich-js price-feed 模式）
 * - SIGINT/SIGTERM 优雅停：冲刷 events 队列 + collector flush tickBuffer
 * - 未捕获异常 log 不退出（常驻进程韧性；进程级死亡由 screen + 心跳行 + 实验侧告警兜底）
 */

'use strict';

require('dotenv').config({ path: './config/.env' });
const fs = require('fs');
const path = require('path');

const PID_FILE = path.resolve(__dirname, '../../pids/wss-watcher.pid');

const logger = {
    info: (expId, comp, msg, meta) => console.log(`[INFO][${comp}] ${msg}`, meta ?? ''),
    warn: (expId, comp, msg, meta) => console.warn(`[WARN][${comp}] ${msg}`, meta ?? ''),
    error: (expId, comp, msg, meta) => console.error(`[ERROR][${comp}] ${msg}`, meta ?? ''),
    debug: () => {},
};

function acquirePidLock() {
    if (fs.existsSync(PID_FILE)) {
        const oldPid = parseInt(fs.readFileSync(PID_FILE, 'utf8').trim(), 10);
        if (Number.isInteger(oldPid)) {
            try {
                process.kill(oldPid, 0); // 探活：活着才抛错以外的情况
                console.error(`❌ watcher 已在运行 (pid=${oldPid})，单实例锁拒绝重复启动`);
                process.exit(1);
            } catch (e) {
                if (e.code === 'EPERM') {
                    console.error(`❌ watcher pid=${oldPid} 存在但无权限探活，拒绝启动`);
                    process.exit(1);
                }
                // ESRCH：进程已死，锁文件可接管
                console.log(`♻️ 接管陈旧 pid 锁（pid=${oldPid} 已退出）`);
            }
        }
    }
    fs.mkdirSync(path.dirname(PID_FILE), { recursive: true });
    fs.writeFileSync(PID_FILE, String(process.pid));
    console.log(`🔒 pid 锁已获取: ${PID_FILE} (pid=${process.pid})`);
}

function releasePidLock() {
    try {
        if (fs.existsSync(PID_FILE) && parseInt(fs.readFileSync(PID_FILE, 'utf8').trim(), 10) === process.pid) {
            fs.unlinkSync(PID_FILE);
        }
    } catch { /* best effort */ }
}

async function main() {
    acquirePidLock();

    const defaultConfig = require('../../config/default.json');
    const { WssWatcherService } = require('./WssWatcherService');
    const watcher = new WssWatcherService(defaultConfig, logger);

    let stopping = false;
    const shutdown = async (signal) => {
        if (stopping) return;
        stopping = true;
        console.log(`\n${signal} 收到，watcher 优雅停机中...`);
        try {
            await watcher.stop();
        } finally {
            releasePidLock();
            process.exit(0);
        }
    };
    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));

    process.on('uncaughtException', (err) => {
        logger.error('', 'WssWatcher', `未捕获异常（不退出）: ${err.stack || err.message}`);
    });
    process.on('unhandledRejection', (reason) => {
        logger.error('', 'WssWatcher', `未处理 Promise 拒绝（不退出）: ${reason}`);
    });

    await watcher.start();

    // 周期状态打点（5min）
    setInterval(() => {
        console.log(`📊 [stats] ${JSON.stringify(watcher.getStats())}`);
    }, 5 * 60 * 1000);

    console.log('✅ wss-watcher 已启动（Ctrl+C 停止）');
}

main().catch(err => {
    console.error('❌ watcher 启动失败:', err.stack || err);
    releasePidLock();
    process.exit(1);
});
