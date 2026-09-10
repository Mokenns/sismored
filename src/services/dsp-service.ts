import DspWorker from '../dsp-worker?worker';

export interface FilterResult {
    filteredData: Float32Array;
    effectiveSampleRate: number;
}

export class DspService {
    private worker: Worker;
    private pending: Map<number, (res: FilterResult) => void> = new Map();
    private msgId: number = 0;

    constructor() {
        this.worker = new DspWorker();
        this.worker.onmessage = (e: MessageEvent) => {
            const { id, filteredData, effectiveSampleRate } = e.data;
            if (this.pending.has(id)) {
                this.pending.get(id)!({ filteredData, effectiveSampleRate });
                this.pending.delete(id);
            }
        };
    }

    filterWaveform(
        rawData: Float32Array,
        sampleRate: number,
        hpFreq: number,
        lpFreq: number,
        decimationFactor: number = 1
    ): Promise<FilterResult> {
        return new Promise(resolve => {
            const id = ++this.msgId;
            this.pending.set(id, resolve);

            this.worker.postMessage({
                id,
                rawData,
                sampleRate,
                hpFreq,
                lpFreq,
                applyDemean: false,
                decimationFactor
            });
        });
    }

    destroy() {
        this.worker.terminate();
        this.pending.clear();
    }
}
