export interface ChannelTriplet {
    z: string;
    n: string | null;
    e: string | null;
    allQueryChannels: string[];
}

export function resolveStationChannels(station: any, timeframe: string, isMultiComponent: boolean): ChannelTriplet {
    const channels: string[] = Array.isArray(station.channels) && station.channels.length > 0
        ? station.channels
        : ['HHZ'];

    const isWebicorder = timeframe === '24h' || timeframe === '12h' || timeframe === '3h';

    // 1. Identify Vertical (Z) channels
    const zCandidates = channels.filter(c => c.toUpperCase().endsWith('Z'));
    let z = 'HHZ';
    if (isWebicorder) {
        // For long timeframes, prefer broadband (BHZ) or short period (EHZ/SHZ)
        z = zCandidates.find(c => c.toUpperCase().startsWith('B'))
            || zCandidates.find(c => c.toUpperCase().startsWith('S'))
            || zCandidates.find(c => c.toUpperCase().startsWith('E'))
            || zCandidates[0]
            || 'HHZ';
    } else {
        // For real-time, prefer broadband high-frequency (HHZ), then EHZ, HNZ, BHZ
        z = zCandidates.find(c => c.toUpperCase().startsWith('H'))
            || zCandidates.find(c => c.toUpperCase().startsWith('E'))
            || zCandidates.find(c => c.toUpperCase().startsWith('B'))
            || zCandidates[0]
            || 'HHZ';
    }

    if (!isMultiComponent) {
        return { z, n: null, e: null, allQueryChannels: [z] };
    }

    // 2. Identify Horizontal (N / Y) and (E / X)
    // Suffix rules:
    // North: ends with N, 1, Y
    // East: ends with E, 2, X
    const bandPrefix = z.length >= 2 ? z.substring(0, z.length - 1).toUpperCase() : '';

    const isNorth = (c: string) => {
        const end = c.toUpperCase().slice(-1);
        return end === 'N' || end === '1' || end === 'Y';
    };
    const isEast = (c: string) => {
        const end = c.toUpperCase().slice(-1);
        return end === 'E' || end === '2' || end === 'X';
    };

    // Match band prefix first if available
    const n = channels.find(c => c.toUpperCase().startsWith(bandPrefix) && isNorth(c))
        || channels.find(isNorth)
        || null;

    const e = channels.find(c => c.toUpperCase().startsWith(bandPrefix) && isEast(c))
        || channels.find(isEast)
        || null;

    const allQueryChannels = [z, n, e].filter((c): c is string => Boolean(c));
    return { z, n, e, allQueryChannels };
}
