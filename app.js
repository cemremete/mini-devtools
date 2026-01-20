 /**
 * main app controller
 * wires up all the modules and handles ui interactions
 * now with puppeteer support for headless browser mode
 */

(function() {
    'use strict';

    // dom elements - grabbed once at startup
    const urlInput = document.getElementById('urlInput');
    const loadBtn = document.getElementById('loadBtn');
    const refreshBtn = document.getElementById('refreshBtn');
    const recentUrlsList = document.getElementById('recentUrlsList');
    const urlDropdown = document.getElementById('urlDropdown');
    const darkModeToggle = document.getElementById('darkModeToggle');
    const modeToggle = document.getElementById('modeToggle');
    const screenshotBtn = document.getElementById('screenshotBtn');
    const targetFrame = document.getElementById('targetFrame');
    const screenshotView = document.getElementById('screenshotView');
    const previewPlaceholder = document.getElementById('previewPlaceholder');
    const loadingOverlay = document.getElementById('loadingOverlay');
    const panelResizer = document.getElementById('panelResizer');
    const devtoolsPanel = document.getElementById('devtoolsPanel');
    const statusText = document.getElementById('statusText');
    const statusIndicator = document.querySelector('.status-dot');
    const loadTimeEl = document.getElementById('loadTime');

    // console tab elements
    const consoleOutput = document.getElementById('consoleOutput');
    const consoleSearch = document.getElementById('consoleSearch');
    const clearConsoleBtn = document.getElementById('clearConsole');

    // network tab elements
    const networkRows = document.getElementById('networkRows');
    const networkDetail = document.getElementById('networkDetail');
    const networkStats = document.getElementById('networkStats');
    const clearNetworkBtn = document.getElementById('clearNetwork');
    const closeNetworkDetail = document.getElementById('closeNetworkDetail');

    // elements tab
    const domTree = document.getElementById('domTree');
    const stylesContent = document.getElementById('stylesContent');

    // state
    let isDragging = false;
    let startY = 0;
    let startHeight = 0;
    let currentMode = 'proxy'; // 'proxy' or 'puppeteer'
    let puppeteerSessionId = null;
    let pollInterval = null;

    // localstorage key for recent urls
    const RECENT_URLS_KEY = 'minidevtools_recent_urls';
    const DARK_MODE_KEY = 'minidevtools_dark_mode';

    // init everything
    function init() {
        // initialize modules
        IframeManager.init(targetFrame);
        ConsoleMonitor.init(consoleOutput);
        NetworkMonitor.init(networkRows, networkDetail, networkStats);
        ElementsInspector.init(domTree, stylesContent);

        // setup event listeners
        setupEventListeners();

        // load saved state
        loadRecentUrls();
        loadDarkMode();

        // keyboard shortcuts
        setupKeyboardShortcuts();

        // console.log('mini devtools initialized');
        setStatus('Ready');
    }

    function setupEventListeners() {
        // url loading
        loadBtn.addEventListener('click', loadPage);
        urlInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') loadPage();
        });
        refreshBtn.addEventListener('click', () => IframeManager.refresh());

        // url input focus - show dropdown
        urlInput.addEventListener('focus', () => {
            if (recentUrlsList && recentUrlsList.children.length > 0) {
                urlDropdown.classList.add('show');
            }
        });
        
        urlInput.addEventListener('blur', () => {
            setTimeout(() => urlDropdown.classList.remove('show'), 200);
        });

        // quick links
        document.querySelectorAll('.quick-link').forEach(btn => {
            btn.addEventListener('click', () => {
                urlInput.value = btn.dataset.url;
                loadPage();
            });
        });

        // dark mode
        darkModeToggle.addEventListener('click', toggleDarkMode);

        // mode toggle (proxy vs puppeteer)
        if (modeToggle) {
            modeToggle.addEventListener('click', toggleMode);
        }

        // screenshot button
        if (screenshotBtn) {
            screenshotBtn.addEventListener('click', takeScreenshot);
        }

        // sidebar navigation
        document.querySelectorAll('.nav-item[data-tab]').forEach(item => {
            item.addEventListener('click', () => switchTab(item.dataset.tab));
        });

        // console controls
        document.querySelectorAll('.filter-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                ConsoleMonitor.setFilter(btn.dataset.filter);
            });
        });
        consoleSearch.addEventListener('input', (e) => {
            ConsoleMonitor.setSearch(e.target.value);
        });
        clearConsoleBtn.addEventListener('click', () => ConsoleMonitor.clear());

        // network controls
        clearNetworkBtn.addEventListener('click', () => NetworkMonitor.clear());
        closeNetworkDetail.addEventListener('click', () => NetworkMonitor.hideDetail());
        
        // network detail tabs
        document.querySelectorAll('.detail-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                NetworkMonitor.showDetailTab(tab.dataset.detail);
            });
        });

        // panel resizer
        panelResizer.addEventListener('mousedown', startResize);
        document.addEventListener('mousemove', doResize);
        document.addEventListener('mouseup', stopResize);

        // iframe callbacks
        IframeManager.onLoad(handlePageLoad);
        IframeManager.onError(handlePageError);
        IframeManager.onMessage(handleIframeMessage);
    }

    function loadPage() {
        const url = urlInput.value.trim();
        if (!url) {
            setStatus('Please enter a URL');
            return;
        }

        // basic URL validation
        let validUrl = url;
        if (!url.startsWith('http://') && !url.startsWith('https://') && !url.endsWith('.html')) {
            validUrl = 'https://' + url;
        }

        setStatus('Loading...', 'loading');
        if (previewPlaceholder) previewPlaceholder.style.display = 'none';
        if (loadingOverlay) loadingOverlay.classList.add('visible');
        
        // clear previous data
        ConsoleMonitor.clear();
        NetworkMonitor.clear();
        ElementsInspector.clear();

        // stop any existing polling
        if (pollInterval) {
            clearInterval(pollInterval);
            pollInterval = null;
        }

        // close any existing puppeteer session
        if (puppeteerSessionId) {
            closePuppeteerSession();
        }

        if (currentMode === 'puppeteer') {
            loadWithPuppeteer(url);
        } else {
            // proxy mode - use iframe
            if (targetFrame) targetFrame.classList.add('visible');
            if (screenshotView) screenshotView.classList.remove('visible');
            
            if (IframeManager.loadUrl(url)) {
                saveRecentUrl(url);
            }
        }
    }

    // puppeteer mode - uses headless browser on server
    async function loadWithPuppeteer(url) {
        setStatus('Starting browser session...');
        
        // hide iframe, show screenshot view
        if (targetFrame) targetFrame.classList.remove('visible');
        if (screenshotView) {
            screenshotView.classList.add('visible');
            screenshotView.innerHTML = '<div class="loader"></div>';
        }

        try {
            const response = await fetch('/api/puppeteer/start', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url })
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || 'Failed to start browser');
            }

            puppeteerSessionId = data.sessionId;
            saveRecentUrl(url);

            // show screenshot
            if (screenshotView && data.screenshot) {
                screenshotView.innerHTML = `<img src="${data.screenshot}" alt="Page screenshot" style="max-width:100%;height:auto;">`;
            }

            // add console logs
            if (data.consoleLogs) {
                data.consoleLogs.forEach(log => {
                    ConsoleMonitor.addEntry(log.level, log.message, log.timestamp);
                });
            }

            // add network requests
            if (data.networkRequests) {
                data.networkRequests.forEach(req => {
                    NetworkMonitor.handleNetworkMessage({
                        action: req.status === 'pending' ? 'start' : 'complete',
                        id: req.id,
                        method: req.method,
                        url: req.url,
                        status: req.status,
                        statusText: req.statusText || '',
                        timestamp: req.timestamp
                    });
                });
            }

            setStatus('Page loaded (Puppeteer mode)');
            loadTimeEl.textContent = '';

            // start polling for new logs
            startLogPolling();

        } catch (err) {
            console.error('Puppeteer error:', err);
            setStatus('Error: ' + err.message);
            if (screenshotView) {
                screenshotView.innerHTML = `<div class="error-message">${err.message}</div>`;
            }
        }
    }

    function startLogPolling() {
        if (pollInterval) clearInterval(pollInterval);
        
        pollInterval = setInterval(async () => {
            if (!puppeteerSessionId) {
                clearInterval(pollInterval);
                return;
            }

            try {
                const response = await fetch('/api/puppeteer/logs', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ sessionId: puppeteerSessionId })
                });

                if (response.ok) {
                    const data = await response.json();
                    // could update logs here if needed
                }
            } catch (e) {
                // ignore polling errors
            }
        }, 2000);
    }

    async function closePuppeteerSession() {
        if (!puppeteerSessionId) return;

        try {
            await fetch('/api/puppeteer/close', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sessionId: puppeteerSessionId })
            });
        } catch (e) {
            // ignore
        }

        puppeteerSessionId = null;
        if (pollInterval) {
            clearInterval(pollInterval);
            pollInterval = null;
        }
    }

    async function takeScreenshot() {
        if (!puppeteerSessionId) {
            setStatus('No active browser session');
            return;
        }

        setStatus('Taking screenshot...');

        try {
            const response = await fetch('/api/puppeteer/screenshot', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sessionId: puppeteerSessionId })
            });

            const data = await response.json();

            if (response.ok && data.screenshot) {
                if (screenshotView) {
                    screenshotView.innerHTML = `<img src="${data.screenshot}" alt="Page screenshot" style="max-width:100%;height:auto;">`;
                }
                setStatus('Screenshot updated');
            }
        } catch (err) {
            setStatus('Screenshot failed: ' + err.message);
        }
    }

    function handlePageLoad(data) {
        setStatus('Page loaded', 'success');
        if (loadingOverlay) loadingOverlay.classList.remove('visible');
        loadTimeEl.textContent = `${data.loadTime}ms`;

        // try to inspect the document
        // might fail for cross-origin pages
        setTimeout(() => {
            const doc = IframeManager.getDocument();
            ElementsInspector.inspectDocument(doc);
        }, 500); // small delay to let page settle
    }

    function handlePageError(err) {
        setStatus('Failed to load page', 'error');
        if (loadingOverlay) loadingOverlay.classList.remove('visible');
        console.error('page load error:', err);
    }

    function handleIframeMessage(data) {
        // console.log('message from iframe:', data.type);

        if (data.type === 'console') {
            const message = data.data ? data.data.join(' ') : '';
            ConsoleMonitor.addEntry(data.level, message, data.timestamp);
        } else if (data.type === 'network') {
            NetworkMonitor.handleNetworkMessage(data);
        } else if (data.type === 'injected') {
            setStatus('Monitoring active');
        }
    }

    function switchTab(tabName) {
        // update sidebar nav items
        document.querySelectorAll('.nav-item[data-tab]').forEach(item => {
            item.classList.toggle('active', item.dataset.tab === tabName);
        });

        // update tab content
        document.querySelectorAll('.tab-content').forEach(content => {
            content.classList.toggle('active', content.id === tabName + 'Tab');
        });
    }

    // panel resizing - took a while to get this smooth
    function startResize(e) {
        isDragging = true;
        startY = e.clientY;
        startHeight = devtoolsPanel.offsetHeight;
        panelResizer.classList.add('dragging');
        document.body.style.cursor = 'ns-resize';
        document.body.style.userSelect = 'none';
    }

    function doResize(e) {
        if (!isDragging) return;

        const diff = startY - e.clientY;
        const newHeight = Math.min(Math.max(startHeight + diff, 150), window.innerHeight * 0.7);
        devtoolsPanel.style.height = newHeight + 'px';
    }

    function stopResize() {
        if (!isDragging) return;
        isDragging = false;
        panelResizer.classList.remove('dragging');
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
    }

    // dark mode toggle
    function toggleDarkMode() {
        document.body.classList.toggle('dark-mode');
        const isDark = document.body.classList.contains('dark-mode');
        if (darkModeToggle) {
            const iconEl = darkModeToggle.querySelector('.nav-icon');
            const textEl = darkModeToggle.querySelector('.nav-text');
            if (iconEl) iconEl.textContent = isDark ? '☀️' : '🌙';
            if (textEl) textEl.textContent = isDark ? 'Light Mode' : 'Dark Mode';
        }
        localStorage.setItem(DARK_MODE_KEY, isDark ? 'dark' : 'light');
    }

    // mode toggle between proxy and puppeteer
    function toggleMode() {
        currentMode = currentMode === 'proxy' ? 'puppeteer' : 'proxy';
        
        if (modeToggle) {
            const iconEl = modeToggle.querySelector('.nav-icon');
            const textEl = modeToggle.querySelector('.nav-text');
            if (iconEl) iconEl.textContent = currentMode === 'proxy' ? '📄' : '🤖';
            if (textEl) textEl.textContent = currentMode === 'proxy' ? 'Proxy Mode' : 'Browser Mode';
            modeToggle.classList.toggle('active', currentMode === 'puppeteer');
        }

        // show/hide screenshot button based on mode
        if (screenshotBtn) {
            screenshotBtn.style.display = currentMode === 'puppeteer' ? 'flex' : 'none';
        }

        setStatus(`Switched to ${currentMode} mode`);
    }

    function loadDarkMode() {
        const mode = localStorage.getItem(DARK_MODE_KEY);
        if (mode === 'dark') {
            document.body.classList.add('dark-mode');
            if (darkModeToggle) {
                const iconEl = darkModeToggle.querySelector('.nav-icon');
                const textEl = darkModeToggle.querySelector('.nav-text');
                if (iconEl) iconEl.textContent = '☀️';
                if (textEl) textEl.textContent = 'Light Mode';
            }
        }
    }

    // recent urls management
    function saveRecentUrl(url) {
        let urls = getRecentUrls();
        
        // remove if already exists
        urls = urls.filter(u => u !== url);
        
        // add to front
        urls.unshift(url);
        
        // keep only last 10
        urls = urls.slice(0, 10);
        
        localStorage.setItem(RECENT_URLS_KEY, JSON.stringify(urls));
        updateRecentUrlsDropdown(urls);
    }

    function getRecentUrls() {
        try {
            return JSON.parse(localStorage.getItem(RECENT_URLS_KEY)) || [];
        } catch(e) {
            return [];
        }
    }

    function loadRecentUrls() {
        const urls = getRecentUrls();
        updateRecentUrlsDropdown(urls);
    }

    function updateRecentUrlsDropdown(urls) {
        if (!recentUrlsList) return;
        
        recentUrlsList.innerHTML = '';

        urls.forEach(url => {
            const item = document.createElement('div');
            item.className = 'dropdown-item';
            item.innerHTML = `<i class="fas fa-clock"></i><span>${url.length > 40 ? url.substring(0, 40) + '...' : url}</span>`;
            item.addEventListener('click', () => {
                urlInput.value = url;
                urlDropdown.classList.remove('show');
                loadPage();
            });
            recentUrlsList.appendChild(item);
        });
    }

    function setStatus(text, state = 'ready') {
        statusText.textContent = text;
        if (statusIndicator) {
            statusIndicator.classList.remove('loading', 'error');
            if (state === 'loading') statusIndicator.classList.add('loading');
            if (state === 'error') statusIndicator.classList.add('error');
        }
    }

    // keyboard shortcuts
    function setupKeyboardShortcuts() {
        document.addEventListener('keydown', (e) => {
            // Ctrl+K = clear console
            if (e.ctrlKey && e.key === 'k') {
                e.preventDefault();
                ConsoleMonitor.clear();
            }
            // Ctrl+L = focus url input
            if (e.ctrlKey && e.key === 'l') {
                e.preventDefault();
                urlInput.focus();
                urlInput.select();
            }
            // Ctrl+R = refresh
            if (e.ctrlKey && e.key === 'r') {
                e.preventDefault();
                IframeManager.refresh();
            }
        });
    }

    // start the app when dom is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
