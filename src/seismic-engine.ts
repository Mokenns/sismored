import DspWorker from './dsp-worker?worker';
import { miniseed } from 'seisplotjs';

export interface ComponentTraceData {
    channelCode: string;
    component: 'Z' | 'N' | 'E';
    componentLabel: string;
    buffer: Float32Array;
    rawBuffer: Float32Array;
    sampleRate: number;
    renderSampleRate?: number;
    dataStartTime: number;
    lastFetchTime: number;
    maxAbs: number;
}

export interface StationState {
    bufferZ: Float32Array;
    rawFdsnBuffer: Float32Array;
    sampleRate: number;
    renderSampleRate?: number;
    lastFetchTime: number;
    lastRequestTime: number;
    dataStartTime: number;
    hpFilter: number;
    lpFilter: number;
    hasFailed: boolean;
    provider?: string;
    successfulProviderUrlBase?: string;
    channelCode?: string;
    isFetching: boolean;
    station: any;
    customGain: number;
    maxAbs: number;
    components: {
        Z?: ComponentTraceData;
        N?: ComponentTraceData; // North-South / Y
        E?: ComponentTraceData; // East-West / X
    };
}

export class SeismicEngine {
    globalGain: number = 3.0;
    autoScale: boolean = true;
    displayUnit: string = 'counts';
    timeframe: string = '1m'; 
    stationsState: Map<string, StationState> = new Map();
    dspWorker: Worker;
    
    colors = {
        traceCSN: '#00d2ff',
        traceRS: '#ffb300',
        traceGSN: '#00e676',
        traceGEOFON: '#e040fb',
        gridMajor: 'rgba(255, 255, 255, 0.12)',
        gridMinor: 'rgba(255, 255, 255, 0.04)',
        baseline: 'rgba(255, 255, 255, 0.25)',
        axisText: '#94a3b8'
    };
    
    private pendingFilters: Map<number, (data: { filteredData: Float32Array, effectiveSampleRate: number }) => void> = new Map();
    private filterMsgId: number = 0;
    private currentPollSessionId: number = 0;
    
    private activeCanvases: Map<HTMLCanvasElement, any> = new Map();

    constructor() {
        this.dspWorker = new DspWorker();
        this.dspWorker.onmessage = (e) => {
            const { id, filteredData, effectiveSampleRate } = e.data;
            if (this.pendingFilters.has(id)) {
                this.pendingFilters.get(id)!({ filteredData, effectiveSampleRate });
                this.pendingFilters.delete(id);
            }
        };
        
        this.startRenderLoop();
    }
    
    private startRenderLoop() {
        let lastRenderTime = 0;
        const loop = (timestamp: number) => {
            let renderInterval = 1000 / 60; // 60fps
            if (this.timeframe === '24h' || this.timeframe === '12h') renderInterval = 10000;
            else if (this.timeframe === '3h') renderInterval = 5000;
            else if (this.timeframe === '1h') renderInterval = 1000;
            else if (this.timeframe === '10m') renderInterval = 500;
            
            if (timestamp - lastRenderTime >= renderInterval) {
                this.activeCanvases.forEach((station, canvas) => {
                    this.renderCanvasTrace(canvas, station);
                });
                lastRenderTime = timestamp;
            }
            requestAnimationFrame(loop);
        };
        requestAnimationFrame(loop);
    }
    
    setActiveCanvases(map: Map<HTMLCanvasElement, any>) {
        this.activeCanvases = map;
    }

    getOrCreateStationState(stationId: string, station: any): StationState {
        if (!this.stationsState.has(stationId)) {
            this.stationsState.set(stationId, {
                bufferZ: new Float32Array(0),
                rawFdsnBuffer: new Float32Array(0),
                sampleRate: 100,
                lastFetchTime: 0,
                lastRequestTime: 0,
                dataStartTime: 0,
                hpFilter: 1.0,
                lpFilter: 5.0,
                hasFailed: false,
                isFetching: false,
                station,
                customGain: 1.0,
                maxAbs: 1.0,
                components: {}
            });
        }
        return this.stationsState.get(stationId)!;
    }

