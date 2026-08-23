/**
 * Seismic Engine - High-Precision FDSN Seismic Processing & Multi-Scale Rendering
 */

class SeismicEngine {
    constructor() {
        this.globalGain = 3.0;
        this.autoScale = true;
        this.displayUnit = 'counts';
        this.timeframe = '1m'; 
        this.stationsState = new Map();
        
        this.colors = {
            traceCSN: '#00d2ff',
            traceRS: '#ffb300',
            traceGSN: '#00e676',
            traceGEOFON: '#e040fb',
            gridMajor: 'rgba(255, 255, 255, 0.12)',
            gridMinor: 'rgba(255, 255, 255, 0.04)',
            baseline: 'rgba(255, 255, 255, 0.25)',
            axisText: '#94a3b8'
        };
    }

    getOrCreateStationState(stationId, station) {
        if (!this.stationsState.has(stationId)) {
            this.stationsState.set(stationId, {
                bufferZ: [],
                rawFdsnBuffer: [],
                sampleRate: 100,
                lastFetchTime: 0,
                hpFilter: 0.01,
                lpFilter: 50.0,
                hasFailed: false,
                isFetching: false,
                station,
                customGain: 1.0
            });
        }
        return this.stationsState.get(stationId);
    }

    setStationGain(stationCode, gain) {
        const state = this.stationsState.get(stationCode);
        if (state) {
            state.customGain = gain;
        }
    }

    toggleAutoScale() {
        this.autoScale = !this.autoScale;
        return this.autoScale;
    }

    setAutoScale(enabled) {
        this.autoScale = enabled;
    }

    setTimeframe(tf) {
        this.timeframe = tf;
        this.stationsState.forEach(state => {
            state.isFetching = false;
        });
    }

    setDisplayUnit(unit) {
        this.displayUnit = unit;
    }

    setGain(multiplier) {
        this.globalGain = multiplier;
    }

    setStationFilter(stationCode, hp, lp) {
        const state = this.stationsState.get(stationCode);
        if (state) {
            state.hpFilter = hp;
            state.lpFilter = lp;
            if (state.rawFdsnBuffer && state.rawFdsnBuffer.length > 0) {
                state.bufferZ = this.applyLocalFilter(state.rawFdsnBuffer, state.sampleRate, hp, lp);
            }
        }
    }

