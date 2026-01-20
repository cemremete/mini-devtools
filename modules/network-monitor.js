 /**
 * network monitor - tracks http requests
 * hacky way to catch fetch/xhr but it works
 */

const NetworkMonitor = (function() {
    let listEl = null;
    let detailEl = null;
    let statsEl = null;
    let requests = new Map();
    let selectedId = null;
    
    // callbacks
    let onSelectCallback = null;

    function init(listElement, detailElement, statsElement) {
        listEl = listElement;
        detailEl = detailElement;
        statsEl = statsElement;
        // console.log('network monitor initialized');
    }

    function handleNetworkMessage(data) {
        if (data.action === 'start') {
            addRequest(data);
        } else if (data.action === 'complete') {
            completeRequest(data);
        } else if (data.action === 'error') {
            errorRequest(data);
        }
    }

    function addRequest(data) {
        const req = {
            id: data.id,
            method: data.method,
            url: data.url,
            status: null,
            statusText: '',
            duration: null,
            size: null,
            headers: {},
            body: '',
            payload: data.payload || null,
            timestamp: data.timestamp,
            pending: true,
            error: false
        };

        requests.set(data.id, req);
        renderRequest(req);
        updateStats();
    }

    function completeRequest(data) {
        const req = requests.get(data.id);
        if (!req) return;

        req.status = data.status;
        req.statusText = data.statusText;
        req.duration = data.duration;
        req.size = data.size;
        req.headers = data.headers || {};
        req.body = data.body || '';
        req.pending = false;

        updateRequestRow(req);
        updateStats();

        // update detail panel if this request is selected
        if (selectedId === data.id) {
            showDetail(req);
        }
    }

    function errorRequest(data) {
        const req = requests.get(data.id);
        if (!req) return;

        req.error = true;
        req.pending = false;
        req.statusText = data.error || 'Error';

        updateRequestRow(req);
        updateStats();
    }

    function renderRequest(req) {
        // remove empty state
        const emptyState = listEl.querySelector('.empty-state');
        if (emptyState) emptyState.remove();

        const row = document.createElement('div');
        row.className = 'network-row';
        row.dataset.id = req.id;

        row.innerHTML = getRowHtml(req);

        row.addEventListener('click', () => selectRequest(req.id));

        listEl.appendChild(row);
    }

    function updateRequestRow(req) {
        const row = listEl.querySelector(`[data-id="${req.id}"]`);
        if (!row) return;

        row.innerHTML = getRowHtml(req);
    }

    function getRowHtml(req) {
        const statusBadgeClass = getStatusBadgeClass(req.status, req.pending, req.error);
        const statusText = req.pending ? '...' : (req.error ? 'ERR' : req.status);
        const timeText = req.duration !== null ? `${req.duration}ms` : '-';
        const sizeText = req.size !== null ? formatSize(req.size) : '-';

        // get filename from url
        let displayName = req.url;
        let fileType = 'fetch';
        try {
            const urlObj = new URL(req.url);
            const pathParts = urlObj.pathname.split('/');
            displayName = pathParts[pathParts.length - 1] || urlObj.hostname;
            
            // determine type from extension or content
            const ext = displayName.split('.').pop()?.toLowerCase();
            if (['js'].includes(ext)) fileType = 'script';
            else if (['css'].includes(ext)) fileType = 'style';
            else if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'].includes(ext)) fileType = 'image';
            else if (['html', 'htm'].includes(ext)) fileType = 'document';
            else if (['json'].includes(ext)) fileType = 'json';
            else if (['woff', 'woff2', 'ttf', 'otf'].includes(ext)) fileType = 'font';
        } catch(e) {
            // keep original if parsing fails
        }

        // waterfall bar width based on duration (max 100px for 1000ms)
        const waterfallWidth = req.duration ? Math.min(Math.max(req.duration / 10, 4), 100) : 0;

        return `
            <span class="col-status"><span class="status-badge ${statusBadgeClass}">${statusText}</span></span>
            <span class="col-method">${req.method}</span>
            <span class="col-name" title="${escapeHtml(req.url)}">${escapeHtml(displayName)}</span>
            <span class="col-type">${fileType}</span>
            <span class="col-size">${sizeText}</span>
            <span class="col-time">${timeText}</span>
            <span class="col-waterfall"><div class="waterfall-bar" style="width:${waterfallWidth}px"></div></span>
        `;
    }

    function getStatusBadgeClass(status, pending, error) {
        if (pending) return 'pending';
        if (error) return 'error';
        if (status >= 200 && status < 300) return 'success';
        if (status >= 300 && status < 400) return 'redirect';
        return 'error';
    }

    function selectRequest(id) {
        // deselect previous
        const prevRow = listEl.querySelector('.network-row.selected');
        if (prevRow) prevRow.classList.remove('selected');

        // select new
        const row = listEl.querySelector(`[data-id="${id}"]`);
        if (row) row.classList.add('selected');

        selectedId = id;
        const req = requests.get(id);
        if (req) {
            showDetail(req);
        }
    }

    function showDetail(req) {
        detailEl.classList.add('visible');
        
        // default to headers tab
        showDetailTab('headers', req);
    }

    function showDetailTab(tab, req) {
        if (!req) {
            req = requests.get(selectedId);
        }
        if (!req) return;

        const contentEl = detailEl.querySelector('#detailContent');
        
        // update active tab
        detailEl.querySelectorAll('.detail-tab').forEach(t => {
            t.classList.toggle('active', t.dataset.detail === tab);
        });

        let content = '';

        if (tab === 'headers') {
            content = formatHeaders(req);
        } else if (tab === 'response') {
            content = formatResponse(req);
        } else if (tab === 'payload') {
            content = formatPayload(req);
        }

        contentEl.innerHTML = content;
    }

    function formatHeaders(req) {
        let html = '<strong>General</strong>\n';
        html += `Request URL: ${escapeHtml(req.url)}\n`;
        html += `Request Method: ${req.method}\n`;
        html += `Status Code: ${req.status || 'pending'} ${req.statusText}\n\n`;

        html += '<strong>Response Headers</strong>\n';
        if (Object.keys(req.headers).length > 0) {
            for (const [key, value] of Object.entries(req.headers)) {
                html += `${escapeHtml(key)}: ${escapeHtml(value)}\n`;
            }
        } else {
            html += '(no headers captured)\n';
        }

        return html;
    }

    function formatResponse(req) {
        if (!req.body) {
            return '(no response body)';
        }

        // try to pretty print json
        try {
            const json = JSON.parse(req.body);
            return escapeHtml(JSON.stringify(json, null, 2));
        } catch(e) {
            return escapeHtml(req.body);
        }
    }

    function formatPayload(req) {
        if (!req.payload) {
            return '(no request payload)';
        }

        // try to pretty print json
        try {
            const json = JSON.parse(req.payload);
            return escapeHtml(JSON.stringify(json, null, 2));
        } catch(e) {
            return escapeHtml(req.payload);
        }
    }

    function hideDetail() {
        detailEl.classList.remove('visible');
        selectedId = null;
        
        const row = listEl.querySelector('.network-row.selected');
        if (row) row.classList.remove('selected');
    }

    function updateStats() {
        const total = requests.size;
        const totalSize = Array.from(requests.values())
            .filter(r => r.size)
            .reduce((sum, r) => sum + r.size, 0);
        
        statsEl.innerHTML = `
            <span class="stat-item"><strong>${total}</strong> requests</span>
            <span class="stat-item"><strong>${formatSize(totalSize)}</strong> transferred</span>
        `;
    }

    function clear() {
        requests.clear();
        selectedId = null;
        listEl.innerHTML = `<div class="empty-state">
            <i class="fas fa-network-wired"></i>
            <p>No requests captured</p>
            <span>Network activity will appear here</span>
        </div>`;
        detailEl.classList.remove('visible');
        updateStats();
    }

    function formatSize(bytes) {
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    }

    function escapeHtml(str) {
        if (!str) return '';
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    function getRequests() {
        return Array.from(requests.values());
    }

    return {
        init: init,
        handleNetworkMessage: handleNetworkMessage,
        showDetailTab: showDetailTab,
        hideDetail: hideDetail,
        clear: clear,
        getRequests: getRequests
    };
})();
