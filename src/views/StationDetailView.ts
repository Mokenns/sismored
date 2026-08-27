import { SeismicEngine } from '../seismic-engine';
// @ts-ignore
import { getStationById } from '../stations-data.js';
import { renderStationCardHtml } from '../components/StationCard';

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
        if (!st) {
            this.container.innerHTML = `<div style="padding: 2rem; text-align: center;"><h2>Estación no encontrada: ${this.stationCode}</h2><button onclick="window.location.hash='#/'">Volver</button></div>`;
            return;
        }

        // Hide region sidebar/filters if they exist
        const topNav = document.querySelector('.top-nav-bar') as HTMLElement;
        if (topNav) topNav.style.display = 'none';

        this.container.innerHTML = `
            <div style="padding: 1rem;">
                <button onclick="window.history.back()" style="margin-bottom: 1rem; padding: 0.5rem 1rem; background: #1e293b; color: white; border: none; border-radius: 4px; cursor: pointer;">
                    ← Volver
                </button>
                <div style="max-width: 1200px; margin: 0 auto;">
                    ${renderStationCardHtml(st, this.engine.timeframe)}
                </div>
            </div>
        `;

        // The card has max-height and widths in CSS that might constrain it, we can inject some overrides or just let it be big.
        const card = this.container.querySelector('.station-card') as HTMLElement;
        if (card) {
            card.style.maxWidth = '100%';
            const canvas = card.querySelector('canvas') as HTMLCanvasElement;
            if (canvas) {
                // Adjust height for detail view if desired
                canvas.height = 300; 
                canvas.style.height = '300px';
            }
        }

        // Set up visible canvases for engine
        const visibleMap = new Map<HTMLCanvasElement, any>();
        const canvas = this.container.querySelector('.station-canvas-render') as HTMLCanvasElement;
        if (canvas) {
            visibleMap.set(canvas, st);
        }
        
        this.engine.setActiveCanvases(visibleMap);
        this.startPolling(st);
    }

    startPolling(st: any) {
        if (this.pollingInterval) clearInterval(this.pollingInterval);
        
        const doPoll = () => {
            const tf = this.engine.timeframe;
            if (!['10s', '1m', '10m'].includes(tf)) return; // No automatic refresh for these timeframes
            
            const canvas = this.container.querySelector('.station-canvas-render') as HTMLCanvasElement;
            if (!canvas) return; // Unmounted
            this.engine.pollLiveFDSNForVisible([st], false);
        };

        // Always trigger an initial fetch regardless of timeframe
        this.engine.pollLiveFDSNForVisible([st], true);
        this.pollingInterval = setInterval(doPoll, 5000); // 5s polling for detail view
    }

    destroy() {
        if (this.pollingInterval) {
            clearInterval(this.pollingInterval);
        }
        const topNav = document.querySelector('.top-nav-bar') as HTMLElement;
        if (topNav) topNav.style.display = 'flex'; // Restore nav
    }
}