    formatCount(val: number): string {
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

    forceRender() {
        this.activeCanvases.forEach((station, canvas) => {
            this.renderCanvasTrace(canvas, station);
        });
    }

    renderStationCanvas(stationCode: string) {
        this.activeCanvases.forEach((station, canvas) => {
            if (station.code === stationCode) {
                this.renderCanvasTrace(canvas, station);
            }
        });
    }

    setStationGain(stationCode: string, gain: number, render: boolean = true) {
        let state = this.stationsState.get(stationCode);
        if (!state) {
            state = this.getOrCreateStationState(stationCode, { code: stationCode });
        }
        state.customGain = gain;
        if (render) {
            this.renderStationCanvas(stationCode);
        }
    }

    toggleAutoScale() {
        this.autoScale = !this.autoScale;
        this.forceRender();
        return this.autoScale;
    }

    setAutoScale(enabled: boolean) {
        this.autoScale = enabled;
        this.forceRender();
    }

    setTimeframe(tf: string) {
        this.timeframe = tf;
        this.stationsState.forEach(state => {
            state.isFetching = false;
            state.lastFetchTime = 0; // Reset fetch time so it forces a new fetch for the new window
            state.bufferZ = new Float32Array(0); // Clear old buffer to prevent visual artifacts
            state.rawFdsnBuffer = new Float32Array(0);
            state.components = {};
        });
        this.forceRender();
    }

    setDisplayUnit(unit: string) {
        this.displayUnit = unit;
        this.forceRender();
    }

    setGain(multiplier: number, render: boolean = true) {
        this.globalGain = multiplier;
        if (render) {
            this.forceRender();
        }
    }

    async setStationFilter(stationCode: string, hp: number, lp: number) {
        const state = this.stationsState.get(stationCode);
        if (state) {
            state.hpFilter = hp;
            state.lpFilter = lp;
            const filterPromises: Promise<any>[] = [];

            // Filter Component Z
            if (state.components?.Z?.rawBuffer && state.components.Z.rawBuffer.length > 0) {
                filterPromises.push(
                    this.applyFilterAsync(state.components.Z.rawBuffer, state.components.Z.sampleRate, hp, lp).then(res => {
                        state.components.Z!.buffer = res.filteredData;
                        state.components.Z!.renderSampleRate = res.effectiveSampleRate || state.components.Z!.sampleRate;
                        state.bufferZ = res.filteredData;
                        state.renderSampleRate = state.components.Z!.renderSampleRate;
                        let m = 0;
                        for (let i = 0; i < res.filteredData.length; i++) {
                            const v = Math.abs(res.filteredData[i]);
                            if (v > m) m = v;
                        }
                        state.components.Z!.maxAbs = m;
                        state.maxAbs = m;
                    })
                );
            } else if (state.rawFdsnBuffer && state.rawFdsnBuffer.length > 0) {
                filterPromises.push(
                    this.applyFilterAsync(state.rawFdsnBuffer, state.sampleRate, hp, lp).then(res => {
                        state.bufferZ = res.filteredData;
                        state.renderSampleRate = res.effectiveSampleRate || state.sampleRate;
                        let m = 0;
                        for (let i = 0; i < res.filteredData.length; i++) {
                            const v = Math.abs(res.filteredData[i]);
                            if (v > m) m = v;
                        }
                        state.maxAbs = m;
                    })
                );
            }

            // Filter Component N / Y
            if (state.components?.N?.rawBuffer && state.components.N.rawBuffer.length > 0) {
                filterPromises.push(
                    this.applyFilterAsync(state.components.N.rawBuffer, state.components.N.sampleRate, hp, lp).then(res => {
                        state.components.N!.buffer = res.filteredData;
                        state.components.N!.renderSampleRate = res.effectiveSampleRate || state.components.N!.sampleRate;
                        let m = 0;
                        for (let i = 0; i < res.filteredData.length; i++) {
                            const v = Math.abs(res.filteredData[i]);
                            if (v > m) m = v;
                        }
                        state.components.N!.maxAbs = m;
                    })
                );
            }

            // Filter Component E / X
            if (state.components?.E?.rawBuffer && state.components.E.rawBuffer.length > 0) {
                filterPromises.push(
                    this.applyFilterAsync(state.components.E.rawBuffer, state.components.E.sampleRate, hp, lp).then(res => {
                        state.components.E!.buffer = res.filteredData;
                        state.components.E!.renderSampleRate = res.effectiveSampleRate || state.components.E!.sampleRate;
                        let m = 0;
                        for (let i = 0; i < res.filteredData.length; i++) {
                            const v = Math.abs(res.filteredData[i]);
                            if (v > m) m = v;
                        }
                        state.components.E!.maxAbs = m;
                    })
                );
            }

            if (filterPromises.length > 0) {
                await Promise.all(filterPromises);
                this.renderStationCanvas(stationCode);
            }
        }
    }
    
    private applyFilterAsync(rawData: Float32Array, sampleRate: number, hpFreq: number, lpFreq: number): Promise<{ filteredData: Float32Array, effectiveSampleRate: number }> {
        return new Promise(resolve => {
            const id = ++this.filterMsgId;
            this.pendingFilters.set(id, resolve);
            
            let decimationFactor = 1;
            if (this.timeframe === '3h') decimationFactor = 5;
            else if (this.timeframe === '12h') decimationFactor = 10;
            else if (this.timeframe === '24h') decimationFactor = 20;

            this.dspWorker.postMessage({
                id,
                rawData,
                sampleRate,
                hpFreq,
                lpFreq,
                applyDemean: false,
                decimationFactor
            });
        });
    }

    getTimeWindowSeconds() {
        if (this.timeframe === '10s') return 10;
        if (this.timeframe === '1m') return 60;
        if (this.timeframe === '10m') return 600;
        if (this.timeframe === '1h') return 3600;
        if (this.timeframe === '3h') return 10800;
        if (this.timeframe === '12h') return 43200;
        if (this.timeframe === '24h') return 86400;
        return 60;
    }

    private processRecordStream(
        records: any[],
        previousBuffer: Float32Array | null,
        previousStartMs: number,
        startDtMs: number,
        endDtMs: number,
        windowSec: number,
        isDelta: boolean
    ): { rawBuffer: Float32Array; sampleRate: number; dataStartTime: number; lastFetchTime: number; chanCode: string } | null {
        if (!records || records.length === 0) return null;

        const headerTimeMs = (header: any): number => {
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
        };

        records.sort((a, b) => headerTimeMs(a.header) - headerTimeMs(b.header));

        const sampleRate = records[0].header.sampleRate;
        const chanCode = records[0].header.chanCode;

        let actualStartMs = headerTimeMs(records[0].header) || startDtMs;
        const lastRec = records[records.length - 1];
        const lastRecStartMs = headerTimeMs(lastRec.header);
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

            const recStartMs = headerTimeMs(rec.header);
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
            let recIdx = 0;
            for (const rec of records) {
                const decoded = decompressedRecords[recIdx++];
                const recStartMs = headerTimeMs(rec.header);
                if (recStartMs <= 0) continue;
                const offsetMs = recStartMs - actualStartMs;
                const offsetSamples = Math.round((offsetMs / 1000) * sampleRate);

                for (let i = 0; i < decoded.length; i++) {
                    const x = offsetSamples + i;
                    const y = decoded[i];
                    const dx = x - meanX;
                    num += dx * (y - meanY);
                    den += dx * dx;
                }
            }

            if (den !== 0) {
                slope = num / den;
            }
            intercept = meanY - slope * meanX;
        } else if (validSampleCount === 1) {
            intercept = sumY;
        }

        let maxWrittenIndex = 0;
        let recIdx2 = 0;
        for (const rec of records) {
            const recStartMs = headerTimeMs(rec.header);
            const decoded = decompressedRecords[recIdx2++];
            if (recStartMs <= 0) continue;

            const offsetMs = recStartMs - actualStartMs;
            const offsetSamples = Math.round((offsetMs / 1000) * sampleRate);

            if (offsetSamples < 0 || offsetSamples >= cappedSamples) continue;

            const copyLen = Math.min(decoded.length, cappedSamples - offsetSamples);
            for (let i = 0; i < copyLen; i++) {
                const x = offsetSamples + i;
                timeIndexedBuffer[x] = decoded[i] - (slope * x + intercept);
            }
            maxWrittenIndex = Math.max(maxWrittenIndex, offsetSamples + copyLen);
        }

        const finalBuffer = (maxWrittenIndex > 0 && maxWrittenIndex < cappedSamples)
            ? timeIndexedBuffer.subarray(0, maxWrittenIndex)
            : timeIndexedBuffer;

        let mergedBuffer: Float32Array;
        let mergedStartMs: number;

        if (isDelta && previousBuffer && previousBuffer.length > 0) {
            const gapMs = actualStartMs - previousStartMs;
            const gapSamples = Math.max(0, Math.round((gapMs / 1000) * sampleRate));

            const newTotalLength = gapSamples + finalBuffer.length;
            const tempBuffer = new Float32Array(newTotalLength);

            const copyLen = Math.min(previousBuffer.length, gapSamples);
            if (copyLen > 0) {
                tempBuffer.set(previousBuffer.subarray(0, copyLen), 0);
            }

            tempBuffer.set(finalBuffer, gapSamples);

            const maxWindowSamples = windowSec * sampleRate;
            if (tempBuffer.length > maxWindowSamples) {
                mergedBuffer = tempBuffer.subarray(tempBuffer.length - maxWindowSamples);
                mergedStartMs = actualEndMs - Math.round((mergedBuffer.length / sampleRate) * 1000);
            } else {
                mergedBuffer = tempBuffer;
                mergedStartMs = previousStartMs;
            }
        } else {
            mergedBuffer = finalBuffer;
            mergedStartMs = actualStartMs;
        }

        actualEndMs = mergedStartMs + Math.round((mergedBuffer.length / sampleRate) * 1000);

        return {
            rawBuffer: mergedBuffer,
            sampleRate,
            dataStartTime: mergedStartMs,
            lastFetchTime: actualEndMs,
            chanCode
        };
    }

