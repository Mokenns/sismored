export function getStationFrequencyRange(st: any, tf: string) {
    if (tf === '24h' || tf === '3h') {
        return { text: "1.0 - 5.0 Hz", hpDefault: 1.0, hpMin: 0.0, hpMax: 2.0, hpStep: 0.005, lpDefault: 5.0, lpMin: 0.0, lpMax: 20.0, lpStep: 0.1 };
    }
    if (st.network === 'IU' || st.network === 'II') {
        return { text: "1.0 - 5.0 Hz", hpDefault: 1.0, hpMin: 0.0, hpMax: 10.0, hpStep: 0.05, lpDefault: 5.0, lpMin: 0.0, lpMax: 20.0, lpStep: 0.5 };
    }
    if (st.sensorClass === 'accelerometer' || (st.code && st.code.startsWith('GO'))) {
        return { text: "1.0 - 5.0 Hz", hpDefault: 1.0, hpMin: 0.0, hpMax: 10.0, hpStep: 0.05, lpDefault: 5.0, lpMin: 0.0, lpMax: 40.0, lpStep: 0.5 };
    }
    if (st.sensorClass === 'short_period') {
        return { text: "1.0 - 5.0 Hz", hpDefault: 1.0, hpMin: 0.0, hpMax: 15.0, hpStep: 0.1, lpDefault: 5.0, lpMin: 0.0, lpMax: 40.0, lpStep: 0.5 };
    }
    return { text: "1.0 - 5.0 Hz", hpDefault: 1.0, hpMin: 0.0, hpMax: 10.0, hpStep: 0.05, lpDefault: 5.0, lpMin: 0.0, lpMax: 40.0, lpStep: 0.5 };
}

export function renderStationCardHtml(st: any, timeframe: string): string {
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

    const rangeInfo = getStationFrequencyRange(st, timeframe);

    return `
        <article class="station-card" id="card-${st.network}_${st.code}">
            <div class="station-card-header">
                <div>
                    <div class="station-code-group">
                        <a href="#/station/${st.code}" class="station-code-link" title="Ver detalle de estación" style="text-decoration: none; color: inherit;">
                            <span class="station-code">${st.code}</span>
                        </a>
                        <span class="network-badge ${netClass}">${st.network}</span>
                        <span class="zone-tag ${zonePillClass}">${zoneIcon} ${st.geomorphicZone}</span>
                    </div>
                    <div class="station-locality">${st.locality} (${st.operator.replace(' (CSN - U. de Chile)', '').replace(' Network', '')})</div>
                </div>
            </div>

            <div class="oscilloscope-container" id="osc-container-${st.code}" style="min-height: 110px; cursor: pointer;" onclick="window.location.hash='#/station/${st.code}'">
                <canvas class="oscilloscope-canvas station-canvas-render" data-station-code="${st.code}" width="380" height="105" style="width:100%; display:block;"></canvas>
                <div class="oscilloscope-overlay" id="range-overlay-${st.code}">Rango Medido: ${rangeInfo.text}</div>
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
                <div class="meta-item" id="sensor-meta-${st.code}">Sensor: <span>${st.sensorClass === 'broadband' ? 'Banda Ancha' : (st.sensorClass === 'accelerometer' ? 'Acelerógrafo' : 'Corto Periodo')}</span></div>
                <div class="meta-item">Elevación: <span>${Math.round(st.elevation)} m</span></div>
                <div class="meta-item">Longitud: <span>${st.lon.toFixed(3)}° W</span></div>
                <div class="meta-item">Latitud: <span>${st.lat.toFixed(3)}° S</span></div>
            </div>
        </article>
    `;
}
