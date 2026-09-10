export interface TimeframeConfig {
    id: string;
    label: string;
    seconds: number;
    latencyMs: number;
    expectedRows: number;
    tickIntervalSec: number;
    decimationFactor: number;
    isWebicorder: boolean;
    isHighFrequency: boolean;
    autoRefreshSec?: number;
    renderIntervalMs: number;
}

export const TIMEFRAMES: Record<string, TimeframeConfig> = {
    '10s': {
        id: '10s',
        label: '10s',
        seconds: 10,
        latencyMs: 2_000,
        expectedRows: 1,
        tickIntervalSec: 2,
        decimationFactor: 1,
        isWebicorder: false,
        isHighFrequency: true,
        autoRefreshSec: 5,
        renderIntervalMs: 16
    },
    '1m': {
        id: '1m',
        label: '1m',
        seconds: 60,
        latencyMs: 5_000,
        expectedRows: 1,
        tickIntervalSec: 15,
        decimationFactor: 1,
        isWebicorder: false,
        isHighFrequency: true,
        autoRefreshSec: 5,
        renderIntervalMs: 16
    },
    '10m': {
        id: '10m',
        label: '10m',
        seconds: 600,
        latencyMs: 10_000,
        expectedRows: 1,
        tickIntervalSec: 120,
        decimationFactor: 1,
        isWebicorder: false,
        isHighFrequency: true,
        autoRefreshSec: 5,
        renderIntervalMs: 500
    },
    '1h': {
        id: '1h',
        label: '1h',
        seconds: 3_600,
        latencyMs: 30_000,
        expectedRows: 1,
        tickIntervalSec: 900,
        decimationFactor: 1,
        isWebicorder: false,
        isHighFrequency: false,
        renderIntervalMs: 1_000
    },
    '3h': {
        id: '3h',
        label: '3h',
        seconds: 10_800,
        latencyMs: 180_000,
        expectedRows: 6,
        tickIntervalSec: 1_800,
        decimationFactor: 5,
        isWebicorder: true,
        isHighFrequency: false,
        renderIntervalMs: 5_000
    },
    '12h': {
        id: '12h',
        label: '12h',
        seconds: 43_200,
        latencyMs: 180_000,
        expectedRows: 12,
        tickIntervalSec: 7_200,
        decimationFactor: 10,
        isWebicorder: true,
        isHighFrequency: false,
        renderIntervalMs: 10_000
    },
    '24h': {
        id: '24h',
        label: '24h',
        seconds: 86_400,
        latencyMs: 180_000,
        expectedRows: 24,
        tickIntervalSec: 14_400,
        decimationFactor: 20,
        isWebicorder: true,
        isHighFrequency: false,
        renderIntervalMs: 10_000
    }
};

export const VALID_TIMEFRAMES = Object.keys(TIMEFRAMES);
export const DEFAULT_TIMEFRAME = '1m';

export function getTimeframeConfig(tf: string): TimeframeConfig {
    return TIMEFRAMES[tf] || TIMEFRAMES[DEFAULT_TIMEFRAME];
}

export function isValidTimeframe(tf: string): boolean {
    return tf in TIMEFRAMES;
}

export function isHighFrequencyTimeframe(tf: string): boolean {
    return Boolean(TIMEFRAMES[tf]?.isHighFrequency);
}
