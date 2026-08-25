import DspWorker from './dsp-worker?worker';
import { miniseed } from 'seisplotjs';

interface StationState {
    bufferZ: Float32Array;
    rawFdsnBuffer: Float32Array;
    sampleRate: number;
    lastFetchTime: number;
    lastRequestTime: number;
    dataStartTime: number;
    hpFilter: number;
    lpFilter: number;
    hasFailed: boolean;
    provider?: string;
    isFetching: boolean;
    station: any;
    customGain: number;
    maxAbs: number;
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
    
    private pendingFilters: Map<number, (data: Float32Array) => void> = new Map();
    private filterMsgId: number = 0;
    
    private activeCanvases: Map<HTMLCanvasElement, any> = new Map();

    constructor() {
        this.dspWorker = new DspWorker();
        this.dspWorker.onmessage = (e) => {
            const { id, filteredData } = e.data;
            if (this.pendingFilters.has(id)) {
                this.pendingFilters.get(id)!(filteredData);
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
                hpFilter: 0.5,
                lpFilter: 10.0,
                hasFailed: false,
                isFetching: false,
                station,
                customGain: 1.0,
                maxAbs: 1.0
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
            if (state.rawFdsnBuffer && state.rawFdsnBuffer.length > 0) {
                state.bufferZ = await this.applyFilterAsync(state.rawFdsnBuffer, state.sampleRate, hp, lp);
                this.renderStationCanvas(stationCode);
            }
        }
    }
    
    private applyFilterAsync(rawData: Float32Array, sampleRate: number, hpFreq: number, lpFreq: number): Promise<Float32Array> {
        return new Promise(resolve => {
            const id = ++this.filterMsgId;
            this.pendingFilters.set(id, resolve);
            this.dspWorker.postMessage({
                id,
                rawData,
                sampleRate,
                hpFreq,
                lpFreq,
                applyDemean: true
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

    async fetchStationData(station: any, nowMs: number, force: boolean = false) {
        const state = this.getOrCreateStationState(station.code, station);
        if (state.isFetching) return;
        
        let cacheDuration = 10000;
        if (this.timeframe === '24h' || this.timeframe === '12h') cacheDuration = 300000; // 5 min
        else if (this.timeframe === '3h') cacheDuration = 120000; // 2 min
        else if (this.timeframe === '1h') cacheDuration = 60000; // 1 min
        else if (this.timeframe === '10m') cacheDuration = 4500;
        else if (this.timeframe === '1m') cacheDuration = 1500;
        else if (this.timeframe === '10s') cacheDuration = 500;

        if (!force && nowMs - state.lastRequestTime < cacheDuration) {
            return;
        }
        state.lastRequestTime = nowMs;
        state.isFetching = true;
        
        try {
            let latencyMs = 5 * 60 * 1000; 
            let windowSec = this.getTimeWindowSeconds();
            
            let net = station.network;
            let loc = '';
            
            const channels = station.channels || [];
            let cha = 'HHZ';
            
            if (this.timeframe === '24h' || this.timeframe === '3h') {
                if (channels.includes('BHZ')) cha = 'BHZ';
                else if (channels.includes('HHZ')) cha = 'HHZ';
                else if (channels.includes('HNZ')) cha = 'HNZ';
                else cha = channels.find((c: string) => c.endsWith('Z')) || 'BHZ';
            } else {
                if (channels.includes('HHZ')) cha = 'HHZ';
                else if (channels.includes('HNZ')) cha = 'HNZ';
                else if (channels.includes('BHZ')) cha = 'BHZ';
                else cha = channels.find((c: string) => c.endsWith('Z')) || 'HHZ';
            }
            
            let isWebicorder = false;
            
            if (this.timeframe === '24h' || this.timeframe === '3h') {
                latencyMs = 15 * 60 * 1000;
                isWebicorder = true;
            }
            
            // FDSN delay padding
            const endDt = new Date(nowMs - latencyMs);
            const startDt = new Date(endDt.getTime() - (windowSec * 1000));
            
            const startStr = startDt.toISOString().split('.')[0];
            const endStr = endDt.toISOString().split('.')[0];
            
            const urls: string[] = [];
            if (net === 'C') {
                urls.push(`/api/csn/fdsnws/dataselect/1/query?net=${net}&sta=${station.code}&loc=${loc}&cha=${cha}&starttime=${startStr}&endtime=${endStr}`);
                urls.push(`https://service.earthscope.org/fdsnws/dataselect/1/query?net=C1&sta=${station.code}&loc=${loc}&cha=${cha}&starttime=${startStr}&endtime=${endStr}`);
            } else if (net === 'AM') {
                urls.push(`https://fdsnws.raspberryshakedata.com/fdsnws/dataselect/1/query?net=${net}&sta=${station.code}&loc=${loc}&cha=${cha}&starttime=${startStr}&endtime=${endStr}`);
            } else if (net === 'GE') {
                urls.push(`https://geofon.gfz-potsdam.de/fdsnws/dataselect/1/query?net=${net}&sta=${station.code}&loc=${loc}&cha=${cha}&starttime=${startStr}&endtime=${endStr}`);
                urls.push(`https://service.earthscope.org/fdsnws/dataselect/1/query?net=${net}&sta=${station.code}&loc=${loc}&cha=${cha}&starttime=${startStr}&endtime=${endStr}`);
            } else {
                urls.push(`https://service.earthscope.org/fdsnws/dataselect/1/query?net=${net}&sta=${station.code}&loc=${loc}&cha=${cha}&starttime=${startStr}&endtime=${endStr}`);
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
                                // Test parsing to ensure it's valid miniseed and has data
                                const testRecords = miniseed.parseDataRecords(tempAb);
                                if (testRecords.length > 0) {
                                    ab = tempAb;
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
                        // Data doesn't exist here, try next provider just in case
                        lastError = new Error(`HTTP ${res.status}`);
                    } else {
                        throw new Error(`HTTP ${res.status}`);
                    }
                } catch (err: any) {
                    clearTimeout(timeoutId);
                    lastError = err;
                    // Network error or 503, continue to next URL
                }
            }

            if (!ab) {
                state.hasFailed = true;
                throw lastError || new Error('No data found across all providers');
            }
            
            const records = miniseed.parseDataRecords(ab);
            
            let totalSamples = 0;
            for (const r of records) totalSamples += r.header.numSamples;
            
            const rawSamples = new Float32Array(totalSamples);
            let offset = 0;
            for (const r of records) {
                const dec = r.decompress();
                rawSamples.set(dec, offset);
                offset += dec.length;
            }
            
            if (rawSamples.length > 0) {
                state.sampleRate = records[0].header.sampleRate;
                state.rawFdsnBuffer = rawSamples; 
                state.bufferZ = await this.applyFilterAsync(rawSamples, state.sampleRate, state.hpFilter, state.lpFilter);
                
                // Use actual miniseed start time if available to prevent drift
                let actualStartMs = startDt.getTime();
                const headerAny = records[0].header as any;
                if (headerAny.start) {
                    const startObj = headerAny.start;
                    if (typeof startObj.toMillis === 'function') actualStartMs = startObj.toMillis();
                    else if (typeof startObj.valueOf === 'function') actualStartMs = startObj.valueOf();
                    else if (typeof startObj.getTime === 'function') actualStartMs = startObj.getTime();
                } else if (headerAny.startTime) {
                    const startObj = headerAny.startTime;
                    if (typeof startObj.toMillis === 'function') actualStartMs = startObj.toMillis();
                    else if (typeof startObj.valueOf === 'function') actualStartMs = startObj.valueOf();
                    else if (typeof startObj.getTime === 'function') actualStartMs = startObj.getTime();
                }
                state.dataStartTime = actualStartMs;

                state.lastFetchTime = endDt.getTime();
                state.hasFailed = false;
                
                // compute maxAbs
                let m = 0;
                for (let i=0; i<state.bufferZ.length; i++) {
                    const v = Math.abs(state.bufferZ[i]);
                    if (v > m) m = v;
                }
                state.maxAbs = m;
            } else {
                state.hasFailed = true;
                throw new Error('No samples extracted from records');
            }
        } catch (e: any) {
            console.warn(`[FDSN] ${station.code}:`, e.message);
            state.hasFailed = true;
        } finally {
            state.isFetching = false;
        }
    }

    async pollLiveFDSNForVisible(visibleStationsList: any[], isInitial = false) {
        const nowMs = Date.now();
        if (isInitial) {
            const chunkSize = 6;
            for (let i = 0; i < visibleStationsList.length; i += chunkSize) {
                const chunk = visibleStationsList.slice(i, i + chunkSize);
                await Promise.all(chunk.map(st => this.fetchStationData(st, nowMs, true)));
            }
        } else {
            // Staggered updates
            for (let i = 0; i < visibleStationsList.length; i++) {
                await this.fetchStationData(visibleStationsList[i], nowMs, false);
                await new Promise(r => setTimeout(r, 400)); // 400ms time gap between station requests
            }
        }
    }

    renderCanvasTrace(canvas: HTMLCanvasElement, station: any) {
        if (!canvas) return;
        const ctx = canvas.getContext('2d')!;
        const dpr = window.devicePixelRatio || 1;
        
        let numRows = 1;
        if (this.timeframe === '24h') numRows = 24;
        else if (this.timeframe === '12h') numRows = 12;
        else if (this.timeframe === '3h') numRows = 6;

        const cssWidth = canvas.parentElement?.clientWidth || 380;
        const cssHeight = numRows > 1 ? (numRows * 50 + 20) : 105;
        
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

        const state = this.getOrCreateStationState(station.code, station);
        const buffer = state.bufferZ;
        const bufLen = buffer.length;

        ctx.fillStyle = '#060a12';
        ctx.fillRect(0, 0, width, height);

        const padLeft = 45;
        const padBottom = 16;
        const plotWidth = width - padLeft;
        
        const maxAbs = Math.max(state.maxAbs || 0.0001, 0.0001);
        
        const rowHeight = (height - padBottom) / numRows;
        
        // Auto-scale vs Manual scale combined with customGain
        const targetAmplitudePixels = rowHeight * 0.42;
        let baseScale = (targetAmplitudePixels / maxAbs);
        if (!this.autoScale) {
            baseScale = (targetAmplitudePixels / 1000.0) * (this.globalGain / 3.0);
        }
        const effectiveScale = baseScale * (state.customGain || 1.0);

        let latencyMs = (this.timeframe === '24h' || this.timeframe === '3h') ? 15 * 60 * 1000 : 5 * 60 * 1000;
        const logicalNow = state.lastFetchTime > 0 ? state.lastFetchTime : (Date.now() - latencyMs);
        const windowSec = this.getTimeWindowSeconds();
        const windowMs = windowSec * 1000;
        const logicalWindowStart = logicalNow - windowMs;
        const rowDurationMs = windowMs / numRows;

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
            const ySteps = [-0.75, 0.75]; // This maps to 0.75 * 0.5 * rowHeight = 0.375
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
                if (station.network === 'AM') traceColor = this.colors.traceRS;
                else if (station.network === 'IU' || station.network === 'II') traceColor = this.colors.traceGSN;
                else if (station.network === 'GE') traceColor = this.colors.traceGEOFON;

                ctx.strokeStyle = traceColor;
                ctx.lineWidth = 1.2;
                ctx.lineJoin = 'round';
                ctx.beginPath();
                
                // Segment of buffer that falls in this row
                // t = state.dataStartTime + (i / state.sampleRate) * 1000
                const startIndex = Math.max(0, Math.floor(((rowStartTime - state.dataStartTime) / 1000) * state.sampleRate));
                const endIndex = Math.min(bufLen, Math.ceil(((rowEndTime - state.dataStartTime) / 1000) * state.sampleRate));
                
                if (startIndex < endIndex) {
                    const rowSamples = endIndex - startIndex;
                    const ptsPerPixel = rowSamples / plotWidth;
                    
                    if (ptsPerPixel <= 1) {
                        for (let i = startIndex; i < endIndex; i++) {
                            const t = state.dataStartTime + (i / state.sampleRate) * 1000;
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
                    ctx.fillStyle = '#94a3b8';
                    ctx.font = '10px sans-serif';
                    ctx.textAlign = 'center';
                    ctx.fillText("Esperando datos...", padLeft + (plotWidth/2), plotCenterY);
                }
            }
        }
        
        let displayMax = this.formatCount(maxAbs);
        const tag = document.getElementById(`pgv-tag-${station.code}`);
        if (tag) {
            if (state.hasFailed) {
                tag.textContent = `No hay datos disponibles`;
            } else {
                tag.textContent = `Max: ±${displayMax} cnt | Datos: ${state.provider || 'N/A'}`;
            }
        }
    }
}
