const { ExperimentTimeSeriesService } = require('./src/web/services/ExperimentTimeSeriesService');

async function test() {
    const service = new ExperimentTimeSeriesService();
    const sourceExpId = '99d362c7-66f3-42e0-aba3-e8c93b12c9d8';

    console.log('=== 测试时序数据服务查询 ===');
    const data = await service.getExperimentTimeSeries(sourceExpId, null, {
        retryAttempt: 1,
        maxRetries: 3
    });

    console.log('获取的数据点数:', data?.length || 0);

    if (data && data.length > 0) {
        // 按 loop_count 分组
        const loopGroups = new Map();
        data.forEach(ts => {
            const loop = ts.loop_count;
            if (!loopGroups.has(loop)) {
                loopGroups.set(loop, new Set());
            }
            loopGroups.get(loop).add(ts.token_address);
        });

        const loops = Array.from(loopGroups.keys()).sort((a, b) => a - b);
        console.log('Loop count 范围:', loops[0], '-', loops[loops.length - 1]);
        console.log('不同 loop_count 数:', loops.length);
    }
}

test().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
