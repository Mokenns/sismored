function applyCosineTaper(data: Float32Array, taperFraction: number = 0.015) {
    const n = data.length;
    if (n < 10) return;
    const taperLen = Math.min(Math.floor(n / 2), Math.max(10, Math.floor(n * taperFraction)));
    for (let i = 0; i < taperLen; i++) {
        const factor = 0.5 * (1 - Math.cos((Math.PI * i) / taperLen));
        data[i] *= factor;
        data[n - 1 - i] *= factor;
    }
}

self.onmessage = function(e: MessageEvent) {
    const { id, rawData, sampleRate, hpFreq, lpFreq, applyDemean } = e.data;
    
    let data = new Float32Array(rawData);
    const n = data.length;
    if (n === 0) {
        postMessage({ id, filteredData: data }, [data.buffer]);
        return;
    }
    
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
        const denom = (n * sumX2 - sumX * sumX);
        if (denom !== 0) {
            const slope = (n * sumXY - sumX * sumY) / denom;
            const intercept = (sumY - slope * sumX) / n;
            for (let i = 0; i < n; i++) {
                data[i] -= (slope * i + intercept);
            }
        }
    }
    
    // Apply smooth cosine taper to boundaries (standard in GlobalQuake, ObsPy, SAC)
    applyCosineTaper(data, 0.015);
    
    // 3. Robust zero-phase Butterworth filtering (Direct Form II Transposed)
    data = applyBandpass(data, sampleRate, hpFreq, lpFreq);
    
    postMessage({ id, filteredData: data }, [data.buffer]);
};

function applyBandpass(data: Float32Array, sampleRate: number, hpFreq: number, lpFreq: number): Float32Array {
    if (!sampleRate || sampleRate <= 0) return data;
    const nyquist = sampleRate * 0.499;
    
    let effectiveHp = hpFreq > 0.0001 ? Math.min(hpFreq, nyquist * 0.95) : 0;
    let effectiveLp = lpFreq > 0.0001 ? Math.min(lpFreq, nyquist) : 0;
    
    // Ensure passband validity: if HP >= LP, prioritize LP or relax HP
    if (effectiveHp > 0 && effectiveLp > 0 && effectiveHp >= effectiveLp) {
        effectiveHp = effectiveLp * 0.5;
    }
    
    let current = data;
    
    // High-pass (Butterworth 2nd order)
    if (effectiveHp > 0.001) {
        const w0 = Math.min(Math.PI * 0.95, Math.max(0.0001, (2 * Math.PI * effectiveHp) / sampleRate));
        const alpha = Math.sin(w0) / (2 * 0.70710678);
        const cosw0 = Math.cos(w0);
        const a0 = 1 + alpha;
        
        const b0 = ((1 + cosw0) / 2) / a0;
        const b1 = (-(1 + cosw0)) / a0;
        const b2 = ((1 + cosw0) / 2) / a0;
        const a1 = (-2 * cosw0) / a0;
        const a2 = (1 - alpha) / a0;
        
        current = filtfilt(current, b0, b1, b2, a1, a2);
    }
    
    // Low-pass (Butterworth 2nd order)
    if (effectiveLp > 0.001 && effectiveLp < nyquist) {
        const w0 = Math.min(Math.PI * 0.95, Math.max(0.0001, (2 * Math.PI * effectiveLp) / sampleRate));
        const alpha = Math.sin(w0) / (2 * 0.70710678);
        const cosw0 = Math.cos(w0);
        const a0 = 1 + alpha;
        
        const b0 = ((1 - cosw0) / 2) / a0;
        const b1 = (1 - cosw0) / a0;
        const b2 = ((1 - cosw0) / 2) / a0;
        const a1 = (-2 * cosw0) / a0;
        const a2 = (1 - alpha) / a0;
        
        current = filtfilt(current, b0, b1, b2, a1, a2);
    }
    
    return current;
}

// Zero-phase forward-backward filtering using Direct Form II Transposed with SciPy-style odd extension padding
function filtfilt(x: Float32Array, b0: number, b1: number, b2: number, a1: number, a2: number): Float32Array {
    const n = x.length;
    if (n <= 4) return x;
    
    // Choose padding length based on signal size (up to 200 samples)
    const padlen = Math.min(n - 1, Math.max(30, Math.min(300, Math.floor(n * 0.1))));
    const extLen = n + 2 * padlen;
    const ext = new Float64Array(extLen);
    
    // 1. Odd extension at start: 2*x[0] - x[padlen - i]
    const x0 = x[0];
    for (let i = 0; i < padlen; i++) {
        ext[i] = 2 * x0 - x[padlen - i];
    }
    
    // 2. Original data in center
    for (let i = 0; i < n; i++) {
        ext[padlen + i] = x[i];
    }
    
    // 3. Odd extension at end: 2*x[n-1] - x[n - 2 - i]
    const xEnd = x[n - 1];
    for (let i = 0; i < padlen; i++) {
        ext[padlen + n + i] = 2 * xEnd - x[n - 2 - i];
    }
    
    // Calculate DC gain for boundary initialization
    const dcGain = (b0 + b1 + b2) / (1 + a1 + a2);
    
    // Forward pass
    const yForward = new Float64Array(extLen);
    let z1 = 0.0, z2 = 0.0;
    
    const startVal = ext[0];
    const yStart = startVal * dcGain;
    z1 = startVal * (b1 + b2) - yStart * (a1 + a2);
    z2 = startVal * b2 - yStart * a2;
    
    for (let i = 0; i < extLen; i++) {
        const xi = ext[i];
        const yi = b0 * xi + z1;
        z1 = b1 * xi - a1 * yi + z2;
        z2 = b2 * xi - a2 * yi;
        yForward[i] = yi;
    }
    
    // Backward pass
    const yBackward = new Float64Array(extLen);
    const lastVal = yForward[extLen - 1];
    const yLast = lastVal * dcGain;
    z1 = lastVal * (b1 + b2) - yLast * (a1 + a2);
    z2 = lastVal * b2 - yLast * a2;
    
    for (let i = extLen - 1; i >= 0; i--) {
        const xi = yForward[i];
        const yi = b0 * xi + z1;
        z1 = b1 * xi - a1 * yi + z2;
        z2 = b2 * xi - a2 * yi;
        yBackward[i] = yi;
    }
    
    // Extract central original segment without edge padding artifacts
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) {
        const v = yBackward[padlen + i];
        out[i] = isNaN(v) ? 0 : v;
    }
    return out;
}
