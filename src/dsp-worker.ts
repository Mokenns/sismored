// dsp-worker.ts
// @ts-nocheck
/// <reference lib="webworker" />

self.onmessage = function(e: MessageEvent) {
    const { id, rawData, sampleRate, hpFreq, lpFreq, applyDemean } = e.data;
    
    let data = new Float32Array(rawData);
    const n = data.length;
    
    // 1. Demean
    if (applyDemean && n > 0) {
        let sum = 0;
        for (let i = 0; i < n; i++) sum += data[i];
        const mean = sum / n;
        for (let i = 0; i < n; i++) data[i] -= mean;
    }
    
    // 2. Detrend (Linear)
    if (applyDemean && n > 1) {
        let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
        for (let i = 0; i < n; i++) {
            sumX += i;
            sumY += data[i];
            sumXY += i * data[i];
            sumX2 += i * i;
        }
        const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
        const intercept = (sumY - slope * sumX) / n;
        for (let i = 0; i < n; i++) {
            data[i] -= (slope * i + intercept);
        }
    }
    
    // 3. Simple Butterworth-style Bandpass (using 2-pole HP and 2-pole LP cascade for stability)
    if (hpFreq > 0 || lpFreq < sampleRate / 2) {
        data = applyBandpass(data, sampleRate, hpFreq, lpFreq);
    }
    
    postMessage({ id, filteredData: data }, [data.buffer]);
};

function applyBandpass(data: Float32Array, sampleRate: number, hpFreq: number, lpFreq: number): Float32Array {
    // 2nd order HP and LP (Biquad)
    let output = new Float32Array(data.length);
    
    // High-pass
    if (hpFreq > 0) {
        const w0 = 2 * Math.PI * hpFreq / sampleRate;
        const alpha = Math.sin(w0) / (2 * 0.707); // Q = 0.707 (Butterworth)
        const cosw0 = Math.cos(w0);
        
        const b0 = (1 + cosw0) / 2;
        const b1 = -(1 + cosw0);
        const b2 = (1 + cosw0) / 2;
        const a0 = 1 + alpha;
        const a1 = -2 * cosw0;
        const a2 = 1 - alpha;
        
        output = applyBiquad(data, b0/a0, b1/a0, b2/a0, a1/a0, a2/a0);
    } else {
        output.set(data);
    }
    
    // Low-pass
    if (lpFreq < sampleRate / 2) {
        const w0 = 2 * Math.PI * lpFreq / sampleRate;
        const alpha = Math.sin(w0) / (2 * 0.707);
        const cosw0 = Math.cos(w0);
        
        const b0 = (1 - cosw0) / 2;
        const b1 = 1 - cosw0;
        const b2 = (1 - cosw0) / 2;
        const a0 = 1 + alpha;
        const a1 = -2 * cosw0;
        const a2 = 1 - alpha;
        
        output = applyBiquad(output, b0/a0, b1/a0, b2/a0, a1/a0, a2/a0);
    }
    
    return output;
}

function applyBiquad(x: Float32Array, b0: number, b1: number, b2: number, a1: number, a2: number): Float32Array {
    const y = new Float32Array(x.length);
    for (let i = 0; i < x.length; i++) {
        y[i] = b0 * x[i] 
             + b1 * (i > 0 ? x[i-1] : x[0]) 
             + b2 * (i > 1 ? x[i-2] : x[0]) 
             - a1 * (i > 0 ? y[i-1] : 0) 
             - a2 * (i > 1 ? y[i-2] : 0);
    }
    return y;
}