    applyLocalFilter(rawData, sampleRate, hpFreq, lpFreq) {
        if (!rawData || rawData.length === 0) return [];
        let filtered = new Float32Array(rawData.length);
        let dt = 1.0 / (sampleRate || 100);
        
        let rcHP = 1.0 / (2 * Math.PI * Math.max(hpFreq, 0.0001));
        let alphaHP = rcHP / (rcHP + dt);
        
        let rcLP = 1.0 / (2 * Math.PI * Math.max(lpFreq, 0.0001));
        let alphaLP = dt / (rcLP + dt);

        let hpVal = rawData[0];
        let lpVal = hpVal;
        
        for (let i = 0; i < rawData.length; i++) {
            const minHpThreshold = sampleRate < 5 ? 0.0005 : 0.02;
            if (hpFreq > minHpThreshold) {
                hpVal = alphaHP * (hpVal + rawData[i] - (i > 0 ? rawData[i-1] : rawData[0]));
            } else {
                hpVal = rawData[i];
            }
            
            if (lpFreq < (sampleRate / 2.05)) {
                lpVal = lpVal + alphaLP * (hpVal - lpVal);
            } else {
                lpVal = hpVal;
            }
            
            filtered[i] = lpVal;
        }
        return Array.from(filtered);
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

    async fetchStationData(station, nowMs) {
        const state = this.getOrCreateStationState(station.code, station);
        if (state.isFetching) return;
        state.isFetching = true;
        
        const card = document.getElementById(`card-${station.network}_${station.code}`);
        const regSection = card ? card.closest('.region-section') : null;
        
        try {
            let latencyMs = 2 * 60 * 1000; 
            let windowSec = this.getTimeWindowSeconds();
            
            let net = station.network;
            if (net === 'C') net = 'C1';
            let loc = (net === 'IU' || net === 'II') ? '00' : '--';
            let cha = station.channels[0] || 'HHZ';
            
            if (this.timeframe === '24h' || this.timeframe === '3h') {
                cha = 'LHZ';
                latencyMs = 15 * 60 * 1000; 
            }
            
            const endDt = new Date(nowMs - latencyMs);
            const startDt = new Date(endDt.getTime() - (windowSec * 1000));
            
            const startStr = startDt.toISOString().split('.')[0];
            const endStr = endDt.toISOString().split('.')[0];
            
            const url = `https://service.iris.edu/irisws/timeseries/1/query?net=${net}&sta=${station.code}&loc=${loc}&cha=${cha}&starttime=${startStr}&endtime=${endStr}&output=ascii1`;
            
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 12000);
            
            const res = await fetch(url, { signal: controller.signal });
            clearTimeout(timeoutId);
            
            if (!res.ok) {
                if (res.status === 404 || res.status === 400) {
                    state.hasFailed = true;
                    if (card) card.style.display = 'none';
                }
                throw new Error(`HTTP ${res.status}`);
            }
            
            const text = await res.text();
            const lines = text.trim().split('\n');
            
            const rawSamples = [];
            for (let i = 1; i < lines.length; i++) {
                const v = parseFloat(lines[i]);
                if (!isNaN(v)) rawSamples.push(v);
            }
            
            if (rawSamples.length > 0) {
                state.sampleRate = rawSamples.length / windowSec;
                state.rawFdsnBuffer = rawSamples; 
                state.bufferZ = this.applyLocalFilter(rawSamples, state.sampleRate, state.hpFilter, state.lpFilter);
                state.lastFetchTime = endDt.getTime();
                state.hasFailed = false;
                if (card && card.style.display === 'none') card.style.display = 'flex';
                
                const canvas = document.querySelector(`.station-canvas-render[data-station-code="${station.code}"]`);
                if (canvas) {
                    this.renderCanvasTrace(canvas, station, { showAxes: false, component: 'Z' });
                }
            } else {
                throw new Error('No data');
            }
        } catch (e) {
            console.warn(`[FDSN] ${station.code}:`, e.message);
        } finally {
            state.isFetching = false;
            if (regSection) {
                const visibleCards = regSection.querySelectorAll('.station-card:not([style*="display: none"])');
                if (visibleCards.length === 0) {
                    regSection.style.display = 'none';
                } else {
                    regSection.style.display = '';
                }
            }
        }
    }

    async pollLiveFDSNForVisible(visibleStationsList) {
        const nowMs = Date.now();
        const chunkSize = 6;
        for (let i = 0; i < visibleStationsList.length; i += chunkSize) {
            const chunk = visibleStationsList.slice(i, i + chunkSize);
            await Promise.all(chunk.map(st => this.fetchStationData(st, nowMs)));
        }
    }

