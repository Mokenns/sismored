export class Router {
    routes: { [path: string]: Function } = {};
    currentRoute: string = '';

    constructor() {
        window.addEventListener('hashchange', this.handleHashChange.bind(this));
    }

    addRoute(path: string, callback: Function) {
        this.routes[path] = callback;
    }

    handleHashChange() {
        const rawHash = window.location.hash || '#/';
        this.currentRoute = rawHash;
        
        // Remove '#' and query string for routing match
        let hashPath = rawHash.replace(/^#/, '').split('?')[0].trim();
        if (!hashPath.startsWith('/')) hashPath = '/' + hashPath;
        if (hashPath.length > 1 && hashPath.endsWith('/')) {
            hashPath = hashPath.slice(0, -1);
        }

        // Sort routes by specificity: deepest paths and static segments first
        const routeKeys = Object.keys(this.routes).filter(k => k !== '*').sort((a, b) => {
            const aSegments = a.split('/').filter(Boolean);
            const bSegments = b.split('/').filter(Boolean);
            if (bSegments.length !== aSegments.length) {
                return bSegments.length - aSegments.length; // More segments first
            }
            // If same length, count non-param segments
            const aStatic = aSegments.filter(s => !s.startsWith(':')).length;
            const bStatic = bSegments.filter(s => !s.startsWith(':')).length;
            return bStatic - aStatic;
        });

        let matched = false;
        for (const path of routeKeys) {
            const regexPath = path.replace(/:[a-zA-Z0-9_]+/g, '([^/]+)');
            const regex = new RegExp(`^${regexPath}$`);
            const match = hashPath.match(regex);
            
            if (match) {
                matched = true;
                const args = match.slice(1).map(decodeURIComponent);
                this.routes[path](...args);
                break;
            }
        }

        if (!matched && this.routes['*']) {
            this.routes['*']();
        }
    }

    navigate(hash: string) {
        if (!hash.startsWith('#')) {
            hash = '#' + hash;
        }
        window.location.hash = hash;
    }
    
    init() {
        this.handleHashChange();
    }
}
