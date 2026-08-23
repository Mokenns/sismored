import urllib.request
import json
import math
import os

localities = [
    ('Arica', -18.4783, -70.3126, 'XV', 'Costa'),
    ('Putre / Altiplano', -18.1956, -69.5594, 'XV', 'Cordillera'),
    ('Visviri', -17.5956, -69.4833, 'XV', 'Cordillera'),
    ('Iquique', -20.2167, -70.1422, 'I', 'Costa'),
    ('Pisagua', -19.5986, -70.2119, 'I', 'Costa'),
    ('Pica', -20.4897, -69.3297, 'I', 'Valle'),
    ('Pozo Almonte', -20.2597, -69.7861, 'I', 'Valle'),
    ('Mamiña', -20.0719, -69.2158, 'I', 'Cordillera'),
    ('Tocopilla', -22.0919, -70.1978, 'II', 'Costa'),
    ('Mejillones', -23.1000, -70.4500, 'II', 'Costa'),
    ('Antofagasta', -23.6500, -70.4000, 'II', 'Costa'),
    ('Taltal', -25.4056, -70.4833, 'II', 'Costa'),
    ('Sierra Gorda', -22.8944, -69.3178, 'II', 'Valle'),
    ('Calama (Limón Verde)', -22.4544, -68.9294, 'II', 'Valle'),
    ('San Pedro de Atacama', -22.9087, -68.1997, 'II', 'Cordillera'),
    ('Ollagüe', -21.2222, -68.2522, 'II', 'Cordillera'),
    ('Socaire', -23.5900, -67.8900, 'II', 'Cordillera'),
    ('Chañaral', -26.3478, -70.6219, 'III', 'Costa'),
    ('Caldera', -27.0667, -70.8167, 'III', 'Costa'),
    ('Huasco', -28.4689, -71.2197, 'III', 'Costa'),
    ('Copiapó', -27.3667, -70.3333, 'III', 'Valle'),
    ('Vallenar', -28.5756, -70.7581, 'III', 'Valle'),
    ('El Salvador', -26.2458, -69.6253, 'III', 'Cordillera'),
    ('Alto del Carmen', -28.7594, -70.4864, 'III', 'Cordillera'),
    ('La Serena', -29.9027, -71.2520, 'IV', 'Costa'),
    ('Coquimbo', -29.9533, -71.3436, 'IV', 'Costa'),
    ('Tongoy', -30.2547, -71.4931, 'IV', 'Costa'),
    ('Los Vilos', -31.9133, -71.5164, 'IV', 'Costa'),
    ('Ovalle', -30.5983, -71.2003, 'IV', 'Valle'),
    ('Illapel', -31.6308, -71.1653, 'IV', 'Valle'),
    ('Combarbalá', -31.1783, -71.0028, 'IV', 'Valle'),
    ('Vicuña (Valle de Elqui)', -30.0319, -70.7081, 'IV', 'Cordillera'),
    ('Las Campanas / Tololo', -29.0100, -70.7000, 'IV', 'Cordillera'),
    ('Monte Patria', -30.6953, -70.9575, 'IV', 'Cordillera'),
    ('Salamanca', -31.7789, -70.9639, 'IV', 'Cordillera'),
    ('Valparaíso', -33.0472, -71.6127, 'V', 'Costa'),
    ('Viña del Mar', -33.0246, -71.5518, 'V', 'Costa'),
    ('Concón', -32.9228, -71.5175, 'V', 'Costa'),
    ('Quintero', -32.7833, -71.5333, 'V', 'Costa'),
    ('Papudo', -32.5072, -71.4489, 'V', 'Costa'),
    ('San Antonio', -33.5947, -71.6075, 'V', 'Costa'),
    ('Quillota', -32.8800, -71.2486, 'V', 'Valle'),
    ('Villa Alemana / Quilpué', -33.0450, -71.3739, 'V', 'Valle'),
    ('Limache', -32.9833, -71.2667, 'V', 'Valle'),
    ('La Ligua', -32.4522, -71.2311, 'V', 'Valle'),
    ('San Felipe', -32.7508, -70.7256, 'V', 'Cordillera'),
    ('Los Andes / Portillo', -32.8339, -70.5983, 'V', 'Cordillera'),
    ('Melipilla', -33.7000, -71.2167, 'RM', 'Costa'),
    ('Curacaví', -33.4000, -71.1333, 'RM', 'Costa'),
    ('Santiago Centro', -33.4489, -70.6693, 'RM', 'Valle'),
    ('Providencia / Ñuñoa', -33.4333, -70.6167, 'RM', 'Valle'),
    ('Maipú / Pudahuel', -33.5100, -70.7500, 'RM', 'Valle'),
    ('Peldehue / Colina', -33.1833, -70.6833, 'RM', 'Valle'),
    ('Talagante / Peñaflor', -33.6667, -70.9333, 'RM', 'Valle'),
    ('Buin / Paine', -33.7333, -70.7333, 'RM', 'Valle'),
    ('Las Condes / Lo Barnechea', -33.3700, -70.5200, 'RM', 'Cordillera'),
    ('Farellones / La Parva', -33.3500, -70.3100, 'RM', 'Cordillera'),
    ('San José de Maipo / El Yeso', -33.6333, -70.3500, 'RM', 'Cordillera'),
    ('Pichilemu', -34.3872, -72.0047, 'VI', 'Costa'),
    ('Bucalemu / Paredones', -34.6400, -71.9800, 'VI', 'Costa'),
    ('Santa Cruz', -34.6392, -71.3653, 'VI', 'Valle'),
    ('San Vicente de Tagua Tagua', -34.4400, -71.0700, 'VI', 'Valle'),
    ('Rancagua', -34.1708, -70.7444, 'VI', 'Valle'),
    ('Rengo', -34.4100, -70.8600, 'VI', 'Valle'),
    ('San Fernando', -34.5842, -70.9889, 'VI', 'Valle'),
    ('Machalí / Coya / Sewell', -34.1800, -70.5000, 'VI', 'Cordillera'),
    ('Constitución', -35.3333, -72.4167, 'VII', 'Costa'),
    ('Iloca / Licantén', -34.9800, -72.1800, 'VII', 'Costa'),
    ('Curanipe / Pelluhue', -35.8400, -72.6300, 'VII', 'Costa'),
    ('Talca', -35.4264, -71.6554, 'VII', 'Valle'),
    ('Curicó', -34.9828, -71.2394, 'VII', 'Valle'),
    ('Linares', -35.8467, -71.5931, 'VII', 'Valle'),
    ('Cauquenes', -35.9672, -72.3156, 'VII', 'Valle'),
    ('Molina / Radal Siete Tazas', -35.1100, -71.0500, 'VII', 'Cordillera'),
    ('San Clemente / Laguna del Maule', -35.5300, -70.8000, 'VII', 'Cordillera'),
    ('Cobquecura', -36.1333, -72.7833, 'XVI', 'Costa'),
    ('Quirihue', -36.2800, -72.5400, 'XVI', 'Costa'),
    ('Chillán', -36.6067, -72.1033, 'XVI', 'Valle'),
    ('San Carlos', -36.4239, -71.9589, 'XVI', 'Valle'),
    ('Bulnes / Quillón', -36.7400, -72.3000, 'XVI', 'Valle'),
    ('Pinto / Nevados de Chillán', -36.9000, -71.4000, 'XVI', 'Cordillera'),
    ('San Fabián de Alico', -36.5500, -71.5500, 'XVI', 'Cordillera'),
    ('Talcahuano / Tomé', -36.7247, -73.1168, 'VIII', 'Costa'),
    ('Concepción / San Pedro', -36.8270, -73.0503, 'VIII', 'Costa'),
    ('Coronel / Lota', -37.0300, -73.1500, 'VIII', 'Costa'),
    ('Arauco / Lebu', -37.6083, -73.6542, 'VIII', 'Costa'),
    ('Cañete / Tirúa', -37.8000, -73.4000, 'VIII', 'Costa'),
    ('Los Ángeles', -37.4697, -72.3536, 'VIII', 'Valle'),
    ('Mulchén / Cabrero', -37.7200, -72.2400, 'VIII', 'Valle'),
    ('Antuco / Laguna Laja', -37.3300, -71.6800, 'VIII', 'Cordillera'),
    ('Alto Biobío / Ralco', -37.8800, -71.4500, 'VIII', 'Cordillera'),
    ('Puerto Saavedra', -38.7889, -73.3958, 'IX', 'Costa'),
    ('Carahue / Toltén', -39.2200, -73.2200, 'IX', 'Costa'),
    ('Temuco / Padre Las Casas', -38.7359, -72.5904, 'IX', 'Valle'),
    ('Angol / Collipulli', -37.7981, -72.7094, 'IX', 'Valle'),
    ('Victoria / Lautaro', -38.2300, -72.3300, 'IX', 'Valle'),
    ('Villarrica / Pucón', -39.2819, -71.9744, 'IX', 'Cordillera'),
    ('Curacautín / Lonquimay', -38.4419, -71.3650, 'IX', 'Cordillera'),
    ('Melipeuco / Volcán Llaima', -38.8300, -71.7000, 'IX', 'Cordillera'),
    ('Curarrehue', -39.3500, -71.5800, 'IX', 'Cordillera'),
    ('Corral / Niebla', -39.8889, -73.4306, 'XIV', 'Costa'),
    ('Valdivia', -39.8142, -73.2459, 'XIV', 'Costa'),
    ('La Unión / Río Bueno', -40.2942, -73.0825, 'XIV', 'Valle'),
    ('Paillaco / Los Lagos', -39.8500, -72.8200, 'XIV', 'Valle'),
    ('Panguipulli / Neltume', -39.6433, -72.3333, 'XIV', 'Cordillera'),
    ('Futrono / Lago Ranco', -40.1300, -72.4000, 'XIV', 'Cordillera'),
    ('Ancud / Chiloé Norte', -41.8683, -73.8267, 'X', 'Costa'),
    ('Castro / Chiloé Centro', -42.4722, -73.7731, 'X', 'Costa'),
    ('Quellón / Chiloé Sur', -43.1200, -73.6100, 'X', 'Costa'),
    ('Maullín / Calbuco', -41.6000, -73.5000, 'X', 'Costa'),
    ('Osorno', -40.5739, -73.1335, 'X', 'Valle'),
    ('Puerto Montt / Frutillar', -41.4693, -72.9424, 'X', 'Valle'),
    ('Puerto Varas / Llanquihue', -41.3195, -72.9854, 'X', 'Valle'),
    ('Ensenada / Volcán Calbuco', -41.2100, -72.5300, 'X', 'Cordillera'),
    ('Chaitén / Palena / Futaleufú', -42.9200, -72.7000, 'X', 'Cordillera'),
    ('Puerto Cisnes / Puyuhuapi', -44.7500, -72.7000, 'XI', 'Costa'),
    ('Puerto Aysén / Chacabuco', -45.4056, -72.6958, 'XI', 'Costa'),
    ('Coyhaique', -45.5752, -72.0662, 'XI', 'Valle'),
    ('Chile Chico / Lago Gral. Carrera', -46.5408, -71.7231, 'XI', 'Cordillera'),
    ('Cochrane / Caleta Tortel', -47.2547, -72.5694, 'XI', 'Cordillera'),
    ('Puerto Natales', -51.7269, -72.5064, 'XII', 'Costa'),
    ('Punta Arenas', -53.1638, -70.9171, 'XII', 'Valle'),
    ('Porvenir (Tierra del Fuego)', -53.2981, -70.3683, 'XII', 'Valle'),
    ('Puerto Williams (Cabo de Hornos)', -54.9342, -67.6106, 'XII', 'Costa'),
    ('Rapa Nui (Isla de Pascua)', -27.1536, -109.4311, 'INSULAR', 'Costa'),
    ('Archipiélago Juan Fernández', -33.6361, -78.8319, 'INSULAR', 'Costa')
]

