/**
 * Mini DevTools Server - Express + Puppeteer
 * Full web inspector with headless browser support
 * 
 * run with: npm start (after npm install)
 */

const express = require('express');
const cors = require('cors');
const path = require('path');
const http = require('http');
const https = require('https');

const app = express();
const PORT = 3000;

// try to load puppeteer, but don't fail if not installed
let puppeteer = null;
try {
    puppeteer = require('puppeteer');
    console.log('Puppeteer loaded - headless browser mode available');
} catch (e) {
    console.log('Puppeteer not installed - using fetch-only mode');
    console.log('Run "npm install puppeteer" for full browser support');
}

// middleware
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// store active browser sessions
const sessions = new Map();

// session timeout (30 minutes)
const SESSION_TIMEOUT = 30 * 60 * 1000;
const MAX_REDIRECTS = 10;

// cleanup old sessions periodically
setInterval(() => {
    const now = Date.now();
    for (const [id, session] of sessions.entries()) {
        if (now - session.createdAt > SESSION_TIMEOUT) {
            console.log('[Cleanup] Closing stale session:', id);
            session.browser.close().catch(() => {});
            sessions.delete(id);
        }
    }
}, 60000);

// ============================================
// API ENDPOINTS
// ============================================

// POST /api/proxy - fetch a page and return HTML with injected scripts
app.post('/api/proxy', async (req, res) => {
    const { url } = req.body;
    
    if (!url) {
        return res.status(400).json({ error: 'URL is required' });
    }

    console.log('[Proxy] Fetching:', url);

    try {
        const html = await fetchPage(url);
        const processedHtml = injectMonitoringScripts(html, url);
        
        res.json({
            success: true,
            html: processedHtml,
            url: url
        });
    } catch (err) {
        console.error('[Proxy] Error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// GET /proxy?url=... - serve proxied page directly (for iframe)
app.get('/proxy', async (req, res) => {
    const targetUrl = req.query.url;
    
    if (!targetUrl) {
        return res.status(400).send('Missing url parameter');
    }

    console.log('[Proxy] Loading:', targetUrl);

    try {
        const html = await fetchPage(targetUrl);
        const processedHtml = injectMonitoringScripts(html, targetUrl);
        
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.setHeader('X-Proxied-From', targetUrl);
        res.send(processedHtml);
    } catch (err) {
        console.error('[Proxy] Error:', err.message);
        // escape HTML to prevent XSS
        const safeUrl = escapeHtml(targetUrl);
        const safeError = escapeHtml(err.message);
        res.status(500).send(`
            <html>
            <body style="font-family: sans-serif; padding: 40px; background: #1e1e1e; color: #ccc;">
                <h2>Failed to load page</h2>
                <p style="color: #f48771;">${safeError}</p>
                <p>URL: ${safeUrl}</p>
            </body>
            </html>
        `);
    }
});

// POST /api/puppeteer/start - start a puppeteer session
app.post('/api/puppeteer/start', async (req, res) => {
    if (!puppeteer) {
        return res.status(501).json({ error: 'Puppeteer not installed' });
    }

    const { url } = req.body;
    if (!url) {
        return res.status(400).json({ error: 'URL is required' });
    }

    const sessionId = Math.random().toString(36).substr(2, 9);
    console.log('[Puppeteer] Starting session:', sessionId, 'for', url);

    try {
        const browser = await puppeteer.launch({
            headless: 'new',
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });

        const page = await browser.newPage();
        
        // collect console logs
        const consoleLogs = [];
        page.on('console', msg => {
            consoleLogs.push({
                level: msg.type(),
                message: msg.text(),
                timestamp: Date.now()
            });
        });

        // collect network requests
        const networkRequests = [];
        page.on('request', request => {
            networkRequests.push({
                id: Math.random().toString(36).substr(2, 9),
                method: request.method(),
                url: request.url(),
                timestamp: Date.now(),
                status: 'pending'
            });
        });

        page.on('response', response => {
            const req = networkRequests.find(r => r.url === response.url() && r.status === 'pending');
            if (req) {
                req.status = response.status();
                req.statusText = response.statusText();
            }
        });

        // navigate to page
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

        // get page content
        const content = await page.content();
        
        // take screenshot
        const screenshot = await page.screenshot({ encoding: 'base64', fullPage: false });

        // store session with timestamp
        sessions.set(sessionId, {
            browser,
            page,
            consoleLogs,
            networkRequests,
            url,
            createdAt: Date.now()
        });

        res.json({
            success: true,
            sessionId,
            screenshot: `data:image/png;base64,${screenshot}`,
            consoleLogs,
            networkRequests,
            html: content
        });

    } catch (err) {
        console.error('[Puppeteer] Error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// POST /api/puppeteer/screenshot - take screenshot of current page
app.post('/api/puppeteer/screenshot', async (req, res) => {
    const { sessionId } = req.body;
    const session = sessions.get(sessionId);

    if (!session) {
        return res.status(404).json({ error: 'Session not found' });
    }

    try {
        const screenshot = await session.page.screenshot({ encoding: 'base64' });
        res.json({
            success: true,
            screenshot: `data:image/png;base64,${screenshot}`
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/puppeteer/logs - get console logs and network requests
app.post('/api/puppeteer/logs', async (req, res) => {
    const { sessionId } = req.body;
    const session = sessions.get(sessionId);

    if (!session) {
        return res.status(404).json({ error: 'Session not found' });
    }

    res.json({
        success: true,
        consoleLogs: session.consoleLogs,
        networkRequests: session.networkRequests
    });
});

// POST /api/puppeteer/execute - execute JS in page context
app.post('/api/puppeteer/execute', async (req, res) => {
    const { sessionId, script } = req.body;
    const session = sessions.get(sessionId);

    if (!session) {
        return res.status(404).json({ error: 'Session not found' });
    }

    try {
        const result = await session.page.evaluate(script);
        res.json({ success: true, result });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/puppeteer/close - close browser session
app.post('/api/puppeteer/close', async (req, res) => {
    const { sessionId } = req.body;
    const session = sessions.get(sessionId);

    if (session) {
        await session.browser.close();
        sessions.delete(sessionId);
    }

    res.json({ success: true });
});

// GET /api/puppeteer/dom - get DOM structure
app.post('/api/puppeteer/dom', async (req, res) => {
    const { sessionId } = req.body;
    const session = sessions.get(sessionId);

    if (!session) {
        return res.status(404).json({ error: 'Session not found' });
    }

    try {
        const dom = await session.page.evaluate(() => {
            function serializeNode(node, depth = 0) {
                if (depth > 10) return null;
                
                const result = {
                    tagName: node.tagName ? node.tagName.toLowerCase() : '#text',
                    id: node.id || null,
                    className: node.className || null,
                    children: []
                };

                if (node.childNodes) {
                    for (const child of node.childNodes) {
                        if (child.nodeType === 1) { // element node
                            const serialized = serializeNode(child, depth + 1);
                            if (serialized) result.children.push(serialized);
                        }
                    }
                }

                return result;
            }

            return serializeNode(document.documentElement);
        });

        res.json({ success: true, dom });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============================================
// HELPER FUNCTIONS
// ============================================

// escape HTML to prevent XSS
function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function fetchPage(targetUrl, redirectCount = 0) {
    return new Promise((resolve, reject) => {
        // prevent redirect loops
        if (redirectCount > MAX_REDIRECTS) {
            reject(new Error('Too many redirects'));
            return;
        }

        let parsedUrl;
        try {
            parsedUrl = new URL(targetUrl);
        } catch (e) {
            reject(new Error('Invalid URL'));
            return;
        }

        // block private/local IPs (SSRF protection)
        const hostname = parsedUrl.hostname.toLowerCase();
        if (hostname === 'localhost' || 
            hostname === '127.0.0.1' || 
            hostname.startsWith('192.168.') ||
            hostname.startsWith('10.') ||
            hostname.startsWith('172.') ||
            hostname === '0.0.0.0') {
            reject(new Error('Access to local addresses is not allowed'));
            return;
        }

        const protocol = parsedUrl.protocol === 'https:' ? https : http;
        
        const options = {
            hostname: parsedUrl.hostname,
            port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
            path: parsedUrl.pathname + parsedUrl.search,
            method: 'GET',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.5'
            },
            timeout: 15000
        };

        const req = protocol.request(options, (res) => {
            // handle redirects with loop protection
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                const redirectUrl = new URL(res.headers.location, targetUrl).href;
                fetchPage(redirectUrl, redirectCount + 1).then(resolve).catch(reject);
                return;
            }

            let body = [];
            res.on('data', chunk => body.push(chunk));
            res.on('end', () => {
                const content = Buffer.concat(body).toString('utf-8');
                resolve(content);
            });
        });

        req.on('error', reject);
        req.on('timeout', () => {
            req.destroy();
            reject(new Error('Request timeout'));
        });

        req.end();
    });
}

function injectMonitoringScripts(html, baseUrl) {
    // add base tag for relative URLs
    if (!html.includes('<base')) {
        html = html.replace(/<head[^>]*>/i, `$&\n<base href="${baseUrl}">`);
    }

    const monitorScript = `
<script>
(function() {
    // === CONSOLE INTERCEPTION ===
    const _console = {
        log: console.log.bind(console),
        warn: console.warn.bind(console),
        error: console.error.bind(console),
        info: console.info.bind(console)
    };

    function sendMsg(type, level, args) {
        try {
            window.parent.postMessage({
                type: type,
                level: level,
                data: Array.from(args).map(a => {
                    try {
                        if (a === null) return 'null';
                        if (a === undefined) return 'undefined';
                        if (typeof a === 'object') return JSON.stringify(a, null, 2);
                        return String(a);
                    } catch(e) { return '[object]'; }
                }),
                timestamp: Date.now()
            }, '*');
        } catch(e) {}
    }

    console.log = function() { sendMsg('console', 'log', arguments); _console.log.apply(console, arguments); };
    console.warn = function() { sendMsg('console', 'warn', arguments); _console.warn.apply(console, arguments); };
    console.error = function() { sendMsg('console', 'error', arguments); _console.error.apply(console, arguments); };
    console.info = function() { sendMsg('console', 'info', arguments); _console.info.apply(console, arguments); };

    window.onerror = function(msg, url, line) {
        sendMsg('console', 'error', ['Uncaught: ' + msg + ' at ' + url + ':' + line]);
    };

    // === FETCH INTERCEPTION ===
    const _fetch = window.fetch;
    window.fetch = function(url, opts) {
        const t0 = performance.now();
        const method = (opts && opts.method) || 'GET';
        const id = Math.random().toString(36).substr(2, 9);
        const fullUrl = new URL(url, location.href).href;

        window.parent.postMessage({ type: 'network', action: 'start', id, method, url: fullUrl, timestamp: Date.now() }, '*');

        return _fetch.apply(this, arguments)
            .then(res => {
                const dur = Math.round(performance.now() - t0);
                res.clone().text().then(body => {
                    window.parent.postMessage({
                        type: 'network', action: 'complete', id,
                        status: res.status, statusText: res.statusText,
                        duration: dur, size: body.length,
                        headers: Object.fromEntries(res.headers.entries()),
                        body: body.substring(0, 5000)
                    }, '*');
                }).catch(() => {});
                return res;
            })
            .catch(err => {
                window.parent.postMessage({ type: 'network', action: 'error', id, error: err.message }, '*');
                throw err;
            });
    };

    // === XHR INTERCEPTION ===
    const _XHR = window.XMLHttpRequest;
    window.XMLHttpRequest = function() {
        const xhr = new _XHR();
        const id = Math.random().toString(36).substr(2, 9);
        let method = 'GET', reqUrl = '', t0 = 0;

        const _open = xhr.open;
        xhr.open = function(m, u) { method = m; reqUrl = new URL(u, location.href).href; return _open.apply(this, arguments); };

        const _send = xhr.send;
        xhr.send = function(body) {
            t0 = performance.now();
            window.parent.postMessage({ type: 'network', action: 'start', id, method, url: reqUrl, timestamp: Date.now() }, '*');

            xhr.addEventListener('load', function() {
                window.parent.postMessage({
                    type: 'network', action: 'complete', id,
                    status: xhr.status, statusText: xhr.statusText,
                    duration: Math.round(performance.now() - t0),
                    size: xhr.responseText ? xhr.responseText.length : 0,
                    body: xhr.responseText ? xhr.responseText.substring(0, 5000) : ''
                }, '*');
            });

            xhr.addEventListener('error', function() {
                window.parent.postMessage({ type: 'network', action: 'error', id, error: 'Request failed' }, '*');
            });

            return _send.apply(this, arguments);
        };

        return xhr;
    };

    // notify ready
    window.parent.postMessage({ type: 'injected' }, '*');
    
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => window.parent.postMessage({ type: 'domready' }, '*'));
    } else {
        window.parent.postMessage({ type: 'domready' }, '*');
    }
})();
</script>`;

    // inject script
    if (html.includes('</head>')) {
        html = html.replace('</head>', monitorScript + '\n</head>');
    } else if (html.includes('<body')) {
        html = html.replace(/<body[^>]*>/i, '$&\n' + monitorScript);
    } else {
        html = monitorScript + html;
    }

    return html;
}

// ============================================
// START SERVER
// ============================================

app.listen(PORT, () => {
    console.log('');
    console.log('╔═══════════════════════════════════════╗');
    console.log('║       Mini DevTools Server            ║');
    console.log('╠═══════════════════════════════════════╣');
    console.log('║  http://localhost:' + PORT + '                 ║');
    console.log('╚═══════════════════════════════════════╝');
    console.log('');
    console.log('API Endpoints:');
    console.log('  GET  /proxy?url=...        - Proxy page for iframe');
    console.log('  POST /api/proxy            - Fetch page HTML');
    console.log('  POST /api/puppeteer/start  - Start browser session');
    console.log('  POST /api/puppeteer/screenshot');
    console.log('  POST /api/puppeteer/logs');
    console.log('  POST /api/puppeteer/dom');
    console.log('  POST /api/puppeteer/close');
    console.log('');
});
