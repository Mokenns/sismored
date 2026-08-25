import './styles.css';
// @ts-ignore
import { CHILE_REGIONS, STATIONS_BY_REGION, getStationById } from './stations-data.js';
import { SeismicEngine } from './seismic-engine';

declare global {
    interface Window {
        seismicEngine: SeismicEngine;
        sismoRedApp: SismoRedApp;
    }
}

function getStationFrequencyRange(st: any, tf: string) {
    if (tf === '24h' || tf === '3h') {
        return { text: "0.01 - 10.0 Hz (Webicorder)", hpDefault: 0.1, hpMin: 0.005, hpMax: 2.0, hpStep: 0.005, lpDefault: 10.0, lpMin: 0.05, lpMax: 20.0, lpStep: 0.1 };
    }
    if (st.network === 'IU' || st.network === 'II') {
        return { text: "0.0028 - 20.0 Hz (GSN 360s)", hpDefault: 0.1, hpMin: 0.01, hpMax: 10.0, hpStep: 0.05, lpDefault: 10.0, lpMin: 1.0, lpMax: 20.0, lpStep: 0.5 };
    }
    if (st.sensorClass === 'accelerometer' || (st.code && st.code.startsWith('GO'))) {
        return { text: "0.10 - 40.0 Hz (Acelerógrafo)", hpDefault: 1.0, hpMin: 0.05, hpMax: 10.0, hpStep: 0.05, lpDefault: 20.0, lpMin: 1.0, lpMax: 40.0, lpStep: 0.5 };
    }
    if (st.sensorClass === 'short_period') {
        return { text: "1.0 - 20.0 Hz (Corto Periodo)", hpDefault: 1.0, hpMin: 0.1, hpMax: 15.0, hpStep: 0.1, lpDefault: 15.0, lpMin: 2.0, lpMax: 40.0, lpStep: 0.5 };
    }
    return { text: "0.0083 - 40.0 Hz (Banda Ancha 120s)", hpDefault: 0.5, hpMin: 0.01, hpMax: 10.0, hpStep: 0.05, lpDefault: 10.0, lpMin: 1.0, lpMax: 40.0, lpStep: 0.5 };
}

class SismoRedApp {
    activeRegion: string = 'all';
    filterNetwork: string = 'all';
    filterSensor: string = 'all';
    searchQuery: string = '';
    apiFreqFilter: string = 'broadband';
    visibleCanvasMap: Map<HTMLCanvasElement, any> = new Map();
    engine: SeismicEngine;
    hoveredRegionId: string | null = null;
    visibleRegionIds: Set<string> = new Set();
    isScrolling: boolean = false;
    scrollTimeout: any = null;

    constructor() {
        this.engine = new SeismicEngine();
        window.seismicEngine = this.engine;
        
        this.init();
    }