    async fetchStationData(station: any, nowMs: number, force: boolean = false) {
        const state = this.getOrCreateStationState(station.code, station);
        if (state.isFetching) return;
        
        let cacheDuration = 10000;
        if (this.timeframe === '24h' || this.timeframe === '12h') cacheDuration = 300000; // 5 min
        else if (this.timeframe === '3h') cacheDuration = 120000; // 2 min
        else if (this.timeframe === '1h') cacheDuration = 60000; // 1 min
        else if (this.timeframe === '10m') cacheDuration = 4500; // 5s min refresh time
        else if (this.timeframe === '1m') cacheDuration = 4500; // 5s min refresh time
        else if (this.timeframe === '10s') cacheDuration = 4500; // 5s min refresh time

        if (!force && nowMs - state.lastRequestTime < cacheDuration) {
            return;
        }
        state.lastRequestTime = nowMs;
        state.isFetching = true;
        
        try {
            let latencyMs = 30 * 1000; // default 30s
            let windowSec = this.getTimeWindowSeconds();
            
            let net = station.network;
            let loc = '';
            const channels = station.channels || [];

            // Detect if this station is being viewed with multi-component canvases (Detail View)
            const isMultiComponent = Array.from(this.activeCanvases.keys()).some(c => 
                c.getAttribute('data-station-code') === station.code && 
                (c.getAttribute('data-component') === 'N' || c.getAttribute('data-component') === 'E')
            );
            
            let isWebicorder = false;
            if (this.timeframe === '10s') latencyMs = 2 * 1000;
            else if (this.timeframe === '1m') latencyMs = 5 * 1000;
            else if (this.timeframe === '10m') latencyMs = 10 * 1000;
            else if (this.timeframe === '1h') latencyMs = 30 * 1000;
            else if (this.timeframe === '3h') { latencyMs = 3 * 60 * 1000; isWebicorder = true; }
            else if (this.timeframe === '12h') { latencyMs = 3 * 60 * 1000; isWebicorder = true; }
            else if (this.timeframe === '24h') { latencyMs = 3 * 60 * 1000; isWebicorder = true; }
            
            // FDSN delay padding
            const endDt = new Date(nowMs - latencyMs);
            let startDt = new Date(endDt.getTime() - (windowSec * 1000));

            let isDelta = false;
            let previousBuffer: Float32Array | null = null;

            // Check if we can do a delta fetch to save bandwidth and speed up hover updates
            if (!force && state.lastFetchTime > 0 && state.rawFdsnBuffer.length > 0 && !state.hasFailed && state.dataStartTime > 0) {
                let overlapMs = 15000; 
                if (this.timeframe === '10s') overlapMs = 2000;
                else if (this.timeframe === '1m') overlapMs = 5000;
                
                const missingStartMs = state.lastFetchTime - overlapMs;
                if (missingStartMs > startDt.getTime() && missingStartMs < endDt.getTime()) {
                    startDt = new Date(missingStartMs);
                    isDelta = true;
                    previousBuffer = state.rawFdsnBuffer;
                }
            }
            
            const startStr = startDt.toISOString().split('.')[0];
            const endStr = endDt.toISOString().split('.')[0];
            
            const urls: string[] = [];
            const addUrlsForCha = (channelStr: string) => {
                const baseUrls = [];
                if (state.successfulProviderUrlBase) {
                     let queryNet = net;
                     if (net === 'C' && state.successfulProviderUrlBase.includes('earthscope')) queryNet = 'C1';
                     baseUrls.push(`${state.successfulProviderUrlBase}?net=${queryNet}&sta=${station.code}&loc=${loc}&cha=${channelStr}&starttime=${startStr}&endtime=${endStr}`);
                }
                
                if (net === 'C') {
                    baseUrls.push(`/api/csn/fdsnws/dataselect/1/query?net=${net}&sta=${station.code}&loc=${loc}&cha=${channelStr}&starttime=${startStr}&endtime=${endStr}`);
                    baseUrls.push(`https://service.earthscope.org/fdsnws/dataselect/1/query?net=C1&sta=${station.code}&loc=${loc}&cha=${channelStr}&starttime=${startStr}&endtime=${endStr}`);
                } else if (net === 'C1') {
                    baseUrls.push(`https://service.earthscope.org/fdsnws/dataselect/1/query?net=${net}&sta=${station.code}&loc=${loc}&cha=${channelStr}&starttime=${startStr}&endtime=${endStr}`);
                } else if (net === 'AM') {
                    baseUrls.push(`https://fdsnws.raspberryshakedata.com/fdsnws/dataselect/1/query?net=${net}&sta=${station.code}&loc=${loc}&cha=${channelStr}&starttime=${startStr}&endtime=${endStr}`);
                } else if (net === 'GE') {
                    baseUrls.push(`https://geofon.gfz-potsdam.de/fdsnws/dataselect/1/query?net=${net}&sta=${station.code}&loc=${loc}&cha=${channelStr}&starttime=${startStr}&endtime=${endStr}`);
                    baseUrls.push(`https://service.earthscope.org/fdsnws/dataselect/1/query?net=${net}&sta=${station.code}&loc=${loc}&cha=${channelStr}&starttime=${startStr}&endtime=${endStr}`);
                } else {
                    baseUrls.push(`https://service.earthscope.org/fdsnws/dataselect/1/query?net=${net}&sta=${station.code}&loc=${loc}&cha=${channelStr}&starttime=${startStr}&endtime=${endStr}`);
                }

                // Add to urls uniquely, preserving the successful provider at the very front
                for (const u of baseUrls) {
                     if (!urls.includes(u)) urls.push(u);
                }
            };

            if (isMultiComponent) {
                // Find best 3-component triplet
                let z = channels.find((c: string) => c.endsWith('Z')) || 'HHZ';
                let prefix = z.slice(0, -1);
                let n = channels.find((c: string) => c.startsWith(prefix) && (c.endsWith('N') || c.endsWith('1') || c.endsWith('Y')))
                     || channels.find((c: string) => c.endsWith('N') || c.endsWith('1') || c.endsWith('Y'));
                let e = channels.find((c: string) => c.startsWith(prefix) && (c.endsWith('E') || c.endsWith('2') || c.endsWith('X')))
                     || channels.find((c: string) => c.endsWith('E') || c.endsWith('2') || c.endsWith('X'));
                
                if (net === 'AM') {
                    if (channels.includes('ENN') && channels.includes('ENE')) {
                        n = 'ENN';
                        e = 'ENE';
                    }
                }
                const queryChans = [z, n, e].filter(Boolean);
                addUrlsForCha(queryChans.join(','));
                // Also add fallback single channel if multi-channel query rejected
                addUrlsForCha(z);
            } else if (this.timeframe === '24h' || this.timeframe === '12h') {
                if (net === 'AM') {
                    addUrlsForCha('EHZ');
                    addUrlsForCha('SHZ');
                } else {
                    addUrlsForCha('BHZ'); // LHZ removed (anti-aliases local EQs)
                    addUrlsForCha('HHZ');
                }
            } else if (this.timeframe === '3h') {
                if (net === 'AM') {
                    addUrlsForCha('EHZ');
                } else {
                    addUrlsForCha('BHZ');
                    addUrlsForCha('HHZ');
                }
            } else {
                let cha = 'HHZ';
                if (channels.includes('HHZ')) cha = 'HHZ';
                else if (channels.includes('EHZ')) cha = 'EHZ';
                else if (channels.includes('HNZ')) cha = 'HNZ';
                else if (channels.includes('BHZ')) cha = 'BHZ';
                else cha = channels.find((c: string) => c.endsWith('Z')) || 'HHZ';
                addUrlsForCha(cha);
            }

            let ab: ArrayBuffer | null = null;
            let lastError: Error | null = null;

            for (const url of urls) {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), isWebicorder ? 30000 : 12000);
                
                try {
                    const res = await fetch(url, { signal: controller.signal });
                    clearTimeout(timeoutId);
                    
                    if (res.ok) {
                        const tempAb = await res.arrayBuffer();
                        if (tempAb.byteLength > 0) {
                            try {
                                const testRecords = miniseed.parseDataRecords(tempAb);
                                if (testRecords.length > 0) {
                                    ab = tempAb;
                                    state.successfulProviderUrlBase = url.split('?')[0];
                                    if (url.includes('api/csn')) state.provider = 'CSN (Proxy)';
                                    else if (url.includes('earthscope')) state.provider = 'EarthScope';
                                    else if (url.includes('raspberryshake')) state.provider = 'RaspberryShake';
                                    else if (url.includes('geofon')) state.provider = 'GEOFON';
                                    break; // Success!
                                } else {
                                    lastError = new Error('No records in miniseed');
                                }
                            } catch (e) {
                                lastError = e as Error;
                            }
                        } else {
                            lastError = new Error('Empty ArrayBuffer');
                        }
                    } else if (res.status === 404 || res.status === 204) {
                        lastError = new Error(`HTTP ${res.status}`);
                    } else {
                        throw new Error(`HTTP ${res.status}`);
                    }
                } catch (err: any) {
                    clearTimeout(timeoutId);
                    lastError = err;
                }
            }

