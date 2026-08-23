/**
 * SismoRed Chile - Core Application Controller
 * Telemetría en Tiempo Real y DSP Sísmico
 */

function getStationFrequencyRange(st, tf) {
    if (tf === '24h' || tf === '3h') {
        return {
            text: "0.001 - 0.50 Hz (LHZ 1 sps)",
            hpDefault: 0.001,
            hpMin: 0.001,
            hpMax: 0.45,
            hpStep: 0.005,
            lpDefault: 0.5,
            lpMin: 0.01,
            lpMax: 0.5,
            lpStep: 0.01
        };
    }
    
    // GSN Stations (Very Broadband 360s)
    if (st.network === 'IU' || st.network === 'II') {
        return {
            text: "0.0028 - 50.0 Hz (GSN 360s)",
            hpDefault: 0.01,
            hpMin: 0.01,
            hpMax: 10.0,
            hpStep: 0.05,
            lpDefault: 50.0,
            lpMin: 1.0,
            lpMax: 50.0,
            lpStep: 0.5
        };
    }

    // Strong Motion Accelerometers
    if (st.sensorClass === 'accelerometer' || (st.code && st.code.startsWith('GO'))) {
        return {
            text: "0.10 - 50.0 Hz (Acelerógrafo)",
            hpDefault: 0.1,
            hpMin: 0.05,
            hpMax: 10.0,
            hpStep: 0.05,
            lpDefault: 50.0,
            lpMin: 1.0,
            lpMax: 50.0,
            lpStep: 0.5
        };
    }
    
    // Short Period
    if (st.sensorClass === 'short_period') {
        return {
            text: "1.0 - 50.0 Hz (Corto Periodo)",
            hpDefault: 1.0,
            hpMin: 0.1,
            hpMax: 15.0,
            hpStep: 0.1,
            lpDefault: 50.0,
            lpMin: 2.0,
            lpMax: 50.0,
            lpStep: 0.5
        };
    }
    
    // Standard CSN Broadband (Trillium 120s / STS-2)
    return {
        text: "0.0083 - 50.0 Hz (Banda Ancha 120s)",
        hpDefault: 0.01,
        hpMin: 0.01,
        hpMax: 10.0,
        hpStep: 0.05,
        lpDefault: 50.0,
        lpMin: 1.0,
        lpMax: 50.0,
        lpStep: 0.5
    };
}

class SismoRedApp {
    constructor() {
        this.activeRegion = 'all';
        this.filterNetwork = 'all';
        this.filterSensor = 'all';
        this.searchQuery = '';
        this.apiFreqFilter = 'broadband';
        
        this.visibleCanvasMap = new Map();
        
        this.init();
    }

    init() {
        this.renderRegionSidebar();
        this.setupEventListeners();
        this.updateTimeClock();

        const toggleSidebar = document.getElementById('btn-toggle-sidebar');
        if (toggleSidebar) {
            toggleSidebar.addEventListener('click', () => {
                const sidebar = document.getElementById('region-sidebar');
                if (sidebar.style.display === 'none') {
                    sidebar.style.display = 'flex';
                } else {
                    sidebar.style.display = 'none';
                }
            });
        }
    
        setInterval(() => this.updateTimeClock(), 1000);
        
        this.renderTransectView();

        // Poll API every 20 seconds for visible stations
        setInterval(() => {
            if (this.visibleCanvasMap.size > 0 && window.seismicEngine) {
                const visibleStations = Array.from(this.visibleCanvasMap.values());
                window.seismicEngine.pollLiveFDSNForVisible(visibleStations);
            }
        }, 20000); 
    }

