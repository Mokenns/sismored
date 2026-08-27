import './styles.css';
// @ts-ignore
import { CHILE_REGIONS } from './stations-data.js';
import { SeismicEngine } from './seismic-engine';
import { Router } from './router/index';
import { RegionView } from './views/RegionView';
import { StationDetailView } from './views/StationDetailView';
import { getStationFrequencyRange } from './components/StationCard';

declare global {
    interface Window {
        seismicEngine: SeismicEngine;
        sismoRedApp: SismoRedApp;
    }
}

class SismoRedApp {
    engine: SeismicEngine;
    router: Router;
    currentView: any = null;
    isScrolling: boolean = false;
    scrollTimeout: any = null;

    constructor() {
        this.engine = new SeismicEngine();
        window.seismicEngine = this.engine;
        this.router = new Router();
        
        this.init();
    }

    init() {
        this.renderRegionSidebar();
        this.setupEventListeners();
        this.updateTimeClock();
        this.updateDisclaimerVisibility();

        setInterval(() => this.updateTimeClock(), 1000);

        this.setupRoutes();
        this.router.init();
    }

    setupRoutes() {
        this.router.addRoute('/', () => {
            this.router.navigate('#/timeframe/1m');
        });

        this.router.addRoute('/timeframe/:tf', (tf: string) => {
            this.switchView(RegionView);
            this.updateTimeframeButtons(tf);
            this.engine.setTimeframe(tf);
            this.currentView.render();
            this.updateStationCardControlsForTimeframe(tf);
            this.updateDisclaimerVisibility();
        });

        this.router.addRoute('/station/:code', (code: string) => {
            this.switchView(StationDetailView, code);
        });

        this.router.addRoute('*', () => {
            this.router.navigate('#/timeframe/1m');
        });
    }

    switchView(ViewClass: any, ...args: any[]) {
        if (this.currentView) {
            if (this.currentView.destroy) this.currentView.destroy();
        }
        const container = document.getElementById('app-view');
        if (container) container.innerHTML = '';
        
        // Clear active canvases in engine when switching views
        this.engine.setActiveCanvases(new Map());

        if (ViewClass === RegionView) {
            this.currentView = new ViewClass(this.engine, 'app-view', this);
            const select = document.getElementById('region-selector') as HTMLSelectElement;
            const search = document.getElementById('search-stations') as HTMLInputElement;
            this.currentView.setFilters(select?.value || 'all', search?.value || '', 'all');
        } else {
            this.currentView = new ViewClass(this.engine, 'app-view', ...args);
            this.currentView.render();
        }
    }

    updateTimeframeButtons(tf: string) {
        document.querySelectorAll('.btn-timeframe').forEach(btn => {
            if (btn.getAttribute('data-timeframe') === tf) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        });
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
                    if (canvas && this.currentView?.visibleCanvasMap) {
                        this.currentView.visibleCanvasMap.delete(canvas);
                        this.engine.setActiveCanvases(this.currentView.visibleCanvasMap);
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
            if (this.currentView instanceof RegionView) {
                const target = e.target as HTMLElement;
                const regionEl = target.closest('.region-section');
                if (regionEl) {
                    this.currentView.hoveredRegionId = regionEl.id;
                } else {
                    this.currentView.hoveredRegionId = null;
                }
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
                
                let hp = parseFloat(hpEl.value);
                let lp = parseFloat(lpEl.value);
                
                if (target.classList.contains('hp-slider')) {
                    if (hp >= lp) {
                        lp = Math.min(parseFloat(lpEl.max), hp + parseFloat(hpEl.step || '0.1'));
                        lpEl.value = lp.toString();
                    }
                } else if (target.classList.contains('lp-slider')) {
                    if (lp <= hp) {
                        hp = Math.max(parseFloat(hpEl.min), lp - parseFloat(lpEl.step || '0.1'));
                        hpEl.value = hp.toString();
                    }
                }
                
                const hpValSpan = document.getElementById(`hp-val-${code}`);
                const lpValSpan = document.getElementById(`lp-val-${code}`);
                if (hpValSpan) hpValSpan.textContent = hp < 0.1 ? hp.toFixed(3) : hp.toFixed(2);
                if (lpValSpan) lpValSpan.textContent = lp < 1.0 ? lp.toFixed(2) : lp.toFixed(1);
                
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
                
                this.engine.setStationGain(code, gain, false);

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
                    let hp = parseFloat(hpEl.value);
                    let lp = parseFloat(lpEl.value);
                    if (hp >= lp) {
                        hp = Math.max(parseFloat(hpEl.min), lp * 0.5);
                        hpEl.value = hp.toString();
                    }
                    this.engine.setStationFilter(code, hp, lp);
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
                const tf = btn.getAttribute('data-timeframe')!;
                // If we are in RegionView, navigate to timeframe route
                if (this.currentView instanceof RegionView) {
                    this.router.navigate(`#/timeframe/${tf}`);
                } else if (this.currentView instanceof StationDetailView) {
                    // Update timeframe for detail view without leaving
                    this.engine.setTimeframe(tf);
                    this.updateTimeframeButtons(tf);
                    this.currentView.render();
                    this.updateStationCardControlsForTimeframe(tf);
                    this.updateDisclaimerVisibility();
                }
            });
        });

        const search = document.getElementById('search-stations') as HTMLInputElement;
        if (search) search.addEventListener('input', (e) => { 
            if (this.currentView instanceof RegionView) {
                this.currentView.searchQuery = (e.target as HTMLInputElement).value.toLowerCase().trim();
                this.currentView.render();
            }
        });
    }

    updateStationCardControlsForTimeframe(tf: string) {
        if (!this.currentView || !this.currentView.visibleCanvasMap) return;
        this.currentView.visibleCanvasMap.forEach((st: any) => {
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

    renderRegionSidebar() {
        const select = document.getElementById('region-selector');
        if (!select) return;

        let html = `<option value="all">🇨🇱 Todas las Regiones</option>`;
        Object.entries(CHILE_REGIONS).forEach(([code, reg]: [string, any]) => {
            html += `<option value="${code}">${reg.roman} - ${reg.name}</option>`;
        });
        select.innerHTML = html;
        select.addEventListener('change', (e) => {
            if (this.currentView instanceof RegionView) {
                this.currentView.activeRegion = (e.target as HTMLSelectElement).value;
                this.currentView.render();
            }
        });
    }
}

document.addEventListener('DOMContentLoaded', () => {
    window.sismoRedApp = new SismoRedApp();
});
