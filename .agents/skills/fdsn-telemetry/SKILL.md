---
name: fdsn-telemetry
description: Parses FDSNWS feeds, miniSEED packets, and computes seismic signal filtering.
---

# FDSNWS Rules

1. Base URL for CSN: `http://evtdb.csn.uchile.cl/fdsnws/dataselect/1/query` (or proxy).
2. Always handle missing data gaps by drawing dashed interpolations or breaks, not flat zeroes.
3. Implement Butterworth filtering in a Web Worker if processing >4 continuous channels simultaneously.