    setupEventListeners() {
        document.addEventListener('input', (e) => {
            if (e.target.classList.contains('hp-slider') || e.target.classList.contains('lp-slider')) {
                const code = e.target.getAttribute('data-code');
                const hpEl = document.querySelector(`.hp-slider[data-code="${code}"]`);
                const lpEl = document.querySelector(`.lp-slider[data-code="${code}"]`);
                if (!hpEl || !lpEl) return;
                
                const hp = parseFloat(hpEl.value);
                const lp = parseFloat(lpEl.value);
                
                const hpValSpan = document.getElementById(`hp-val-${code}`);
                const lpValSpan = document.getElementById(`lp-val-${code}`);
                if (hpValSpan) hpValSpan.textContent = hp < 0.1 ? hp.toFixed(3) : hp.toFixed(2);
                if (lpValSpan) lpValSpan.textContent = lp < 1.0 ? lp.toFixed(2) : lp.toFixed(1);
                
                if (window.seismicEngine) {
                    window.seismicEngine.setStationFilter(code, hp, lp);
                    
                    const canvas = document.querySelector(`.station-canvas-render[data-station-code="${code}"]`);
                    const st = getStationById(code);
                    if (canvas && st) {
                        window.seismicEngine.renderCanvasTrace(canvas, st, { showAxes: false, component: 'Z' });
                    }
                }
            } else if (e.target.classList.contains('gain-slider')) {
                const code = e.target.getAttribute('data-code');
                const gain = parseFloat(e.target.value);
                const gainValSpan = document.getElementById(`gain-val-${code}`);
                if (gainValSpan) gainValSpan.textContent = `${gain.toFixed(1)}x`;
                
                if (window.seismicEngine) {
                    window.seismicEngine.setStationGain(code, gain);
                    
                    const canvas = document.querySelector(`.station-canvas-render[data-station-code="${code}"]`);
                    const st = getStationById(code);
                    if (canvas && st) {
                        window.seismicEngine.renderCanvasTrace(canvas, st, { showAxes: false, component: 'Z' });
                    }
                }
            }
        });
    
        // Auto-Scale Toggle Button
        const autoScaleBtn = document.getElementById('btn-autoscale-toggle');
        if (autoScaleBtn) {
            autoScaleBtn.addEventListener('click', () => {
                const isAuto = window.seismicEngine.toggleAutoScale();
                if (isAuto) {
                    autoScaleBtn.classList.add('active');
                    autoScaleBtn.textContent = '✨ Auto-Escala: ON';
                } else {
                    autoScaleBtn.classList.remove('active');
                    autoScaleBtn.textContent = '🎚️ Auto-Escala: OFF (Manual)';
                }
                this.forceRenderVisible();
            });
        }

        // Manual Gain Slider
        const slider = document.getElementById('scale-gain-slider');
        const sliderVal = document.getElementById('scale-slider-val');
        if (slider) {
            slider.addEventListener('input', (e) => {
                const val = parseFloat(e.target.value);
                window.seismicEngine.setGain(val);
                if (sliderVal) sliderVal.textContent = `${val.toFixed(1)}x`;

                if (window.seismicEngine.autoScale) {
                    window.seismicEngine.setAutoScale(false);
                    if (autoScaleBtn) {
                        autoScaleBtn.classList.remove('active');
                        autoScaleBtn.textContent = '🎚️ Auto-Escala: OFF (Manual)';
                    }
                }
                this.forceRenderVisible();
            });
        }

        // Timeframe Buttons (10s to 24h)
        document.querySelectorAll('.btn-timeframe').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.btn-timeframe').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                const tf = btn.getAttribute('data-timeframe');
                window.seismicEngine.setTimeframe(tf);
                
                // Update frequency overlays and DSP sliders for all visible stations to match active timeframe
                this.updateStationCardControlsForTimeframe(tf);

                // Immediately fetch new timeframe for visible stations
                const visibleStations = Array.from(this.visibleCanvasMap.values());
                if (window.seismicEngine) window.seismicEngine.pollLiveFDSNForVisible(visibleStations);
            });
        });

        // Unit Buttons
        document.querySelectorAll('.btn-unit').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.btn-unit').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                const u = btn.getAttribute('data-unit');
                window.seismicEngine.setDisplayUnit(u);
                this.forceRenderVisible();
            });
        });

        const search = document.getElementById('search-stations');
        if (search) search.addEventListener('input', (e) => { this.searchQuery = e.target.value.toLowerCase().trim(); this.applyFilters(); });
    }

    updateStationCardControlsForTimeframe(tf) {
        this.visibleCanvasMap.forEach((st) => {
            const rangeInfo = getStationFrequencyRange(st, tf);
            const overlay = document.querySelector(`#osc-container-${st.code} .oscilloscope-overlay`);
            if (overlay) {
                overlay.textContent = `Rango Medido: ${rangeInfo.text}`;
            }

            const hpSlider = document.querySelector(`.hp-slider[data-code="${st.code}"]`);
            const lpSlider = document.querySelector(`.lp-slider[data-code="${st.code}"]`);
            const hpVal = document.getElementById(`hp-val-${st.code}`);
            const lpVal = document.getElementById(`lp-val-${st.code}`);

            if (hpSlider && lpSlider) {
                hpSlider.min = rangeInfo.hpMin;
                hpSlider.max = rangeInfo.hpMax;
                hpSlider.step = rangeInfo.hpStep;
                hpSlider.value = rangeInfo.hpDefault;

                lpSlider.min = rangeInfo.lpMin;
                lpSlider.max = rangeInfo.lpMax;
                lpSlider.step = rangeInfo.lpStep;
                lpSlider.value = rangeInfo.lpDefault;

                if (hpVal) hpVal.textContent = (rangeInfo.hpStep < 0.01) ? rangeInfo.hpDefault.toFixed(3) : rangeInfo.hpDefault.toFixed(2);
                if (lpVal) lpVal.textContent = (rangeInfo.lpStep < 0.01) ? rangeInfo.lpDefault.toFixed(2) : rangeInfo.lpDefault.toFixed(1);

                if (window.seismicEngine) {
                    window.seismicEngine.setStationFilter(st.code, rangeInfo.hpDefault, rangeInfo.lpDefault);
                }
            }
        });
    }

    forceRenderVisible() {
        this.visibleCanvasMap.forEach((st, canvas) => {
            window.seismicEngine.renderCanvasTrace(canvas, st, { showAxes: false, component: 'Z' });
        });
    }

    updateTimeClock() {
        const now = new Date();
        const clt = now.toLocaleTimeString('es-CL', { hour12: false });
        const utc = now.toISOString().substring(11, 19);
        const el = document.getElementById('live-time-display');
        if (el) el.textContent = `${clt} CLT • ${utc} UTC (Tiempo Universal)`;
    }

    applyFilters() {
        this.renderTransectView();
    }

    filterStationList(list) {
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
        Object.entries(CHILE_REGIONS).forEach(([code, reg]) => {
            html += `<option value="${code}">${reg.roman} - ${reg.name}</option>`;
        });
        select.innerHTML = html;
        select.addEventListener('change', (e) => this.selectRegion(e.target.value));
    }

    selectRegion(regCode) {
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
            const code = canvas.getAttribute('data-station-code');
            const st = getStationById(code);
            if (st) {
                this.visibleCanvasMap.set(canvas, st);
                if (window.seismicEngine) window.seismicEngine.renderCanvasTrace(canvas, st, { showAxes: false, component: 'Z' });
            }
        });
        
        const visibleStations = Array.from(this.visibleCanvasMap.values());
        if (window.seismicEngine) window.seismicEngine.pollLiveFDSNForVisible(visibleStations);
    }

    renderStationCardHtml(st) {
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

        const tf = (window.seismicEngine ? window.seismicEngine.timeframe : '1m');
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