    init() {
        this.renderRegionSidebar();
        this.setupEventListeners();
        this.updateTimeClock();
        this.updateDisclaimerVisibility();

        setInterval(() => this.updateTimeClock(), 1000);
        
        this.renderTransectView();

        // High frequency hovering loop
        let fastPollCounter = 0;
        setInterval(() => {
            if (this.isScrolling) return;
            fastPollCounter++;
            const tf = this.engine.timeframe;
            
            let shouldPoll = false;
            if (tf === '10s' && fastPollCounter % 1 === 0) shouldPoll = true;
            if (tf === '1m' && fastPollCounter % 2 === 0) shouldPoll = true;
            if (tf === '10m' && fastPollCounter % 5 === 0) shouldPoll = true;

            if (shouldPoll && this.visibleCanvasMap.size > 0) {
                const isMobile = window.innerWidth <= 768;
                const activeStations = Array.from(this.visibleCanvasMap.values()).filter(st => {
                    const card = document.getElementById(`card-${st.network}_${st.code}`);
                    if (!card) return false;
                    const region = card.closest('.region-section');
                    if (!region) return false;
                    
                    if (isMobile) {
                        return this.visibleRegionIds.has(region.id);
                    } else {
                        return this.hoveredRegionId === region.id;
                    }
                });
                
                if (activeStations.length > 0) {
                    this.engine.pollLiveFDSNForVisible(activeStations, false).then(() => {
                        this.hideFailedStations(activeStations);
                    });
                }
            }
        }, 1000);

        // Regular Polling loop
        setInterval(() => {
            if (this.isScrolling) return;
            const tf = this.engine.timeframe;
            if (tf === '10s' || tf === '1m' || tf === '10m') {
                return; // Low timeframes are handled exclusively by the high frequency loop
            }

            if (this.visibleCanvasMap.size > 0) {
                const isMobile = window.innerWidth <= 768;
                let stationsToPoll = Array.from(this.visibleCanvasMap.values());

                if (isMobile) {
                    stationsToPoll = stationsToPoll.filter(st => {
                        const card = document.getElementById(`card-${st.network}_${st.code}`);
                        if (!card) return false;
                        const region = card.closest('.region-section');
                        return region && this.visibleRegionIds.has(region.id);
                    });
                }
                
                if (stationsToPoll.length > 0) {
                    this.engine.pollLiveFDSNForVisible(stationsToPoll, false).then(() => {
                        this.hideFailedStations(stationsToPoll);
                    });
                }
            }
        }, 10000);
    }

    updateDisclaimerVisibility() {
        const tf = this.engine.timeframe;
        const disclaimer = document.getElementById('hover-disclaimer');
        if (tf === '10s' || tf === '1m' || tf === '10m') {
            if (disclaimer) disclaimer.style.display = 'block';
        } else {
            if (disclaimer) disclaimer.style.display = 'none';
        }
        
        const dataDisclaimer = document.getElementById('data-limit-disclaimer');
        if (tf === '12h' || tf === '24h') {
            if (dataDisclaimer) dataDisclaimer.style.display = 'block';
        } else {
            if (dataDisclaimer) dataDisclaimer.style.display = 'none';
        }
    }

    hideFailedStations(stations: any[]) {
        stations.forEach(st => {
            const state = this.engine.getOrCreateStationState(st.code, st);
            if (state.hasFailed) {
                const card = document.getElementById(`card-${st.network}_${st.code}`);
                if (card) {
                    card.style.display = 'none';
                    const canvas = document.querySelector(`.station-canvas-render[data-station-code="${st.code}"]`) as HTMLCanvasElement;
                    if (canvas) {
                        this.visibleCanvasMap.delete(canvas);
                        this.engine.setActiveCanvases(this.visibleCanvasMap);
                    }
                }
            }
        });
    }

