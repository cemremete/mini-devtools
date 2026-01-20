 /**
 * console monitor - captures and displays console output
 * pretty straightforward once you figure out the message format
 */

const ConsoleMonitor = (function() {
    let outputEl = null;
    let entries = [];
    let currentFilter = 'all';
    let searchTerm = '';
    
    // max entries before we start removing old ones
    // might need to bump this up or add virtual scrolling later
    const MAX_ENTRIES = 500;

    function init(outputElement) {
        outputEl = outputElement;
        // console.log('console monitor ready');
    }

    function addEntry(level, message, timestamp) {
        const entry = {
            id: Date.now() + Math.random(),
            level: level || 'log',
            message: message,
            timestamp: timestamp || Date.now()
        };

        entries.push(entry);

        // remove old entries if we have too many
        if (entries.length > MAX_ENTRIES) {
            entries.shift();
        }

        renderEntry(entry);
        scrollToBottom();
    }

    function renderEntry(entry) {
        if (!shouldShowEntry(entry)) return;

        const div = document.createElement('div');
        div.className = `console-entry ${entry.level}`;
        div.dataset.id = entry.id;
        div.dataset.level = entry.level;

        const time = new Date(entry.timestamp);
        const timeStr = time.toLocaleTimeString('en-US', { 
            hour12: false,
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });

        // icon based on level
        const icons = {
            log: 'fa-circle-info',
            info: 'fa-circle-info',
            warn: 'fa-triangle-exclamation',
            error: 'fa-circle-xmark'
        };
        const icon = icons[entry.level] || icons.log;

        div.innerHTML = `
            <span class="console-icon"><i class="fas ${icon}"></i></span>
            <span class="console-timestamp">${timeStr}</span>
            <span class="console-message">${formatMessage(entry.message)}</span>
        `;

        // remove empty state if present
        const emptyState = outputEl.querySelector('.empty-state');
        if (emptyState) emptyState.remove();

        outputEl.appendChild(div);
    }

    // format message with basic syntax highlighting
    function formatMessage(msg) {
        let escaped = escapeHtml(msg);
        
        // highlight JSON-like content
        escaped = escaped.replace(/(".*?")/g, '<span style="color:#a5d6ff">$1</span>');
        // highlight numbers
        escaped = escaped.replace(/\b(\d+\.?\d*)\b/g, '<span style="color:#79c0ff">$1</span>');
        // highlight booleans
        escaped = escaped.replace(/\b(true|false|null|undefined)\b/g, '<span style="color:#ff7b72">$1</span>');
        
        return escaped;
    }

    function shouldShowEntry(entry) {
        // check filter
        if (currentFilter !== 'all' && entry.level !== currentFilter) {
            return false;
        }

        // check search
        if (searchTerm && !entry.message.toLowerCase().includes(searchTerm.toLowerCase())) {
            return false;
        }

        return true;
    }

    function setFilter(filter) {
        currentFilter = filter;
        rerender();
    }

    function setSearch(term) {
        searchTerm = term;
        rerender();
    }

    function rerender() {
        outputEl.innerHTML = '';
        
        const filtered = entries.filter(shouldShowEntry);
        
        if (filtered.length === 0) {
            outputEl.innerHTML = '<div class="empty-state">No matching console messages</div>';
            return;
        }

        filtered.forEach(entry => renderEntry(entry));
        scrollToBottom();
    }

    function clear() {
        entries = [];
        outputEl.innerHTML = `<div class="empty-state">
            <i class="fas fa-terminal"></i>
            <p>Console is empty</p>
            <span>Log messages will appear here</span>
        </div>`;
    }

    function scrollToBottom() {
        // small delay to make sure dom is updated
        setTimeout(() => {
            outputEl.scrollTop = outputEl.scrollHeight;
        }, 10);
    }

    // helper to prevent xss
    function escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    function getEntries() {
        return entries;
    }

    function getCount() {
        return entries.length;
    }

    // export as json - might be useful
    function exportAsJson() {
        return JSON.stringify(entries, null, 2);
    }

    return {
        init: init,
        addEntry: addEntry,
        setFilter: setFilter,
        setSearch: setSearch,
        clear: clear,
        getEntries: getEntries,
        getCount: getCount,
        exportAsJson: exportAsJson
    };
})();
