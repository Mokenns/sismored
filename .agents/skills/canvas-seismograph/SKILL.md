---
name: canvas-seismograph
description: Enforces high-performance Canvas rendering for seismographs and helicorders.
---

# Rendering Rules

1. Use a static canvas for gridlines/axes and an overlay canvas for dynamic waveform paths.
2. Scale canvas backing stores by `window.devicePixelRatio` to prevent blurriness on Retina displays.
3. Use Min/Max downsampling (LTTB) when sample count exceeds canvas horizontal pixel width.
