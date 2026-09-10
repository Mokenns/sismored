import { miniseed } from 'seisplotjs';
import { getTimeframeConfig, DEFAULT_TIMEFRAME } from './config/timeframes';
import { buildFdsnUrls } from './config/providers';
import { resolveStationChannels } from './utils/channel-selector';
import { classifyRecordsByComponent, processRecordStream } from './telemetry/stream-processor';
import { DspService } from './services/dsp-service';
import { SeismogramRenderer, type RenderColors } from './rendering/seismogram-renderer';

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
        N?: ComponentTraceData;
        E?: ComponentTraceData;
    };
}

export class SeismicEngine {
    globalGain: number = 3.0;
    autoScale: boolean = true;
    displayUnit: string = 'counts';
    timeframe: string = DEFAULT_TIMEFRAME;
    stationsState: Map<string, StationState> = new Map();

    colors: RenderColors = {
        traceCSN: '#00d2ff',
        traceRS: '#ffb300',
        traceGSN: '#00e676',
        traceGEOFON: '#e040fb',
        gridMajor: 'rgba(255, 255, 255, 0.12)',
        gridMinor: 'rgba(255, 255, 255, 0.04)',
        baseline: 'rgba(255, 255, 255, 0.25)',
        axisText: '#94a3b8'
    };

    private dspService: DspService;
    private currentPollSessionId: number = 0;
    private activeCanvases: Map<HTMLCanvasElement, any> = new Map();

    constructor() {
        this.dspService = new DspService();
        this.startRenderLoop();
    }

