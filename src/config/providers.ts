export interface FdsnProviderDef {
    name: string;
    url: string;
    networkMap?: (net: string) => string;
}

export const PROVIDERS = {
    CSN_LOCAL: {
        name: 'CSN',
        url: '/api/csn/fdsnws/dataselect/1/query'
    },
    EARTHSCOPE: {
        name: 'EarthScope',
        url: 'https://service.earthscope.org/fdsnws/dataselect/1/query',
        networkMap: (net: string) => (net === 'C' ? 'C1' : net)
    },
    RASPBERRY_SHAKE: {
        name: 'Raspberry Shake',
        url: 'https://fdsnws.raspberryshakedata.com/fdsnws/dataselect/1/query'
    },
    GEOFON: {
        name: 'GEOFON',
        url: 'https://geofon.gfz-potsdam.de/fdsnws/dataselect/1/query'
    }
};

export function getProviderEndpointsForStation(station: any): { url: string; queryNet: string; name: string }[] {
    const net = station.network || 'C';
    const endpoints: { url: string; queryNet: string; name: string }[] = [];

    if (net === 'C') {
        endpoints.push({ url: PROVIDERS.CSN_LOCAL.url, queryNet: 'C', name: 'CSN' });
        endpoints.push({ url: PROVIDERS.EARTHSCOPE.url, queryNet: 'C1', name: 'EarthScope' });
    } else if (net === 'C1') {
        endpoints.push({ url: PROVIDERS.EARTHSCOPE.url, queryNet: 'C1', name: 'EarthScope' });
    } else if (net === 'AM') {
        endpoints.push({ url: PROVIDERS.RASPBERRY_SHAKE.url, queryNet: 'AM', name: 'Raspberry Shake' });
    } else if (net === 'GE') {
        endpoints.push({ url: PROVIDERS.GEOFON.url, queryNet: 'GE', name: 'GEOFON' });
        endpoints.push({ url: PROVIDERS.EARTHSCOPE.url, queryNet: 'GE', name: 'EarthScope' });
    } else {
        endpoints.push({ url: PROVIDERS.EARTHSCOPE.url, queryNet: net, name: 'EarthScope' });
    }
    return endpoints;
}

export function buildFdsnUrls(
    station: any,
    channels: string[],
    startIso: string,
    endIso: string,
    preferredBaseUrl?: string
): string[] {
    const loc = station.locationCode || station.location || '--';
    const endpoints = getProviderEndpointsForStation(station);
    const urls: string[] = [];

    const channelStr = channels.join(',');

    const formatUrl = (base: string, queryNet: string) =>
        `${base}?net=${queryNet}&sta=${station.code}&loc=${loc}&cha=${channelStr}&starttime=${startIso}&endtime=${endIso}`;

    if (preferredBaseUrl) {
        let queryNet = station.network || 'C';
        if (queryNet === 'C' && preferredBaseUrl.includes('earthscope')) queryNet = 'C1';
        urls.push(formatUrl(preferredBaseUrl, queryNet));
    }

    for (const ep of endpoints) {
        const u = formatUrl(ep.url, ep.queryNet);
        if (!urls.includes(u)) urls.push(u);
    }
    return urls;
}