    renderWebicorder(canvas, station, buffer, maxAbs, effectiveScale, lines) {
        const ctx = canvas.getContext('2d');
        const width = canvas.width;
        
        if (this.timeframe === '24h') lines = 12;
        if (this.timeframe === '3h') lines = 3;
        
        const requiredHeight = lines === 12 ? 800 : 250; 
        
        if (canvas.height !== requiredHeight) {
            canvas.height = requiredHeight;
            canvas.style.height = requiredHeight + "px";
            const container = document.getElementById(`osc-container-${station.code}`);
            if (container) {
                container.style.height = (requiredHeight + 35) + "px";
            }
        }
        const height = canvas.height;

        ctx.fillStyle = '#060a12'; 
        ctx.fillRect(0, 0, width, height);

        const padLeft = 45;
        const padBottom = 16;
        const plotWidth = width - padLeft;
        const plotHeight = height - padBottom;
        
        const rowHeight = plotHeight / lines;
        const lineColors = ['#0ea5e9', '#ef4444', '#10b981', '#f59e0b', '#d946ef', '#8b5cf6'];

        ctx.lineWidth = 0.8;
        ctx.lineJoin = 'round';
        
        // Draw grid lines
        ctx.strokeStyle = '#1e293b';
        ctx.beginPath();
        for (let l = 1; l < lines; l++) {
            ctx.moveTo(padLeft, l * rowHeight);
            ctx.lineTo(width, l * rowHeight);
        }
        for (let i = 0; i <= 6; i++) {
            const x = padLeft + (i / 6) * plotWidth;
            ctx.moveTo(x, 0);
            ctx.lineTo(x, plotHeight);
        }
        ctx.stroke();

        let mean = 0;
        if (buffer.length > 0) mean = buffer.reduce((a, b) => a + b, 0) / buffer.length;
        
        const ptsPerLine = Math.ceil(buffer.length / lines);
        const state = this.getOrCreateStationState(station.code, station);
        const customGain = state.customGain || 1.0;
        
        let webiScale;
        if (this.autoScale) {
            const gainFactor = (this.globalGain / 3.0) * customGain;
            webiScale = (rowHeight / (maxAbs || 1)) * 0.42 * gainFactor;
        } else {
            const baseAmp = 1000.0;
            webiScale = (rowHeight * 0.42 / baseAmp) * (this.globalGain / 3.0) * customGain;
        }
        
        for (let l = 0; l < lines; l++) {
            ctx.strokeStyle = lineColors[l % lineColors.length];
            ctx.beginPath();
            const rowCenterY = (l * rowHeight) + (rowHeight / 2);
            
            const startIdx = l * ptsPerLine;
            const endIdx = Math.min((l + 1) * ptsPerLine, buffer.length);
            
            for (let i = startIdx; i < endIdx; i++) {
                const px = padLeft + ((i - startIdx) / ptsPerLine) * plotWidth;
                const valCentered = buffer[i] - mean;
                const py = rowCenterY - (valCentered * webiScale);
                
                if (i === startIdx) ctx.moveTo(px, py);
                else ctx.lineTo(px, py);
            }
            ctx.stroke();
            
            ctx.fillStyle = '#94a3b8';
            ctx.font = 'bold 9px monospace';
            ctx.textAlign = 'right';
            
            let timeStr = (this.timeframe === '24h') ? `-${(lines - l) * 2}h` : `-${lines - l}h`;
            ctx.fillText(timeStr, padLeft - 4, rowCenterY + 3);
        }

        ctx.textAlign = 'center';
        for (let i = 0; i <= 6; i++) {
            const x = padLeft + (i / 6) * plotWidth;
            let minStr = (this.timeframe === '24h') ? (i * 20) + "m" : (i * 10) + "m";
            ctx.fillText(minStr, x, height - 2);
        }

        const tag = document.getElementById(`pgv-tag-${station.code}`);
        if (tag) {
            let formattedMax = maxAbs.toFixed(0);
            if (!this.autoScale) {
                formattedMax = ((rowHeight * 0.42) / (webiScale || 1)).toFixed(0);
            }
            tag.textContent = `Max: ±${formattedMax} cnt`;
        }
    }

