 /**
 * iframe manager - handles loading pages and communication
 * this was honestly the trickiest part to get working
 * updated to use proxy for CORS bypass
 */

const IframeManager = (function() {
    let iframe = null;
    let currentUrl = '';
    let loadStartTime = 0;
    let isLoaded = false;
    let useProxy = true; // use proxy by default for external urls
    
    // callbacks for when stuff happens
    let onLoadCallback = null;
    let onErrorCallback = null;
    let onMessageCallback = null;

    function init(frameElement) {
        iframe = frameElement;
        
        iframe.addEventListener('load', handleLoad);
        iframe.addEventListener('error', handleError);
        
        // listen for messages from iframe
        window.addEventListener('message', handleMessage);
        
        // console.log('iframe manager initialized');
    }

    function loadUrl(url) {
        if (!iframe) {
            console.error('iframe not initialized yet');
            return false;
        }

        // add protocol if missing - common mistake
        if (!url.startsWith('http://') && !url.startsWith('https://')) {
            url = 'https://' + url;
        }

        currentUrl = url;
        loadStartTime = performance.now();
        isLoaded = false;

        try {
            iframe.style.display = 'block';
            
            // check if its a local file or external url
            const isLocal = url.includes('localhost') || 
                           url.includes('127.0.0.1') || 
                           url.startsWith(window.location.origin) ||
                           url.endsWith('.html');
            
            if (useProxy && !isLocal) {
                // use proxy for external urls to bypass CORS
                const proxyUrl = '/proxy?url=' + encodeURIComponent(url);
                iframe.src = proxyUrl;
            } else {
                // load directly for local files
                iframe.src = url;
            }
            return true;
        } catch (err) {
            console.error('failed to load url:', err);
            if (onErrorCallback) onErrorCallback(err);
            return false;
        }
    }

    function handleLoad() {
        isLoaded = true;
        const loadTime = Math.round(performance.now() - loadStartTime);
        
        // console.log('page loaded in', loadTime, 'ms');
        
        if (onLoadCallback) {
            onLoadCallback({
                url: currentUrl,
                loadTime: loadTime
            });
        }

        // try to inject our monitoring scripts
        // this might fail due to CORS but worth a shot
        injectMonitoringScripts();
    }

    function handleError(e) {
        console.error('iframe load error:', e);
        if (onErrorCallback) onErrorCallback(e);
    }

    function handleMessage(event) {
        // security check - only accept messages from our iframe
        if (event.source !== iframe.contentWindow) return;

        // origin check - only accept from same origin or our proxy
        const allowedOrigins = [
            window.location.origin,
            'null' // sandboxed iframes report 'null' origin
        ];
        
        if (!allowedOrigins.includes(event.origin) && event.origin !== 'null') {
            // for proxied pages, origin might be different but source check is enough
            // console.warn('message from unexpected origin:', event.origin);
        }

        const data = event.data;
        if (!data || !data.type) return;

        // validate message structure
        const validTypes = ['console', 'network', 'injected', 'domready'];
        if (!validTypes.includes(data.type)) return;

        // console.log('got message from iframe:', data.type);
        
        if (onMessageCallback) {
            onMessageCallback(data);
        }
    }

    // inject scripts into iframe to capture console/network
    function injectMonitoringScripts() {
        try {
            const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
            
            if (!iframeDoc) {
                console.warn('cant access iframe document - probably CORS');
                return;
            }

            const script = iframeDoc.createElement('script');
            script.textContent = getInjectionScript();
            iframeDoc.head.appendChild(script);
            
            // console.log('monitoring scripts injected successfully');
        } catch (err) {
            // this is expected for cross-origin iframes
            console.warn('couldnt inject scripts:', err.message);
        }
    }

    // the script we inject into the iframe
    function getInjectionScript() {
        return `
            (function() {
                // override console methods
                const originalConsole = {
                    log: console.log,
                    warn: console.warn,
                    error: console.error,
                    info: console.info
                };

                function sendToParent(type, level, args) {
                    try {
                        window.parent.postMessage({
                            type: type,
                            level: level,
                            data: Array.from(args).map(arg => {
                                try {
                                    if (typeof arg === 'object') {
                                        return JSON.stringify(arg, null, 2);
                                    }
                                    return String(arg);
                                } catch(e) {
                                    return '[object]';
                                }
                            }),
                            timestamp: Date.now()
                        }, '*');
                    } catch(e) {
                        // silently fail
                    }
                }

                console.log = function() {
                    sendToParent('console', 'log', arguments);
                    originalConsole.log.apply(console, arguments);
                };
                console.warn = function() {
                    sendToParent('console', 'warn', arguments);
                    originalConsole.warn.apply(console, arguments);
                };
                console.error = function() {
                    sendToParent('console', 'error', arguments);
                    originalConsole.error.apply(console, arguments);
                };
                console.info = function() {
                    sendToParent('console', 'info', arguments);
                    originalConsole.info.apply(console, arguments);
                };

                // intercept fetch
                const originalFetch = window.fetch;
                window.fetch = function(url, options) {
                    const startTime = performance.now();
                    const method = (options && options.method) || 'GET';
                    const reqId = Math.random().toString(36).substr(2, 9);

                    window.parent.postMessage({
                        type: 'network',
                        action: 'start',
                        id: reqId,
                        method: method,
                        url: typeof url === 'string' ? url : url.toString(),
                        timestamp: Date.now()
                    }, '*');

                    return originalFetch.apply(this, arguments)
                        .then(response => {
                            const duration = Math.round(performance.now() - startTime);
                            

                            // clone response to read body
                            const cloned = response.clone();
                            cloned.text().then(body => {
                                window.parent.postMessage({
                                    type: 'network',
                                    action: 'complete',
                                    id: reqId,
                                    status: response.status,
                                    statusText: response.statusText,
                                    duration: duration,
                                    size: body.length,
                                    headers: Object.fromEntries(response.headers.entries()),
                                    body: body.substring(0, 5000) // limit body size
                                }, '*');
                            }).catch(() => {});

                            return response;
                        })
                        .catch(err => {
                            window.parent.postMessage({
                                type: 'network',
                                action: 'error',
                                id: reqId,
                                error: err.message
                            }, '*');
                            throw err;
                        });
                };

                // intercept XMLHttpRequest
                const originalXHR = window.XMLHttpRequest;
                window.XMLHttpRequest = function() {
                    const xhr = new originalXHR();
                    const reqId = Math.random().toString(36).substr(2, 9);
                    let method = 'GET';
                    let url = '';
                    let startTime = 0;

                    const originalOpen = xhr.open;
                    xhr.open = function(m, u) {
                        method = m;
                        url = u;
                        return originalOpen.apply(this, arguments);
                    };

                    const originalSend = xhr.send;
                    xhr.send = function(body) {
                        startTime = performance.now();
                        
                        window.parent.postMessage({
                            type: 'network',
                            action: 'start',
                            id: reqId,
                            method: method,
                            url: url,
                            payload: body ? body.substring(0, 1000) : null,
                            timestamp: Date.now()
                        }, '*');

                        xhr.addEventListener('load', function() {
                            const duration = Math.round(performance.now() - startTime);
                            window.parent.postMessage({
                                type: 'network',
                                action: 'complete',
                                id: reqId,
                                status: xhr.status,
                                statusText: xhr.statusText,
                                duration: duration,
                                size: xhr.responseText.length,
                                headers: parseHeaders(xhr.getAllResponseHeaders()),
                                body: xhr.responseText.substring(0, 5000)
                            }, '*');
                        });

                        xhr.addEventListener('error', function() {
                            window.parent.postMessage({
                                type: 'network',
                                action: 'error',
                                id: reqId,
                                error: 'Request failed'
                            }, '*');
                        });

                        return originalSend.apply(this, arguments);
                    };

                    return xhr;
                };

                function parseHeaders(headerStr) {
                    const headers = {};
                    if (!headerStr) return headers;
                    headerStr.split('\\r\\n').forEach(line => {
                        const parts = line.split(': ');
                        if (parts.length === 2) {
                            headers[parts[0]] = parts[1];
                        }
                    });
                    return headers;
                }

                // notify parent that injection worked
                window.parent.postMessage({ type: 'injected' }, '*');
            })();
        `;
    }

    function getDocument() {
        try {
            return iframe.contentDocument || iframe.contentWindow.document;
        } catch (e) {
            return null;
        }
    }

    function refresh() {
        if (currentUrl) {
            loadUrl(currentUrl);
        }
    }

    function getCurrentUrl() {
        return currentUrl;
    }

    function getLoadTime() {
        return loadStartTime ? Math.round(performance.now() - loadStartTime) : 0;
    }

    // public api
    return {
        init: init,
        loadUrl: loadUrl,
        refresh: refresh,
        getDocument: getDocument,
        getCurrentUrl: getCurrentUrl,
        getLoadTime: getLoadTime,
        onLoad: function(cb) { onLoadCallback = cb; },
        onError: function(cb) { onErrorCallback = cb; },
        onMessage: function(cb) { onMessageCallback = cb; }
    };
})();
