# 🇨🇱 SismoRed Chile - Telemetría FDSNWS en Tiempo Real

Plataforma sismológica web para la visualización en tiempo real de telemetría de sismógrafos en Chile (Centro Sismológico Nacional CSN y Global Seismographic Network GSN) a través de servicios estándar FDSNWS (IRIS).

## 🚀 Características
- **Osciloscopio Sísmico en Tiempo Real**: Visualización de componentes verticales (Z) a 100 sps con algoritmo de decimación Min-Max de alta fidelidad.
- **Modo Webicorder (24h / 3h)**: Registro continuo multi-línea estilo helicoidal (12 filas para 24 horas, 3 filas para 3 horas) utilizando datos de período largo (`LHZ`).
- **DSP y Filtrado Sísmico en el Navegador**: Filtros IIR Pasa-Altos (HP) y Pasa-Bajos (LP) ajustables individualmente por estación, con rangos adaptativos según el canal y teorema de Nyquist.
- **Control de Ganancia / Escala Multi-Nivel**: Auto-escala dinámica con control de ganancia individual por estación y ganancia global.
- **Detección Rápida de Estaciones No Disponibles**: Sondeo concurrente asíncrono con descarte automático de estaciones fuera de línea.
- **Organización Geoestructural**: Visualización organizada por regiones chilenas de norte a sur y transectas geomorfológicas (Costa, Valle Central, Cordillera).

## 🛠️ Tecnologías
- HTML5 / CSS3 Grid & Flexbox (Dark Theme)
- JavaScript Vanilla (Canvas 2D Rendering & IIR DSP Filters)
- FDSNWS Web Services (IRIS Data Management Center)

## 📦 Despliegue
Esta aplicación es 100% estática (frontend-only) y puede ser alojada directamente en **Netlify**, **Vercel**, o **GitHub Pages**.
