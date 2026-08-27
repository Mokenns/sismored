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
        const fullHash = window.location.hash || '#/';
        this.currentRoute = fullHash;
        
        // Remove the '#' to match against our defined routes
        const hashPath = fullHash.substring(1);
        
        let matched = false;
        for (const path in this.routes) {
            if (path === '*') continue; // Skip wildcard during exact match
            
            const regexPath = path.replace(/:[a-zA-Z]+/g, '([^/]+)');
            const regex = new RegExp(`^${regexPath}$`);
            const match = hashPath.match(regex);
            
            if (match) {
                matched = true;
                const args = match.slice(1);
                this.routes[path](...args);
                break;
            }
        }

        if (!matched && this.routes['*']) {
            this.routes['*']();
        }
    }

    navigate(hash: string) {
        window.location.hash = hash;
    }
    
    init() {
        this.handleHashChange();
    }
}
