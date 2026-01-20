 # Mini DevTools

I got tired of constantly switching to Chrome DevTools just to check a quick console.log or see if a fetch request went through. So I built this lightweight alternative that runs right in the browser.

It's not meant to replace the real DevTools - that would be crazy. But for quick debugging sessions or when you want to inspect a page in an iframe, this gets the job done.

## What it does

- **Console Tab** - Captures console.log, warn, error from the loaded page. Color coded and filterable.
- **Network Tab** - Shows fetch and XHR requests with status, timing, and response data
- **Elements Tab** - Basic DOM tree inspector with element highlighting on hover

## How to use

1. Start the server: `node server.js`
2. Open http://localhost:3000 in your browser
3. Enter a URL in the top bar (e.g. https://example.com)
4. Click "Load Page" or hit Enter
5. Switch between tabs to see console output, network requests, or DOM structure

**Quick test:** Try loading `test-page.html` - it has buttons to trigger console logs and network requests so you can see everything working.

**Note:** The Node.js server acts as a proxy to bypass CORS restrictions. External pages are fetched server-side and served with injected monitoring scripts.

## Screenshots

(TODO: add some screenshots)

## Known limitations

- **Some sites still won't work** - Sites with strict CSP or that detect proxy/iframe embedding might not load properly. Nothing I can do about that.
- **JavaScript-heavy SPAs** - Some React/Vue apps might not render correctly since we're essentially doing server-side fetching.
- **Performance** - If a page has thousands of console logs, things might get slow. I added a cap of 500 entries but maybe should add virtual scrolling at some point.
- **Requires Node.js** - You need Node.js installed to run the proxy server.

## Keyboard shortcuts

- `Ctrl+K` - Clear console
- `Ctrl+L` - Focus URL input
- `Ctrl+R` - Refresh the loaded page

## Tech stuff

Pure vanilla JS, no frameworks or build tools. Just HTML, CSS, and JavaScript files you can open directly in a browser.

The architecture is pretty simple:
- `app.js` - Main controller that wires everything together
- `modules/iframe-manager.js` - Handles loading pages and injecting monitoring scripts
- `modules/console-monitor.js` - Captures and displays console output
- `modules/network-monitor.js` - Intercepts fetch/XHR and shows request details
- `modules/elements-inspector.js` - Builds the DOM tree view

## Things I might add later

- [ ] Export logs as JSON
- [ ] Screenshot feature
- [ ] Regex filtering for console
- [ ] Virtual scrolling for better performance
- [ ] Maybe a simple performance tab?

## Why vanilla JS?

Honestly, I just wanted to see if I could build something useful without reaching for React or Vue. Turns out you can! The code is a bit more verbose but it's also easier to understand what's happening.

## Browser support

Tested on Chrome and Firefox. Should work on Edge too. Safari... probably? Let me know if it breaks.

---

Feel free to fork this and make it better. PRs welcome!
