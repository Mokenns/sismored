import type { TimeframeConfig } from '../config/timeframes';
import { formatCounts } from '../utils/station-helpers';

export interface RenderColors {
    traceCSN: string;
    traceRS: string;
    traceGSN: string;
    traceGEOFON: string;
    gridMajor: string;
    gridMinor: string;
    baseline: string;
    axisText: string;
}

export interface RenderContext {
    canvas: HTMLCanvasElement;
    station: any;
    state: any;
    timeframeConfig: TimeframeConfig;
    autoScale: boolean;
    globalGain: number;
    colors: RenderColors;
}

export class SeismogramRenderer {
    static render(rc: RenderContext) {
        const { canvas, station, state, timeframeConfig, autoScale, globalGain, colors } = rc;
        if (!canvas) return;

        const ctx = canvas.getContext('2d')!;
        const dpr = window.devicePixelRatio || 1;
        const comp = ((canvas.getAttribute('data-component') || 'Z').toUpperCase()) as 'Z' | 'N' | 'E';
        const isDetailComponent = canvas.hasAttribute('data-component');

        const compData = state.components?.[comp];
        const buffer = (comp === 'Z')
            ? (compData?.buffer || state.bufferZ || new Float32Array(0))
            : (compData?.buffer || new Float32Array(0));
        const bufLen = buffer.length;

        const windowSec = timeframeConfig.seconds;
        const windowMs = windowSec * 1000;
        const latencyMs = timeframeConfig.latencyMs;

        const compLastFetch = compData?.lastFetchTime || state.lastFetchTime;
        const compDataStart = compData?.dataStartTime || state.dataStartTime;
        const activeSampleRate = compData?.renderSampleRate || compData?.sampleRate
            || (comp === 'Z' ? (state.renderSampleRate || state.sampleRate) : 100);

        const logicalNow = compLastFetch > 0 ? compLastFetch : (Date.now() - latencyMs);

        let numRows = timeframeConfig.expectedRows;
        const rowDurationMs = windowMs / numRows;

        // Dynamic row reduction for partial webicorders
        if (numRows > 1 && !state.hasFailed && compDataStart > 0) {
            const actualDurationMs = logicalNow - compDataStart;
            if (actualDurationMs > 0 && actualDurationMs < windowMs) {
                numRows = Math.max(1, Math.ceil(actualDurationMs / rowDurationMs));
            }
        }

        const adaptedWindowMs = numRows * rowDurationMs;
        const logicalWindowStart = logicalNow - adaptedWindowMs;

        // Fixed, stable display height calculation
        const cssWidth = canvas.parentElement?.clientWidth || 380;
        const baseHeight = canvas.getAttribute('data-base-height')
            ? parseInt(canvas.getAttribute('data-base-height')!)
            : (isDetailComponent ? 160 : 105);
        const cssHeight = numRows > 1 ? (numRows * 50 + 20) : baseHeight;

        if (canvas.style.height !== cssHeight + 'px') {
            canvas.style.height = cssHeight + 'px';
            if (canvas.parentElement) {
                canvas.parentElement.style.height = cssHeight + 'px';
                canvas.parentElement.style.minHeight = cssHeight + 'px';
            }
        }

        const targetWidth = Math.round(cssWidth * dpr);
        const targetHeight = Math.round(cssHeight * dpr);
        if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
            canvas.width = targetWidth;
            canvas.height = targetHeight;
        }
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        const width = cssWidth;
        const height = cssHeight;

        // 1. Draw Background
        ctx.fillStyle = '#060a12';
        ctx.fillRect(0, 0, width, height);

        const padLeft = 45;
        const padBottom = 16;
        const plotWidth = width - padLeft;

        // 2. Normalized Amplitude Calculation
        const compMaxAbs = compData?.maxAbs || (comp === 'Z' ? state.maxAbs : 0.0001);
        let commonMaxAbs = compMaxAbs;

        if (isDetailComponent) {
            // Normalize scaling across all 3 axes for authentic relative motion comparison
            const zMax = state.components?.Z?.maxAbs || state.maxAbs || 0;
            const nMax = state.components?.N?.maxAbs || 0;
            const eMax = state.components?.E?.maxAbs || 0;
            const triaxialMax = Math.max(zMax, nMax, eMax);
            if (triaxialMax > 0.0001) {
                commonMaxAbs = triaxialMax;
            }
        }