            if (!ab) {
                if (isDelta && previousBuffer) {
                    // No new delta data, keep previous data intact
                    return;
                }
                state.hasFailed = true;
                throw lastError || new Error('No data found across all providers');
            }
            
            const rawRecords = miniseed.parseDataRecords(ab);
            if (rawRecords.length === 0) {
                state.hasFailed = true;
                throw new Error('No records in response');
            }
            
            // Separate streams by channel identifier (net.sta.loc.cha)
            const channelMap = miniseed.byChannel(rawRecords);
            
            // Group streams into 3 components: Z (Vertical), N (North-South / Y), E (East-West / X)
            const recordsByComponent: { Z: any[]; N: any[]; E: any[] } = { Z: [], N: [], E: [] };

            for (const [_chanKey, recList] of channelMap.entries()) {
                if (!recList || recList.length === 0) continue;
                const chan = (recList[0].header.chanCode || '').toUpperCase();
                if (chan.endsWith('Z')) {
                    recordsByComponent.Z.push(...recList);
                } else if (chan.endsWith('N') || chan.endsWith('1') || chan.endsWith('Y')) {
                    recordsByComponent.N.push(...recList);
                } else if (chan.endsWith('E') || chan.endsWith('2') || chan.endsWith('X')) {
                    recordsByComponent.E.push(...recList);
                } else if (recordsByComponent.Z.length === 0) {
                    recordsByComponent.Z.push(...recList);
                }
            }

