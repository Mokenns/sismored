import { miniseed } from 'seisplotjs';

export interface ProcessedStreamResult {
    rawBuffer: Float32Array;
    sampleRate: number;
    dataStartTime: number;
    lastFetchTime: number;
    chanCode: string;
}

export interface ClassifiedComponentRecords {
    Z: any[];
    N: any[];
    E: any[];
}

export function classifyRecordsByComponent(rawRecords: any[]): ClassifiedComponentRecords {
    const channelMap = miniseed.byChannel(rawRecords);
    const result: ClassifiedComponentRecords = { Z: [], N: [], E: [] };

    for (const [_chanKey, recList] of channelMap.entries()) {
        if (!recList || recList.length === 0) continue;
        const chan = (recList[0].header.chanCode || '').toUpperCase();
        if (chan.endsWith('Z')) {
            result.Z.push(...recList);
        } else if (chan.endsWith('N') || chan.endsWith('1') || chan.endsWith('Y')) {
            result.N.push(...recList);
        } else if (chan.endsWith('E') || chan.endsWith('2') || chan.endsWith('X')) {
            result.E.push(...recList);
        } else if (result.Z.length === 0) {
            result.Z.push(...recList);
        }
    }

    if (result.Z.length === 0) {
        let maxRecs = 0;
        let primaryStream: any[] = [];
        for (const [_chanKey, recList] of channelMap.entries()) {
            if (recList.length > maxRecs) {
                maxRecs = recList.length;
                primaryStream = recList;
            }
        }
        result.Z = primaryStream.length > 0 ? primaryStream : rawRecords;
    }

    return result;
}

export function getHeaderTimeMs(header: any): number {
    if (!header) return 0;
    if (header.startTime?.toMillis) return header.startTime.toMillis();
    if (header.startBTime?.toDateTime) return header.startBTime.toDateTime().toMillis();
    for (const field of ['start', 'startTime']) {
        const obj = header[field];
        if (!obj) continue;
        if (typeof obj.toMillis === 'function') return obj.toMillis();
        if (typeof obj.getTime === 'function') return obj.getTime();
        if (typeof obj === 'number') return obj;
        const v = obj.valueOf?.();
        if (typeof v === 'number' && v > 1e12) return v;
    }
    return 0;
}

export function processRecordStream(
    records: any[],
    previousBuffer: Float32Array | null,
    previousStartMs: number,
    startDtMs: number,
    endDtMs: number,
    windowSec: number,
    isDelta: boolean
): ProcessedStreamResult | null {
    if (!records || records.length === 0) return null;

    records.sort((a, b) => getHeaderTimeMs(a.header) - getHeaderTimeMs(b.header));

    const sampleRate = records[0].header.sampleRate;
    const chanCode = records[0].header.chanCode;

    let actualStartMs = getHeaderTimeMs(records[0].header) || startDtMs;
    const lastRec = records[records.length - 1];
    const lastRecStartMs = getHeaderTimeMs(lastRec.header);
    const lastRecDurationMs = (lastRec.header.numSamples / lastRec.header.sampleRate) * 1000;
    let actualEndMs = lastRecStartMs > 0 ? lastRecStartMs + lastRecDurationMs : endDtMs;

    if (actualEndMs <= actualStartMs) actualEndMs = actualStartMs + (windowSec * 1000);

    const totalDurationMs = actualEndMs - actualStartMs;
    const totalSamplesNeeded = Math.ceil((totalDurationMs / 1000) * sampleRate);
    const maxSamples = 12_000_000;
    const cappedSamples = Math.min(totalSamplesNeeded, maxSamples);
    const timeIndexedBuffer = new Float32Array(cappedSamples);

    let validSampleCount = 0;
    let sumX = 0, sumY = 0;
    const decompressedRecords = [];

    for (const rec of records) {
        const decoded = rec.decompress();
        decompressedRecords.push(decoded);

        const recStartMs = getHeaderTimeMs(rec.header);
        if (recStartMs <= 0) continue;
        const offsetMs = recStartMs - actualStartMs;
        const offsetSamples = Math.round((offsetMs / 1000) * sampleRate);

        for (let i = 0; i < decoded.length; i++) {
            sumX += (offsetSamples + i);
            sumY += decoded[i];
            validSampleCount++;
        }
    }

    let slope = 0;
    let intercept = 0;
    if (validSampleCount > 1) {
        const meanX = sumX / validSampleCount;
        const meanY = sumY / validSampleCount;
        let num = 0, den = 0;

        for (let r = 0; r < records.length; r++) {
            const decoded = decompressedRecords[r];
            const recStartMs = getHeaderTimeMs(records[r].header);
            if (recStartMs <= 0) continue;
            const offsetSamples = Math.round(((recStartMs - actualStartMs) / 1000) * sampleRate);

            for (let i = 0; i < decoded.length; i++) {
                const x = offsetSamples + i;
                const y = decoded[i];
                num += (x - meanX) * (y - meanY);
                den += (x - meanX) * (x - meanX);
            }
        }
        if (den !== 0) {
            slope = num / den;
            intercept = meanY - (slope * meanX);
        } else {
            intercept = meanY;
        }
    }

    let maxWrittenIndex = -1;
    for (let r = 0; r < records.length; r++) {
        const decoded = decompressedRecords[r];
        const recStartMs = getHeaderTimeMs(records[r].header);
        if (recStartMs <= 0) continue;
        const offsetMs = recStartMs - actualStartMs;
        const offsetSamples = Math.round((offsetMs / 1000) * sampleRate);

        for (let i = 0; i < decoded.length; i++) {
            const idx = offsetSamples + i;
            if (idx >= 0 && idx < cappedSamples) {
                const baseline = intercept + slope * idx;
                timeIndexedBuffer[idx] = decoded[i] - baseline;
                if (idx > maxWrittenIndex) maxWrittenIndex = idx;
            }
        }
    }

    const validSampleLength = maxWrittenIndex >= 0 ? (maxWrittenIndex + 1) : 0;
    const trimmedBuffer = validSampleLength > 0 && validSampleLength < cappedSamples
        ? timeIndexedBuffer.subarray(0, validSampleLength)
        : timeIndexedBuffer;

    let finalBuffer = trimmedBuffer;
    let finalStartMs = actualStartMs;
    let finalEndMs = validSampleLength > 0 ? (actualStartMs + (validSampleLength / sampleRate) * 1000) : actualEndMs;

    if (isDelta && previousBuffer && previousBuffer.length > 0 && previousStartMs > 0) {
        const shiftMs = actualStartMs - previousStartMs;
        const shiftSamples = Math.round((shiftMs / 1000) * sampleRate);

        if (shiftSamples > 0 && shiftSamples < previousBuffer.length) {
            const merged = new Float32Array(previousBuffer.length);
            merged.set(previousBuffer.subarray(shiftSamples));
            const overlapIndex = previousBuffer.length - shiftSamples;
            const copyLen = Math.min(trimmedBuffer.length, merged.length - overlapIndex);
            if (copyLen > 0) {
                merged.set(trimmedBuffer.subarray(0, copyLen), overlapIndex);
            }
            finalBuffer = merged;
            finalStartMs = previousStartMs + (shiftSamples / sampleRate) * 1000;
            finalEndMs = finalStartMs + (merged.length / sampleRate) * 1000;
        }
    }

    return {
        rawBuffer: finalBuffer,
        sampleRate,
        dataStartTime: finalStartMs,
        lastFetchTime: finalEndMs,
        chanCode
    };
}