def determine_region(lat, lon):
    if lon < -78.0:
        return 'INSULAR'
    if lat > -19.2:
        return 'XV'
    elif lat > -21.6:
        return 'I'
    elif lat > -26.0:
        return 'II'
    elif lat > -29.3:
        return 'III'
    elif lat > -32.2:
        return 'IV'
    elif lat > -33.9:
        if -34.3 <= lat <= -33.0 and -71.1 <= lon <= -69.8:
            return 'RM'
        return 'V'
    elif lat > -35.0:
        return 'VI'
    elif lat > -36.3:
        return 'VII'
    elif lat > -37.2:
        return 'XVI'
    elif lat > -38.5:
        return 'VIII'
    elif lat > -39.6:
        return 'IX'
    elif lat > -40.6:
        return 'XIV'
    elif lat > -44.0:
        return 'X'
    elif lat > -49.0:
        return 'XI'
    else:
        return 'XII'

def determine_geomorphic_zone(lat, lon, elev):
    if lon < -78.0:
        return 'Costa'
    if lat > -27.0:
        if lon <= -70.15:
            return 'Costa'
        elif lon <= -69.25:
            return 'Valle'
        else:
            return 'Cordillera'
    elif lat > -32.0:
        if lon <= -71.15:
            return 'Costa'
        elif lon <= -70.55:
            return 'Valle'
        else:
            return 'Cordillera'
    elif lat > -36.0:
        if lon <= -71.35:
            return 'Costa'
        elif lon <= -70.55:
            return 'Valle'
        else:
            return 'Cordillera'
    elif lat > -41.0:
        if lon <= -73.0:
            return 'Costa'
        elif lon <= -72.2:
            return 'Valle'
        else:
            return 'Cordillera'
    else:
        if lon <= -73.3:
            return 'Costa'
        elif lon <= -72.0:
            return 'Valle'
        else:
            return 'Cordillera'