    private startRenderLoop() {
        let lastRenderTime = 0;
        const loop = (timestamp: number) => {
            const config = getTimeframeConfig(this.timeframe);
            if (timestamp - lastRenderTime >= config.renderIntervalMs) {
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

    renderCanvasTrace(canvas: HTMLCanvasElement, station: any) {
        if (!canvas) return;
        const state = this.getOrCreateStationState(station.code, station);
        const config = getTimeframeConfig(this.timeframe);
        SeismogramRenderer.render({
            canvas,
            station,
            state,
            timeframeConfig: config,
            autoScale: this.autoScale,
            globalGain: this.globalGain,
            colors: this.colors
        });
    }

    setStationGain(stationCode: string, gain: number, render: boolean = true) {
        const state = this.getOrCreateStationState(stationCode, { code: stationCode });
        state.customGain = gain;
        if (render) this.renderStationCanvas(stationCode);
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
            state.lastFetchTime = 0;
            state.bufferZ = new Float32Array(0);
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
        if (render) this.forceRender();
    }

    getTimeWindowSeconds(): number {
        return getTimeframeConfig(this.timeframe).seconds;
    }

    async setStationFilter(stationCode: string, hp: number, lp: number) {
        const state = this.stationsState.get(stationCode);
        if (!state) return;

        state.hpFilter = hp;
        state.lpFilter = lp;
        const config = getTimeframeConfig(this.timeframe);
        const filterPromises: Promise<any>[] = [];

        // Filter Z component
        const zRaw = state.components?.Z?.rawBuffer || state.rawFdsnBuffer;
        const zRate = state.components?.Z?.sampleRate || state.sampleRate;
        if (zRaw && zRaw.length > 0) {
            filterPromises.push(
                this.dspService.filterWaveform(zRaw, zRate, hp, lp, config.decimationFactor).then(res => {
                    if (state.components?.Z) {
                        state.components.Z.buffer = res.filteredData;
                        state.components.Z.renderSampleRate = res.effectiveSampleRate;
                        state.components.Z.maxAbs = this.calculateMaxAbs(res.filteredData);
                    }
                    state.bufferZ = res.filteredData;
                    state.renderSampleRate = res.effectiveSampleRate;
                    state.maxAbs = this.calculateMaxAbs(res.filteredData);
                })
            );
        }

        // Filter N and E components if present
        for (const comp of ['N', 'E'] as const) {
            const compData = state.components?.[comp];
            if (compData?.rawBuffer && compData.rawBuffer.length > 0) {
                filterPromises.push(
                    this.dspService.filterWaveform(compData.rawBuffer, compData.sampleRate, hp, lp, config.decimationFactor).then(res => {
                        compData.buffer = res.filteredData;
                        compData.renderSampleRate = res.effectiveSampleRate;
                        compData.maxAbs = this.calculateMaxAbs(res.filteredData);
                    })
                );
            }
        }

        if (filterPromises.length > 0) {
            await Promise.all(filterPromises);
            this.renderStationCanvas(stationCode);
        }
    }

    private calculateMaxAbs(data: Float32Array): number {
        let max = 0;
        for (let i = 0; i < data.length; i++) {
            const v = Math.abs(data[i]);
            if (v > max) max = v;
        }
        return Math.max(max, 0.0001);
    }

    async fetchStationData(station: any, nowMs: number, force = false) {
        const state = this.getOrCreateStationState(station.code, station);
        if (state.isFetching) return;
        state.isFetching = true;
        state.lastRequestTime = nowMs;

        const config = getTimeframeConfig(this.timeframe);
        const windowSec = config.seconds;
        const endDt = new Date(nowMs - config.latencyMs);
        let startDt = new Date(endDt.getTime() - (windowSec * 1000));

        let isDelta = false;
        let previousBuffer: Float32Array | null = null;

        // Delta fetching for fast real-time polling
        if (!force && state.lastFetchTime > 0 && state.rawFdsnBuffer.length > 0 && !state.hasFailed && state.dataStartTime > 0) {
            const overlapMs = this.timeframe === '10s' ? 2000 : (this.timeframe === '1m' ? 5000 : 15000);
            const missingStartMs = state.lastFetchTime - overlapMs;
            if (missingStartMs > startDt.getTime() && missingStartMs < endDt.getTime()) {
                startDt = new Date(missingStartMs);
                isDelta = true;
                previousBuffer = state.rawFdsnBuffer;
            }
        }

        const startStr = startDt.toISOString().split('.')[0];
        const endStr = endDt.toISOString().split('.')[0];

        // Check whether this station is currently displayed in 3-component detail view
        let isMultiComponent = false;
        this.activeCanvases.forEach((st, canvas) => {
            if (st.code === station.code && canvas.hasAttribute('data-component')) {
                isMultiComponent = true;
            }
        });

        // Dynamically resolve channels from station metadata
        const channelResolution = resolveStationChannels(station, this.timeframe, isMultiComponent);
        const queryChannels = channelResolution.allQueryChannels;

        const urls = buildFdsnUrls(station, queryChannels, startStr, endStr, state.successfulProviderUrlBase);
        if (isMultiComponent && queryChannels.length > 1) {
            // Also add single Z channel fallback in case remote server rejects multi-channel query
            const fallbackZUrls = buildFdsnUrls(station, [channelResolution.z], startStr, endStr, state.successfulProviderUrlBase);
            fallbackZUrls.forEach(u => { if (!urls.includes(u)) urls.push(u); });
        }

        let ab: ArrayBuffer | null = null;
        let lastError: Error | null = null;

        for (const url of urls) {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), config.isWebicorder ? 30000 : 12000);

            try {
                const res = await fetch(url, { signal: controller.signal });
                clearTimeout(timeoutId);

                if (res.status === 200) {
                    ab = await res.arrayBuffer();
                    if (ab && ab.byteLength > 0) {
                        try {
                            const testRecs = miniseed.parseDataRecords(ab);
                            if (testRecs.length > 0) {
                                const baseUrl = url.split('?')[0];
                                state.successfulProviderUrlBase = baseUrl;
                                state.provider = baseUrl.includes('earthscope') ? 'EarthScope'
                                    : (baseUrl.includes('raspberryshake') ? 'Raspberry Shake'
                                    : (baseUrl.includes('geofon') ? 'GEOFON' : 'CSN'));
                                break;
                            }
                        } catch (e: any) {
                            lastError = e;
                        }
                    }
                } else if (res.status === 404 || res.status === 204) {
                    lastError = new Error(`HTTP ${res.status}`);
                }
            } catch (err: any) {
                clearTimeout(timeoutId);
                lastError = err;
            }
        }

        try {
            if (!ab) {
                if (isDelta && previousBuffer) return; // Keep previous buffer on temporary delta glitch
                state.hasFailed = true;
                throw lastError || new Error('No data returned');
            }

            const rawRecords = miniseed.parseDataRecords(ab);
            if (rawRecords.length === 0) {
                state.hasFailed = true;
                throw new Error('No records decoded');
            }

            const recordsByComponent = classifyRecordsByComponent(rawRecords);
            let anySuccess = false;

            for (const comp of ['Z', 'N', 'E'] as const) {
                const recs = recordsByComponent[comp];
                if (recs && recs.length > 0) {
                    const prevComp = state.components?.[comp];
                    const prevRaw = comp === 'Z' ? (prevComp?.rawBuffer || state.rawFdsnBuffer) : prevComp?.rawBuffer;
                    const prevStart = comp === 'Z' ? (prevComp?.dataStartTime || state.dataStartTime) : (prevComp?.dataStartTime || 0);

                    const processed = processRecordStream(
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
                        const filterRes = await this.dspService.filterWaveform(
                            processed.rawBuffer,
                            processed.sampleRate,
                            state.hpFilter,
                            state.lpFilter,
                            config.decimationFactor
                        );

                        const maxAbs = this.calculateMaxAbs(filterRes.filteredData);
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
                            renderSampleRate: filterRes.effectiveSampleRate,
                            dataStartTime: processed.dataStartTime,
                            lastFetchTime: processed.lastFetchTime,
                            maxAbs
                        };

                        if (comp === 'Z') {
                            state.sampleRate = processed.sampleRate;
                            state.channelCode = processed.chanCode;
                            state.rawFdsnBuffer = processed.rawBuffer;
                            state.bufferZ = filterRes.filteredData;
                            state.renderSampleRate = filterRes.effectiveSampleRate;
                            state.dataStartTime = processed.dataStartTime;
                            state.lastFetchTime = processed.lastFetchTime;
                            state.maxAbs = maxAbs;
                            state.hasFailed = false;
                        }
                    }
                }
            }

            if (!anySuccess && (!state.bufferZ || state.bufferZ.length === 0)) {
                state.hasFailed = true;
                throw new Error('No valid samples extracted');
            } else {
                state.hasFailed = false;
            }
        } catch (e: any) {
            console.warn(`[FDSN] ${station.code}:`, e.message);
            state.hasFailed = true;
        } finally {
            state.isFetching = false;
            this.renderStationCanvas(station.code);
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
            for (let i = 0; i < visibleStationsList.length; i++) {
                if (this.currentPollSessionId !== sessionId) return;
                await this.fetchStationData(visibleStationsList[i], Date.now(), false);
                if (this.currentPollSessionId !== sessionId) return;
                if (visibleStationsList.length > 1) {
                    await new Promise(r => setTimeout(r, 400));
                }
            }
        }
    }
}