    setupEventListeners() {
        const mainLayout = document.querySelector('.main-layout');
        if (mainLayout) {
            mainLayout.addEventListener('scroll', () => {
                this.isScrolling = true;
                if (this.scrollTimeout) clearTimeout(this.scrollTimeout);
                this.scrollTimeout = setTimeout(() => {
                    this.isScrolling = false;
                }, 250);
            });
        }

        document.addEventListener('mouseover', (e: Event) => {
            const target = e.target as HTMLElement;
            const regionEl = target.closest('.region-section');
            if (regionEl) {
                this.hoveredRegionId = regionEl.id;
            } else {
                this.hoveredRegionId = null;
            }
        });

        const sliderTimers: Map<string, any> = new Map();

        document.addEventListener('input', (e: Event) => {
            const target = e.target as HTMLInputElement;
            if (target.classList.contains('hp-slider') || target.classList.contains('lp-slider')) {
                const code = target.getAttribute('data-code')!;
                const hpEl = document.querySelector(`.hp-slider[data-code="${code}"]`) as HTMLInputElement;
                const lpEl = document.querySelector(`.lp-slider[data-code="${code}"]`) as HTMLInputElement;
                if (!hpEl || !lpEl) return;
                
                const hp = parseFloat(hpEl.value);
                const lp = parseFloat(lpEl.value);
                
                const hpValSpan = document.getElementById(`hp-val-${code}`);
                const lpValSpan = document.getElementById(`lp-val-${code}`);
                if (hpValSpan) hpValSpan.textContent = hp < 0.1 ? hp.toFixed(3) : hp.toFixed(2);
                if (lpValSpan) lpValSpan.textContent = lp < 1.0 ? lp.toFixed(2) : lp.toFixed(1);
                
                // Debounce DSP filtering until slider stops
                if (sliderTimers.has(`filter-${code}`)) clearTimeout(sliderTimers.get(`filter-${code}`));
                sliderTimers.set(`filter-${code}`, setTimeout(() => {
                    this.engine.setStationFilter(code, hp, lp);
                    sliderTimers.delete(`filter-${code}`);
                }, 150));

            } else if (target.classList.contains('gain-slider')) {
                const code = target.getAttribute('data-code')!;
                const gain = parseFloat(target.value);
                const gainValSpan = document.getElementById(`gain-val-${code}`);
                if (gainValSpan) gainValSpan.textContent = `${gain.toFixed(1)}x`;
                
                // Update gain value internally without rendering
                this.engine.setStationGain(code, gain, false);

                // Debounce render until movement stops
                if (sliderTimers.has(`gain-${code}`)) clearTimeout(sliderTimers.get(`gain-${code}`));
                sliderTimers.set(`gain-${code}`, setTimeout(() => {
                    this.engine.renderStationCanvas(code);
                    sliderTimers.delete(`gain-${code}`);
                }, 150));
            }
        });

        document.addEventListener('change', (e: Event) => {
            const target = e.target as HTMLInputElement;
            if (target.classList.contains('hp-slider') || target.classList.contains('lp-slider')) {
                const code = target.getAttribute('data-code')!;
                const hpEl = document.querySelector(`.hp-slider[data-code="${code}"]`) as HTMLInputElement;
                const lpEl = document.querySelector(`.lp-slider[data-code="${code}"]`) as HTMLInputElement;
                if (hpEl && lpEl) {
                    if (sliderTimers.has(`filter-${code}`)) clearTimeout(sliderTimers.get(`filter-${code}`));
                    this.engine.setStationFilter(code, parseFloat(hpEl.value), parseFloat(lpEl.value));
                }
            } else if (target.classList.contains('gain-slider')) {
                const code = target.getAttribute('data-code')!;
                if (sliderTimers.has(`gain-${code}`)) clearTimeout(sliderTimers.get(`gain-${code}`));
                this.engine.setStationGain(code, parseFloat(target.value), true);
            }
        });
    
        const autoScaleBtn = document.getElementById('btn-autoscale-toggle');
        if (autoScaleBtn) {
            autoScaleBtn.addEventListener('click', () => {
                const isAuto = this.engine.toggleAutoScale();
                if (isAuto) {
                    autoScaleBtn.classList.add('active');
                    autoScaleBtn.textContent = '✨ Auto-Escala: ON';
                } else {
                    autoScaleBtn.classList.remove('active');
                    autoScaleBtn.textContent = '🎚️ Auto-Escala: OFF (Manual)';
                }
            });
        }

        const slider = document.getElementById('scale-gain-slider') as HTMLInputElement;
        const sliderVal = document.getElementById('scale-slider-val');
        let globalGainTimer: any = null;
        if (slider) {
            slider.addEventListener('input', (e) => {
                const val = parseFloat((e.target as HTMLInputElement).value);
                this.engine.setGain(val, false);
                if (sliderVal) sliderVal.textContent = `${val.toFixed(1)}x`;

                if (this.engine.autoScale) {
                    this.engine.setAutoScale(false);
                    if (autoScaleBtn) {
                        autoScaleBtn.classList.remove('active');
                        autoScaleBtn.textContent = '🎚️ Auto-Escala: OFF (Manual)';
                    }
                }

                if (globalGainTimer) clearTimeout(globalGainTimer);
                globalGainTimer = setTimeout(() => {
                    this.engine.forceRender();
                    globalGainTimer = null;
                }, 150);
            });

            slider.addEventListener('change', (e) => {
                if (globalGainTimer) clearTimeout(globalGainTimer);
                const val = parseFloat((e.target as HTMLInputElement).value);
                this.engine.setGain(val, true);
            });
        }

        document.querySelectorAll('.btn-timeframe').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.btn-timeframe').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                const tf = btn.getAttribute('data-timeframe')!;
                this.engine.setTimeframe(tf);
                this.updateStationCardControlsForTimeframe(tf);
                this.updateDisclaimerVisibility();
                
                const visibleStations = Array.from(this.visibleCanvasMap.values());
                this.engine.pollLiveFDSNForVisible(visibleStations, true).then(() => {
                    this.hideFailedStations(visibleStations);
                });
            });
        });

        const search = document.getElementById('search-stations') as HTMLInputElement;
        if (search) search.addEventListener('input', (e) => { this.searchQuery = (e.target as HTMLInputElement).value.toLowerCase().trim(); this.applyFilters(); });
    }

    updateStationCardControlsForTimeframe(tf: string) {
        this.visibleCanvasMap.forEach((st) => {
            const rangeInfo = getStationFrequencyRange(st, tf);
            const overlay = document.querySelector(`#osc-container-${st.code} .oscilloscope-overlay`);
            if (overlay) {
                overlay.textContent = `Rango Medido: ${rangeInfo.text}`;
            }

            const hpSlider = document.querySelector(`.hp-slider[data-code="${st.code}"]`) as HTMLInputElement;
            const lpSlider = document.querySelector(`.lp-slider[data-code="${st.code}"]`) as HTMLInputElement;
            const hpVal = document.getElementById(`hp-val-${st.code}`);
            const lpVal = document.getElementById(`lp-val-${st.code}`);

            if (hpSlider && lpSlider) {
                hpSlider.min = rangeInfo.hpMin.toString();
                hpSlider.max = rangeInfo.hpMax.toString();
                hpSlider.step = rangeInfo.hpStep.toString();
                hpSlider.value = rangeInfo.hpDefault.toString();

                lpSlider.min = rangeInfo.lpMin.toString();
                lpSlider.max = rangeInfo.lpMax.toString();
                lpSlider.step = rangeInfo.lpStep.toString();
                lpSlider.value = rangeInfo.lpDefault.toString();

                if (hpVal) hpVal.textContent = (rangeInfo.hpStep < 0.01) ? rangeInfo.hpDefault.toFixed(3) : rangeInfo.hpDefault.toFixed(2);
                if (lpVal) lpVal.textContent = (rangeInfo.lpStep < 0.01) ? rangeInfo.lpDefault.toFixed(2) : rangeInfo.lpDefault.toFixed(1);

                this.engine.setStationFilter(st.code, rangeInfo.hpDefault, rangeInfo.lpDefault);
            }
        });
    }

    updateTimeClock() {
        const now = new Date();
        const clt = now.toLocaleTimeString('es-CL', { hour12: false, timeZone: 'America/Santiago' });
        const utc = now.toISOString().substring(11, 19);
        const el = document.getElementById('live-time-display');
        if (el) el.textContent = `${clt} CLT • ${utc} UTC (Tiempo Universal)`;
    }

    applyFilters() {
        this.renderTransectView();
    }

    filterStationList(list: any[]) {
        return list.filter(st => {
            if (st.network === 'AM' || st.network === 'GE' || st.network === 'CX') return false;
            
            if (this.filterSensor !== 'all' && st.sensorClass !== this.filterSensor) return false;
            if (this.searchQuery) {
                const q = this.searchQuery;
                const matchCode = st.code.toLowerCase().includes(q);
                const matchName = st.name.toLowerCase().includes(q);
                const matchLoc = st.locality.toLowerCase().includes(q);
                const matchNet = st.operator.toLowerCase().includes(q);
                if (!matchCode && !matchName && !matchLoc && !matchNet) return false;
            }
            return true;
        });
    }

    renderRegionSidebar() {
        const select = document.getElementById('region-selector');
        if (!select) return;

        let html = `<option value="all">🇨🇱 Todas las Regiones</option>`;
        Object.entries(CHILE_REGIONS).forEach(([code, reg]: [string, any]) => {
            html += `<option value="${code}">${reg.roman} - ${reg.name}</option>`;
        });
        select.innerHTML = html;
        select.addEventListener('change', (e) => this.selectRegion((e.target as HTMLSelectElement).value));
    }

    selectRegion(regCode: string) {
        this.activeRegion = regCode;
        this.renderTransectView();
    }

    renderTransectView() {
        const container = document.getElementById('transect-view-container');
        if (!container) return;

        this.visibleCanvasMap.clear();

        const regionsToRender = this.activeRegion === 'all'
            ? Object.keys(CHILE_REGIONS)
            : [this.activeRegion];

        let html = '';

        regionsToRender.forEach(regCode => {
            const regInfo = CHILE_REGIONS[regCode];
            const rawStations = STATIONS_BY_REGION[regCode] || [];
            const filteredStations = this.filterStationList(rawStations);

            if (filteredStations.length === 0) return;

            const costaCount = filteredStations.filter(s => s.geomorphicZone === 'Costa').length;
            const valleCount = filteredStations.filter(s => s.geomorphicZone === 'Valle').length;
            const cordCount = filteredStations.filter(s => s.geomorphicZone === 'Cordillera').length;

            const isWide = (filteredStations.length >= 4 || regionsToRender.length === 1);
            const wideClass = isWide ? 'region-wide' : '';

            html += `
                <section class="region-section ${wideClass}" id="region-${regCode}">
                    <div class="region-header">
                        <h3 class="region-name">
                            <span class="region-badge-roman">${regInfo.roman}</span>
                            ${regInfo.name}
                        </h3>
                        <div class="region-transect-summary">
                            <span class="zone-count-pill pill-costa">🌊 Costa: ${costaCount}</span>
                            <span class="zone-count-pill pill-valle">🏙️ Valle: ${valleCount}</span>
                            <span class="zone-count-pill pill-cordillera">🏔️ Cordillera: ${cordCount}</span>
                        </div>
                    </div>

                    <div class="stations-grid">
                        ${filteredStations.map(st => this.renderStationCardHtml(st)).join('')}
                    </div>
                </section>
            `;
        });

        if (!html) {
            html = `
                <div class="region-section" style="text-align: center; padding: 3rem;">
                    <h3>🔍 No se encontraron estaciones sismográficas</h3>
                </div>
            `;
        }

        container.innerHTML = html;

        document.querySelectorAll('.station-canvas-render').forEach(canvas => {
            const code = canvas.getAttribute('data-station-code')!;
            const st = getStationById(code);
            if (st) {
                this.visibleCanvasMap.set(canvas as HTMLCanvasElement, st);
            }
        });
        
        this.engine.setActiveCanvases(this.visibleCanvasMap);
        
        const visibleStations = Array.from(this.visibleCanvasMap.values());
        this.engine.pollLiveFDSNForVisible(visibleStations, true).then(() => {
            this.hideFailedStations(visibleStations);
        });

        // Setup IntersectionObserver for mobile performance optimization
        if ((this as any)._regionObserver) {
            (this as any)._regionObserver.disconnect();
        }
        
        (this as any)._regionObserver = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    this.visibleRegionIds.add(entry.target.id);
                } else {
                    this.visibleRegionIds.delete(entry.target.id);
                }
            });
        }, { rootMargin: '200px 0px' });

        document.querySelectorAll('.region-section').forEach(el => {
            (this as any)._regionObserver.observe(el);
        });
    }

    renderStationCardHtml(st: any) {
        let netClass = 'net-csn';
        if (st.network === 'AM') netClass = 'net-rs';
        else if (st.network === 'IU' || st.network === 'II') netClass = 'net-gsn';
        else if (st.network === 'GE') netClass = 'net-geofon';

        let zonePillClass = 'pill-costa';
        let zoneIcon = '🌊';
        if (st.geomorphicZone === 'Valle') {
            zonePillClass = 'pill-valle';
            zoneIcon = '🏙️';
        } else if (st.geomorphicZone === 'Cordillera') {
            zonePillClass = 'pill-cordillera';
            zoneIcon = '🏔️';
        }

        const tf = this.engine.timeframe;
        const rangeInfo = getStationFrequencyRange(st, tf);

        return `
            <article class="station-card" id="card-${st.network}_${st.code}">
                <div class="station-card-header">
                    <div>
                        <div class="station-code-group">
                            <span class="station-code">${st.code}</span>
                            <span class="network-badge ${netClass}">${st.network}</span>
                            <span class="zone-tag ${zonePillClass}">${zoneIcon} ${st.geomorphicZone}</span>
                        </div>
                        <div class="station-locality">${st.locality} (${st.operator.replace(' (CSN - U. de Chile)', '').replace(' Network', '')})</div>
                    </div>
                </div>

                <div class="oscilloscope-container" id="osc-container-${st.code}" style="min-height: 110px;">
                    <canvas class="oscilloscope-canvas station-canvas-render" data-station-code="${st.code}" width="380" height="105" style="width:100%; display:block;"></canvas>
                    <div class="oscilloscope-overlay">Rango Medido: ${rangeInfo.text}</div>
                    <div class="oscilloscope-pgv-tag" id="pgv-tag-${st.code}">Esperando datos...</div>
                </div>

                <div class="dsp-controls">
                    <div class="dsp-col">
                        <label class="dsp-label">Filtro HP: <span id="hp-val-${st.code}">${rangeInfo.hpDefault < 0.1 ? rangeInfo.hpDefault.toFixed(3) : rangeInfo.hpDefault.toFixed(2)}</span> Hz</label>
                        <input type="range" class="dsp-slider hp-slider" data-code="${st.code}" min="${rangeInfo.hpMin}" max="${rangeInfo.hpMax}" step="${rangeInfo.hpStep}" value="${rangeInfo.hpDefault}" style="accent-color:#0ea5e9;">
                    </div>
                    <div class="dsp-col">
                        <label class="dsp-label">Filtro LP: <span id="lp-val-${st.code}">${rangeInfo.lpDefault < 1.0 ? rangeInfo.lpDefault.toFixed(2) : rangeInfo.lpDefault.toFixed(1)}</span> Hz</label>
                        <input type="range" class="dsp-slider lp-slider" data-code="${st.code}" min="${rangeInfo.lpMin}" max="${rangeInfo.lpMax}" step="${rangeInfo.lpStep}" value="${rangeInfo.lpDefault}" style="accent-color:#f59e0b;">
                    </div>
                    <div class="dsp-col">
                        <label class="dsp-label">Escala: <span id="gain-val-${st.code}">1.0x</span></label>
                        <input type="range" class="dsp-slider gain-slider" data-code="${st.code}" min="0.2" max="5.0" step="0.1" value="1.0" style="accent-color:#10b981;">
                    </div>
                </div>

                <div class="station-meta-grid">
                    <div class="meta-item">Sensor: <span>${st.sensorClass === 'broadband' ? 'Banda Ancha' : (st.sensorClass === 'accelerometer' ? 'Acelerógrafo' : 'Corto Periodo')}</span></div>
                    <div class="meta-item">Elevación: <span>${Math.round(st.elevation)} m</span></div>
                    <div class="meta-item">Longitud: <span>${st.lon.toFixed(3)}° W</span></div>
                    <div class="meta-item">Latitud: <span>${st.lat.toFixed(3)}° S</span></div>
                </div>
            </article>
        `;
    }
}

document.addEventListener('DOMContentLoaded', () => {
    window.sismoRedApp = new SismoRedApp();
});