    renderCanvasTrace(canvas, station, customOptions = {}) {
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        const width = canvas.width;
        const height = canvas.height;

        const state = this.getOrCreateStationState(station.code, station);
        const buffer = state.bufferZ;
        const bufLen = buffer.length;

        ctx.fillStyle = '#060a12';
        ctx.fillRect(0, 0, width, height);

        const padLeft = 45;
        const padBottom = 16;
        const plotWidth = width - padLeft;
        const plotHeight = height - padBottom;
        const plotCenterY = plotHeight / 2;
        
        let maxAbs = 0.0001;
        
        if (bufLen > 0) {
            const mean = buffer.reduce((a, b) => a + b, 0) / bufLen;
            for (let i = 0; i < bufLen; i++) {
                const a = Math.abs(buffer[i] - mean);
                if (a > maxAbs) maxAbs = a;
            }
        }

        let effectiveScale = (plotHeight * 0.42) * this.globalGain * (state.customGain || 1.0);

        if (this.timeframe === '24h' || this.timeframe === '3h') {
            this.renderWebicorder(canvas, station, buffer, maxAbs, effectiveScale);
            return;
        } else {
            if (canvas.height !== 105) {
                canvas.height = 105;
                canvas.style.height = "105px";
                const container = document.getElementById(`osc-container-${station.code}`);
                if (container) container.style.height = "";
            }
        }

        if (this.autoScale) {
            const targetAmplitudePixels = plotHeight * 0.38;
            effectiveScale = (targetAmplitudePixels / Math.max(maxAbs, 1)) * (this.globalGain / 3.0) * (state.customGain || 1.0);
        } else {
            effectiveScale = (plotHeight * 0.38 / 1000.0) * this.globalGain * (state.customGain || 1.0);
        }

        // Draw grid
        ctx.strokeStyle = this.colors.gridMinor;
        ctx.lineWidth = 1;
        const ySteps = [-0.75, -0.375, 0, 0.375, 0.75];
        ctx.beginPath();
        ySteps.forEach(ratio => {
            const y = plotCenterY + (ratio * plotHeight * 0.5);
            ctx.moveTo(padLeft, y);
            ctx.lineTo(width, y);
        });
        ctx.stroke();

        ctx.strokeStyle = this.colors.baseline;
        ctx.beginPath();
        ctx.moveTo(padLeft, plotCenterY);
        ctx.lineTo(width, plotCenterY);
        ctx.stroke();

        const timeTicks = 5;
        const tStep = plotWidth / timeTicks;
        ctx.strokeStyle = this.colors.gridMajor;
        ctx.beginPath();
        for (let i = 1; i < timeTicks; i++) {
            const x = padLeft + (i * tStep);
            ctx.moveTo(x, 0);
            ctx.lineTo(x, plotHeight);
        }
        ctx.stroke();
        
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
            const step = plotWidth / (bufLen - 1);
            const mean = buffer.reduce((a, b) => a + b, 0) / bufLen;

            // High-performance visual decimation (Min-Max Envelope)
            const ptsPerPixel = bufLen / plotWidth;
            
            if (ptsPerPixel <= 1) {
                for (let i = 0; i < bufLen; i++) {
                    const x = padLeft + (i * step);
                    const valCentered = buffer[i] - mean;
                    const y = plotCenterY - (valCentered * effectiveScale);
                    const clampedY = Math.max(1, Math.min(plotHeight - 1, y));
                    if (i === 0) ctx.moveTo(x, clampedY);
                    else ctx.lineTo(x, clampedY);
                }
            } else {
                for (let px = 0; px < plotWidth; px++) {
                    const startIdx = Math.floor((px / plotWidth) * bufLen);
                    let endIdx = Math.floor(((px + 1) / plotWidth) * bufLen);
                    if (endIdx > bufLen) endIdx = bufLen;
                    
                    let minVal = Infinity;
                    let maxVal = -Infinity;
                    
                    for (let i = startIdx; i < endIdx; i++) {
                        const val = buffer[i] - mean;
                        if (val < minVal) minVal = val;
                        if (val > maxVal) maxVal = val;
                    }
                    
                    const x = padLeft + px;
                    let yMin = plotCenterY - (minVal * effectiveScale);
                    let yMax = plotCenterY - (maxVal * effectiveScale);
                    
                    yMin = Math.max(1, Math.min(plotHeight - 1, yMin));
                    yMax = Math.max(1, Math.min(plotHeight - 1, yMax));
                    
                    if (px === 0) {
                        ctx.moveTo(x, yMin);
                    } else {
                        ctx.lineTo(x, yMin);
                    }
                    ctx.lineTo(x, yMax);
                }
            }
            ctx.stroke();
        } else {
            ctx.fillStyle = '#94a3b8';
            ctx.font = '10px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText("Esperando datos...", padLeft + (plotWidth/2), plotCenterY);
        }

        // Draw Axis Values
        let formattedMax = maxAbs.toFixed(0);
        if (!this.autoScale) {
            formattedMax = ((plotHeight * 0.38) / (effectiveScale || 1)).toFixed(0);
        }
        
        const tag = document.getElementById(`pgv-tag-${station.code}`);
        if (tag) tag.textContent = `Max: ±${formattedMax} cnt`;

        ctx.fillStyle = this.colors.axisText;
        ctx.font = '9px JetBrains Mono, monospace';
        ctx.textAlign = 'right';

        ctx.fillText(`+${formattedMax}`, padLeft - 3, plotCenterY - (plotHeight * 0.375) + 3);
        ctx.fillText(`0`, padLeft - 3, plotCenterY + 3);
        ctx.fillText(`-${formattedMax}`, padLeft - 3, plotCenterY + (plotHeight * 0.375) + 3);

        ctx.textAlign = 'center';
        for (let i = 0; i <= timeTicks; i++) {
            const x = padLeft + (i * tStep);
            let timeLabel = '';
            
            const windowSec = this.getTimeWindowSeconds();
            const tickSec = Math.round((timeTicks - i) * (windowSec / timeTicks));
            
            if (tickSec === 0) {
                timeLabel = "Now";
            } else if (tickSec < 60) {
                timeLabel = `-${tickSec}s`;
            } else if (tickSec < 3600) {
                timeLabel = `-${Math.round(tickSec/60)}m`;
            } else {
                timeLabel = `-${Math.round(tickSec/3600)}h`;
            }
            
            ctx.fillText(timeLabel, x, height - 3);
        }
    }
}

window.seismicEngine = new SeismicEngine();
