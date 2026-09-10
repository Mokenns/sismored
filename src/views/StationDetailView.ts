import { SeismicEngine } from '../seismic-engine';
// @ts-ignore
import { getStationById, CHILE_REGIONS } from '../stations-data.js';
import { getStationFrequencyRange, getNetworkBadgeClass, getGeomorphicZoneInfo } from '../utils/station-helpers';
import { isHighFrequencyTimeframe, getTimeframeConfig } from '../config/timeframes';

export class StationDetailView {
    engine: SeismicEngine;
    container: HTMLElement;
    stationCode: string;
    pollingInterval: any;

    constructor(engine: SeismicEngine, containerId: string, stationCode: string) {
        this.engine = engine;
        this.container = document.getElementById(containerId)!;
        this.stationCode = stationCode;
    }

    render() {
        const st = getStationById(this.stationCode);
        const tf = this.engine.timeframe;

        if (!st) {
            this.container.innerHTML = `
                <div style="padding: 3rem; text-align: center; color: #94a3b8;">
                    <h2 style="color: #f43f5e; margin-bottom: 1rem;">Estación no encontrada: ${this.stationCode}</h2>
                    <p>Verifique el código o regrese al catálogo de regiones.</p>
                    <a href="#/timeframe/${tf}/region/all" style="display: inline-block; margin-top: 1rem; padding: 0.6rem 1.2rem; background: #1e293b; color: #38bdf8; text-decoration: none; border-radius: 6px; border: 1px solid #334155;">
                        ← Volver a Regiones
                    </a>
                </div>
            `;
            return;
        }

        const regInfo = CHILE_REGIONS[st.regionCode] || { name: 'Región de Chile', roman: '' };
        const rangeInfo = getStationFrequencyRange(st, tf);
        const netClass = getNetworkBadgeClass(st.network);
        const { icon: zoneIcon, pillClass: zonePillClass } = getGeomorphicZoneInfo(st.geomorphicZone);

        const state = this.engine.getOrCreateStationState(this.stationCode, st);
        const isHD = Boolean(state.disableDecimation);
        const config = getTimeframeConfig(tf);
        const decimationFactor = config.decimationFactor;
        const rawRate = Math.round(st.sampleRate || state.sampleRate || 100);
        const decimatedRate = Math.max(1, Math.round(rawRate / decimationFactor));

        this.container.innerHTML = `
            <div class="station-detail-container" style="width: 100%; max-width: 100%; box-sizing: border-box; padding: 0.5rem 0.5rem 2.5rem 0.5rem; margin: 0;">
                
                <!-- Web Tree Breadcrumb Navigation -->
                <nav class="tree-breadcrumb" style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 1.2rem; font-size: 0.88rem; flex-wrap: wrap; background: #0b1120; padding: 0.6rem 1rem; border-radius: 8px; border: 1px solid rgba(255, 255, 255, 0.08);">
                    <a href="#/timeframe/${tf}/region/all" style="color: #38bdf8; text-decoration: none; display: flex; align-items: center; gap: 0.3rem;">
                        <span>📡</span> SismoRed (${tf})
                    </a>
                    <span style="color: #475569;">/</span>
                    <a href="#/timeframe/${tf}/region/${st.regionCode}" style="color: #94a3b8; text-decoration: none; display: flex; align-items: center; gap: 0.3rem;">
                        <span>📍</span> ${regInfo.roman} - ${regInfo.name}
                    </a>
                    <span style="color: #475569;">/</span>
                    <span style="color: #e2e8f0; font-weight: 600; display: flex; align-items: center; gap: 0.3rem;">
                        <span>🏷️</span> ${st.code} (${st.locality})
                    </span>
                </nav>

                <!-- Station Header Bar -->
                <header style="display: flex; justify-content: space-between; align-items: flex-start; flex-wrap: wrap; gap: 1rem; margin-bottom: 1.5rem; background: #0f172a; padding: 1.2rem 1.5rem; border-radius: 10px; border: 1px solid rgba(255, 255, 255, 0.1);">
                    <div>
                        <div style="display: flex; align-items: center; gap: 0.75rem; margin-bottom: 0.4rem; flex-wrap: wrap;">
                            <h1 style="margin: 0; font-size: 1.8rem; font-weight: 800; letter-spacing: -0.02em; color: #f8fafc;">${st.code}</h1>
                            <span class="network-badge ${netClass}">${st.network} - ${st.networkName || st.operator}</span>
                            <span class="zone-tag ${zonePillClass}">${zoneIcon} ${st.geomorphicZone}</span>
                            <span style="background: rgba(56, 189, 248, 0.1); color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.25); padding: 0.2rem 0.6rem; border-radius: 4px; font-size: 0.75rem; font-family: monospace;">
                                3-Componentes (Z, N/Y, E/X)
                            </span>
                        </div>
                        <div style="color: #94a3b8; font-size: 0.95rem;">
                            ${st.locality} • Operado por <strong>${st.operator}</strong> • Coordenadas: <strong>${st.lat.toFixed(3)}° S, ${st.lon.toFixed(3)}° W</strong> • Elevación: <strong>${Math.round(st.elevation)} m</strong>
                        </div>
                    </div>

                    <a href="#/timeframe/${tf}/region/${st.regionCode}" style="display: inline-flex; align-items: center; gap: 0.4rem; padding: 0.55rem 1.1rem; background: #1e293b; color: #e2e8f0; text-decoration: none; border-radius: 6px; border: 1px solid #334155; font-size: 0.88rem; font-weight: 500; transition: all 0.15s;">
                        ← Volver a ${regInfo.roman}
                    </a>
                </header>

                <!-- Synchronized DSP Controls Bar -->
                <div class="dsp-controls-panel" style="background: #0f172a; padding: 1rem 1.5rem; border-radius: 10px; border: 1px solid rgba(255, 255, 255, 0.08); margin-bottom: 1.5rem;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.75rem; flex-wrap: wrap; gap: 0.5rem;">
                        <span style="font-size: 0.85rem; font-weight: 600; color: #cbd5e1; text-transform: uppercase; letter-spacing: 0.05em;">
                            🎛️ Filtros DSP y Ganancia (Sincronizados para los 3 componentes)
                        </span>
                        <span style="font-size: 0.8rem; color: #94a3b8;" id="range-overlay-${st.code}">
                            Rango: ${rangeInfo.text}
                        </span>
                    </div>

                    <div class="dsp-controls" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 1.2rem; align-items: flex-end;">
                        <div class="dsp-col">
                            <label class="dsp-label" style="display: flex; justify-content: space-between; color: #cbd5e1; font-size: 0.82rem; margin-bottom: 0.3rem;">
                                <span>Filtro Pasa-Altos (HP):</span>
                                <strong style="color: #0ea5e9;"><span id="hp-val-${st.code}">${rangeInfo.hpDefault < 0.1 ? rangeInfo.hpDefault.toFixed(3) : rangeInfo.hpDefault.toFixed(2)}</span> Hz</strong>
                            </label>
                            <input type="range" class="dsp-slider hp-slider" data-code="${st.code}" min="${rangeInfo.hpMin}" max="${rangeInfo.hpMax}" step="${rangeInfo.hpStep}" value="${rangeInfo.hpDefault}" style="accent-color:#0ea5e9; width: 100%;">
                        </div>
                        <div class="dsp-col">
                            <label class="dsp-label" style="display: flex; justify-content: space-between; color: #cbd5e1; font-size: 0.82rem; margin-bottom: 0.3rem;">
                                <span>Filtro Pasa-Bajos (LP):</span>
                                <strong style="color: #f59e0b;"><span id="lp-val-${st.code}">${rangeInfo.lpDefault < 1.0 ? rangeInfo.lpDefault.toFixed(2) : rangeInfo.lpDefault.toFixed(1)}</span> Hz</strong>
                            </label>
                            <input type="range" class="dsp-slider lp-slider" data-code="${st.code}" min="${rangeInfo.lpMin}" max="${rangeInfo.lpMax}" step="${rangeInfo.lpStep}" value="${rangeInfo.lpDefault}" style="accent-color:#f59e0b; width: 100%;">
                        </div>
                        <div class="dsp-col">
                            <label class="dsp-label" style="display: flex; justify-content: space-between; color: #cbd5e1; font-size: 0.82rem; margin-bottom: 0.3rem;">
                                <span>Escala de Ganancia:</span>
                                <strong style="color: #10b981;"><span id="gain-val-${st.code}">1.0x</span></strong>
                            </label>
                            <input type="range" class="dsp-slider gain-slider" data-code="${st.code}" min="0.2" max="5.0" step="0.1" value="1.0" style="accent-color:#10b981; width: 100%;">
                        </div>
                        <div class="dsp-col" style="display: flex; flex-direction: column; justify-content: flex-end;">
                            <label class="dsp-label" style="display: flex; justify-content: space-between; color: #cbd5e1; font-size: 0.82rem; margin-bottom: 0.3rem;">
                                <span>Resolución / Diezmado:</span>
                                <strong id="decimation-label-${st.code}" style="color: ${isHD ? '#38bdf8' : '#94a3b8'};">
                                    ${isHD ? `⚡ HD Nativo (${rawRate} Hz)` : `📊 Diezmado (${decimationFactor}x • ${decimatedRate} Hz)`}
                                </strong>
                            </label>
                            <button id="btn-toggle-decimation-${st.code}" class="btn-decimation-toggle ${isHD ? 'active' : ''}" style="
                                width: 100%;
                                padding: 0.45rem 0.8rem;
                                background: ${isHD ? 'rgba(56, 189, 248, 0.18)' : '#1e293b'};
                                color: ${isHD ? '#38bdf8' : '#e2e8f0'};
                                border: 1px solid ${isHD ? '#38bdf8' : '#334155'};
                                border-radius: 6px;
                                font-size: 0.82rem;
                                font-weight: 600;
                                cursor: pointer;
                                display: flex;
                                align-items: center;
                                justify-content: center;
                                gap: 0.4rem;
                                transition: all 0.2s;
                            ">
                                <span>${isHD ? `⚡ Desactivar HD (Volver a ${decimatedRate} Hz)` : `🔬 Ver sin diezmar (HD ${rawRate} Hz)`}</span>
                            </button>
                        </div>
                    </div>
                </div>

                <!-- 3-Component Waveform Cards -->
                <div class="components-stack" style="display: flex; flex-direction: column; gap: 1.25rem;">

                    <!-- Component Z (Vertical) -->
                    <div class="component-card" style="background: #0f172a; border-radius: 10px; border: 1px solid rgba(56, 189, 248, 0.25); overflow: hidden; box-shadow: 0 4px 15px rgba(0, 0, 0, 0.3);">
                        <div style="display: flex; justify-content: space-between; align-items: center; padding: 0.6rem 1.2rem; background: rgba(15, 23, 42, 0.95); border-bottom: 1px solid rgba(255, 255, 255, 0.08);">
                            <div style="display: flex; align-items: center; gap: 0.6rem;">
                                <span style="background: #0284c7; color: white; padding: 0.2rem 0.55rem; border-radius: 4px; font-weight: 800; font-size: 0.85rem; font-family: monospace;">Z</span>
                                <strong style="color: #f8fafc; font-size: 0.95rem;">Componente Vertical (Z)</strong>
                                <span style="color: #64748b; font-size: 0.8rem;">(Movimiento arriba - abajo)</span>
                            </div>
                            <div style="display: flex; align-items: center; gap: 0.8rem;">
                                <span id="range-overlay-${st.code}-Z" style="font-size: 0.8rem; color: #94a3b8; font-family: monospace;">0.01 - 50 Hz</span>
                                <span id="pgv-tag-${st.code}-Z" style="background: rgba(56, 189, 248, 0.1); color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.2); padding: 0.25rem 0.6rem; border-radius: 4px; font-size: 0.8rem; font-family: monospace;">Esperando datos...</span>
                            </div>
                        </div>
                        <div class="oscilloscope-container" style="position: relative; height: 160px; min-height: 160px;">
                            <canvas class="oscilloscope-canvas station-canvas-render" data-station-code="${st.code}" data-component="Z" data-base-height="160" style="width:100%; display:block;"></canvas>
                        </div>
                    </div>

                    <!-- Component N / Y (North-South) -->
                    <div class="component-card" style="background: #0f172a; border-radius: 10px; border: 1px solid rgba(16, 185, 129, 0.25); overflow: hidden; box-shadow: 0 4px 15px rgba(0, 0, 0, 0.3);">
                        <div style="display: flex; justify-content: space-between; align-items: center; padding: 0.6rem 1.2rem; background: rgba(15, 23, 42, 0.95); border-bottom: 1px solid rgba(255, 255, 255, 0.08);">
                            <div style="display: flex; align-items: center; gap: 0.6rem;">
                                <span style="background: #059669; color: white; padding: 0.2rem 0.55rem; border-radius: 4px; font-weight: 800; font-size: 0.85rem; font-family: monospace;">N / Y</span>
                                <strong style="color: #f8fafc; font-size: 0.95rem;">Componente Horizontal Norte-Sur (Y / N)</strong>
                                <span style="color: #64748b; font-size: 0.8rem;">(Movimiento meridional)</span>
                            </div>
                            <div style="display: flex; align-items: center; gap: 0.8rem;">
                                <span id="range-overlay-${st.code}-N" style="font-size: 0.8rem; color: #94a3b8; font-family: monospace;">0.01 - 50 Hz</span>
                                <span id="pgv-tag-${st.code}-N" style="background: rgba(16, 185, 129, 0.1); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.2); padding: 0.25rem 0.6rem; border-radius: 4px; font-size: 0.8rem; font-family: monospace;">Esperando datos...</span>
                            </div>
                        </div>
                        <div class="oscilloscope-container" style="position: relative; height: 160px; min-height: 160px;">
                            <canvas class="oscilloscope-canvas station-canvas-render" data-station-code="${st.code}" data-component="N" data-base-height="160" style="width:100%; display:block;"></canvas>
                        </div>
                    </div>

                    <!-- Component E / X (East-West) -->
                    <div class="component-card" style="background: #0f172a; border-radius: 10px; border: 1px solid rgba(245, 158, 11, 0.25); overflow: hidden; box-shadow: 0 4px 15px rgba(0, 0, 0, 0.3);">
                        <div style="display: flex; justify-content: space-between; align-items: center; padding: 0.6rem 1.2rem; background: rgba(15, 23, 42, 0.95); border-bottom: 1px solid rgba(255, 255, 255, 0.08);">
                            <div style="display: flex; align-items: center; gap: 0.6rem;">
                                <span style="background: #d97706; color: white; padding: 0.2rem 0.55rem; border-radius: 4px; font-weight: 800; font-size: 0.85rem; font-family: monospace;">E / X</span>
                                <strong style="color: #f8fafc; font-size: 0.95rem;">Componente Horizontal Este-Oeste (X / E)</strong>
                                <span style="color: #64748b; font-size: 0.8rem;">(Movimiento zonal)</span>
                            </div>
                            <div style="display: flex; align-items: center; gap: 0.8rem;">
                                <span id="range-overlay-${st.code}-E" style="font-size: 0.8rem; color: #94a3b8; font-family: monospace;">0.01 - 50 Hz</span>
                                <span id="pgv-tag-${st.code}-E" style="background: rgba(245, 158, 11, 0.1); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.2); padding: 0.25rem 0.6rem; border-radius: 4px; font-size: 0.8rem; font-family: monospace;">Esperando datos...</span>
                            </div>
                        </div>
                        <div class="oscilloscope-container" style="position: relative; height: 160px; min-height: 160px;">
                            <canvas class="oscilloscope-canvas station-canvas-render" data-station-code="${st.code}" data-component="E" data-base-height="160" style="width:100%; display:block;"></canvas>
                        </div>
                    </div>

                </div>
            </div>
        `;

        const decimationBtn = this.container.querySelector(`#btn-toggle-decimation-${st.code}`) as HTMLButtonElement;
        if (decimationBtn) {
            decimationBtn.addEventListener('click', async () => {
                decimationBtn.disabled = true;
                decimationBtn.innerHTML = '<span>⏳ Calculando HD...</span>';
                const isDecimated = await this.engine.toggleStationDecimation(st.code);
                const currentHD = !isDecimated;
                decimationBtn.disabled = false;

                const label = document.getElementById(`decimation-label-${st.code}`);
                if (currentHD) {
                    decimationBtn.classList.add('active');
                    decimationBtn.style.background = 'rgba(56, 189, 248, 0.18)';
                    decimationBtn.style.color = '#38bdf8';
                    decimationBtn.style.borderColor = '#38bdf8';
                    decimationBtn.innerHTML = `<span>⚡ Desactivar HD (Volver a ${decimatedRate} Hz)</span>`;
                    if (label) {
                        label.textContent = `⚡ HD Nativo (${rawRate} Hz)`;
                        label.style.color = '#38bdf8';
                    }
                } else {
                    decimationBtn.classList.remove('active');
                    decimationBtn.style.background = '#1e293b';
                    decimationBtn.style.color = '#e2e8f0';
                    decimationBtn.style.borderColor = '#334155';
                    decimationBtn.innerHTML = `<span>🔬 Ver sin diezmar (HD ${rawRate} Hz)</span>`;
                    if (label) {
                        label.textContent = `📊 Diezmado (${decimationFactor}x • ${decimatedRate} Hz)`;
                        label.style.color = '#94a3b8';
                    }
                }
            });
        }

        // Register all 3 canvases with the engine
        const visibleMap = new Map<HTMLCanvasElement, any>();
        this.container.querySelectorAll('.station-canvas-render').forEach(canvas => {
            visibleMap.set(canvas as HTMLCanvasElement, st);
        });
        
        this.engine.setActiveCanvases(visibleMap);
        this.startPolling(st);
    }

    startPolling(st: any) {
        if (this.pollingInterval) clearInterval(this.pollingInterval);
        
        const doPoll = () => {
            const tf = this.engine.timeframe;
            if (!isHighFrequencyTimeframe(tf)) return; // No auto-refresh for long timeframes
            
            const canvases = this.container.querySelectorAll('.station-canvas-render');
            if (canvases.length === 0) return; // View unmounted
            this.engine.pollLiveFDSNForVisible([st], false);
        };

        // Trigger immediate fetch for the 3 components
        this.engine.pollLiveFDSNForVisible([st], true);
        this.pollingInterval = setInterval(doPoll, 5000);
    }

    destroy() {
        if (this.pollingInterval) {
            clearInterval(this.pollingInterval);
        }
    }
}