            // Fallback: If no Z was classified, take the largest stream
            if (recordsByComponent.Z.length === 0) {
                let maxRecs = 0;
                let primaryStream: any[] = [];
                for (const [_chanKey, recList] of channelMap.entries()) {
                    if (recList.length > maxRecs) {
                        maxRecs = recList.length;
                        primaryStream = recList;
                    }
                }
                recordsByComponent.Z = primaryStream.length > 0 ? primaryStream : rawRecords;
            }

            // Process each available component stream
            let anySuccess = false;
            for (const comp of ['Z', 'N', 'E'] as const) {
                const recs = recordsByComponent[comp];
                if (recs && recs.length > 0) {
                    const prevComp = state.components?.[comp];
                    const prevRaw = (comp === 'Z') ? (prevComp?.rawBuffer || state.rawFdsnBuffer) : prevComp?.rawBuffer;
                    const prevStart = (comp === 'Z') ? (prevComp?.dataStartTime || state.dataStartTime) : (prevComp?.dataStartTime || 0);

                    const processed = this.processRecordStream(
                        recs,
                        isDelta ? (prevRaw || null) : null,
                        prevStart,
                        startDt.getTime(),
                        endDt.getTime(),
                        windowSec,
                        isDelta
                    );

                    if (processed && processed.rawBuffer.length > 0) {
                        anySuccess = true;
                        const filterRes = await this.applyFilterAsync(processed.rawBuffer, processed.sampleRate, state.hpFilter, state.lpFilter);
                        let m = 0;
                        for (let i = 0; i < filterRes.filteredData.length; i++) {
                            const v = Math.abs(filterRes.filteredData[i]);
                            if (v > m) m = v;
                        }

                        let label = 'Vertical (Z)';
                        if (comp === 'N') label = 'Norte-Sur (Y)';
                        else if (comp === 'E') label = 'Este-Oeste (X)';

                        state.components[comp] = {
                            channelCode: processed.chanCode,
                            component: comp,
                            componentLabel: label,
                            buffer: filterRes.filteredData,
                            rawBuffer: processed.rawBuffer,
                            sampleRate: processed.sampleRate,
                            renderSampleRate: filterRes.effectiveSampleRate || processed.sampleRate,
                            dataStartTime: processed.dataStartTime,
                            lastFetchTime: processed.lastFetchTime,
                            maxAbs: m
                        };

                        if (comp === 'Z') {
                            state.sampleRate = processed.sampleRate;
                            state.channelCode = processed.chanCode;
                            state.rawFdsnBuffer = processed.rawBuffer;
                            state.bufferZ = filterRes.filteredData;
                            state.renderSampleRate = filterRes.effectiveSampleRate || processed.sampleRate;
                            state.dataStartTime = processed.dataStartTime;
                            state.lastFetchTime = processed.lastFetchTime;
                            state.maxAbs = m;
                            state.hasFailed = false;
                        }
                    }
                }
            }

