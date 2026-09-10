export interface FilterRangeInfo {
    text: string;
    hpDefault: number;
    hpMin: number;
    hpMax: number;
    hpStep: number;
    lpDefault: number;
    lpMin: number;
    lpMax: number;
    lpStep: number;
}

export function getStationFrequencyRange(station: any, timeframe: string): FilterRangeInfo {
    const isLongTimeframe = ['24h', '12h', '3h'].includes(timeframe);
    if (isLongTimeframe) {
        return {
            text: "1.0 - 5.0 Hz",
            hpDefault: 1.0,
            hpMin: 0.0,
            hpMax: 2.0,
            hpStep: 0.005,
            lpDefault: 5.0,
            lpMin: 0.0,
            lpMax: 20.0,
            lpStep: 0.1
        };
    }

    const sampleRate = station?.sampleRate || 100;
    const nyquist = sampleRate / 2;
    const lpMax = Math.min(nyquist * 0.8, 40.0);
    const hpMax = Math.min(nyquist * 0.2, 10.0);

    return {
        text: "1.0 - 5.0 Hz",
        hpDefault: 1.0,
        hpMin: 0.0,
        hpMax: hpMax,
        hpStep: hpMax <= 5.0 ? 0.01 : 0.05,
        lpDefault: Math.min(5.0, lpMax * 0.5),
        lpMin: 0.0,
        lpMax: lpMax,
        lpStep: 0.5
    };
}

export function getNetworkBadgeClass(network: string): string {
    switch (network) {
        case 'AM': return 'net-rs';
        case 'IU':
        case 'II': return 'net-gsn';
        case 'GE': return 'net-geofon';
        default: return 'net-csn';
    }
}

export function getGeomorphicZoneInfo(zone: string): { icon: string; pillClass: string } {
    switch (zone) {
        case 'Valle': return { icon: '🏙️', pillClass: 'pill-valle' };
        case 'Cordillera': return { icon: '🏔️', pillClass: 'pill-cordillera' };
        default: return { icon: '🌊', pillClass: 'pill-costa' };
    }
}

export function formatCounts(val: number): string {
    const abs = Math.abs(val);
    if (abs >= 1_000_000) return (val / 1_000_000).toFixed(1) + 'M';
    if (abs >= 10_000) return (val / 1_000).toFixed(1) + 'k';
    if (abs >= 100) return val.toFixed(0);
    if (abs >= 10) return val.toFixed(1);
    if (abs >= 1) return val.toFixed(2);
    if (abs >= 0.01) return val.toFixed(3);
    if (abs === 0) return '0';
    return val.toFixed(4);
}

export function getSensorClassLabel(sensorClass: string): string {
    switch (sensorClass) {
        case 'broadband': return 'Banda Ancha';
        case 'accelerometer': return 'Acelerógrafo';
        case 'short_period': return 'Corto Periodo';
        default: return 'Sismómetro';
    }
}
