 /**
 * elements inspector - shows dom tree and styles
 * this one was a pain to get the tree rendering right
 * still not perfect but good enough for now
 */

const ElementsInspector = (function() {
    let treeEl = null;
    let stylesEl = null;
    let iframeDoc = null;
    let selectedElement = null;
    let highlightOverlay = null;

    function init(treeElement, stylesElement) {
        treeEl = treeElement;
        stylesEl = stylesElement;
        // console.log('elements inspector ready');
    }

    function inspectDocument(doc) {
        if (!doc) {
            treeEl.innerHTML = '<div class="empty-state">Cannot access document (CORS restriction)</div>';
            return;
        }

        iframeDoc = doc;
        
        // create highlight overlay in iframe
        createHighlightOverlay();
        
        // render the dom tree
        renderTree();
    }

    function createHighlightOverlay() {
        try {
            // remove existing overlay if any
            const existing = iframeDoc.getElementById('devtools-highlight');
            if (existing) existing.remove();

            highlightOverlay = iframeDoc.createElement('div');
            highlightOverlay.id = 'devtools-highlight';
            highlightOverlay.style.cssText = `
                position: fixed;
                pointer-events: none;
                background: rgba(66, 133, 244, 0.3);
                border: 1px solid rgba(66, 133, 244, 0.8);
                z-index: 999999;
                display: none;
            `;
            iframeDoc.body.appendChild(highlightOverlay);
        } catch(e) {
            // might fail due to cors
            console.warn('couldnt create highlight overlay');
        }
    }

    function renderTree() {
        treeEl.innerHTML = '';
        
        if (!iframeDoc || !iframeDoc.documentElement) {
            treeEl.innerHTML = '<div class="empty-state">No document to inspect</div>';
            return;
        }

        const tree = buildTree(iframeDoc.documentElement, 0);
        treeEl.appendChild(tree);
    }

    function buildTree(element, depth) {
        const container = document.createElement('div');
        container.className = 'dom-node';
        
        // dont go too deep - performance reasons
        if (depth > 15) {
            container.innerHTML = '<span class="dom-text">...</span>';
            return container;
        }

        const hasChildren = element.children && element.children.length > 0;
        const isExpanded = depth < 3; // auto expand first few levels

        // node content
        const content = document.createElement('div');
        content.className = 'dom-node-content';
        
        // toggle arrow with icon
        const toggle = document.createElement('span');
        toggle.className = 'dom-toggle' + (isExpanded ? ' expanded' : '');
        toggle.innerHTML = hasChildren ? '<i class="fas fa-chevron-right"></i>' : '';
        content.appendChild(toggle);

        // tag name and attributes
        const tagHtml = formatElement(element);
        const tagSpan = document.createElement('span');
        tagSpan.innerHTML = tagHtml;
        content.appendChild(tagSpan);

        container.appendChild(content);

        // children container
        const childrenContainer = document.createElement('div');
        childrenContainer.className = 'dom-children';
        childrenContainer.style.display = isExpanded ? 'block' : 'none';

        if (hasChildren) {
            Array.from(element.children).forEach(child => {
                // skip our highlight overlay
                if (child.id === 'devtools-highlight') return;
                childrenContainer.appendChild(buildTree(child, depth + 1));
            });
        } else if (element.textContent && element.textContent.trim()) {
            // show text content for leaf nodes
            const text = element.textContent.trim();
            if (text.length > 0 && text.length < 100) {
                const textNode = document.createElement('div');
                textNode.className = 'dom-node';
                textNode.innerHTML = `<span class="dom-text">"${escapeHtml(text.substring(0, 50))}${text.length > 50 ? '...' : ''}"</span>`;
                childrenContainer.appendChild(textNode);
            }
        }

        container.appendChild(childrenContainer);

        // event handlers
        toggle.addEventListener('click', (e) => {
            e.stopPropagation();
            const isNowExpanded = childrenContainer.style.display !== 'none';
            childrenContainer.style.display = isNowExpanded ? 'none' : 'block';
            toggle.classList.toggle('expanded', !isNowExpanded);
        });

        content.addEventListener('click', () => {
            selectElement(element, container);
        });

        content.addEventListener('mouseenter', () => {
            highlightElement(element);
        });

        content.addEventListener('mouseleave', () => {
            hideHighlight();
        });

        // store reference to actual element
        container._element = element;

        return container;
    }

    function formatElement(el) {
        const tag = el.tagName.toLowerCase();
        let html = `<span class="dom-tag">&lt;${tag}</span>`;

        // add some key attributes
        if (el.id) {
            html += ` <span class="dom-attr-name">id</span>=<span class="dom-attr-value">"${escapeHtml(el.id)}"</span>`;
        }
        if (el.className && typeof el.className === 'string') {
            const classes = el.className.trim();
            if (classes) {
                html += ` <span class="dom-attr-name">class</span>=<span class="dom-attr-value">"${escapeHtml(classes.substring(0, 50))}"</span>`;
            }
        }

        html += `<span class="dom-tag">&gt;</span>`;
        return html;
    }

    function selectElement(element, nodeEl) {
        // deselect previous
        const prev = treeEl.querySelector('.dom-node.selected');
        if (prev) prev.classList.remove('selected');

        // select new
        nodeEl.classList.add('selected');
        selectedElement = element;

        // show styles
        showStyles(element);
    }

    function showStyles(element) {
        if (!element || !iframeDoc) {
            stylesEl.innerHTML = '<div class="empty-state">Select an element to see styles</div>';
            return;
        }

        try {
            const computed = iframeDoc.defaultView.getComputedStyle(element);
            
            // show commonly useful properties
            const props = [
                'display', 'position', 'width', 'height',
                'margin', 'padding', 'border',
                'color', 'background-color', 'font-size', 'font-family',
                'flex', 'grid', 'overflow'
            ];

            let html = '';
            props.forEach(prop => {
                const value = computed.getPropertyValue(prop);
                if (value && value !== 'none' && value !== 'normal' && value !== 'auto') {
                    html += `<div class="style-property">
                        <span class="style-name">${prop}:</span>
                        <span class="style-value">${escapeHtml(value)}</span>
                    </div>`;
                }
            });

            if (!html) {
                html = '<div class="empty-state">No computed styles</div>';
            }

            stylesEl.innerHTML = html;
        } catch(e) {
            stylesEl.innerHTML = '<div class="empty-state">Cannot read styles</div>';
        }
    }

    function highlightElement(element) {
        if (!highlightOverlay || !element) return;

        try {
            const rect = element.getBoundingClientRect();
            highlightOverlay.style.top = rect.top + 'px';
            highlightOverlay.style.left = rect.left + 'px';
            highlightOverlay.style.width = rect.width + 'px';
            highlightOverlay.style.height = rect.height + 'px';
            highlightOverlay.style.display = 'block';
        } catch(e) {
            // silently fail
        }
    }

    function hideHighlight() {
        if (highlightOverlay) {
            highlightOverlay.style.display = 'none';
        }
    }

    function refresh() {
        if (iframeDoc) {
            renderTree();
        }
    }

    function clear() {
        treeEl.innerHTML = `<div class="empty-state">
            <i class="fas fa-sitemap"></i>
            <p>No elements to show</p>
            <span>Load a page to inspect the DOM</span>
        </div>`;
        stylesEl.innerHTML = `<div class="empty-state">
            <i class="fas fa-paint-brush"></i>
            <p>No element selected</p>
            <span>Click an element to see its styles</span>
        </div>`;
        selectedElement = null;
        iframeDoc = null;
    }

    function escapeHtml(str) {
        if (!str) return '';
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    return {
        init: init,
        inspectDocument: inspectDocument,
        refresh: refresh,
        clear: clear
    };
})();
