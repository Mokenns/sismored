import { SeismicEngine } from '../seismic-engine';
// @ts-ignore
import { CHILE_REGIONS, STATIONS_BY_REGION, getStationById } from '../stations-data.js';
import { renderStationCardHtml } from '../components/StationCard';

export class RegionView {
    engine: SeismicEngine;
    container: HTMLElement;
    activeRegion: string = 'all';
    searchQuery: string = '';
    filterSensor: string = 'all';
    visibleCanvasMap: Map<HTMLCanvasElement, any> = new Map();
    visibleRegionIds: Set<string> = new Set();
    hoveredRegionId: string | null = null;
    hoveredStationCode: string | null = null;
    regionObserver: IntersectionObserver | null = null;
    appContext: any; // We'll pass the app context to access isScrolling
    fastPollInterval: any = null;
    regularPollInterval: any = null;

    constructor(engine: SeismicEngine, containerId: string, appContext: any) {
        this.engine = engine;
        this.container = document.getElementById(containerId)!;
        this.appContext = appContext;
    }

    setFilters(region: string, search: string, sensor: string) {
        this.activeRegion = region;
        this.searchQuery = search.toLowerCase().trim();
        this.filterSensor = sensor;
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

    render() {
        const topNav = document.querySelector('.top-nav-bar') as HTMLElement;
        if (topNav) {
            topNav.style.display = ''; // Restore flex or whatever is default via css class
        }

        this.visibleCanvasMap.clear();

        let html = '';
        const tf = this.engine.timeframe;
        const isHighFrequency = ['10s', '1m', '10m'].includes(tf);

        if (isHighFrequency && this.activeRegion === 'all') {
            // Directory View for high frequency / all regions
            html = `<div style="text-align: center; margin-bottom: 2rem; color: #94a3b8;">
                        <h2 style="color: #e2e8f0; font-weight: 500;">Seleccione una región para iniciar la telemetría en vivo</h2>
                        <p>Para evitar la saturación de la red y su navegador en resoluciones de alta frecuencia, seleccione una región específica para comenzar.</p>
                    </div>
                    <div class="regions-directory" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 1rem;">`;
            
            Object.keys(CHILE_REGIONS).forEach(regCode => {
                const regInfo = CHILE_REGIONS[regCode];
                html += `
                    <button class="region-select-btn" onclick="document.getElementById('region-selector').value='${regCode}'; document.getElementById('region-selector').dispatchEvent(new Event('change'))" style="background: #1e293b; border: 1px solid #334155; padding: 1.5rem; border-radius: 8px; cursor: pointer; text-align: left; transition: all 0.2s;">
                        <h3 style="margin: 0 0 0.5rem 0; color: #e2e8f0; font-size: 1.1rem;"><span style="color: #38bdf8; margin-right: 0.5rem;">${regInfo.roman}</span>${regInfo.name}</h3>
                        <p style="margin: 0; color: #94a3b8; font-size: 0.85rem;">Ingresar a la región →</p>
                    </button>
                `;
            });
            html += `</div>`;
        } else {
            // Render specific region (or all regions for low frequency 1h, 3h, 24h)
            const regionsToRender = this.activeRegion === 'all'
                ? Object.keys(CHILE_REGIONS)
                : [this.activeRegion];

            regionsToRender.forEach(regCode => {
                const regInfo = CHILE_REGIONS[regCode];
                const rawStations = STATIONS_BY_REGION[regCode] || [];
                const filteredStations = this.filterStationList(rawStations);

                if (filteredStations.length === 0) return;

                const costaCount = filteredStations.filter((s: any) => s.geomorphicZone === 'Costa').length;
                const valleCount = filteredStations.filter((s: any) => s.geomorphicZone === 'Valle').length;
                const cordCount = filteredStations.filter((s: any) => s.geomorphicZone === 'Cordillera').length;

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
                            ${filteredStations.map((st: any) => renderStationCardHtml(st, this.engine.timeframe)).join('')}
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
        }

        this.container.innerHTML = html;

        // Hover effects for the directory buttons
        this.container.querySelectorAll('.region-select-btn').forEach((btn: any) => {
            btn.onmouseover = () => btn.style.background = '#334155';
            btn.onmouseout = () => btn.style.background = '#1e293b';
        });

        this.container.querySelectorAll('.station-canvas-render').forEach(canvas => {
            const code = canvas.getAttribute('data-station-code')!;
            const st = getStationById(code);
            if (st) {
                this.visibleCanvasMap.set(canvas as HTMLCanvasElement, st);
            }
        });

        // Attach mouseenter and mouseleave directly on station cards for clean, jitter-free hover tracking
        this.container.querySelectorAll('.station-card').forEach(card => {
            const canvas = card.querySelector('.station-canvas-render');
            if (canvas) {
                const code = canvas.getAttribute('data-station-code');
                const st = code ? getStationById(code) : null;
                if (st) {
                    card.addEventListener('mouseenter', () => {
                        this.hoveredStationCode = st.code;
                        this.engine.cancelActivePolling(); // Instantly abort any background polling loop
                        this.triggerHoverPoll(st); // Trigger immediate fetch if 5s has elapsed
                    });
                    card.addEventListener('mouseleave', () => {
                        if (this.hoveredStationCode === st.code) {
                            this.hoveredStationCode = null;
                        }
                    });
                }
            }
        });
        
        this.engine.setActiveCanvases(this.visibleCanvasMap);
        
        // Setup IntersectionObserver for lazy initial loading (both mobile and PC)
        if (this.regionObserver) {
            this.regionObserver.disconnect();
        }
        
        this.regionObserver = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    this.visibleRegionIds.add(entry.target.id);

                    // Trigger initial fetch only for stations that haven't been fetched yet in this visible region
                    const canvases = entry.target.querySelectorAll('.station-canvas-render');
                    const stationsToFetch: any[] = [];
                    canvases.forEach(c => {
                        const code = c.getAttribute('data-station-code')!;
                        const st = getStationById(code);
                        if (st) {
                            const state = this.engine.getOrCreateStationState(code, st);
                            if (state.lastFetchTime === 0) {
                                stationsToFetch.push(st);
                            }
                        }
                    });

                    if (stationsToFetch.length > 0) {
                        this.engine.pollLiveFDSNForVisible(stationsToFetch, true).then(() => {
                            this.appContext.hideFailedStations(stationsToFetch);
                        });
                    }

                } else {
                    this.visibleRegionIds.delete(entry.target.id);
                }
            });
        }, { rootMargin: '200px 0px' });

        this.container.querySelectorAll('.region-section').forEach(el => {
            this.regionObserver!.observe(el);
        });
        
        this.startPolling();
    }

    triggerHoverPoll(st: any) {
        const tf = this.engine.timeframe;
        if (!['10s', '1m', '10m'].includes(tf)) return;

        const state = this.engine.getOrCreateStationState(st.code, st);
        const now = Date.now();
        // If more than 4.5s since last request, trigger immediate fetch on hover
        if (now - state.lastRequestTime >= 4500) {
            this.engine.pollLiveFDSNForVisible([st], true).then(() => {
                this.appContext.hideFailedStations([st]);
            });
        }
    }
    
    startPolling() {
        if (this.fastPollInterval) clearInterval(this.fastPollInterval);

        let fastPollCounter = 0;
        this.fastPollInterval = setInterval(() => {
            if (this.appContext.isScrolling) return;
            fastPollCounter++;
            const tf = this.engine.timeframe;
            
            // Only auto-refresh high-frequency timeframes (10s, 1m, 10m)
            if (!['10s', '1m', '10m'].includes(tf)) return;
            
            // Refresh every 5 seconds (5s minimum refresh time for 10s, 1m, and 10m)
            if (fastPollCounter % 5 !== 0) return;

            if (this.visibleCanvasMap.size > 0) {
                // When hovering a specific station on PC, refresh ONLY that station's data every 5s while pausing others
                if (this.hoveredStationCode) {
                    const hoveredStation = Array.from(this.visibleCanvasMap.values()).find(st => st.code === this.hoveredStationCode);
                    if (hoveredStation) {
                        this.engine.cancelActivePolling();
                        this.engine.pollLiveFDSNForVisible([hoveredStation], true).then(() => {
                            this.appContext.hideFailedStations([hoveredStation]);
                        });
                        return; // Pause any other station's refresh!
                    }
                }

                // If not hovering a specific station, poll all visible on-screen stations
                const activeStations = Array.from(this.visibleCanvasMap.values()).filter(st => {
                    const card = document.getElementById(`card-${st.network}_${st.code}`);
                    if (!card) return false;
                    const region = card.closest('.region-section');
                    return region && this.visibleRegionIds.has(region.id);
                });
                
                if (activeStations.length > 0) {
                    this.engine.pollLiveFDSNForVisible(activeStations, false).then(() => {
                        this.appContext.hideFailedStations(activeStations);
                    });
                }
            }
        }, 1000);
    }

    destroy() {
        if (this.regionObserver) {
            this.regionObserver.disconnect();
            this.regionObserver = null;
        }
        if (this.fastPollInterval) clearInterval(this.fastPollInterval);
    }
}