        const maxAbs = Math.max(commonMaxAbs || 0.0001, 0.0001);
        const rowHeight = (height - padBottom) / numRows;

        const targetAmplitudePixels = rowHeight * 0.42;
        let baseScale = (targetAmplitudePixels / maxAbs);
        if (!autoScale) {
            baseScale = (targetAmplitudePixels / 1000.0) * (globalGain / 3.0);
        }
        const effectiveScale = baseScale * (state.customGain || 1.0);

        const tickIntervalMs = timeframeConfig.tickIntervalSec * 1000;

        // 3. Draw Rows & Grid
        for (let r = 0; r < numRows; r++) {
            const rowStartY = r * rowHeight;
            const plotCenterY = rowStartY + (rowHeight / 2);

            // Minor grid thresholds
            ctx.strokeStyle = colors.gridMinor;
            ctx.lineWidth = 1;
            ctx.beginPath();
            [-0.75, 0.75].forEach(ratio => {
                const y = plotCenterY + (ratio * rowHeight * 0.5);
                ctx.moveTo(padLeft, y);
                ctx.lineTo(width, y);
            });
            ctx.stroke();

            // Zero baseline
            ctx.strokeStyle = colors.baseline;
            ctx.beginPath();
            ctx.moveTo(padLeft, plotCenterY);
            ctx.lineTo(width, plotCenterY);
            ctx.stroke();

            // X-Axis Time Ticks
            ctx.strokeStyle = colors.gridMajor;
            ctx.fillStyle = colors.axisText;
            ctx.font = '9px JetBrains Mono, monospace';
            ctx.textAlign = 'center';

            const rowStartTime = logicalWindowStart + (r * rowDurationMs);
            const rowEndTime = rowStartTime + rowDurationMs;

            ctx.beginPath();
            if (timeframeConfig.isHighFrequency) {
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
                                if (agoSec === 0) ctx.fillText('0s', x, height - 2);
                                else if (agoSec >= 60) {
                                    const m = Math.floor(agoSec / 60);
                                    const s = agoSec % 60;
                                    ctx.fillText(s === 0 ? `-${m}m` : `-${m}m${s}s`, x, height - 2);
                                } else {
                                    ctx.fillText(`-${agoSec}s`, x, height - 2);
                                }
                            }
                        }
                    }
                }
            } else {
                const rowFirstTick = Math.ceil(rowStartTime / tickIntervalMs) * tickIntervalMs;
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

            // Y-Axis Count Labels
            const gridCountVal = (rowHeight * 0.375) / effectiveScale;
            const formattedMax = formatCounts(gridCountVal);
            ctx.fillStyle = colors.axisText;
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

            // 4. Draw Waveform Trace
            if (bufLen > 0) {
                let traceColor = colors.traceCSN;
                if (comp === 'N') traceColor = '#10b981';
                else if (comp === 'E') traceColor = '#f59e0b';
                else {
                    if (station.network === 'AM') traceColor = colors.traceRS;
                    else if (station.network === 'IU' || station.network === 'II') traceColor = colors.traceGSN;
                    else if (station.network === 'GE') traceColor = colors.traceGEOFON;
                    else traceColor = '#00d2ff';
                }

                ctx.strokeStyle = traceColor;
                ctx.lineWidth = 1.2;
                ctx.lineJoin = 'round';
                ctx.beginPath();

                const compDataEnd = compDataStart + (bufLen / activeSampleRate) * 1000;
                const validRowStartMs = Math.max(rowStartTime, compDataStart);
                const validRowEndMs = Math.min(rowEndTime, compDataEnd);

                if (validRowStartMs < validRowEndMs) {
                    const startPx = Math.max(0, Math.floor(((validRowStartMs - rowStartTime) / rowDurationMs) * plotWidth));
                    const endPx = Math.min(plotWidth, Math.ceil(((validRowEndMs - rowStartTime) / rowDurationMs) * plotWidth));

                    const rowSamples = Math.round(((validRowEndMs - validRowStartMs) / 1000) * activeSampleRate);
                    const activePlotPixels = Math.max(1, endPx - startPx);
                    const ptsPerPixel = rowSamples / activePlotPixels;

                    if (ptsPerPixel <= 1) {
                        let hasStarted = false;
                        const startSampleIdx = Math.max(0, Math.floor(((validRowStartMs - compDataStart) / 1000) * activeSampleRate));
                        const endSampleIdx = Math.min(bufLen, Math.ceil(((validRowEndMs - compDataStart) / 1000) * activeSampleRate));

                        for (let i = startSampleIdx; i < endSampleIdx; i++) {
                            const t = compDataStart + (i / activeSampleRate) * 1000;
                            const x = padLeft + ((t - rowStartTime) / rowDurationMs) * plotWidth;
                            const y = plotCenterY - (buffer[i] * effectiveScale);
                            const clampedY = Math.max(rowStartY + 1, Math.min(rowStartY + rowHeight - 1, y));
                            if (!hasStarted) {
                                ctx.moveTo(x, clampedY);
                                hasStarted = true;
                            } else {
                                ctx.lineTo(x, clampedY);
                            }
                        }
                    } else {
                        // Peak-preserving decimation loop mapped to exact pixel time slices
                        let hasStarted = false;
                        for (let px = startPx; px < endPx; px++) {
                            const actualPx = padLeft + px;
                            const tPixelStart = rowStartTime + (px / plotWidth) * rowDurationMs;
                            const tPixelEnd = rowStartTime + ((px + 1) / plotWidth) * rowDurationMs;

                            const sliceStart = Math.max(0, Math.floor(((tPixelStart - compDataStart) / 1000) * activeSampleRate));
                            const sliceEnd = Math.min(bufLen, Math.ceil(((tPixelEnd - compDataStart) / 1000) * activeSampleRate));

                            if (sliceStart < sliceEnd) {
                                let minVal = Infinity;
                                let maxVal = -Infinity;
                                for (let s = sliceStart; s < sliceEnd; s++) {
                                    const v = buffer[s];
                                    if (v < minVal) minVal = v;
                                    if (v > maxVal) maxVal = v;
                                }

                                if (minVal !== Infinity) {
                                    let yMin = plotCenterY - (minVal * effectiveScale);
                                    let yMax = plotCenterY - (maxVal * effectiveScale);
                                    yMin = Math.max(rowStartY + 1, Math.min(rowStartY + rowHeight - 1, yMin));
                                    yMax = Math.max(rowStartY + 1, Math.min(rowStartY + rowHeight - 1, yMax));

                                    if (!hasStarted) {
                                        ctx.moveTo(actualPx, yMin);
                                        hasStarted = true;
                                    } else {
                                        ctx.lineTo(actualPx, yMin);
                                    }
                                    ctx.lineTo(actualPx, yMax);
                                }
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

        // 5. Update DOM Status Badges
        const displayMax = formatCounts(compMaxAbs || maxAbs);
        const tag = document.getElementById(`pgv-tag-${station.code}-${comp}`) || document.getElementById(`pgv-tag-${station.code}`);
        if (tag) {
            if (state.hasFailed) {
                tag.textContent = 'No hay datos disponibles';
            } else if (bufLen === 0 && comp !== 'Z' && !compData) {
                tag.textContent = 'No disponible';
            } else {
                const chanCode = compData?.channelCode || (comp === 'Z' ? state.channelCode : comp);
                const hdTag = state.disableDecimation ? ' | ⚡ HD' : '';
                tag.textContent = `Max: ±${displayMax} cnt | ${chanCode || comp} | ${state.provider || 'N/A'}${hdTag}`;
            }
        }

        const rangeOverlay = document.getElementById(`range-overlay-${station.code}-${comp}`) || document.getElementById(`range-overlay-${station.code}`);
        if (rangeOverlay && activeSampleRate && !state.hasFailed && bufLen > 0) {
            const nyquist = activeSampleRate / 2;
            const chanCode = compData?.channelCode || (comp === 'Z' ? state.channelCode : comp) || '???';
            rangeOverlay.textContent = `0.01 - ${nyquist.toFixed(1)} Hz (${chanCode})`;
        }
    }
}