            if (!anySuccess && (!state.bufferZ || state.bufferZ.length === 0)) {
                state.hasFailed = true;
                throw new Error('No samples extracted from records');
            } else {
                state.hasFailed = false;
            }
        } catch (e: any) {
            console.warn(`[FDSN] ${station.code}:`, e.message);
            state.hasFailed = true;
        } finally {
            state.isFetching = false;
        }
    }

    cancelActivePolling() {
        this.currentPollSessionId++;
    }

    async pollLiveFDSNForVisible(visibleStationsList: any[], isInitial = false) {
        const sessionId = isInitial ? this.currentPollSessionId : ++this.currentPollSessionId;
        
        if (isInitial) {
            const chunkSize = 6;
            for (let i = 0; i < visibleStationsList.length; i += chunkSize) {
                const chunk = visibleStationsList.slice(i, i + chunkSize);
                await Promise.all(chunk.map(st => this.fetchStationData(st, Date.now(), true)));
            }
        } else {
            // Staggered updates
            for (let i = 0; i < visibleStationsList.length; i++) {
                if (this.currentPollSessionId !== sessionId) {
                    // Polling was cancelled (e.g. user hovered a station or changed view)
                    return;
                }
                await this.fetchStationData(visibleStationsList[i], Date.now(), false);
                if (this.currentPollSessionId !== sessionId) {
                    return;
                }
                if (visibleStationsList.length > 1) {
                    await new Promise(r => setTimeout(r, 400)); // 400ms time gap between station requests
                }
            }
        }
    }

    renderCanvasTrace(canvas: HTMLCanvasElement, station: any) {
        if (!canvas) return;
        const ctx = canvas.getContext('2d')!;
        const dpr = window.devicePixelRatio || 1;
        
        const comp = ((canvas.getAttribute('data-component') || 'Z').toUpperCase()) as 'Z' | 'N' | 'E';
        const state = this.getOrCreateStationState(station.code, station);
        const compData = state.components?.[comp];

        const buffer = (comp === 'Z')
            ? (compData?.buffer || state.bufferZ)
            : (compData?.buffer || new Float32Array(0));
        const bufLen = buffer.length;

        const windowSec = this.getTimeWindowSeconds();
        const windowMs = windowSec * 1000;
        let latencyMs = 30 * 1000;
        if (this.timeframe === '10s') latencyMs = 2 * 1000;
        else if (this.timeframe === '1m') latencyMs = 5 * 1000;
        else if (this.timeframe === '10m') latencyMs = 10 * 1000;
        else if (this.timeframe === '1h') latencyMs = 30 * 1000;
        else if (this.timeframe === '3h' || this.timeframe === '12h' || this.timeframe === '24h') latencyMs = 3 * 60 * 1000;
        
        const compLastFetch = compData?.lastFetchTime || state.lastFetchTime;
        const compDataStart = compData?.dataStartTime || state.dataStartTime;
        const activeSampleRate = compData?.renderSampleRate || compData?.sampleRate || (comp === 'Z' ? (state.renderSampleRate || state.sampleRate) : 100);

        const logicalNow = compLastFetch > 0 ? compLastFetch : (Date.now() - latencyMs);
        
        let expectedRows = 1;
        if (this.timeframe === '24h') expectedRows = 24;
        else if (this.timeframe === '12h') expectedRows = 12;
        else if (this.timeframe === '3h') expectedRows = 6;
        
        let numRows = expectedRows;
        let rowDurationMs = windowMs / expectedRows;

        // Dynamic adjustment based on actual downloaded data duration
        if (expectedRows > 1 && !state.hasFailed && compDataStart > 0) {
            const actualDurationMs = logicalNow - compDataStart;
            if (actualDurationMs > 0 && actualDurationMs < windowMs) {
                numRows = Math.max(1, Math.ceil(actualDurationMs / rowDurationMs));
            }
        }
        
        const adaptedWindowMs = numRows * rowDurationMs;
        const logicalWindowStart = logicalNow - adaptedWindowMs;

        const cssWidth = canvas.parentElement?.clientWidth || 380;
        const cssHeight = numRows > 1 ? (numRows * 50 + 20) : (canvas.getAttribute('height') ? parseInt(canvas.getAttribute('height')!) : 105);
        
        if (canvas.style.height !== cssHeight + 'px') {
            canvas.style.height = cssHeight + 'px';
            if (canvas.parentElement) {
                canvas.parentElement.style.minHeight = cssHeight + 'px';
            }
        }
        
        if (canvas.width !== cssWidth * dpr || canvas.height !== cssHeight * dpr) {
            canvas.width = cssWidth * dpr;
            canvas.height = cssHeight * dpr;
            ctx.scale(dpr, dpr);
        }
        
        const width = cssWidth;
        const height = cssHeight;

        ctx.fillStyle = '#060a12';
        ctx.fillRect(0, 0, width, height);

        const padLeft = 45;
        const padBottom = 16;
        const plotWidth = width - padLeft;
        
        const compMaxAbs = compData?.maxAbs || (comp === 'Z' ? state.maxAbs : 0.0001);
        const maxAbs = Math.max(compMaxAbs || 0.0001, 0.0001);
        
        const rowHeight = (height - padBottom) / numRows;
        
        // Auto-scale vs Manual scale combined with customGain
        const targetAmplitudePixels = rowHeight * 0.42;
        let baseScale = (targetAmplitudePixels / maxAbs);
        if (!this.autoScale) {
            baseScale = (targetAmplitudePixels / 1000.0) * (this.globalGain / 3.0);
        }
        const effectiveScale = baseScale * (state.customGain || 1.0);

        // X-axis interval (Density reduced)
        let tickIntervalSec = 30;
        if (windowSec <= 10) tickIntervalSec = 2;
        else if (windowSec <= 60) tickIntervalSec = 15;
        else if (windowSec <= 600) tickIntervalSec = 120;
        else if (windowSec <= 3600) tickIntervalSec = 900;
        else if (windowSec <= 10800) tickIntervalSec = 1800;
        else if (windowSec <= 43200) tickIntervalSec = 7200;
        else tickIntervalSec = 14400;

        const tickIntervalMs = tickIntervalSec * 1000;

        // Draw rows
        for (let r = 0; r < numRows; r++) {
            const rowStartY = r * rowHeight;
            const plotCenterY = rowStartY + (rowHeight / 2);
            
            // Y Grid
            ctx.strokeStyle = this.colors.gridMinor;
            ctx.lineWidth = 1;
            const ySteps = [-0.75, 0.75];
            ctx.beginPath();
            ySteps.forEach(ratio => {
                const y = plotCenterY + (ratio * rowHeight * 0.5);
                ctx.moveTo(padLeft, y);
                ctx.lineTo(width, y);
            });
            ctx.stroke();

            ctx.strokeStyle = this.colors.baseline;
            ctx.beginPath();
            ctx.moveTo(padLeft, plotCenterY);
            ctx.lineTo(width, plotCenterY);
            ctx.stroke();
            
            // X Grid & Labels
            ctx.strokeStyle = this.colors.gridMajor;
            ctx.fillStyle = this.colors.axisText;
            ctx.font = '9px JetBrains Mono, monospace';
            ctx.textAlign = 'center';
            
            const rowStartTime = logicalWindowStart + (r * rowDurationMs);
            const rowEndTime = rowStartTime + rowDurationMs;
            
            ctx.beginPath();
            
            if (this.timeframe === '10s' || this.timeframe === '1m' || this.timeframe === '10m') {
                const firstTickAgoMs = Math.floor((logicalNow - rowStartTime) / tickIntervalMs) * tickIntervalMs;
                for (let ago = firstTickAgoMs; ago >= 0; ago -= tickIntervalMs) {
                    const t = logicalNow - ago;
                    if (t >= rowStartTime && t <= rowEndTime) {
                        const x = padLeft + ((t - rowStartTime) / rowDurationMs) * plotWidth;
                        if (x >= padLeft && x <= width) {
                            ctx.moveTo(x, rowStartY);
                            ctx.lineTo(x, rowStartY + rowHeight);
                            
                            if (r === numRows - 1) { 
                                const agoSec = Math.round(ago / 1000);
                                if (agoSec === 0) {
                                    ctx.fillText(`0s`, x, height - 2);
                                } else if (agoSec >= 60) {
                                    const m = Math.floor(agoSec / 60);
                                    const s = agoSec % 60;
                                    if (s === 0) ctx.fillText(`-${m}m`, x, height - 2);
                                    else ctx.fillText(`-${m}m${s}s`, x, height - 2);
                                } else {
                                    ctx.fillText(`-${agoSec}s`, x, height - 2);
                                }
                            }
                        }
                    }
                }
            } else {
                let rowFirstTick = Math.ceil(rowStartTime / tickIntervalMs) * tickIntervalMs;
                for (let t = rowFirstTick; t <= rowEndTime; t += tickIntervalMs) {
                    const x = padLeft + ((t - rowStartTime) / rowDurationMs) * plotWidth;
                    if (x >= padLeft && x <= width) {
                        ctx.moveTo(x, rowStartY);
                        ctx.lineTo(x, rowStartY + rowHeight);
                        
                        if (r === numRows - 1) {
                            const dt = new Date(t);
                            const stgFormat = new Intl.DateTimeFormat('es-CL', {
                                timeZone: 'America/Santiago',
                                hour: '2-digit', minute: '2-digit',
                                hour12: false
                            });
                            ctx.fillText(stgFormat.format(dt), x, height - 2);
                        }
                    }
                }
            }
            ctx.stroke();

            // Draw Y-axis labels for each row
            const gridCountVal = (rowHeight * 0.375) / effectiveScale;
            const formattedMax = this.formatCount(gridCountVal);
            ctx.fillStyle = this.colors.axisText;
            ctx.textAlign = 'right';
            ctx.fillText('+' + formattedMax, padLeft - 3, plotCenterY - (rowHeight * 0.375) + 3);
            
            if (numRows > 1) {
                const dt = new Date(rowStartTime);
                const stgFormat = new Intl.DateTimeFormat('es-CL', {
                    timeZone: 'America/Santiago',
                    hour: '2-digit', minute: '2-digit',
                    hour12: false
                });
                ctx.fillText(stgFormat.format(dt), padLeft - 3, plotCenterY + 3);
            } else {
                ctx.fillText('0', padLeft - 3, plotCenterY + 3);
            }
            
            ctx.fillText('-' + formattedMax, padLeft - 3, plotCenterY + (rowHeight * 0.375) + 3);

            // Draw Trace
            if (bufLen > 0) {
                let traceColor = this.colors.traceCSN;
                if (comp === 'N') {
                    traceColor = '#10b981'; // Vibrant Emerald Green for N / Y
                } else if (comp === 'E') {
                    traceColor = '#f59e0b'; // Solar Amber / Coral for E / X
                } else {
                    if (station.network === 'AM') traceColor = this.colors.traceRS;
                    else if (station.network === 'IU' || station.network === 'II') traceColor = this.colors.traceGSN;
                    else if (station.network === 'GE') traceColor = this.colors.traceGEOFON;
                    else traceColor = '#00d2ff'; // Cyan for Z
                }

                ctx.strokeStyle = traceColor;
                ctx.lineWidth = 1.2;
                ctx.lineJoin = 'round';
                ctx.beginPath();
                
                // Segment of buffer that falls in this row
                const startIndex = Math.max(0, Math.floor(((rowStartTime - compDataStart) / 1000) * activeSampleRate));
                const endIndex = Math.min(bufLen, Math.ceil(((rowEndTime - compDataStart) / 1000) * activeSampleRate));
                
                if (startIndex < endIndex) {
                    const rowSamples = endIndex - startIndex;
                    const ptsPerPixel = rowSamples / plotWidth;
                    
                    if (ptsPerPixel <= 1) {
                        for (let i = startIndex; i < endIndex; i++) {
                            const t = compDataStart + (i / activeSampleRate) * 1000;
                            const x = padLeft + ((t - rowStartTime) / rowDurationMs) * plotWidth;
                            const y = plotCenterY - (buffer[i] * effectiveScale);
                            const clampedY = Math.max(rowStartY + 1, Math.min(rowStartY + rowHeight - 1, y));
                            
                            if (i === startIndex) ctx.moveTo(x, clampedY);
                            else ctx.lineTo(x, clampedY);
                        }
                    } else {
                        // Min-Max drawing
                        for (let px = 0; px < plotWidth; px++) {
                            const actualPx = padLeft + px;
                            
                            const sIdx = startIndex + Math.floor((px / plotWidth) * rowSamples);
                            let eIdx = startIndex + Math.floor(((px + 1) / plotWidth) * rowSamples);
                            if (eIdx > endIndex) eIdx = endIndex;
                            
                            let minVal = Infinity, maxVal = -Infinity;
                            for (let i = sIdx; i < eIdx; i++) {
                                const val = buffer[i];
                                if (val < minVal) minVal = val;
                                if (val > maxVal) maxVal = val;
                            }
                            
                            if (minVal !== Infinity) {
                                let yMin = plotCenterY - (minVal * effectiveScale);
                                let yMax = plotCenterY - (maxVal * effectiveScale);
                                yMin = Math.max(rowStartY + 1, Math.min(rowStartY + rowHeight - 1, yMin));
                                yMax = Math.max(rowStartY + 1, Math.min(rowStartY + rowHeight - 1, yMax));
                                
                                if (px === 0) ctx.moveTo(actualPx, yMin);
                                else ctx.lineTo(actualPx, yMin);
                                ctx.lineTo(actualPx, yMax);
                            }
                        }
                    }
                    ctx.stroke();
                }
            } else {
                if (r === Math.floor(numRows / 2)) {
                    ctx.fillStyle = '#64748b';
                    ctx.font = '11px JetBrains Mono, monospace';
                    ctx.textAlign = 'center';
                    if (state.hasFailed) {
                        ctx.fillText('Sin datos disponibles', padLeft + (plotWidth / 2), plotCenterY);
                    } else if (comp !== 'Z' && !compData && !state.isFetching) {
                        ctx.fillText(`Componente ${comp === 'N' ? 'N / Y' : 'E / X'} no disponible (Sensor 1D)`, padLeft + (plotWidth / 2), plotCenterY);
                    } else {
                        ctx.fillText('Esperando datos...', padLeft + (plotWidth / 2), plotCenterY);
                    }
                }
            }
        }
        
        let displayMax = this.formatCount(compMaxAbs || maxAbs);
        const tag = document.getElementById(`pgv-tag-${station.code}-${comp}`) || document.getElementById(`pgv-tag-${station.code}`);
        if (tag) {
            if (state.hasFailed) {
                tag.textContent = `No hay datos disponibles`;
            } else if (bufLen === 0 && comp !== 'Z' && !compData) {
                tag.textContent = `No disponible`;
            } else {
                const chanCode = compData?.channelCode || (comp === 'Z' ? state.channelCode : comp);
                tag.textContent = `Max: ±${displayMax} cnt | ${chanCode || comp} | ${state.provider || 'N/A'}`;
            }
        }
        
        const rangeOverlay = document.getElementById(`range-overlay-${station.code}-${comp}`) || document.getElementById(`range-overlay-${station.code}`);
        if (rangeOverlay && activeSampleRate && !state.hasFailed && bufLen > 0) {
            const nyquist = activeSampleRate / 2;
            const chanCode = compData?.channelCode || (comp === 'Z' ? state.channelCode : comp) || '???';
            rangeOverlay.textContent = `0.01 - ${nyquist.toFixed(1)} Hz (${chanCode})`;
        }
        
        const sensorMeta = document.getElementById(`sensor-meta-${station.code}`);
        if (sensorMeta && state.channelCode && !state.hasFailed) {
            let sensorType = 'Desconocido';
            const ch = state.channelCode.toUpperCase();
            if (ch.startsWith('H') && ch.endsWith('Z')) {
                sensorType = ch[1] === 'N' ? `Acelerógrafo (${ch})` : `Banda Ancha (${ch})`;
            } else if (ch.startsWith('B') && ch.endsWith('Z')) {
                sensorType = `Banda Ancha (${ch})`;
            } else if (ch.startsWith('E') || ch.startsWith('S')) {
                sensorType = ch[1] === 'N' ? `Acelerógrafo (${ch})` : `Corto Periodo (${ch})`;
            } else {
                sensorType = ch;
            }
            sensorMeta.innerHTML = `Sensor: <span>${sensorType} (${state.sampleRate} sps)</span>`;
        }
    }
}