def get_nearest_locality_info(lat, lon):
    min_dist = float('inf')
    best_loc = None
    for loc in localities:
        d = math.hypot(lat - loc[1], (lon - loc[2]) * math.cos(math.radians(lat)))
        if d < min_dist:
            min_dist = d
            best_loc = loc
    return best_loc

all_stations = {}

# Fetch RS
rs_url = 'https://data.raspberryshake.org/fdsnws/station/1/query?network=AM&minlat=-56&maxlat=-17&minlon=-76&maxlon=-66&format=text&level=channel'
try:
    req = urllib.request.Request(rs_url, headers={'User-Agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(req, timeout=15) as resp:
        lines = resp.read().decode('utf-8').strip().split('\n')
        for l in lines[1:]:
            p = l.split('|')
            if len(p) >= 16:
                net, sta, loc, cha, lat, lon, elev = p[0], p[1], p[2], p[3], float(p[4]), float(p[5]), float(p[6] or 0)
                end_time = p[16] if len(p) > 16 else ''
                if -56.0 <= lat <= -17.5 and -76.0 <= lon <= -66.0 and (not end_time or end_time > '2024-01-01'):
                    key = f'{net}_{sta}'
                    if key not in all_stations:
                        all_stations[key] = {
                            'code': sta,
                            'network': 'AM',
                            'networkName': 'Raspberry Shake Network',
                            'operator': 'Red Ciudadana Raspberry Shake',
                            'lat': round(lat, 4),
                            'lon': round(lon, 4),
                            'elevation': round(elev, 1),
                            'channels': [],
                            'sensorType': 'Geófono Raspberry Shake',
                            'sensorClass': 'short_period',
                            'sensorDescription': 'Geófono sísmico de alta sensibilidad',
                            'status': 'online',
                            'source': 'Raspberry Shake FDSN',
                            'sampleRate': float(p[14]) if len(p) > 14 and p[14] else 100.0,
                            'latency': '180 ms',
                            'fallbackLevel': 1
                        }
                    if cha not in all_stations[key]['channels']:
                        all_stations[key]['channels'].append(cha)
except Exception as e:
    print('RS fetch error:', e)

for k, s in all_stations.items():
    if s['network'] == 'AM':
        chs = set(s['channels'])
        if 'HDF' in chs:
            s['sensorType'] = 'Raspberry Shake Boom (Infrasonido + Geófono)'
            s['sensorClass'] = 'infrasound'
            s['sensorDescription'] = 'Sensor combinado de geófono vertical 50Hz y barómetro de infrasonido microbarimétrico'
        elif 'ENZ' in chs and 'EHZ' in chs:
            s['sensorType'] = 'Raspberry Shake 4D (Velocímetro 3D + Acelerómetro)'
            s['sensorClass'] = 'accelerometer'
            s['sensorDescription'] = 'Sensor cuadriaxial: Geófono vertical 100Hz + Acelerómetro triaxial MEMS'
        elif 'ENE' in chs or 'ENN' in chs:
            s['sensorType'] = 'Raspberry Shake 3D (Velocímetro Triaxial)'
            s['sensorClass'] = 'short_period'
            s['sensorDescription'] = 'Geófono triaxial ortogonal de corto periodo (E, N, Z)'
        elif 'EHZ' in chs:
            s['sensorType'] = 'Raspberry Shake 1D (Geófono Vertical 100Hz)'
            s['sensorClass'] = 'short_period'
            s['sensorDescription'] = 'Geófono vertical de 4.5 Hz muestreado a 100 sps'
        elif 'SHZ' in chs:
            s['sensorType'] = 'Raspberry Shake 1D (Geófono Vertical 50Hz)'
            s['sensorClass'] = 'short_period'
            s['sensorDescription'] = 'Geófono vertical de 4.5 Hz muestreado a 50 sps'

# Fetch CSN / IRIS / GSN / GEOFON
iris_url = 'https://service.iris.edu/fdsnws/station/1/query?net=C,C1,CX,IU,II,GE&minlat=-56&maxlat=-17&minlon=-76&maxlon=-66&format=text&level=channel'
try:
    req2 = urllib.request.Request(iris_url, headers={'User-Agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(req2, timeout=15) as resp:
        lines = resp.read().decode('utf-8').strip().split('\n')
        for l in lines[1:]:
            p = l.split('|')
            if len(p) >= 16:
                net, sta, loc, cha, lat, lon, elev = p[0], p[1], p[2], p[3], float(p[4]), float(p[5]), float(p[6] or 0)
                sensor = p[10] if len(p) > 10 else ''
                end_time = p[16] if len(p) > 16 else ''
                if -56.0 <= lat <= -17.5 and -76.0 <= lon <= -66.0 and (not end_time or end_time > '2024-01-01'):
                    key = f'{net}_{sta}'
                    if key not in all_stations:
                        op = 'Centro Sismológico Nacional (CSN)' if net in ['C', 'C1'] else ('IPOC / GFZ Potsdam' if net == 'CX' else ('Global Seismographic Network (GSN)' if net in ['IU', 'II'] else 'GEOFON / GFZ'))
                        st_type = 'Sismómetro Banda Ancha (Broadband)' if 'Trillium' in sensor or 'STS' in sensor or cha.startswith('B') or cha.startswith('H') else ('Acelerógrafo (Strong Motion)' if 'Episensor' in sensor or cha.startswith('H') or cha.startswith('N') else 'Sismógrafo Sismológico')
                        s_class = 'broadband' if 'Banda Ancha' in st_type else ('accelerometer' if 'Acelerógrafo' in st_type else 'short_period')
                        all_stations[key] = {
                            'code': sta,
                            'network': net,
                            'networkName': op,
                            'operator': op,
                            'lat': round(lat, 4),
                            'lon': round(lon, 4),
                            'elevation': round(elev, 1),
                            'channels': [],
                            'sensorType': st_type,
                            'sensorClass': s_class,
                            'sensorDescription': sensor.strip() if sensor.strip() else 'Sensor sismológico estándar',
                            'status': 'online',
                            'source': 'CSN / IRIS FDSNWS',
                            'sampleRate': float(p[14]) if len(p) > 14 and p[14] else 100.0,
                            'latency': '120 ms',
                            'fallbackLevel': 1
                        }
                    if cha not in all_stations[key]['channels']:
                        all_stations[key]['channels'].append(cha)
except Exception as e:
    print('IRIS fetch error:', e)

# Enrich each station with Region, Geomorphic Zone, and Friendly Name
for key, s in all_stations.items():
    nearest_loc = get_nearest_locality_info(s['lat'], s['lon'])
    reg = determine_region(s['lat'], s['lon'])
    zone = determine_geomorphic_zone(s['lat'], s['lon'], s['elevation'])
    s['regionCode'] = reg
    s['geomorphicZone'] = zone
    s['locality'] = nearest_loc[0] if nearest_loc else 'Chile'
    s['name'] = f"{s['code']} - {s['locality']}"

region_defs = {
    'XV': {'name': 'Región de Arica y Parinacota', 'roman': 'XV', 'order': 1, 'capital': 'Arica'},
    'I': {'name': 'Región de Tarapacá', 'roman': 'I', 'order': 2, 'capital': 'Iquique'},
    'II': {'name': 'Región de Antofagasta', 'roman': 'II', 'order': 3, 'capital': 'Antofagasta'},
    'III': {'name': 'Región de Atacama', 'roman': 'III', 'order': 4, 'capital': 'Copiapó'},
    'IV': {'name': 'Región de Coquimbo', 'roman': 'IV', 'order': 5, 'capital': 'La Serena'},
    'V': {'name': 'Región de Valparaíso', 'roman': 'V', 'order': 6, 'capital': 'Valparaíso'},
    'RM': {'name': 'Región Metropolitana de Santiago', 'roman': 'RM', 'order': 7, 'capital': 'Santiago'},
    'VI': {'name': "Región del Libertador Gral. Bernardo O'Higgins", 'roman': 'VI', 'order': 8, 'capital': 'Rancagua'},
    'VII': {'name': 'Región del Maule', 'roman': 'VII', 'order': 9, 'capital': 'Talca'},
    'XVI': {'name': 'Región de Ñuble', 'roman': 'XVI', 'order': 10, 'capital': 'Chillán'},
    'VIII': {'name': 'Región del Biobío', 'roman': 'VIII', 'order': 11, 'capital': 'Concepción'},
    'IX': {'name': 'Región de La Araucanía', 'roman': 'IX', 'order': 12, 'capital': 'Temuco'},
    'XIV': {'name': 'Región de Los Ríos', 'roman': 'XIV', 'order': 13, 'capital': 'Valdivia'},
    'X': {'name': 'Región de Los Lagos', 'roman': 'X', 'order': 14, 'capital': 'Puerto Montt'},
    'XI': {'name': 'Región de Aysén del Gral. Carlos Ibáñez del Campo', 'roman': 'XI', 'order': 15, 'capital': 'Coyhaique'},
    'XII': {'name': 'Región de Magallanes y de la Antártica Chilena', 'roman': 'XII', 'order': 16, 'capital': 'Punta Arenas'},
    'INSULAR': {'name': 'Territorios Insulares (Rapa Nui / J. Fernández)', 'roman': 'INS', 'order': 17, 'capital': 'Hanga Roa'}
}

stations_by_region = {}
for reg_code in region_defs.keys():
    stations_by_region[reg_code] = []

zone_order = {'Costa': 1, 'Valle': 2, 'Cordillera': 3}

for s in all_stations.values():
    reg = s['regionCode']
    if reg in stations_by_region:
        stations_by_region[reg].append(s)

# Sort each region from West to East (Costa -> Valle -> Cordillera & Lon ascending)
for reg_code in stations_by_region:
    stations_by_region[reg_code].sort(key=lambda x: (zone_order.get(x['geomorphicZone'], 2), x['lon']))

js_content = '/**\n * SismoRed Chile - Inventario Oficial y Base de Datos Sismográfica\n'
js_content += ' * Redes: Centro Sismológico Nacional (CSN), Raspberry Shake (AM), GSN, GEOFON\n'
js_content += ' * Organizado por Regiones y ordenado de Oeste a Este (Costa -> Valle -> Cordillera)\n */\n\n'
js_content += 'const CHILE_REGIONS = ' + json.dumps(region_defs, indent=2, ensure_ascii=False) + ';\n\n'
js_content += 'const CHILE_STATIONS = ' + json.dumps(list(all_stations.values()), indent=2, ensure_ascii=False) + ';\n\n'
js_content += 'const STATIONS_BY_REGION = ' + json.dumps(stations_by_region, indent=2, ensure_ascii=False) + ';\n\n'

js_content += '''
function getStationById(id) {
    return CHILE_STATIONS.find(s => s.code === id || `${s.network}_${s.code}` === id);
}

function getStationsByRegion(regionCode) {
    return STATIONS_BY_REGION[regionCode] || [];
}

function getStationsByZone(zone) {
    return CHILE_STATIONS.filter(s => s.geomorphicZone === zone);
}

function getStationsByNetwork(net) {
    return CHILE_STATIONS.filter(s => s.network === net);
}

if (typeof window !== 'undefined') {
    window.CHILE_REGIONS = CHILE_REGIONS;
    window.CHILE_STATIONS = CHILE_STATIONS;
    window.STATIONS_BY_REGION = STATIONS_BY_REGION;
    window.getStationById = getStationById;
    window.getStationsByRegion = getStationsByRegion;
    window.getStationsByZone = getStationsByZone;
    window.getStationsByNetwork = getStationsByNetwork;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { CHILE_REGIONS, CHILE_STATIONS, STATIONS_BY_REGION, getStationById, getStationsByRegion };
}
'''

with open('stations-data.js', 'w', encoding='utf-8') as f:
    f.write(js_content)

print(f'Successfully generated stations-data.js with {len(all_stations)} stations!')
for reg, list_st in stations_by_region.items():
    if len(list_st) > 0:
        c = sum(1 for x in list_st if x['geomorphicZone'] == 'Costa')
        v = sum(1 for x in list_st if x['geomorphicZone'] == 'Valle')
        m = sum(1 for x in list_st if x['geomorphicZone'] == 'Cordillera')
        rs = sum(1 for x in list_st if x['network'] == 'AM')
        csn = sum(1 for x in list_st if x['network'] in ['C', 'C1', 'CX'])
        print(f"[{reg}] {region_defs[reg]['name']}: {len(list_st)} estaciones (Costa:{c}, Valle:{v}, Cordillera:{m}) | RS:{rs}, CSN:{csn}")
