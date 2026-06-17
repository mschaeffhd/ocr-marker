const CONFIG = {
    markerServerUrl: './api/marker/upload',
    openwebuiUrl: 'https://openwebui.sbbz-ilvesheim.de/api',
    apiToken: '',
    markerApiToken: '',
    model: 'alleskoenner-schnell-qwen36-35b-a3b',
    ocrBackend: 'marker',
    chandraUrl: 'http://127.0.0.1:1234',
    chandraModel: 'chandra-ocr-2-nvfp4-mlx',
};

// Default prompt for image recognition
const DEFAULT_IMAGE_PROMPT = `Describe illustrations comprehensively in German. Use the following internal structure:

((Bild))<br/>
Art der Abbildung (z. B. Foto, Zeichnung, Diagramm):<br/>
Beschreibung: …  / Bildtext: …<br/>
((/Bild))

example:
((Bild))<br/>
Diagramm:<br/>
Eine farbenfrohe Illustration eines Party-Poppers, der buntes Konfetti und kleine Girlanden ausstößt, begleitet von dem Text „Purchase Completed!“<br/>
((/Bild))

* Place captions and titles above the ((Bild))((/Bild)) tag if they exist in the source.
* Use LaTeX for ALL mathematical expressions.
* If there is text in the image stick with the language it is written in and don't translate it.`;

// Encryption Key (Simple default as requested)
const SECRET_KEY = 'marker-pipeline-secret-key-123';

function encrypt(text) {
    try {
        return CryptoJS.AES.encrypt(text, SECRET_KEY).toString();
    } catch (e) {
        console.error('Encryption failed:', e);
        return text;
    }
}

function decrypt(ciphertext) {
    if (!ciphertext) return null;
    try {
        const bytes = CryptoJS.AES.decrypt(ciphertext, SECRET_KEY);
        // Using toString(Utf8) can throw if data is malformed
        try {
            const originalText = bytes.toString(CryptoJS.enc.Utf8);
            return originalText || null;
        } catch (err) {
            console.warn('UTF-8 String conversion failed, possibly corrupted data.');
            return null;
        }
    } catch (e) {
        console.error('Decryption failed:', e);
        return null;
    }
}

// ===== State =====
let state = {
    pdfFile: null,
    bookName: 'export',
    markdown: '',
    images: {}, // {filename: base64}
    descriptions: {}, // {filename: description}
    pipelineRunning: false,
    currentStep: 0,
};

// ===== PDF Preview State =====
let pdfPageImages = {}; // {pageNum: base64}
let pdfTotalPages = 0;
let pdfDocument = null; // pdf.js document reference
let pdfArrayBuffer = null; // cached for on-demand rendering

// ===== Comparison View State =====
let compareViewOpen = false;
let compareCurrentPage = '1';
let comparePageMap = {}; // {pageNum: {pdfPage, extractedImages[], descriptions[]}}


// ===== Markdown Sync State =====
let mdPageOffsets = {}; // {pageNum: htmlElementId}

// ===== DOM Elements =====
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

// Safe event listener helper
function on(selector, event, handler) {
    const el = $(selector);
    if (el) {
        el.addEventListener(event, handler);
    } else {
        console.warn(`Safe listener: Element "${selector}" not found in DOM.`);
    }
}
function showToast(message, type = 'info') {
    const container = $('#toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 4000);
}

function showLoading(show) {
    $('#loadingOverlay').style.display = show ? 'flex' : 'none';
}

function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function setStepStatus(stepNum, status, message) {
    const step = $(`[data-step="${stepNum}"]`);
    if (!step) return;
    
    const statusEl = step.querySelector('.step-status');
    if (statusEl) statusEl.textContent = message || status;
    
    step.classList.remove('active', 'completed', 'error');
    step.classList.add(status === 'completed' ? 'completed' : status === 'error' ? 'error' : 'active');
}

function addLog(logId, message, type = 'info') {
    const log = $(`#${logId}`);
    if (!log) return;
    
    log.style.display = 'block';
    const entry = document.createElement('div');
    entry.className = `log-entry ${type}`;
    const time = new Date().toLocaleTimeString('de-DE');
    entry.textContent = `[${time}] ${message}`;
    log.appendChild(entry);
    log.scrollTop = log.scrollHeight;
    
    // Also push to system console
    debugLog(message, type);
}

function debugLog(message, type = 'info') {
    const consoleBody = $('#systemConsole');
    if (!consoleBody) return;
    
    const entry = document.createElement('div');
    entry.className = `console-entry ${type}`;
    
    const time = new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const timeSpan = document.createElement('span');
    timeSpan.className = 'console-time';
    timeSpan.textContent = `[${time}]`;
    
    entry.appendChild(timeSpan);
    entry.appendChild(document.createTextNode(message));
    
    consoleBody.appendChild(entry);
    consoleBody.scrollTop = consoleBody.scrollHeight;
    
    if (type === 'error') {
        console.error(`[System Console] ${message}`);
    }
}

// Safe DOM helpers
const safeText = (sel, text) => { const el = $(sel); if (el) el.textContent = text; else console.warn(`Missing text element: ${sel}`); };
const safeHTML = (sel, html) => { const el = $(sel); if (el) el.innerHTML = html; else console.warn(`Missing HTML element: ${sel}`); };
const safeStyle = (sel, prop, val) => { const el = $(sel); if (el) el.style[prop] = val; else console.warn(`Missing style element: ${sel}`); };
const safeVal = (sel) => { const el = $(sel); return el ? el.value : ''; };

// ===== Utility Functions =====

// Step 1: File check
async function prepareFile(file) {
    addLog('conversionLog', `Datei vorbereitet: ${file.name} (${formatFileSize(file.size)})`, 'success');
    return file;
}

async function convertWithMarker() {
    const formData = new FormData();
    formData.append('file', state.pdfFile);
    
    // Basis-Einstellungen für Marker-Server
    formData.append('output_format', safeVal('#outputFormat') || 'markdown');
    
    const forceOcr = $('#forceOcr');
    if (forceOcr && forceOcr.checked) {
        formData.append('force_ocr', 'true');
    }
    
    const paginateOutput = $('#paginateOutput');
    if (paginateOutput && paginateOutput.checked) {
        formData.append('paginate_output', 'true');
    }
    
    const pageRange = $('#pageRange');
    if (pageRange && pageRange.value.trim()) {
        formData.append('page_range', pageRange.value.trim());
    }
    
    // Experimentelle Optionen
    const useLlm = $('#useLlm');
    if (useLlm && useLlm.checked) {
        formData.append('use_llm', 'true');
    }
    const stripExistingOcr = $('#stripExistingOcr');
    if (stripExistingOcr && stripExistingOcr.checked) {
        formData.append('strip_existing_ocr', 'true');
    }
    const redoInlineMath = $('#redoInlineMath');
    if (redoInlineMath && redoInlineMath.checked) {
        formData.append('redo_inline_math', 'true');
    }
    const disableImageExtraction = $('#disableImageExtraction');
    if (disableImageExtraction && disableImageExtraction.checked) {
        formData.append('disable_image_extraction', 'true');
    }
    
    const headers = {};
    const markerToken = (CONFIG.markerApiToken && CONFIG.markerApiToken.trim() !== '')
        ? CONFIG.markerApiToken.trim()
        : (CONFIG.apiToken && CONFIG.apiToken.trim() !== '')
            ? CONFIG.apiToken.trim()
            : '';
    if (markerToken) {
        headers['Authorization'] = 'Bearer ' + markerToken;
        debugLog('Sende Marker-Request mit API-Token.', 'debug');
    } else {
        debugLog('Kein API-Token für Marker angegeben.', 'warn');
    }

    // Check for local file execution
    if (window.location.protocol === 'file:') {
        debugLog('HINWEIS: Browser blockieren API-Anfragen oft, wenn HTML-Dateien direkt (file://) geöffnet werden. Empfehlung: Starten Sie einen lokalen Server.', 'warn');
    }
    
    // Build upload URL from server URL (checks if /upload is already present)
    const markerServerInput = $('#markerServerUrl');
    const markerServer = markerServerInput ? markerServerInput.value.trim().replace(/\/+$/, '') : '';
    let uploadUrl = markerServer || './api/marker/upload';
    
    // Only append /upload if the value is not empty and doesn't already end with /upload
    if (markerServer && !markerServer.endsWith('/upload')) {
        uploadUrl = markerServer + '/upload';
    }
    
    debugLog(`POST Request an ${uploadUrl} (Größe: ${formatFileSize(state.pdfFile.size)})`, 'debug');
    
    try {
        const response = await fetch(uploadUrl, {
            method: 'POST',
            headers: headers,
            body: formData
        });
        
        debugLog(`Antwort empfangen: ${response.status} ${response.statusText}`, response.ok ? 'success' : 'error');
        
        const result = await response.json();
        
        if (!result.success) throw new Error(`Marker Konvertierung fehlgeschlagen: ${result.error || 'Unbekannter Fehler'}`);
        
        state.markdown = result.output || '';
        state.images = result.images || {};
        
        addLog('conversionLog', `${result.output?.length || 0} Zeichen konvertiert`, 'success');
        addLog('conversionLog', `${Object.keys(state.images).length} Bilder extrahiert`, 'success');
        
        // Update stats safely
        safeText('#statChars', (result.output?.length || 0).toLocaleString());
        safeText('#statImages', Object.keys(state.images).length);
        safeStyle('#conversionStats', 'display', 'flex');
        
        // IMMEDIATE UPDATE: Show results now!
        updateMarkdownWithCaptions();
        
        return result;
    } catch (err) {
        if (err.message === 'Failed to fetch') {
            debugLog('FEHLER: "Failed to fetch". Dies ist fast immer ein Netzwerk- oder CORS-Problem.', 'error');
            debugLog('Mögliche Lösungen:', 'info');
            debugLog('1. Prüfen Sie, ob der Server CORS-Header für Ihren Ursprung (Origin) sendet.', 'warn');
            debugLog('2. Wenn Sie die Datei lokal öffnen, nutzen Sie einen Webserver (z.B. npx serve).', 'warn');
            debugLog('3. Prüfen Sie, ob die API-URL korrekt erreichbar ist.', 'warn');
        }
        throw err;
    }
}

// ── Chandra OCR (via LM Studio) ──────────────────────────────────────────────

function parsePageRange(rangeStr, totalPages) {
    if (!rangeStr) return Array.from({ length: totalPages }, (_, i) => i + 1);
    const pages = new Set();
    for (const part of rangeStr.split(',')) {
        const m = part.trim().match(/^(\d+)(?:-(\d+))?$/);
        if (!m) continue;
        const start = parseInt(m[1]);
        const end = m[2] ? parseInt(m[2]) : start;
        for (let p = start; p <= Math.min(end, totalPages); p++) pages.add(p);
    }
    return [...pages].sort((a, b) => a - b);
}

function chandraHtmlToMarkdown(html) {
    if (!html || !html.trim()) return '';
    const parser = new DOMParser();
    const doc = parser.parseFromString('<body>' + html + '</body>', 'text/html');

    // Convert element content to text, wrapping <math> in $...$ and preserving <b>/<i>
    function innerText(el) {
        let text = '';
        for (const node of el.childNodes) {
            if (node.nodeType === Node.TEXT_NODE) {
                text += node.textContent;
            } else if (node.nodeType === Node.ELEMENT_NODE) {
                const tag = node.tagName.toLowerCase();
                const lbl = node.dataset && node.dataset.label;
                if (tag === 'math') {
                    const latex = node.textContent.trim();
                    text += latex ? ' $' + latex + '$ ' : '';
                } else if (lbl === 'InlineEquation' || lbl === 'Inline-Equation') {
                    text += ' $' + node.textContent.trim() + '$ ';
                } else if (tag === 'b' || tag === 'strong') {
                    text += '**' + innerText(node) + '**';
                } else if (tag === 'i' || tag === 'em') {
                    text += '*' + innerText(node) + '*';
                } else {
                    text += innerText(node);
                }
            }
        }
        return text;
    }

    // Determine heading level from child h1-h6 tag, default ##
    function headingPrefix(block) {
        const h = block.querySelector('h1,h2,h3,h4,h5,h6');
        if (!h) return '## ';
        const level = parseInt(h.tagName[1]);
        return '#'.repeat(Math.min(level, 4)) + ' ';
    }

    function nodeToMd(node) {
        if (node.nodeType === Node.TEXT_NODE) return node.textContent;
        if (node.nodeType !== Node.ELEMENT_NODE) return '';
        const tag = node.tagName.toLowerCase();
        if (tag === 'math') return ' $' + node.textContent.trim() + '$ ';
        if (tag === 'b' || tag === 'strong') return '**' + Array.from(node.childNodes).map(nodeToMd).join('') + '**';
        if (tag === 'i' || tag === 'em') return '*' + Array.from(node.childNodes).map(nodeToMd).join('') + '*';
        if (tag === 'ol') {
            let i = 1;
            return Array.from(node.children)
                .filter(n => n.tagName.toLowerCase() === 'li')
                .map(li => `${i++}. ${Array.from(li.childNodes).map(nodeToMd).join('').trim()}`)
                .join('\n') + '\n';
        }
        if (tag === 'ul') {
            return Array.from(node.children)
                .filter(n => n.tagName.toLowerCase() === 'li')
                .map(li => `- ${Array.from(li.childNodes).map(nodeToMd).join('').trim()}`)
                .join('\n') + '\n';
        }
        if (tag === 'table') {
            return '\n' + node.outerHTML.replace(/<math>([\s\S]*?)<\/math>/g, (_, c) => '$' + c.trim() + '$') + '\n';
        }
        return Array.from(node.childNodes).map(nodeToMd).join('');
    }

    const blocks = doc.body.querySelectorAll('div[data-label]');
    if (blocks.length === 0) return nodeToMd(doc.body).trim();

    const parts = [];
    for (const block of blocks) {
        const label = block.dataset.label || '';
        switch (label) {
            case 'Section-Header':
            case 'SectionHeader': {
                const prefix = headingPrefix(block);
                const heading = block.querySelector('h1,h2,h3,h4,h5,h6');
                const text = heading ? innerText(heading).trim() : innerText(block).trim();
                parts.push('\n' + prefix + text + '\n');
                break;
            }
            case 'Text': {
                const t = innerText(block).trim();
                if (t) parts.push(t + '\n');
                break;
            }
            case 'List-Group':
            case 'ListGroup':
                parts.push(nodeToMd(block).trim() + '\n');
                break;
            case 'List-Item':
            case 'ListItem':
                parts.push('- ' + innerText(block).trim());
                break;
            case 'Equation':
            case 'Display-Equation': {
                const mathEl = block.querySelector('math');
                const eq = mathEl ? mathEl.textContent.trim() : block.textContent.trim();
                if (eq) parts.push('\n$$\n' + eq + '\n$$\n');
                break;
            }
            case 'Table': {
                const tbl = block.querySelector('table');
                if (tbl) {
                    const rows = Array.from(tbl.querySelectorAll('tr'));
                    if (rows.length) {
                        const mdRows = rows.map(row =>
                            '| ' + Array.from(row.querySelectorAll('th,td')).map(c => innerText(c).trim()).join(' | ') + ' |'
                        );
                        const colCount = tbl.querySelector('tr')?.querySelectorAll('th,td').length || 1;
                        mdRows.splice(1, 0, '| ' + Array(colCount).fill('---').join(' | ') + ' |');
                        parts.push('\n' + mdRows.join('\n') + '\n');
                    }
                } else { const tb = innerText(block).trim(); if (tb) parts.push(tb); }
                break;
            }
            case 'Figure':
            case 'Image': {
                const img = block.querySelector('img');
                const alt = img ? (img.getAttribute('alt') || '').trim() : '';
                const captionText = innerText(block).trim();
                const description = [captionText, alt].filter(Boolean).join(' ');
                if (description) parts.push('\n*[Abbildung: ' + description + ']*\n');
                break;
            }
            case 'Caption':
                parts.push('*' + innerText(block).trim() + '*\n');
                break;
            case 'Footnote':
            case 'FootNote':
                parts.push('> ' + innerText(block).trim() + '\n');
                break;
            case 'Page-Header':
            case 'PageHeader':
            case 'Page-Footer':
            case 'PageFooter':
                break;
            default: {
                const def = innerText(block).trim();
                if (def) parts.push(def + '\n');
            }
        }
    }
    return parts.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

async function convertWithChandra() {
    if (!pdfDocument) throw new Error('Kein PDF geladen');

    const chandraUrl = ($('#chandraUrl')?.value || CONFIG.chandraUrl || 'http://127.0.0.1:1234').replace(/\/$/, '');
    const chandraModel = $('#chandraModel')?.value || CONFIG.chandraModel || 'chandra-ocr-2-nvfp4-mlx';
    const pageRange = $('#pageRange')?.value?.trim() || '';
    const pages = parsePageRange(pageRange, pdfTotalPages);

    addLog('conversionLog', `Chandra: ${pages.length} Seite(n) · Modell: ${chandraModel}`, 'info');

    const markdownParts = [];
    for (let idx = 0; idx < pages.length; idx++) {
        const pageNum = pages[idx];
        addLog('conversionLog', `Seite ${pageNum} von ${pdfTotalPages} …`, 'info');

        const page = await pdfDocument.getPage(pageNum);

        const textContent = await page.getTextContent();
        const rawText = textContent.items.map(i => i.str + (i.hasEOL ? '\n' : ' ')).join('');

        const firstItem = textContent.items[0]?.str?.trim() || '';
        const pdfPageLabel = /^\d{1,4}$/.test(firstItem) ? firstItem : null;

        const viewport = page.getViewport({ scale: 2.0 });
        const canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
        const imageBase64 = canvas.toDataURL('image/png').split(',')[1];

        const prompt = `The following raw text was extracted directly from this PDF page and is the authoritative source for all symbols, variables, and content:\n\n<raw_text>\n${rawText}\n</raw_text>\n\nConvert this page to well-formatted markdown with LaTeX for all mathematical expressions. Rules:\n- Trust the raw text above for every character and symbol — do NOT substitute, interpret, or correct anything, especially mathematical variables like n, k, ∞.\n- Use the image for layout, structure, and numbered/bulleted list detection.\n- Preserve numbered lists (1. 2. 3.) exactly — never merge list items into prose.\n- For every figure, chart, diagram, or illustration visible in the image: always provide a detailed description IN GERMAN of what is visually shown. A caption label like "Histogramm:" is NOT a description — look at the image and describe the actual visual content. Write the img alt attribute in German.`;

        const response = await fetch(chandraUrl + '/v1/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: chandraModel,
                messages: [{ role: 'user', content: [
                    { type: 'text', text: prompt },
                    { type: 'image_url', image_url: { url: 'data:image/png;base64,' + imageBase64 } }
                ]}],
                max_tokens: 4096,
                temperature: 0
            })
        });

        if (!response.ok) throw new Error(`Chandra API Fehler (Seite ${pageNum}): ${await response.text()}`);

        const result = await response.json();
        const md = chandraHtmlToMarkdown(result.choices[0].message.content);
        const mdWithPageNum = pdfPageLabel ? `((${pdfPageLabel}))\n\n${md}` : md;
        markdownParts.push(mdWithPageNum);
    }

    state.markdown = markdownParts.join('\n\n---\n\n');
    state.images = {};

    safeText('#statChars', state.markdown.length.toLocaleString());
    safeText('#statImages', '0');
    safeStyle('#conversionStats', 'display', 'flex');
    addLog('conversionLog', `✓ ${pages.length} Seite(n) mit Chandra verarbeitet`, 'success');
    updateMarkdownWithCaptions();
}

function updateBackendUI() {
    const backend = $('#ocrBackend')?.value || 'marker';
    const markerDiv = $('#markerSettings');
    const chandraDiv = $('#chandraSettings');
    if (markerDiv) markerDiv.style.display = backend === 'marker' ? '' : 'none';
    if (chandraDiv) chandraDiv.style.display = backend === 'chandra' ? '' : 'none';
}

// Step 3: Describe images with OpenWebUI
async function describeImages() {
    const filenames = Object.keys(state.images);
    if (!filenames.length) return;
    
    safeStyle('#describeProgress', 'display', 'block');
    safeStyle('#describeLog', 'display', 'block');
    
    const total = filenames.length;
    
    for (let i = 0; i < total; i++) {
        const fname = filenames[i];
        const progress = ((i + 1) / total) * 100;
        
        safeStyle('#progressFill', 'width', `${progress}%`);
        safeText('#progressLabel', `${i + 1} / ${total} Bilder`);
        
        try {
            debugLog(`Anfrage Bildbeschreibung für ${fname}...`, 'debug');
            // Get custom prompt or use default
            const customPrompt = $('#imagePrompt')?.value?.trim();
            const promptText = customPrompt || DEFAULT_IMAGE_PROMPT;
            
            const payload = {
                model: CONFIG.model,
                stream: false,
                messages: [
                    {
                        role: 'user',
                        content: [
                            {
                                type: 'text',
                                text: promptText
                            },
                            {
                                type: 'image_url',
                                image_url: {
                                    url: `data:image/jpeg;base64,${state.images[fname]}`
                                }
                            }
                        ]
                    }
                ],
                max_tokens: 100
            };
            
            // BaseURL als chat/completions verwenden
            let baseUrl = CONFIG.openwebuiUrl.replace(/\/+$/, '');
            const chatUrl = baseUrl + '/chat/completions';
            
            const response = await fetch(chatUrl, {
                method: 'POST',
                headers: {
                    'Authorization': 'Bearer ' + CONFIG.apiToken,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payload)
            });
            
            debugLog(`Bildbeschreibung Antwort für ${fname}: ${response.status} (${chatUrl})`, response.ok ? 'debug' : 'error');
            
            const data = await response.json();
            
            if (data.choices && data.choices[0]?.message?.content) {
                const desc = data.choices[0].message.content.trim();
                state.descriptions[fname] = desc;
                
                addLog('describeLog', `Erfolg: ${fname}`, 'success');
            } else {
                state.descriptions[fname] = '';
                addLog('describeLog', `${fname}: Keine Beschreibung möglich`, 'error');
            }
        } catch (err) {
            state.descriptions[fname] = '';
            addLog('describeLog', `${fname}: Fehler - ${err.message}`, 'error');
        }
        
        // Small delay for rate limiting
        await new Promise(r => setTimeout(r, 300));
    }
}

// Step 4: Update Markdown with captions
function updateMarkdownWithCaptions() {
    // 1. Zuerst alle existierenden Beschreibungsblöcke entfernen (verhindert Duplikate)
    let md = state.markdown;
    md = md.replace(/\n?<!-- DESC-START -->\n[\s\S]*?\n<!-- DESC-END -->\n?/g, '\n');
    md = md.replace(/\n{3,}/g, '\n\n');
    
    let lines = md.split('\n');
    const newLines = [];
    
    for (let i = 0; i < lines.length; i++) {
        newLines.push(lines[i]);
        
        const stripped = lines[i].trim();
        if (stripped.startsWith('![[') || stripped.match(/^!\[.*\]\(.*_page_/)) {
            // Find the opening bracket !\[ and closing bracket \]
            const openBracket = stripped.indexOf('![');
            const closeBracket = stripped.indexOf(']', openBracket);
            const openParen = stripped.indexOf('(', closeBracket);
            const closeParen = stripped.indexOf(')', openParen);
            
            if (openParen >= 0 && closeParen > openParen) {
                const fname = stripped.substring(openParen + 1, closeParen);
                const desc = state.descriptions[fname];
                
                if (desc) {
                    // Store description for renderer
                    state.captions = state.captions || {};
                    state.captions[fname] = desc;
                    
                    // Append caption as text under the image with invisible markers for export filtering
                    newLines.push('');
                    newLines.push('<!-- DESC-START -->');
                    newLines.push(desc + '.');
                    newLines.push('<!-- DESC-END -->');
                }
            }
        }
    }
    
    state.markdown = newLines.join('\n');
    
    // Update preview
    $('#mdSource').textContent = state.markdown;
    renderMarkdown(state.markdown);
    
    addLog('mdLog', 'Markdown mit Bildbeschreibungen aktualisiert', 'success');
}

function insertPageNumbers(md) {
    const paginate = $('#paginateOutput')?.checked || false;
    const showNums = $('#showPageNumbers')?.checked || false;
    
    // Only works when both Paginate Output and Show Page Numbers are active
    if (!paginate || !showNums) return md;
    
    const startPage = parseInt($('#pageNumberStart')?.value || '1', 10) || 1;
    const initialNum = parseInt($('#pageNumberInitial')?.value || '1', 10) || 1;
    
    let pages = [];
    let splitBy = 'none';
    
    // Pattern 1: Marker page numbers like {5}------------------------------------------------
    // This is the most common format when marker paginate_output is active
    const markerMatch = md.match(/\n?\{\d+\}[-]+\n?/);
    if (markerMatch) {
        pages = md.split(/\n?\{\d+\}[-]+\n?/);
        splitBy = 'marker-page-numbers';
        console.log(`[PageNumbers] Split on Marker page numbers, found ${pages.length} raw segments`);
    }
    // Pattern 2: Literal \f (backslash + f)
    else if (md.includes('\\f')) {
        pages = md.split(/\\f+/);
        splitBy = 'literal-f';
        console.log(`[PageNumbers] Split on literal \\f, found ${pages.length} raw segments`);
    }
    // Pattern 3: Actual form feed character (ASCII 12)
    else if (md.includes('\x0C')) {
        pages = md.split(/\x0C+/);
        splitBy = 'form-feed';
        console.log(`[PageNumbers] Split on form feed char, found ${pages.length} raw segments`);
    }
    // Pattern 4: Horizontal rule
    else if (md.includes('\n---\n')) {
        pages = md.split('\n---\n');
        splitBy = 'horizontal-rule';
        console.log(`[PageNumbers] Split on horizontal rule (---), found ${pages.length} raw segments`);
    }
    else {
        pages = [md];
        splitBy = 'none';
        console.log('[PageNumbers] No page breaks found, treating as single page');
    }
    
    // Filter out empty pages
    pages = pages.filter(p => p.trim().length > 0);
    if (pages.length === 0) return md;
    
    console.log(`[PageNumbers] After filter: ${pages.length} pages (split by ${splitBy}), startPage=${startPage}, initialNum=${initialNum}`);
    
    const result = [];
    let currentNum = initialNum;
    
    pages.forEach((page, index) => {
        const pageNum = index + 1;
        const prefix = (pageNum < startPage) ? '(( ))' : `((${currentNum++}))`;
        // Remove leading newlines but preserve internal formatting
        const trimmed = page.replace(/^\n+/, '');
        if (trimmed.length > 0) {
            result.push(prefix + '\n' + trimmed);
        }
    });
    
    const output = result.join('\n');
    console.log('[PageNumbers] Output preview:', output.substring(0, 300));
    return output;
}

function renderMarkdown(md) {
    // Insert page numbers before rendering
    const mdWithNumbers = insertPageNumbers(md);
    
    // Update the raw text source to show page numbers too
    const mdSource = $('#mdSource');
    if (mdSource) mdSource.textContent = mdWithNumbers;
    
    // Use the numbered version for rendering
    md = mdWithNumbers;
    
    // Reset page offsets
    mdPageOffsets = {};
    
    // Split into lines for figure detection
    const lines = md.split('\n');
    const processed = [];
    let i = 0;
    
    while (i < lines.length) {
        const line = lines[i];
        const stripped = line.trim();
        
        // Check for image reference
        const imgMatch = stripped.match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
        if (imgMatch) {
            const alt = imgMatch[1];
            const fname = imgMatch[2];
            const hasCaption = state.captions && state.captions[fname];
            
            // Find caption text (skip blank lines)
            let captionText = null;
            let j = i + 1;
            while (j < lines.length && lines[j].trim() === '') {
                j++;
            }
            if (j < lines.length && lines[j].trim() !== '') {
                captionText = lines[j].trim();
            }
            
            // Find base64 image data - try multiple key formats
            let imgSrc = fname;
            let imgAlt = alt;
            let captionForAlt = captionText || null;
            let foundImage = false;
            
            // Try direct match first
            if (state.images[fname]) {
                imgSrc = `data:image/jpeg;base64,${state.images[fname]}`;
                foundImage = true;
            }
            
            // Try without leading underscore (_page_ → page_)
            if (!foundImage && fname.startsWith('_')) {
                const withoutLeading = fname.substring(1);
                if (state.images[withoutLeading]) {
                    imgSrc = `data:image/jpeg;base64,${state.images[withoutLeading]}`;
                    foundImage = true;
                }
            }
            
            // Try with _page_ prefix removed from _page_...
            if (!foundImage && fname.startsWith('_page_')) {
                const fromPage = fname.substring(6);
                if (state.images[fromPage]) {
                    imgSrc = `data:image/jpeg;base64,${state.images[fromPage]}`;
                    foundImage = true;
                }
            }
            
            // Fallback: search for any key that ends with this filename
            if (!foundImage) {
                for (const key of Object.keys(state.images)) {
                    if (key.endsWith(fname) || fname.endsWith(key)) {
                        imgSrc = `data:image/jpeg;base64,${state.images[key]}`;
                        foundImage = true;
                        break;
                    }
                }
            }
            
            if (foundImage) {
                imgAlt = captionForAlt || alt;
            } else {
                // Image not found in state.images - show a placeholder
                imgSrc = `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" style="background:#f0f0f0;display:flex;align-items:center;justify-content:center"><text x="50%" y="50%" text-anchor="middle" fill="#999" font-size="14" dy=".3em">Bild nicht gefunden: ${fname}</text></svg>`)}`;
                debugLog(`Bild nicht gefunden in state.images: "${fname}"`, 'warn');
            }
            
            // Extract page number from filename for sync
            let pageMatch = fname.match(/(?:page|seite)[_\s-]?(\d+)/i);
            if (!pageMatch) pageMatch = fname.match(/(\d+)/);
            const pageNum = pageMatch ? pageMatch[1] : null;
            const anchorId = pageNum ? `md-page-${pageNum}` : null;
            if (anchorId && !mdPageOffsets[pageNum]) {
                mdPageOffsets[pageNum] = anchorId;
            }
            
            // Build HTML
            let html;
            if (hasCaption || captionText) {
                // Render as figure with figcaption
                let captionDisplay = captionForAlt || captionText || imgAlt || '';
                html = anchorId ? `<div id="${anchorId}" class="md-page-anchor"></div>` : '';
                html += `<figure class="image-caption"><img src="${imgSrc}" alt="${imgAlt}" title="${captionDisplay}" style="display:block;margin:12px auto;max-width:100%;height:auto;">`;
                if (captionDisplay) {
                    html += `<figcaption>${captionDisplay}</figcaption>`;
                }
                html += `</figure>`;
            } else {
                // Render as plain image (no caption)
                html = anchorId ? `<div id="${anchorId}" class="md-page-anchor"></div>` : '';
                html += `<img src="${imgSrc}" alt="${imgAlt}" style="display:block;margin:12px auto;max-width:100%;height:auto;">`;
            }
            
            processed.push(html);
            if (captionText) {
                i = j + 1; // Skip caption line
            } else {
                i++;
            }
        } else {
            processed.push(line);
            i++;
        }
    }
    
    // Update raw source
    safeText('#mdSource', state.markdown || processed.join('\n'));

    // Build overall HTML
    let finalHtml = processed.join('\n')
        .replace(/^### (.+)$/gm, '<h3>$1</h3>')
        .replace(/^## (.+)$/gm, '<h2>$1</h2>')
        .replace(/^# (.+)$/gm, '<h1>$1</h1>')
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.+?)\*/g, '<em>$1</em>')
        .replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>')
        .replace(/^- (.+)$/gm, '<li>$1</li>')
        .replace(/\n/g, '<br>');
    
    safeHTML('#mdRendered', finalHtml);
    if (window.MathJax) MathJax.typesetPromise(['#mdRendered']);
}

// Step 5: Create ZIP
async function createZipArchive() {
    const zip = new JSZip();
    const bookName = state.bookName || 'export';
    
    addLog('uploadLog', 'Erstelle ZIP-Archiv...', 'info');
    
    // Add output file (Markdown or JSON)
    const outputFormat = $('#outputFormat')?.value || 'markdown';
    const ext = outputFormat === 'json' ? 'json' : 'md';
    zip.file(`${bookName}.${ext}`, state.markdown);
    
    // Add images
    let imageCount = 0;
    for (const [fname, b64] of Object.entries(state.images)) {
        // Convert base64 to arraybuffer
        const binary = atob(b64);
        const array = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
            array[i] = binary.charCodeAt(i);
        }
        zip.file(fname, array.buffer);
        imageCount++;
    }
    
    const content = await zip.generateAsync({ type: 'blob' });
    state.zipBlob = content;
    
    // Update summary safely (ZIP only visible for Markdown output)
    const isJsonOutput = outputFormat === 'json';
    safeText('#zipStatus', 'Erstellt');
    if (!isJsonOutput) {
        safeStyle('#uploadSummary', 'display', 'inline');
        safeStyle('#uploadDivider', 'display', 'inline');
        safeStyle('#btnDownloadZip', 'display', 'inline-flex');
    }
    
    addLog('conversionLog', `ZIP-Archiv fertiggestellt mit ${imageCount} Bildern`, 'success');
    
    return content;
}

// Regenerate ZIP in background when images/descriptions change
async function regenerateZip() {
    if (!state.zipBlob) return; // Only if ZIP was already created
    try {
        await createZipArchive();
        debugLog('ZIP-Archiv im Hintergrund aktualisiert', 'info');
    } catch (err) {
        console.error('ZIP regeneration error:', err);
    }
}

// ===== Main Pipeline =====
async function runPipeline() {
    if (state.pipelineRunning) return;
    state.pipelineRunning = true;
    
    debugLog('Pipeline gestartet.', 'info');
    
    const btnStart = $('#btnStart');
    btnStart.disabled = true;
    
    // Check if file is an image (skip marker conversion)
    const file = state.pdfFile;
    const isImage = file && (file.type.startsWith('image/') || /\.(png|jpe?g|webp|gif)$/i.test(file.name));
    
    // Get config values
    CONFIG.markerServerUrl = $('#markerServerUrl').value;
    CONFIG.markerUploadUrl = $('#markerServerUrl').value ? ($('#markerServerUrl').value.replace(/\/+$/, '') + '/upload') : './api/marker/upload';
    CONFIG.markerApiToken = $('#markerApiToken')?.value || '';
    CONFIG.openwebuiUrl = $('#openwebuiUrl').value;
    CONFIG.apiToken = $('#apiToken').value;
    CONFIG.model = $('#modelSelect').value;
    
    // Reset logs
    $$('.step-log').forEach(log => { log.innerHTML = ''; log.style.display = 'none'; });
    if ($('#conversionStats')) $('#conversionStats').style.display = 'none';
    if ($('#describeProgress')) $('#describeProgress').style.display = 'none';
    if ($('#imageThumbnails')) $('#imageThumbnails').innerHTML = '';
    if ($('#uploadSummary')) $('#uploadSummary').style.display = 'none';
    if ($('#uploadDivider')) $('#uploadDivider').style.display = 'none';
    if ($('#btnDownloadZip')) $('#btnDownloadZip').style.display = 'none';
    
    try {
        // Step 1: Prepare
        setStepStatus(1, 'active', 'Bereite Datei vor...');
        await prepareFile(file);
        setStepStatus(1, 'completed', 'Datei bereit ✓');
        
        // Step 2: Convert (skip for images - already handled in handleFileSelect)
        if (isImage) {
            setStepStatus(2, 'completed', 'Bild direkt geladen ✓ (keine Konvertierung nötig)');
            addLog('conversionLog', 'Bild direkt geladen – keine Marker-Konvertierung nötig.', 'info');
        } else {
            const backend = $('#ocrBackend')?.value || 'marker';
            if (backend === 'chandra') {
                setStepStatus(2, 'active', 'Konvertiere mit Chandra (LM Studio)...');
                addLog('conversionLog', 'Starte Chandra-Konvertierung...', 'info');
                await convertWithChandra();
                setStepStatus(2, 'completed', 'Konvertiert mit Chandra ✓');
            } else {
                setStepStatus(2, 'active', 'Konvertiere mit Marker...');
                addLog('conversionLog', 'Starte Konvertierung...', 'info');
                await convertWithMarker();
                setStepStatus(2, 'completed', 'Konvertiert ✓');
            }
        }
        
        // Step 3: Describe
        setStepStatus(3, 'active', 'Generiere Beschreibungen...');
        addLog('describeLog', 'Starte Bildanalyse...', 'info');
        await describeImages();
        setStepStatus(3, 'completed', 'Beschreibungen erstellt ✓');
        
        // Step 4: Update markdown
        setStepStatus(4, 'active', 'Aktualisiere Markdown...');
        updateMarkdownWithCaptions();
        setStepStatus(4, 'completed', 'Markdown aktualisiert ✓');
        
        // Step 5: ZIP Archive
        setStepStatus(5, 'active', 'Erstelle ZIP-Archiv...');
        await createZipArchive();
        setStepStatus(5, 'completed', 'ZIP-Archiv erstellt ✓');
        
        showToast('Pipeline abgeschlossen!', 'success');
        debugLog('Pipeline erfolgreich abgeschlossen.', 'success');
        
    } catch (err) {
        console.error('Pipeline Error:', err);
        debugLog(`Pipeline Fehler: ${err.message}`, 'error');
        showToast(`Fehler: ${err.message}`, 'error');
        
        // Mark current step as error
        if (state.currentStep > 0) {
            setStepStatus(state.currentStep, 'error', `Fehler: ${err.message}`);
        }
    } finally {
        state.pipelineRunning = false;
        btnStart.disabled = false;
        showLoading(false);
        
        // Auto-open comparison view after pipeline completes
        const imgCount = Object.keys(state.images).length;
        if (imgCount > 0) {
            setTimeout(() => openCompareView(), 500);
        }
    }
}

function getCleanedMarkdown(markdown) {
    const docxOptUnitCm = document.getElementById("docx-opt-unit-cm");
    const docxOptUnitCirc = document.getElementById("docx-opt-unit-circ");
    const docxOptLatexSpaceBlock = document.getElementById("docx-opt-latex-space-block");
    const docxOptLatexSpaceInline = document.getElementById("docx-opt-latex-space-inline");
    const docxOptGreek = document.getElementById("docx-opt-greek");
    const docxOptSupsub = document.getElementById("docx-opt-supsub");
    const docxOptNonAscii = document.getElementById("docx-opt-nonascii");
    const docxOptNbspNarrow = document.getElementById("docx-opt-nbsp-narrow");
    const docxOptQuotes = document.getElementById("docx-opt-quotes");
    const docxOptHyphens = document.getElementById("docx-opt-hyphens");
    const docxOptWhitespace = document.getElementById("docx-opt-whitespace");
    const docxOptLatex = document.getElementById("docx-opt-latex");
    const docxOptDollar = document.getElementById("docx-opt-dollar");
    const docxOptCdot = document.getElementById("docx-opt-cdot");
    const docxOptImages = document.getElementById("docx-opt-images");
    const docxOptDashes = document.getElementById("docx-opt-dashes");
    const docxOptPagebreak = document.getElementById("docx-opt-pagebreak");

    let cleaned = markdown;

    // --- 0. Seitenumbruch vor Seitenzahlen (z.B. ((16 ))) ---
    if (docxOptPagebreak && docxOptPagebreak.checked) {
        cleaned = cleaned.replace(/(\(\(\s*\d*\s*\)\))/g, '<div class="page-break" style="page-break-before:always;">&nbsp;</div>\n\n$1');
    }

    // --- 1. Einheiten (\text, \mathrm) bereinigen ---
    if (docxOptUnitCm && docxOptUnitCm.checked) {
        cleaned = cleaned.replace(/\\(?:text|mathrm|textnormal)\s*\{\s*([^{}]+?)\s*\}/g, "$1");
    }

    // --- 2. Zirkumflex (^) zu Grad (°) ---
    if (docxOptUnitCirc && docxOptUnitCirc.checked)
        cleaned = cleaned.replace(/\^circ/g, "°");

    // --- 3a. Leerzeichen in $$...$$ entfernen ---
    if (docxOptLatexSpaceBlock && docxOptLatexSpaceBlock.checked) {
        cleaned = cleaned.replace(/\$$([\s\S]*?)\$$/g, (match, content) => {
            return "$$" + content.replace(/\s+/g, "") + "$$";
        });
    }

    // --- 3b. Leerzeichen in $...$ entfernen ---
    if (docxOptLatexSpaceInline && docxOptLatexSpaceInline.checked) {
        cleaned = cleaned.replace(/(\$)([^$\n]+?)(\$)/g, (match, open, content, close) => {
            return open + content.replace(/\s+/g, "") + close;
        });
    }

    // -- 4. GREEK TO LATEX CONVERSION --
    if (docxOptGreek && docxOptGreek.checked) {
        const greekToLatex = {
            α: "\\alpha", β: "\\beta", γ: "\\gamma", δ: "\\delta", ε: "\\epsilon", ϵ: "\\varepsilon",
            ζ: "\\zeta", η: "\\eta", θ: "\\theta", ϑ: "\\vartheta", ι: "\\iota", κ: "\\kappa",
            λ: "\\lambda", μ: "\\mu", ν: "\\nu", ξ: "\\xi", ο: "o", π: "\\pi", ρ: "\\rho",
            σ: "\\sigma", ς: "\\varsigma", τ: "\\tau", υ: "\\upsilon", φ: "\\phi", ϕ: "\\varphi",
            χ: "\\chi", ψ: "\\psi", ω: "\\omega", Α: "A", Β: "B", Γ: "\\Gamma", Δ: "\\Delta",
            Ε: "E", Ζ: "Z", Η: "H", Θ: "\\Theta", Ι: "I", Κ: "K", Λ: "\\Lambda", Μ: "M",
            Ν: "N", Ξ: "\\Xi", Ο: "O", Π: "\\Pi", Ρ: "P", Σ: "\\Sigma", Τ: "T", Υ: "\\Upsilon",
            Φ: "\\Phi", Χ: "X", Ψ: "\\Psi", Ω: "\\Omega",
        };
        cleaned = cleaned.replace(/[α-ωΑ-Ωϵϑϕς]/g, (match) => {
            return (greekToLatex[match] || match) + " ";
        });
    }

    // -- 5. SUPERSCRIPT / SUBSCRIPT --
    if (docxOptSupsub && docxOptSupsub.checked) {
        const supMap = { "⁰": "0", "¹": "1", "²": "2", "³": "3", "⁴": "4", "⁵": "5", "⁶": "6", "⁷": "7", "⁸": "8", "⁹": "9" };
        const subMap = { "₀": "0", "₁": "1", "₂": "2", "₃": "3", "₄": "4", "₅": "5", "₆": "6", "₇": "7", "₈": "8", "₉": "9" };
        cleaned = cleaned.replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹]/g, (m) => "^" + supMap[m]);
        cleaned = cleaned.replace(/[₀₁₂₃₄₅₆₇₈₉]/g, (m) => "_" + subMap[m]);
    }

    // -- 6. NON-ASCII TO LATEX --
    if (docxOptNonAscii && docxOptNonAscii.checked) {
        const charMap = {
            "×": "\\times ", "÷": "\\div ", "±": "\\pm ", "∓": "\\mp ", "≤": "\\leq ", "≥": "\\geq ",
            "≠": "\\neq ", "≈": "\\approx ", "∞": "\\infty ", "•": "\\cdot ", "→": "\\to ", "↔": "\\leftrightarrow ",
            "⇐": "\\Leftarrow ", "⇒": "\\Rightarrow ", "⇔": "\\Leftrightarrow ", "∈": "\\in ", "∉": "\\notin ",
            "⊂": "\\subset ", "⊃": "\\supset ", "∪": "\\cup ", "∩": "\\cap ", "∀": "\\forall ", "∃": "\\exists ",
            "∇": "\\nabla ", "∂": "\\partial ", "∑": "\\sum ", "∏": "\\prod ", "∫": "\\int ",
        };
        const keys = Object.keys(charMap).join("").replace(/[-\/\\^$*+?.()|[\]{}]/g, "\\$&");
        const re = new RegExp(`[${keys}]`, "g");
        cleaned = cleaned.replace(re, (m) => charMap[m]);
    }

    if (docxOptNbspNarrow && docxOptNbspNarrow.checked)
        cleaned = cleaned.replace(/\u00A0/g, "\u202F");

    if (docxOptQuotes && docxOptQuotes.checked)
        cleaned = cleaned.replace(/[“„”«»]/g, '"').replace(/[‘‚’‹›]/g, "'");

    if (docxOptHyphens && docxOptHyphens.checked)
        cleaned = cleaned.replace(/[—–]/g, "-");

    if (docxOptWhitespace && docxOptWhitespace.checked) {
        const regex = docxOptNbspNarrow.checked ? /[\u1680\u180E\u2000-\u200B\u205F\u3000\uFEFF]/g : /[\u1680\u180E\u2000-\u200B\u202F\u205F\u3000\uFEFF]/g;
        cleaned = cleaned.replace(regex, " ");
        if (!docxOptNbspNarrow.checked) cleaned = cleaned.replace(/\u00A0/g, " ");
    }

    if (docxOptLatex && docxOptLatex.checked)
        cleaned = cleaned.replace(/\$$([\s\S]*?)\$$/g, "&lt;L&gt;$1&lt;/L&gt;");

    if (docxOptDollar && docxOptDollar.checked)
        cleaned = cleaned.replace(/\$/g, "");

    if (docxOptCdot && docxOptCdot.checked)
        cleaned = cleaned.replace(/\\cdot/g, "*");

    if (docxOptImages && docxOptImages.checked)
        cleaned = cleaned.replace(/\(\(Bild\)\)/g, "&lt;Bild&gt;").replace(/\(\(\/Bild\)\)/g, "&lt;/Bild&gt;");

    if (docxOptDashes && docxOptDashes.checked)
        cleaned = cleaned.split("\n").filter((line) => !/^---\s*$/.test(line)).join("\n");

    return cleaned;
}

// ===== Event Handlers =====

// Drop zone
const dropZone = $('#dropZone');
const pdfInput = $('#pdfInput');

dropZone.addEventListener('click', () => pdfInput.click());

dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('dragover');
});

dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('dragover');
});

dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    
    const files = e.dataTransfer.files;
    if (files.length) {
        const file = files[0];
        const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
        const isImage = file.type.startsWith('image/') || /\.(png|jpe?g|webp|gif)$/i.test(file.name);
        if (isPdf || isImage) {
            handleFileSelect(file);
        } else {
            showToast('Bitte eine PDF- oder Bild-Datei auswählen', 'error');
        }
    }
});

pdfInput.addEventListener('change', (e) => {
    if (e.target.files.length) {
        handleFileSelect(e.target.files[0]);
    }
});

function handleFileSelect(file) {
    state.pdfFile = file;
    
    // Auto-generate book name from filename (without extension)
    state.bookName = file.name.substring(0, file.name.lastIndexOf('.')) || file.name;
    
    // Detect file type
    const isImage = file.type.startsWith('image/') || /\.(png|jpe?g|webp|gif)$/i.test(file.name);
    
    dropZone.style.display = 'none';
    $('#fileInfo').style.display = 'flex';
    $('#fileName').textContent = file.name;
    $('#fileSize').textContent = formatFileSize(file.size);
    
    if (isImage) {
        // Handle image file directly - no PDF conversion needed
        handleImageFile(file);
    } else {
        // Render PDF preview
        renderPdfPreview(file);
    }
    
    showToast(`${file.name} ausgewählt`, 'info');
}

function handleImageFile(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
        const b64 = e.target.result.replace(/^data:image\/[^;]+;base64,/, '');
        const imgName = file.name;
        state.images = {};
        state.images[imgName] = b64;
        state.rawMarkdown = `![${imgName}](${imgName})`;
        state.markdown = state.rawMarkdown;
        state.totalPages = 1;
        state.extractedImages = 1;
        
        // Show image preview in output area
        $('#mdOutput').innerHTML = `<img src="data:image/jpeg;base64,${b64}" style="max-width:100%; border-radius:8px;">`;
        $('#mdSource').textContent = state.markdown;
        
        // Update stats
        $('#statPages').textContent = '1';
        $('#statChars').textContent = state.markdown.length.toString();
        $('#statImages').textContent = '1';
        
        // Show output section
        $('#stepOutput').classList.add('active');
        $('#outputSection').style.display = 'block';
        
        // Build compare page map
        comparePageMap = { 1: { page: 1, images: [imgName] } };
    };
    reader.readAsDataURL(file);
}

// ===== PDF Preview Rendering =====
async function renderPdfPreview(file) {
    if (typeof pdfjsLib === 'undefined') {
        console.warn('pdf.js not loaded');
        return;
    }
    
    try {
        const ab = await file.arrayBuffer();
        pdfArrayBuffer = ab.slice(0); // clone before pdf.js uses it
        pdfDocument = await pdfjsLib.getDocument({ data: ab }).promise;
        pdfTotalPages = pdfDocument.numPages;
        pdfPageImages = {};
        
        const preview = $('#pdfPreview');
        const grid = $('#pdfGrid');
        const count = $('#pdfPreviewCount');
        const more = $('#pdfPreviewMore');
        
        if (!preview || !grid) return;
        
        grid.innerHTML = '';
        preview.style.display = 'block';
        if (count) count.textContent = `${pdfTotalPages} Seiten`;
        
        // Render first 30 pages as thumbnails (rest on-demand)
        const maxPreviewPages = Math.min(pdfTotalPages, 30);
        
        for (let i = 1; i <= maxPreviewPages; i++) {
            const page = await pdfDocument.getPage(i);
            const viewport = page.getViewport({ scale: 0.3 });
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            canvas.width = viewport.width;
            canvas.height = viewport.height;
            
            await page.render({ canvasContext: ctx, viewport: viewport }).promise;
            
            const base64 = canvas.toDataURL('image/jpeg', 0.7);
            pdfPageImages[i] = base64;
            
            const thumb = document.createElement('div');
            thumb.className = 'pdf-thumb';
            thumb.innerHTML = `
                <img src="${base64}" alt="Seite ${i}">
                <span class="pdf-thumb-page">${i}</span>
            `;
            thumb.addEventListener('click', () => openPdfZoom(base64, i));
            grid.appendChild(thumb);
        }
        
        if (pdfTotalPages > maxPreviewPages) {
            more.style.display = 'flex'; // Use flex for alignment
            safeText('#pdfPreviewMoreText', `… und ${pdfTotalPages - maxPreviewPages} weitere Seiten (werden bei Bedarf nachgeladen)`);
        } else {
            more.style.display = 'none';
        }
        
    } catch (err) {
        console.error('PDF preview error:', err);
        showToast('PDF-Vorschau konnte nicht geladen werden', 'error');
    }
}

// Load the rest of PDF thumbnails
on('#btnLoadAllPdf', 'click', async () => {
    if (!pdfDocument) return;
    
    const more = $('#pdfPreviewMore');
    const btn = $('#btnLoadAllPdf');
    const grid = $('#pdfGrid');
    
    btn.disabled = true;
    btn.textContent = 'Lädt...';
    
    const startNum = Object.keys(pdfPageImages).length + 1;
    
    for (let i = startNum; i <= pdfTotalPages; i++) {
        const page = await pdfDocument.getPage(i);
        const viewport = page.getViewport({ scale: 0.3 });
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        
        await page.render({ canvasContext: ctx, viewport: viewport }).promise;
        
        const base64 = canvas.toDataURL('image/jpeg', 0.7);
        pdfPageImages[i] = base64;
        
        const thumb = document.createElement('div');
        thumb.className = 'pdf-thumb';
        thumb.innerHTML = `
            <img src="${base64}" alt="Seite ${i}">
            <span class="pdf-thumb-page">${i}</span>
        `;
        thumb.addEventListener('click', () => openPdfZoom(base64, i));
        grid.appendChild(thumb);
    }
    
    if (more) more.style.display = 'none';
});

// Render a single PDF page on demand (for comparison view) - always HD, no thumbnail cache overwrite
async function renderPdfPageOnDemand(pageNum) {
    // Try to reload PDF document if lost
    if (!pdfDocument && pdfArrayBuffer) {
        try {
            pdfDocument = await pdfjsLib.getDocument({ data: pdfArrayBuffer }).promise;
        } catch (e) {
            console.error('Failed to reload PDF document:', e);
            return null;
        }
    }
    
    if (!pdfDocument) {
        console.warn('No PDF document available for on-demand rendering');
        return null;
    }
    
    try {
        const page = await pdfDocument.getPage(pageNum);
        const viewport = page.getViewport({ scale: 2.0 });
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        
        await page.render({ canvasContext: ctx, viewport: viewport }).promise;
        
        return canvas.toDataURL('image/jpeg', 0.9);
    } catch (err) {
        console.error(`Failed to render page ${pageNum}:`, err);
        return null;
    }
}

async function openPdfZoom(base64, pageNum) {
    // Show loading overlay first
    const overlay = document.createElement('div');
    overlay.className = 'compare-zoom-overlay pdf-zoom-overlay';
    overlay.dataset.currentPage = pageNum;
    overlay.innerHTML = `
        <div style="text-align:center;color:#94a3b8;padding-top:40vh;">
            <div style="width:40px;height:40px;border:3px solid #334155;border-top-color:#4f46e5;border-radius:50%;animation:spin 1s linear infinite;margin:0 auto 16px;"></div>
            <div>Seite ${pageNum} in hoher Qualität...</div>
        </div>
    `;
    document.body.appendChild(overlay);
    
    // Render high-res version
    const highRes = await renderPdfPageHighRes(pageNum);
    
    if (highRes) {
        showPdfZoomContent(overlay, highRes, pageNum);
    } else {
        showPdfZoomContent(overlay, base64, pageNum);
    }
}

function showPdfZoomContent(overlay, src, pageNum) {
    overlay.innerHTML = `
        <div class="pdf-zoom-nav">
            <button class="btn btn-icon pdf-zoom-prev" title="Vorherige Seite">◀</button>
            <span class="pdf-zoom-page-info">Seite ${pageNum} / ${pdfTotalPages}</span>
            <input type="number" class="pdf-zoom-page-input" min="1" max="${pdfTotalPages}" value="${pageNum}" title="Zu Seite springen">
            <button class="btn btn-icon pdf-zoom-next" title="Nächste Seite">▶</button>
            <div style="flex:1;"></div>
            <button class="btn btn-icon pdf-zoom-close-btn" title="Schließen">✕</button>
        </div>
        <div class="pdf-zoom-content">
            <img src="${src}" alt="Seite ${pageNum}">
        </div>
    `;
    
    // Navigation events
    const prevBtn = overlay.querySelector('.pdf-zoom-prev');
    const nextBtn = overlay.querySelector('.pdf-zoom-next');
    const pageInput = overlay.querySelector('.pdf-zoom-page-input');
    const closeBtn = overlay.querySelector('.pdf-zoom-close-btn');
    
    prevBtn?.addEventListener('click', (e) => {
        e.stopPropagation();
        const current = Number(overlay.dataset.currentPage);
        if (current > 1) navigatePdfZoom(overlay, current - 1);
    });
    
    nextBtn?.addEventListener('click', (e) => {
        e.stopPropagation();
        const current = Number(overlay.dataset.currentPage);
        if (current < pdfTotalPages) navigatePdfZoom(overlay, current + 1);
    });
    
    // Blur (focus loss) triggers page navigation
    pageInput?.addEventListener('blur', () => {
        const target = Number(pageInput.value);
        if (target >= 1 && target <= pdfTotalPages && target !== Number(overlay.dataset.currentPage)) {
            navigatePdfZoom(overlay, target);
        }
    });
    
    pageInput?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            pageInput.blur();
        }
    });
    
    closeBtn?.addEventListener('click', (e) => {
        e.stopPropagation();
        overlay.remove();
    });
    
    // Keyboard nav
    const keyHandler = (e) => {
        if (e.key === 'ArrowLeft') {
            const current = Number(overlay.dataset.currentPage);
            if (current > 1) navigatePdfZoom(overlay, current - 1);
        } else if (e.key === 'ArrowRight') {
            const current = Number(overlay.dataset.currentPage);
            if (current < pdfTotalPages) navigatePdfZoom(overlay, current + 1);
        } else if (e.key === 'Escape') {
            overlay.remove();
            document.removeEventListener('keydown', keyHandler);
        }
    };
    document.addEventListener('keydown', keyHandler);
    overlay._keyHandler = keyHandler;
}

async function navigatePdfZoom(overlay, targetPage) {
    if (overlay._keyHandler) document.removeEventListener('keydown', overlay._keyHandler);
    overlay.dataset.currentPage = targetPage;
    overlay.innerHTML = `
        <div style="text-align:center;color:#94a3b8;padding-top:40vh;">
            <div style="width:40px;height:40px;border:3px solid #334155;border-top-color:#4f46e5;border-radius:50%;animation:spin 1s linear infinite;margin:0 auto 16px;"></div>
            <div>Seite ${targetPage}...</div>
        </div>
    `;
    const highRes = await renderPdfPageHighRes(targetPage);
    const fallback = pdfPageImages[targetPage];
    showPdfZoomContent(overlay, highRes || fallback, targetPage);
}

async function renderPdfPageHighRes(pageNum) {
    if (!pdfDocument && pdfArrayBuffer) {
        try {
            pdfDocument = await pdfjsLib.getDocument({ data: pdfArrayBuffer }).promise;
        } catch (e) {
            console.error('Failed to reload PDF for high-res:', e);
            return null;
        }
    }
    if (!pdfDocument) return null;
    
    try {
        const page = await pdfDocument.getPage(pageNum);
        const viewport = page.getViewport({ scale: 2.0 });
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        await page.render({ canvasContext: ctx, viewport: viewport }).promise;
        return canvas.toDataURL('image/jpeg', 0.92);
    } catch (err) {
        console.error(`High-res render failed for page ${pageNum}:`, err);
        return null;
    }
}

on('#removeFile', 'click', () => {
    state.pdfFile = null;
    pdfInput.value = '';
    dropZone.style.display = 'block';
    $('#fileInfo').style.display = 'none';
    
    // Clear PDF preview
    pdfPageImages = {};
    pdfTotalPages = 0;
    pdfDocument = null;
    pdfArrayBuffer = null;
    const preview = $('#pdfPreview');
    if (preview) preview.style.display = 'none';
    const grid = $('#pdfGrid');
    if (grid) grid.innerHTML = '';
});

// Start button
on('#btnStart', 'click', () => {
    if (!state.pdfFile) {
        showToast('Bitte zuerst eine PDF-Datei auswählen', 'error');
        return;
    }
    
    showLoading(true);
    runPipeline();
});

// Reset button
on('#btnReset', 'click', () => {
    if (confirm('Möchtest du die Pipeline zurücksetzen?')) {
        state = {
            pdfFile: null,
            bookName: 'export',
            markdown: '',
            images: {},
            descriptions: {},
            pipelineRunning: false,
            currentStep: 0,
        };
        
        pdfInput.value = '';
        dropZone.style.display = 'block';
        if ($('#fileInfo')) $('#fileInfo').style.display = 'none';
        
        if ($('#conversionStats')) $('#conversionStats').style.display = 'none';
        if ($('#describeProgress')) $('#describeProgress').style.display = 'none';
        if ($('#uploadSummary')) $('#uploadSummary').style.display = 'none';
        if ($('#uploadPath')) $('#uploadPath').style.display = 'none';
        
        // Clear inputs
        if ($('#apiToken')) $('#apiToken').value = '';
        if ($('#openwebuiUrl')) $('#openwebuiUrl').value = CONFIG.openwebuiUrl;
        if ($('#bookName')) $('#bookName').value = '';
        
        // Clear output
        if ($('#mdSource')) $('#mdSource').textContent = '';
        if ($('#mdRendered')) $('#mdRendered').innerHTML = '';
        
        // Clear PDF preview
        pdfPageImages = {};
        pdfTotalPages = 0;
        pdfDocument = null;
        pdfArrayBuffer = null;
        const preview = $('#pdfPreview');
        if (preview) preview.style.display = 'none';
        const grid = $('#pdfGrid');
        if (grid) grid.innerHTML = '';
        
        // Reset comparison view
        closeCompareView();
        
        showToast('Zurückgesetzt', 'info');
    }
});

// Copy markdown
on('#btnCopyMd', 'click', () => {
    const mdWithNumbers = insertPageNumbers(state.markdown);
    navigator.clipboard.writeText(mdWithNumbers).then(() => {
        showToast('Markdown in Zwischenablage kopiert!', 'success');
    }).catch(() => {
        showToast('Kopieren fehlgeschlagen', 'error');
    });
});

// Update UI based on output format selection
function updateOutputFormatUI() {
    const outputFormat = $('#outputFormat')?.value || 'markdown';
    const isJson = outputFormat === 'json';
    
    const btnDocx = $('#btnDownloadDocx');
    const btnMd = $('#btnDownloadMd');
    const btnCopy = $('#btnCopyMd');
    const btnZip = $('#btnDownloadZip');
    const exportPanel = $('#exportPanel');
    
    if (btnDocx) {
        btnDocx.textContent = isJson ? '📄 JSON-Datei (.json)' : '📘 Word-Datei (.docx)';
    }
    if (btnMd) {
        btnMd.style.display = isJson ? 'none' : '';
    }
    if (btnCopy) {
        btnCopy.textContent = isJson ? '📋 Kopieren' : '📋 Kopieren';
    }
    if (btnZip) {
        btnZip.style.display = isJson ? 'none' : '';
    }
    if (exportPanel) {
        exportPanel.style.display = isJson ? 'none' : '';
    }
}

// Download markdown / json
on('#btnDownloadMd', 'click', () => {
    const bookName = state.bookName || 'export';
    const mdWithNumbers = insertPageNumbers(state.markdown);
    const blob = new Blob([mdWithNumbers], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${bookName}.md`;
    a.click();
    URL.revokeObjectURL(url);
    
    showToast(`${bookName}.md heruntergeladen`, 'success');
});

// Download ZIP handler
on('#btnDownloadZip', 'click', () => {
    if (!state.zipBlob) return;
    const bookName = state.bookName || 'export';
    const url = URL.createObjectURL(state.zipBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${bookName}.zip`;
    a.click();
    URL.revokeObjectURL(url);
    
    showToast(`${bookName}.zip heruntergeladen`, 'success');
});

// Download Word / JSON handler
on('#btnDownloadDocx', 'click', async () => {
    if (!state.markdown) {
        showToast('Kein Inhalt vorhanden zum Exportieren', 'error');
        return;
    }
    
    const outputFormat = $('#outputFormat')?.value || 'markdown';
    if (outputFormat === 'json') {
        // Download as JSON
        const bookName = state.bookName || 'export';
        const content = insertPageNumbers(state.markdown);
        const blob = new Blob([content], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${bookName}.json`;
        a.click();
        URL.revokeObjectURL(url);
        showToast(`${bookName}.json heruntergeladen`, 'success');
    } else {
        await exportToDocx();
    }
});

async function exportToDocx() {
    const bookName = state.bookName || 'export';
    debugLog(`Starte DOCX-Export für ${bookName}...`, 'info');
    
    try {
        // Insert page numbers before cleaning/export
        let md = insertPageNumbers(state.markdown);
        
        // Apply MBZ cleaning filters
        md = getCleanedMarkdown(md);
        
        // Wenn "Bildbeschreibungen nur als Alt-Text speichern" aktiv: Beschreibungsblöcke aus Markdown entfernen
        const altOnly = $('#docx-alt-only')?.checked || false;
        if (altOnly) {
            md = md.replace(/<!-- DESC-START -->[\s\S]*?<!-- DESC-END -->/g, '');
            // Überflüssige Leerzeilen bereinigen
            md = md.replace(/\n{3,}/g, '\n\n');
        }
        
        // 2. Markdown zu HTML
        marked.setOptions({
            breaks: true,
            gfm: true
        });
        
        let htmlContent = marked.parse(md);
        
        // Images embedding remains mostly as is, but we use the cleaned md
        const settings = {
            fontSize: $('#docxFontSize').value,
            lineSpacing: $('#docxLineSpacing')?.value || '1'
        };
        
        // Prüfe ob nur Beschreibungen ohne Bilder in Word gespeichert werden sollen
        const descOnly = $('#docx-desc-only')?.checked !== false;
        
        // Bilder einbetten (Bilder sind in state.images as base64)
        for (const [fname, b64] of Object.entries(state.images)) {
            // Wir suchen im HTML nach Tags, die diesen Filename im src haben
            // Da marked oft Pfade bereinigt, suchen wir nach dem Filename Teil
            const imgRegex = new RegExp(`<img[^>]+src=["'][^"']*${fname.replace('.', '\\.')}[^"']*["'][^>]*>`, 'g');
            htmlContent = htmlContent.replace(imgRegex, (match) => {
                // Beschreibung finden falls vorhanden
                const desc = state.descriptions[fname] || '';
                
                // Wenn "Bildbeschreibungen ohne Bilder" aktiv: Bild komplett entfernen
                if (descOnly) {
                    return '';
                }
                
                // Standard: Bild als Base64 einbetten, mit bereinigtem Alt-Text
                let cleanDesc = desc
                    .replace(/\(\(Bild\)\)/g, '')
                    .replace(/\(\(\/Bild\)\)/g, '')
                    .replace(/<<Bild>>/g, '')
                    .replace(/<<\/Bild>>/g, '')
                    .replace(/<Bild>/g, '')
                    .replace(/<\/Bild>/g, '')
                    .replace(/<br\s*\/?>/gi, '')
                    .replace(/\s+/g, ' ')
                    .trim();

                let altAttr = '';
                if (cleanDesc) {
                    const escapedDesc = cleanDesc
                        .replace(/"/g, '&quot;')
                        .replace(/</g, '&lt;')
                        .replace(/>/g, '&gt;');
                    altAttr = ` alt="${escapedDesc}"`;
                }

                let newTag = `<img src="data:image/jpeg;base64,${b64}"${altAttr}>`;

                if (settings.includeCaptions && desc) {
                    return `<div style="text-align: center; margin-bottom: 20px;">${newTag}<p style="font-size: 10pt; color: #666; margin-top: 5px;">${desc}</p></div>`;
                }
                return newTag;
            });
        }

        // 3. HTML in DOCX Template einbetten
        const fullHtml = `
            <!DOCTYPE html>
            <html lang="de">
            <head>
                <meta charset="UTF-8">
                <style>
                    body {
                        font-family: 'Arial', sans-serif;
                        font-size: ${settings.fontSize}pt;
                        line-height: ${settings.lineSpacing};
                        color: #000;
                    }
                    h1 { font-size: 18pt; margin-top: 24pt; border-bottom: 1px solid #ccc; padding-bottom: 6pt; }
                    h2 { font-size: 16pt; margin-top: 18pt; }
                    h3 { font-size: 14pt; margin-top: 14pt; }
                    p { margin-bottom: 10pt; }
                    img { display: block; margin: 12pt auto; max-width: 100%; }
                    table { border-collapse: collapse; width: 100%; margin-bottom: 12pt; }
                    th, td { border: 1px solid #333; padding: 6pt; text-align: left; }
                    th { background-color: #f2f2f2; }
                </style>
            </head>
            <body>
                ${htmlContent}
            </body>
            </html>
        `;

        // 4. Konvertieren und Download
        const converted = htmlDocx.asBlob(fullHtml);
        saveAs(converted, `${bookName}.docx`);
        
        debugLog(`DOCX-Export für ${bookName} erfolgreich.`, 'success');
        showToast(`Datei ${bookName}.docx wurde erstellt.`, 'success');
        
    } catch (err) {
        console.error('DOCX Export Fehler:', err);
        debugLog(`Fehler beim DOCX-Export: ${err.message}`, 'error');
        showToast('Word-Export fehlgeschlagen.', 'error');
    }
}

// Clear console
on('#btnClearConsole', 'click', () => {
    if ($('#systemConsole')) $('#systemConsole').innerHTML = '';
    debugLog('Konsole geleert.', 'info');
});

// Toolbar buttons
$$('.toolbar-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        $$('.toolbar-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        
        const view = btn.dataset.view;
        if ($('#mdSource')) $('#mdSource').style.display = view === 'markdown' ? 'block' : 'none';
        if ($('#mdRendered')) $('#mdRendered').style.display = view === 'rendered' ? 'block' : 'none';
        
        if (view === 'split') {
            if ($('#mdSource')) $('#mdSource').style.display = 'block';
            if ($('#mdRendered')) $('#mdRendered').style.display = 'block';
        }
    });
});

// Auto-save config to localStorage (encrypted)
function saveConfig() {
    const configData = {
        ocrBackend: $('#ocrBackend')?.value || 'marker',
        chandraUrl: $('#chandraUrl')?.value || 'http://127.0.0.1:1234',
        chandraModel: $('#chandraModel')?.value || 'chandra-ocr-2-nvfp4-mlx',
        markerServerUrl: $('#markerServerUrl')?.value || '',
        markerApiToken: $('#markerApiToken')?.value || '',
        openwebuiUrl: $('#openwebuiUrl')?.value || '',
        apiToken: $('#apiToken')?.value || '',
        model: $('#modelSelect')?.value || '',
        imagePrompt: $('#imagePrompt')?.value || '',
        forceOcr: $('#forceOcr')?.checked || false,
        outputFormat: $('#outputFormat')?.value || 'markdown',
        pageRange: $('#pageRange')?.value || '',
        paginateOutput: $('#paginateOutput')?.checked || false,
        // Seitenzahlen Optionen
        showPageNumbers: $('#showPageNumbers')?.checked || false,
        pageNumberStart: $('#pageNumberStart')?.value || '1',
        pageNumberInitial: $('#pageNumberInitial')?.value || '1',
        // Experimentelle Optionen
        useLlm: $('#useLlm')?.checked || false,
        stripExistingOcr: $('#stripExistingOcr')?.checked || false,
        redoInlineMath: $('#redoInlineMath')?.checked || false,
        disableImageExtraction: $('#disableImageExtraction')?.checked || false,
        // Word Export Optionen
        docxFontSize: $('#docxFontSize')?.value || '12',
        docxLineSpacing: $('#docxLineSpacing')?.value || '1',
        // MBZ Optionen
        'docx-opt-unit-cm': $('#docx-opt-unit-cm')?.checked || false,
        'docx-opt-unit-circ': $('#docx-opt-unit-circ')?.checked || false,
        'docx-opt-latex-space-block': $('#docx-opt-latex-space-block')?.checked || false,
        'docx-opt-latex-space-inline': $('#docx-opt-latex-space-inline')?.checked || false,
        'docx-opt-greek': $('#docx-opt-greek')?.checked || false,
        'docx-opt-supsub': $('#docx-opt-supsub')?.checked || false,
        'docx-opt-nonascii': $('#docx-opt-nonascii')?.checked || false,
        'docx-opt-nbsp-narrow': $('#docx-opt-nbsp-narrow')?.checked || false,
        'docx-opt-quotes': $('#docx-opt-quotes')?.checked || false,
        'docx-opt-hyphens': $('#docx-opt-hyphens')?.checked || false,
        'docx-opt-whitespace': $('#docx-opt-whitespace')?.checked || false,
        'docx-opt-latex': $('#docx-opt-latex')?.checked || false,
        'docx-opt-dollar': $('#docx-opt-dollar')?.checked || false,
        'docx-opt-cdot': $('#docx-opt-cdot')?.checked || false,
        'docx-opt-images': $('#docx-opt-images')?.checked || false,
        'docx-opt-dashes': $('#docx-opt-dashes')?.checked || false,
        'docx-opt-pagebreak': $('#docx-opt-pagebreak')?.checked || false,
        'docx-desc-only': $('#docx-desc-only')?.checked !== false,
        'docx-alt-only': $('#docx-alt-only')?.checked || false,
    };
    
    localStorage.setItem('pipeline_config_v2', encrypt(JSON.stringify(configData)));
}

// Load config from localStorage (decrypted)
function loadConfig() {
    const saved = localStorage.getItem('pipeline_config_v2');
    if (saved) {
        const decrypted = decrypt(saved);
        if (!decrypted) return;
        
        try {
            const config = JSON.parse(decrypted);
            
            // Migration: Logic to handle different environments
            // 1. Rename old markerUrl key if present
            if (config.markerUrl && !config.markerServerUrl) {
                config.markerServerUrl = config.markerUrl;
                delete config.markerUrl;
            }

            if (window.location.hostname === 'ocr.sbbz-ilvesheim.de') {
                // On the hosted server, we MUST use the relative path to avoid CORS.
                if (!config.markerServerUrl || config.markerServerUrl.startsWith('http')) {
                    config.markerServerUrl = './api/marker/upload';
                    console.log('Server-Migration: Reset to relative path to prevent CORS error.');
                }
            } else if (config.markerServerUrl && config.markerServerUrl.includes('test-ki2-sbbz')) {
                // In other environments (local/file://), fix common typo
                config.markerServerUrl = config.markerServerUrl.replace('test-ki2-sbbz', 'test-ki2.sbbz');
                console.log('DNS Migration: Fixed hyphenated markerServerUrl to dot version.');
            }

            if ($('#ocrBackend')) $('#ocrBackend').value = config.ocrBackend || 'marker';
            if ($('#chandraUrl')) $('#chandraUrl').value = config.chandraUrl || 'http://127.0.0.1:1234';
            if ($('#chandraModel')) $('#chandraModel').value = config.chandraModel || 'chandra-ocr-2-nvfp4-mlx';
            updateBackendUI();
            if ($('#markerServerUrl')) $('#markerServerUrl').value = config.markerServerUrl || CONFIG.markerServerUrl;
            if ($('#markerApiToken')) $('#markerApiToken').value = config.markerApiToken || '';
            if ($('#openwebuiUrl')) $('#openwebuiUrl').value = config.openwebuiUrl || CONFIG.openwebuiUrl;
            if ($('#apiToken')) $('#apiToken').value = config.apiToken || '';
            if ($('#modelSelect')) $('#modelSelect').value = config.model || '';
            if ($('#imagePrompt')) $('#imagePrompt').value = config.imagePrompt || DEFAULT_IMAGE_PROMPT;
            if ($('#forceOcr')) $('#forceOcr').checked = config.forceOcr || false;
            if ($('#outputFormat')) $('#outputFormat').value = config.outputFormat || 'markdown';
            if ($('#pageRange')) $('#pageRange').value = config.pageRange || '';
            if ($('#paginateOutput')) $('#paginateOutput').checked = config.paginateOutput || false;
            // Seitenzahlen Optionen
            if ($('#showPageNumbers')) $('#showPageNumbers').checked = config.showPageNumbers || false;
            if ($('#pageNumberStart')) $('#pageNumberStart').value = config.pageNumberStart || '1';
            if ($('#pageNumberInitial')) $('#pageNumberInitial').value = config.pageNumberInitial || '1';
            
            // Update page number UI visibility after loading config
            updatePageNumberUI();
            
            // Experimentelle Optionen
            if ($('#useLlm')) $('#useLlm').checked = config.useLlm || false;
            if ($('#stripExistingOcr')) $('#stripExistingOcr').checked = config.stripExistingOcr || false;
            if ($('#redoInlineMath')) $('#redoInlineMath').checked = config.redoInlineMath || false;
            if ($('#disableImageExtraction')) $('#disableImageExtraction').checked = config.disableImageExtraction || false;
            
            // Bildbeschreibungen ohne Bilder in Word (standardmäßig aktiv)
            if ($('#docx-desc-only')) $('#docx-desc-only').checked = config['docx-desc-only'] !== false;
            
            // Bildbeschreibungen nur als Alt-Text (standardmäßig inaktiv)
            if ($('#docx-alt-only')) $('#docx-alt-only').checked = config['docx-alt-only'] || false;
            
            // Visibility der Alt-Text-Option aktualisieren
            updateAltOnlyVisibility();
            
            // Word Export Optionen
            if ($('#docxFontSize')) $('#docxFontSize').value = config.docxFontSize || '12';
            if ($('#docxLineSpacing')) $('#docxLineSpacing').value = config.docxLineSpacing || '1';
            
            // MBZ Optionen
            const mbzOpts = [
                'docx-opt-unit-cm', 'docx-opt-unit-circ', 'docx-opt-latex-space-block', 
                'docx-opt-latex-space-inline', 'docx-opt-greek', 'docx-opt-supsub', 
                'docx-opt-nonascii', 'docx-opt-nbsp-narrow', 'docx-opt-quotes', 
                'docx-opt-hyphens', 'docx-opt-whitespace', 'docx-opt-latex', 
                'docx-opt-dollar', 'docx-opt-cdot', 'docx-opt-dashes', 'docx-opt-pagebreak'
            ];
            
            mbzOpts.forEach(opt => {
                const el = document.getElementById(opt);
                if (el) el.checked = config[opt] !== undefined ? config[opt] : (opt === 'docx-opt-pagebreak' ? false : true);
            });
            
            // If model is set but not in list, we might need to wait for model loading
            if (config.model && config.model !== $('#modelSelect').value) {
                const opt = document.createElement('option');
                opt.value = config.model;
                opt.textContent = config.model;
                $('#modelSelect').appendChild(opt);
                $('#modelSelect').value = config.model;
            }
        } catch (e) {
            console.error('Error parsing decrypted config:', e);
        }
    }
    
    // If no config could be loaded (missing or decryption error), set defaults
    if (!localStorage.getItem('pipeline_config_v2') || !decrypt(localStorage.getItem('pipeline_config_v2'))) {
        if (localStorage.getItem('pipeline_config_v2')) {
            console.warn('Clearing corrupted configuration from localStorage.');
            localStorage.removeItem('pipeline_config_v2');
        }
        if ($('#markerServerUrl') && $('#markerServerUrl').value === '') $('#markerServerUrl').value = CONFIG.markerServerUrl;
        if ($('#openwebuiUrl') && $('#openwebuiUrl').value === '') $('#openwebuiUrl').value = CONFIG.openwebuiUrl;
        if ($('#imagePrompt') && $('#imagePrompt').value === '') $('#imagePrompt').value = DEFAULT_IMAGE_PROMPT;
    }

    // Auto-trigger model loading on startup if URL is present
    const openwebuiUrl = $('#openwebuiUrl')?.value.trim();
    if (openwebuiUrl) {
        debugLog('Initialisiere Modell-Liste...', 'info');
        loadModels(openwebuiUrl);
    }
}

// Auto-save on input change
$$('input, select, textarea').forEach(el => {
    el.addEventListener('input', saveConfig);
    el.addEventListener('change', saveConfig);
});

// Load models when OpenWebUI URL changes
on('#ocrBackend', 'change', updateBackendUI);

on('#openwebuiUrl', 'input', debounce(async function() {
    const url = this.value.trim();
    if (!url) {
        const sel = $('#modelSelect');
        if (sel) sel.innerHTML = '<option value="">Bitte OpenWebUI URL eingeben...</option>';
        return;
    }
    
    await loadModels(url);
}, 500));

// Reload models button
on('#btnReloadModels', 'click', async function() {
    const urlInput = $('#openwebuiUrl');
    if (!urlInput) return;
    
    const url = urlInput.value.trim();
    if (!url) {
        debugLog('Bitte zuerst OpenWebUI URL eingeben.', 'warning');
        return;
    }
    
    // Visual feedback
    this.textContent = '⏳';
    this.disabled = true;
    
    await loadModels(url);
    
    this.textContent = '🔄';
    this.disabled = false;
});

async function loadModels(baseUrl) {
    const modelSelect = $('#modelSelect');
    
    try {
        // BaseURL bereinigen (kein trailing slash)
        let cleanUrl = baseUrl.replace(/\/+$/, '');
        
        // Modelle über /v1/models laden
        const apiUrl = cleanUrl + '/v1/models';
        
        debugLog(`Lade Modelle von: ${apiUrl}`, 'info');
        
        const apiToken = $('#apiToken').value.trim();
        const headers = { 'Content-Type': 'application/json' };
        
        if (apiToken) {
            headers['Authorization'] = `Bearer ${apiToken}`;
            debugLog('API-Key wird verwendet', 'info');
        }
        
        const response = await fetch(apiUrl, {
            method: 'GET',
            headers: headers
        });
        
        // Get raw response first for debugging
        const contentType = response.headers.get('content-type');
        const rawText = await response.text();
        
        if (!response.ok) {
            debugLog(`API-Antwort (${response.status}): ${rawText.substring(0, 200)}`, 'error');
            throw new Error(`HTTP ${response.status} - Prüfe URL und API-Key`);
        }
        
        if (!contentType || !contentType.includes('application/json')) {
            if (rawText.includes('<!doctype') || rawText.includes('<html')) {
                debugLog(`Kein JSON! (HTML): ${rawText.substring(0, 200)}`, 'error');
                throw new Error(`Kein JSON empfangen! URL: ${apiUrl} (CORS? API-Key?)`);
            }
            debugLog(`Unerwarteter Content-Type: ${contentType}`, 'warning');
            debugLog(`Response: ${rawText.substring(0, 200)}`, 'warning');
            throw new Error('Unerwarteter Antwort-Typ');
        }
        
        // Parse JSON
        let data;
        try {
            data = JSON.parse(rawText);
        } catch (e) {
            debugLog(`JSON-Parse-Fehler: ${e.message}`, 'error');
            debugLog(`Response: ${rawText.substring(0, 500)}`, 'error');
            throw new Error('Ungültiges JSON von API');
        }
        
        debugLog(`API-Antwort empfangen: ${rawText.substring(0, 300)}...`, 'info');
        
        // Check for different response structures
        let models = [];
        if (Array.isArray(data)) {
            models = data;
            debugLog('API gibt Array zurück', 'info');
        } else if (data.data && Array.isArray(data.data)) {
            models = data.data.map(m => m.id || m.name);
            debugLog('API gibt {data: [...]} zurück', 'info');
        } else if (data.models && Array.isArray(data.models)) {
            models = data.models;
            debugLog('API gibt {models: [...]} zurück', 'info');
        } else if (data.model) {
            // Single model
            models = [data.model];
            debugLog('API gibt einzelnes Modell zurück', 'info');
        } else {
            debugLog(`Unerwartetes API-Format: ${JSON.stringify(data).substring(0, 300)}`, 'warning');
        }
        
        // Clear and populate
        modelSelect.innerHTML = '';
        
        if (models.length === 0) {
            modelSelect.innerHTML = '<option value="">Keine Modelle gefunden (API-Struktur: ' + Object.keys(data).join(', ') + ')</option>';
            debugLog('Keine Modelle von OpenWebUI API gefunden.', 'warning');
            debugLog('Verfügbare API-Felder: ' + Object.keys(data).join(', '), 'warning');
            return;
        }
        
        models.forEach((modelName, index) => {
            const option = document.createElement('option');
            option.value = modelName;
            option.textContent = modelName;
            modelSelect.appendChild(option);
        });
        
        // Restore saved model if available and in list, otherwise select first
        const savedModel = localStorage.getItem('pdfPipeline_model');
        if (savedModel && models.includes(savedModel)) {
            modelSelect.value = savedModel;
            debugLog(`Gespeichertes Model wiederhergestellt: ${savedModel}`, 'success');
        } else if (models.length > 0) {
            modelSelect.value = models[0];
        }
        
        debugLog(`${models.length} Modelle von OpenWebUI geladen: ${models.join(', ')}`, 'success');
        
    } catch (error) {
        const errorMsg = `Fehler beim Laden der Modelle: ${error.message}`;
        debugLog(errorMsg, 'error');
        modelSelect.innerHTML = `<option value="">Fehler: ${error.message.substring(0, 50)}</option>`;
        
        // Add helpful hint
        debugLog('Hinweis: Stelle sicher, dass die API-Key Konfiguration korrekt ist.', 'info');
    }
}

function debounce(func, wait) {
    let timeout;
    return function(...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), wait);
    };
}

// Initialize
loadConfig();
updatePageNumberUI(); // Set initial visibility of page number options
updateOutputFormatUI(); // Set initial visibility based on output format

// Sidebar Toggle Logic
function initSidebar() {
    const app = $('.app');
    
    // Initial state: Expand if no token, otherwise respect last state or default to expanded on desktop
    const hasToken = $('#apiToken')?.value.trim() !== '';
    const lastState = localStorage.getItem('sidebarCollapsed');
    
    let isCollapsed = false;
    if (lastState !== null) {
        isCollapsed = lastState === 'true';
    } else if (hasToken && window.innerWidth < 1024) {
        isCollapsed = true;
    }

    if (isCollapsed) {
        app.classList.add('sidebar-collapsed');
    } else {
        app.classList.remove('sidebar-collapsed');
    }
    
    const toggleSidebar = (e) => {
        if (e) e.preventDefault();
        app.classList.toggle('sidebar-collapsed');
        localStorage.setItem('sidebarCollapsed', app.classList.contains('sidebar-collapsed'));
        
        // Dispatch resize event for preview components
        setTimeout(() => window.dispatchEvent(new Event('resize')), 400);
    };

    on('#sidebarToggle', 'click', toggleSidebar);
    on('#sidebarClose', 'click', toggleSidebar);
    on('#sidebarBackdrop', 'click', toggleSidebar);

    // Accordion Logic
    $$('.panel-header[data-toggle]').forEach(header => {
        const panelId = header.dataset.toggle;
        const panel = $(`#${panelId}`);
        if (!panel) return;

        // Load saved state
        const isCollapsed = localStorage.getItem(`panel_${panelId}_collapsed`) === 'true';
        if (isCollapsed) panel.classList.add('collapsed');

        header.addEventListener('click', (e) => {
            // Don't toggle if the close button was clicked
            if (e.target.closest('.btn-close-sidebar')) return;

            panel.classList.toggle('collapsed');
            localStorage.setItem(`panel_${panelId}_collapsed`, panel.classList.contains('collapsed'));
        });
    });
}

// Service Worker Registration
function initPWA() {
    if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('./sw.js')
                .then(reg => console.log('Service Worker registered! 💎', reg.scope))
                .catch(err => console.log('Service Worker registration failed: ', err));
        });
    }
}



initSidebar();
initPWA();

// Focus API field if missing
const apiField = $('#apiToken');
if (apiField && !apiField.value) {
    setTimeout(() => {
        apiField.focus();
        debugLog('Bitte geben Sie Ihren API-Token ein, um zu starten.', 'info');
    }, 600);
}

// ===== Image Editor (Clean Rewrite) =====
const editorState = {
    open: false,
    fname: null,
    canvas: null,
    ctx: null,
    undoStack: [],
    tool: 'brush',
    isDrawing: false,
    lastX: 0,
    lastY: 0,
    cropRect: null,
    cropMode: null,
    cropStart: null,
    bgImage: null  // Offscreen canvas holding clean image (no overlays)
};

function openEditor(fname) {
    if (!fname || !state.images[fname]) return;
    
    const rawB64 = state.images[fname];
    let imgSrc = rawB64;
    if (!imgSrc.startsWith('data:')) imgSrc = 'data:image/jpeg;base64,' + imgSrc;
    
    const img = new Image();
    img.onload = function() {
        // Setup canvas
        const cvs = $('#editorCanvas');
        const maxW = window.innerWidth - 40;
        const maxH = window.innerHeight - 140;
        const scale = Math.min(maxW / img.width, maxH / img.height, 1);
        
        cvs.width = Math.round(img.width * scale);
        cvs.height = Math.round(img.height * scale);
        
        const ctx = cvs.getContext('2d');
        ctx.drawImage(img, 0, 0, cvs.width, cvs.height);
        
        // Create offscreen background canvas
        const bg = document.createElement('canvas');
        bg.width = cvs.width;
        bg.height = cvs.height;
        bg.getContext('2d').drawImage(img, 0, 0, cvs.width, cvs.height);
        
        // Set state
        editorState.open = true;
        editorState.fname = fname;
        editorState.canvas = cvs;
        editorState.ctx = ctx;
        editorState.bgImage = bg;
        editorState.tool = 'brush';
        editorState.undoStack = [bg.toDataURL('image/jpeg', 0.95)];
        editorState.cropRect = null;
        editorState.cropMode = null;
        editorState.isDrawing = false;
        
        // UI
        $('#imageEditor').style.display = 'flex';
        $('#editorFname').textContent = fname;
        $('#cropActionBar').style.display = 'none';
        document.querySelectorAll('#imageEditor .tool-btn').forEach(b => b.classList.remove('active'));
        $('#toolBrush')?.classList.add('active');
    };
    img.onerror = function() {
        showToast('Bild konnte nicht geladen werden', 'error');
    };
    img.src = imgSrc;
}

function closeEditor() {
    $('#imageEditor').style.display = 'none';
    editorState.open = false;
    editorState.cropRect = null;
    editorState.cropMode = null;
    editorState.isDrawing = false;
    $('#cropActionBar').style.display = 'none';
}

function getCanvasPos(e) {
    const rect = editorState.canvas.getBoundingClientRect();
    const sx = editorState.canvas.width / rect.width;
    const sy = editorState.canvas.height / rect.height;
    return { x: (e.clientX - rect.left) * sx, y: (e.clientY - rect.top) * sy };
}

function isInCrop(x, y) {
    const r = editorState.cropRect;
    return r && x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
}

function getCropHandle(x, y) {
    const r = editorState.cropRect, hs = 12;
    if (!r) return null;
    const checks = [
        { h: 'nw', x: r.x, y: r.y },
        { h: 'ne', x: r.x + r.w, y: r.y },
        { h: 'sw', x: r.x, y: r.y + r.h },
        { h: 'se', x: r.x + r.w, y: r.y + r.h }
    ];
    for (const c of checks) {
        if (Math.abs(x - c.x) < hs && Math.abs(y - c.y) < hs) return c.h;
    }
    return null;
}

function redrawCanvas() {
    const cvs = editorState.canvas;
    const ctx = editorState.ctx;
    const bg = editorState.bgImage;
    if (!cvs || !ctx || !bg) return;
    ctx.clearRect(0, 0, cvs.width, cvs.height);
    ctx.drawImage(bg, 0, 0);
    if (editorState.cropRect) drawCropOverlay();
}

function drawCropOverlay() {
    const ctx = editorState.ctx;
    const r = editorState.cropRect;
    const cvs = editorState.canvas;
    if (!r || !ctx) return;
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.fillRect(0, 0, cvs.width, r.y);
    ctx.fillRect(0, r.y + r.h, cvs.width, cvs.height - r.y - r.h);
    ctx.fillRect(0, r.y, r.x, r.h);
    ctx.fillRect(r.x + r.w, r.y, cvs.width - r.x - r.w, r.h);
    ctx.strokeStyle = '#4f46e5';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.strokeRect(r.x, r.y, r.w, r.h);
    ctx.setLineDash([]);
    ctx.fillStyle = '#4f46e5';
    const s = 8;
    [[r.x, r.y], [r.x+r.w, r.y], [r.x, r.y+r.h], [r.x+r.w, r.y+r.h]].forEach(([hx, hy]) => {
        ctx.fillRect(hx-s, hy-s, s*2, s*2);
    });
    ctx.restore();
}

function onEditDown(e) {
    if (!editorState.open) return;
    e.preventDefault();
    const p = getCanvasPos(e);
    editorState.isDrawing = true;
    editorState.lastX = p.x;
    editorState.lastY = p.y;
    
    if (editorState.tool === 'crop') {
        const handle = getCropHandle(p.x, p.y);
        if (handle) {
            editorState.cropMode = 'resize-' + handle;
            editorState.cropStart = { x: p.x, y: p.y, rect: { ...editorState.cropRect } };
        } else if (isInCrop(p.x, p.y)) {
            editorState.cropMode = 'move';
            editorState.cropStart = { x: p.x, y: p.y, rect: { ...editorState.cropRect } };
        } else {
            editorState.cropRect = { x: p.x, y: p.y, w: 0, h: 0 };
            editorState.cropMode = 'create';
        }
        $('#cropActionBar').style.display = 'none';
    } else if (editorState.tool === 'eyedropper') {
        const px = editorState.ctx.getImageData(Math.floor(p.x), Math.floor(p.y), 1, 1).data;
        const hex = '#' + [px[0], px[1], px[2]].map(v => v.toString(16).padStart(2, '0')).join('');
        $('#brushColor').value = hex;
        setEditorTool('brush');
        showToast('Farbe: ' + hex, 'info');
    } else if (editorState.tool === 'brush') {
        const sz = parseInt($('#brushSize')?.value || 10);
        const col = $('#brushColor')?.value || '#ff0000';
        editorState.ctx.beginPath();
        editorState.ctx.arc(p.x, p.y, sz/2, 0, Math.PI*2);
        editorState.ctx.fillStyle = col;
        editorState.ctx.fill();
    }
}

function onEditMove(e) {
    if (!editorState.open || !editorState.isDrawing) return;
    e.preventDefault();
    const p = getCanvasPos(e);
    const cvs = editorState.canvas;
    
    if (editorState.tool === 'crop' && editorState.cropMode) {
        const r = editorState.cropRect;
        if (editorState.cropMode === 'create') {
            const x1 = Math.min(editorState.lastX, p.x);
            const y1 = Math.min(editorState.lastY, p.y);
            editorState.cropRect = {
                x: x1, y: y1,
                w: Math.min(Math.abs(p.x - editorState.lastX), cvs.width - x1),
                h: Math.min(Math.abs(p.y - editorState.lastY), cvs.height - y1)
            };
        } else if (editorState.cropMode === 'move' && editorState.cropStart) {
            const dx = p.x - editorState.cropStart.x;
            const dy = p.y - editorState.cropStart.y;
            const sr = editorState.cropStart.rect;
            editorState.cropRect = {
                x: Math.max(0, Math.min(sr.x + dx, cvs.width - sr.w)),
                y: Math.max(0, Math.min(sr.y + dy, cvs.height - sr.h)),
                w: sr.w, h: sr.h
            };
        } else if (editorState.cropMode.startsWith('resize-') && editorState.cropStart) {
            const sr = editorState.cropStart.rect;
            const dir = editorState.cropMode.replace('resize-', '');
            let x=sr.x, y=sr.y, w=sr.w, h=sr.h;
            if (dir.includes('e')) w = Math.max(20, p.x - sr.x);
            if (dir.includes('w')) { const nx = Math.min(p.x, sr.x+sr.w-20); w = sr.x+sr.w-nx; x = nx; }
            if (dir.includes('s')) h = Math.max(20, p.y - sr.y);
            if (dir.includes('n')) { const ny = Math.min(p.y, sr.y+sr.h-20); h = sr.y+sr.h-ny; y = ny; }
            editorState.cropRect = { x, y, w, h };
        }
        redrawCanvas();
    } else if (editorState.tool === 'brush') {
        const sz = parseInt($('#brushSize')?.value || 10);
        const col = $('#brushColor')?.value || '#ff0000';
        editorState.ctx.lineCap = 'round';
        editorState.ctx.lineJoin = 'round';
        editorState.ctx.lineWidth = sz;
        editorState.ctx.strokeStyle = col;
        editorState.ctx.beginPath();
        editorState.ctx.moveTo(editorState.lastX, editorState.lastY);
        editorState.ctx.lineTo(p.x, p.y);
        editorState.ctx.stroke();
        editorState.lastX = p.x;
        editorState.lastY = p.y;
    }
}

function onEditUp(e) {
    if (!editorState.open || !editorState.isDrawing) return;
    editorState.isDrawing = false;
    if (editorState.tool === 'brush') {
        // Sync bgImage with current canvas state (brush strokes are permanent)
        editorState.bgImage.width = editorState.canvas.width;
        editorState.bgImage.height = editorState.canvas.height;
        editorState.bgImage.getContext('2d').drawImage(editorState.canvas, 0, 0);
        pushUndo();
    }
    if (editorState.tool === 'crop' && editorState.cropRect && editorState.cropRect.w > 20 && editorState.cropRect.h > 20) {
        $('#cropActionBar').style.display = 'flex';
    }
    editorState.cropMode = null;
    editorState.cropStart = null;
}

function onEditTouchStart(e) {
    e.preventDefault();
    if (e.touches.length === 1) {
        const t = e.touches[0];
        onEditDown({ preventDefault: () => {}, clientX: t.clientX, clientY: t.clientY });
    }
}

function onEditTouchMove(e) {
    e.preventDefault();
    if (e.touches.length === 1) {
        const t = e.touches[0];
        onEditMove({ preventDefault: () => {}, clientX: t.clientX, clientY: t.clientY });
    }
}

function pushUndo() {
    if (!editorState.canvas) return;
    if (editorState.undoStack.length > 20) editorState.undoStack.shift();
    editorState.undoStack.push(editorState.canvas.toDataURL('image/jpeg', 0.95));
}

function undoEditor() {
    if (editorState.undoStack.length <= 1) {
        showToast('Nichts zum Rückgängig machen', 'info');
        return;
    }
    editorState.undoStack.pop();
    const dataUrl = editorState.undoStack[editorState.undoStack.length - 1];
    const img = new Image();
    img.onload = () => {
        editorState.ctx.clearRect(0, 0, editorState.canvas.width, editorState.canvas.height);
        editorState.ctx.drawImage(img, 0, 0);
        // Sync bgImage
        editorState.bgImage.width = editorState.canvas.width;
        editorState.bgImage.height = editorState.canvas.height;
        editorState.bgImage.getContext('2d').drawImage(img, 0, 0);
    };
    img.src = dataUrl;
}

function setEditorTool(tool) {
    editorState.tool = tool;
    document.querySelectorAll('#imageEditor .tool-btn').forEach(b => b.classList.remove('active'));
    if (tool === 'crop') $('#toolCrop')?.classList.add('active');
    else if (tool === 'brush') $('#toolBrush')?.classList.add('active');
    else if (tool === 'eyedropper') $('#toolEyedropper')?.classList.add('active');
    
    if (tool !== 'crop') {
        editorState.cropRect = null;
        $('#cropActionBar').style.display = 'none';
        redrawCanvas();
    } else if (editorState.cropRect) {
        redrawCanvas();
        $('#cropActionBar').style.display = 'flex';
    }
}

function applyCrop() {
    if (!editorState.cropRect || !editorState.canvas) return;
    const r = editorState.cropRect;
    if (r.w < 10 || r.h < 10) { showToast('Bereich zu klein', 'error'); return; }
    
    // CRITICAL: Use bgImage (clean, no overlay) for cropping, NOT the visible canvas
    const bgCtx = editorState.bgImage.getContext('2d');
    const data = bgCtx.getImageData(r.x, r.y, r.w, r.h);
    
    const nc = document.createElement('canvas');
    nc.width = r.w; nc.height = r.h;
    nc.getContext('2d').putImageData(data, 0, 0);
    
    editorState.canvas.width = r.w;
    editorState.canvas.height = r.h;
    editorState.ctx.clearRect(0, 0, r.w, r.h);
    editorState.ctx.drawImage(nc, 0, 0);
    
    // Sync bgImage to new cropped size
    editorState.bgImage = document.createElement('canvas');
    editorState.bgImage.width = r.w;
    editorState.bgImage.height = r.h;
    editorState.bgImage.getContext('2d').drawImage(nc, 0, 0);
    
    editorState.cropRect = null;
    $('#cropActionBar').style.display = 'none';
    pushUndo();
    showToast('Bild zugeschnitten', 'success');
}

function saveEditor() {
    if (!editorState.canvas || !editorState.fname) return;
    
    // Ensure crop overlay is removed before saving
    if (editorState.cropRect) {
        editorState.cropRect = null;
        $('#cropActionBar').style.display = 'none';
        redrawCanvas();
    }
    
    // bgImage always holds the clean image (no overlays)
    const b64 = editorState.bgImage.toDataURL('image/jpeg', 0.95).replace(/^data:image\/jpeg;base64,/, '');
    state.images[editorState.fname] = b64;
    
    // Regenerate ZIP in background (image data changed)
    regenerateZip();
    
    comparePageMap = buildComparePageMap();
    if (compareViewOpen) renderComparePage();
    renderMarkdown(state.markdown);
    showToast('Bild gespeichert. Starte KI-Neu...', 'success');
    const fn = editorState.fname;
    closeEditor();
    reDescribeImage(fn);
}

function handleSwapFile(file) {
    if (!file || !file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = (e) => {
        const b64 = e.target.result.replace(/^data:image\/[^;]+;base64,/, '');
        state.images[editorState.fname] = b64;
        
        // Regenerate ZIP in background (image swapped)
        regenerateZip();
        
        openEditor(editorState.fname);
        showToast('Bild ausgetauscht!', 'success');
    };
    reader.readAsDataURL(file);
}

// Editor toolbar listeners
on('#toolCrop', 'click', () => setEditorTool('crop'));
on('#toolBrush', 'click', () => setEditorTool('brush'));
on('#toolEyedropper', 'click', () => setEditorTool('eyedropper'));
on('#toolUndo', 'click', undoEditor);
on('#toolReset', 'click', () => { if (editorState.fname) openEditor(editorState.fname); });
on('#toolCancel', 'click', () => closeEditor());
on('#editorCloseX', 'click', () => closeEditor());
on('#toolFinish', 'click', saveEditor);
on('#toolSwap', 'click', () => $('#swapFileInput')?.click());
on('#swapFileInput', 'change', (e) => { if (e.target.files[0]) { handleSwapFile(e.target.files[0]); e.target.value = ''; } });
on('#cropApply', 'click', applyCrop);
on('#cropCancel', 'click', () => { editorState.cropRect = null; $('#cropActionBar').style.display = 'none'; redrawCanvas(); });
on('#brushSize', 'input', (e) => { const v = $('#brushSizeVal'); if (v) v.textContent = e.target.value; });

// Editor canvas events (registered once, state-gated)
(function setupEditorOnce() {
    const cvs = $('#editorCanvas');
    if (!cvs) return;
    cvs.addEventListener('mousedown', onEditDown);
    cvs.addEventListener('mousemove', onEditMove);
    cvs.addEventListener('mouseup', onEditUp);
    cvs.addEventListener('mouseleave', onEditUp);
    cvs.addEventListener('touchstart', onEditTouchStart, { passive: false });
    cvs.addEventListener('touchmove', onEditTouchMove, { passive: false });
    cvs.addEventListener('touchend', onEditUp);
})();

document.addEventListener('keydown', (e) => {
    if (!editorState.open) return;
    if (e.key === 'Escape') closeEditor();
    else if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); undoEditor(); }
});

// ===== Page Number UI Visibility Control =====
function updatePageNumberUI() {
    const paginate = $('#paginateOutput')?.checked || false;
    const showNums = $('#showPageNumbers')?.checked || false;
    
    const optsContainer = $('#pageNumberOptions');
    const inputsContainer = $('#pageNumberInputs');
    const showNumsCheckbox = $('#showPageNumbers');
    
    // Show/hide the entire page number options block
    if (optsContainer) optsContainer.style.display = paginate ? 'block' : 'none';
    
    // Enable/disable the checkbox
    if (showNumsCheckbox) showNumsCheckbox.disabled = !paginate;
    
    // Show/hide the number input fields
    if (inputsContainer) inputsContainer.style.display = (paginate && showNums) ? 'block' : 'none';
}

// Visibility der Alt-Text-Option steuern
function updateAltOnlyVisibility() {
    const descOnly = $('#docx-desc-only')?.checked !== false;
    const altOnlyGroup = $('#docx-alt-only-group');
    if (altOnlyGroup) {
        altOnlyGroup.style.display = descOnly ? 'none' : '';
    }
}

// Bildbeschreibungen-ohne-Bilder toggle
on('#docx-desc-only', 'change', () => {
    if (typeof saveConfig === 'function') saveConfig();
    updateAltOnlyVisibility();
});

// Paginate Output toggle
on('#paginateOutput', 'change', () => {
    if (typeof saveConfig === 'function') saveConfig();
    updatePageNumberUI();
    if (state.markdown) renderMarkdown(state.markdown);
});

// Show Page Numbers toggle
on('#showPageNumbers', 'change', () => {
    if (typeof saveConfig === 'function') saveConfig();
    updatePageNumberUI();
    if (state.markdown) renderMarkdown(state.markdown);
});

// Page number inputs
on('#pageNumberStart', 'change', () => {
    if (typeof saveConfig === 'function') saveConfig();
    if (state.markdown) renderMarkdown(state.markdown);
});
on('#pageNumberInitial', 'change', () => {
    if (typeof saveConfig === 'function') saveConfig();
    if (state.markdown) renderMarkdown(state.markdown);
});

// ===== Auto-save settings =====
// Save model selection immediately when changed
on('#modelSelect', 'change', () => {
    const val = $('#modelSelect')?.value;
    if (val) localStorage.setItem('pdfPipeline_model', val);
});

// Save other settings on input/change
const autoSaveFields = [
    '#markerServerUrl', '#openwebuiUrl', '#apiToken',
    '#pageRange', '#outputFormat', '#docxFontSize', '#docxLineSpacing'
];
autoSaveFields.forEach(sel => {
    on(sel, 'change', () => {
        if (typeof saveConfig === 'function') saveConfig();
    });
});

const autoSaveChecks = [
    '#forceOcr', '#useLlm', '#stripExistingOcr',
    '#redoInlineMath', '#disableImageExtraction'
];
autoSaveChecks.forEach(sel => {
    on(sel, 'change', () => {
        if (typeof saveConfig === 'function') saveConfig();
    });
});

// Update UI when output format changes
on('#outputFormat', 'change', () => {
    updateOutputFormatUI();
    if (typeof saveConfig === 'function') saveConfig();
});

// ===== Comparison View Functions =====

function buildComparePageMap() {
    const map = {};
    
    // 1. Add all rendered PDF pages
    for (const pageNum of Object.keys(pdfPageImages)) {
        map[pageNum] = {
            pdfPage: pdfPageImages[pageNum],
            extractedImages: [],
            descriptions: [],
            fnames: [] // Store original filenames for editing
        };
    }
    
    // 2. Map extracted Marker images to pages by filename
    for (const fname of Object.keys(state.images || {})) {
        // Try patterns: page_1.png, _page_1.png, page1.png, seite_1.png, 1.png, etc.
        let match = fname.match(/(?:^|_)(?:page|seite)[_\s-]?(\d+)/i);
        if (!match) {
            // Try extracting any number from the filename
            match = fname.match(/(\d+)/);
        }
        if (match) {
            const pageNum = match[1];
            if (!map[pageNum]) {
                map[pageNum] = { pdfPage: null, extractedImages: [], descriptions: [], fnames: [] };
            }
            map[pageNum].extractedImages.push(state.images[fname]);
            map[pageNum].descriptions.push(state.descriptions[fname] || 'Keine Beschreibung');
            map[pageNum].fnames.push(fname);
        }
    }
    
    // 3. If we have images but no pages at all, create a fallback entry
    const hasAnyImages = Object.keys(state.images || {}).length > 0;
    const hasAnyPages = Object.keys(map).length > 0;
    if (hasAnyImages && !hasAnyPages) {
        // Put all images on "page 1" as fallback
        map['1'] = { pdfPage: null, extractedImages: [], descriptions: [], fnames: [] };
        for (const fname of Object.keys(state.images || {})) {
            map['1'].extractedImages.push(state.images[fname]);
            map['1'].descriptions.push(state.descriptions[fname] || 'Keine Beschreibung');
            map['1'].fnames.push(fname);
        }
    }
    
    console.log('[Compare] Page map built:', Object.keys(map).length, 'pages');
    console.log('[Compare] pdfPageImages keys:', Object.keys(pdfPageImages));
    console.log('[Compare] state.images keys:', Object.keys(state.images || {}));
    
    return map;
}

async function openCompareView() {
    comparePageMap = buildComparePageMap();
    const allPages = Object.keys(comparePageMap).map(Number).sort((a, b) => a - b);
    
    if (allPages.length === 0) {
        showToast('Keine Seiten zum Vergleichen vorhanden', 'error');
        return;
    }
    
    compareViewOpen = true;
    compareCurrentPage = String(allPages[0]);

    
    const view = $('#compareView');
    if (view) view.style.display = 'block';
    
    await renderComparePage();

    
    // Scroll markdown preview to matching page
    scrollMdToPage(compareCurrentPage);
    
    // Scroll to view
    setTimeout(() => view?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
}



function scrollMdToPage(pageNum) {
    // Try rendered view first
    const anchorId = mdPageOffsets[pageNum];
    const mdRendered = $('#mdRendered');
    
    if (anchorId && mdRendered && mdRendered.style.display !== 'none') {
        const anchor = mdRendered.querySelector(`#${anchorId}`);
        if (anchor) {
            anchor.scrollIntoView({ behavior: 'smooth', block: 'start' });
            return;
        }
    }
    
    // Fallback: scroll in source view by finding image reference
    const mdSource = $('#mdSource');
    if (!mdSource || mdSource.style.display === 'none') return;
    
    // Find image reference for this page in the markdown text
    const text = mdSource.textContent || '';
    const lines = text.split('\n');
    let targetLine = -1;
    
    // Search for image reference containing page number
    const pagePattern = new RegExp(`page[_-]?${pageNum}|seite[_-]?${pageNum}|\\b${pageNum}\\.`, 'i');
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes('![') && pagePattern.test(lines[i])) {
            targetLine = i;
            break;
        }
    }
    
    // If no image found, estimate position based on page number
    if (targetLine < 0) {
        const totalLines = lines.length;
        const totalPages = pdfTotalPages || Object.keys(comparePageMap).length || 1;
        targetLine = Math.floor((Number(pageNum) - 1) / totalPages * totalLines);
    }
    
    // Scroll source view to estimated position
    if (targetLine >= 0 && mdSource.scrollHeight > mdSource.clientHeight) {
        const lineHeight = mdSource.scrollHeight / lines.length;
        mdSource.scrollTo({ top: targetLine * lineHeight - 50, behavior: 'smooth' });
    }
}

async function renderComparePage() {
    const allPages = Object.keys(comparePageMap).map(Number).sort((a, b) => a - b);
    const total = allPages.length;
    
    if (total === 0) return;
    
    // Ensure current page is valid
    if (!comparePageMap[compareCurrentPage]) {
        compareCurrentPage = String(allPages[0]);
    }
    
    const data = comparePageMap[compareCurrentPage];
    const pageIndex = allPages.indexOf(Number(compareCurrentPage)) + 1;
    
    // Update page info
    const pageInfo = $('#comparePageInfo');
    if (pageInfo) pageInfo.textContent = `Seite ${compareCurrentPage} (${pageIndex}/${total})`;
    
    // Update nav buttons
    const prevBtn = $('#comparePrev');
    const nextBtn = $('#compareNext');
    if (prevBtn) prevBtn.disabled = pageIndex <= 1;
    if (nextBtn) nextBtn.disabled = pageIndex >= total;
    
    // Render original panel - always render HD (ignore thumbnail cache)
    const originalPanel = $('#compareOriginal');
    if (originalPanel) {
        originalPanel.innerHTML = `
            <div class="compare-empty">
                <div style="width:24px;height:24px;border:2px solid var(--border);border-top-color:var(--primary);border-radius:50%;animation:spin 1s linear infinite;margin:0 auto 8px;"></div>
                Lade Seite ${compareCurrentPage}...
            </div>
        `;
        const pdfBase64 = await renderPdfPageOnDemand(Number(compareCurrentPage));
        
        if (pdfBase64) {
            originalPanel.innerHTML = `
                <img src="${pdfBase64}" alt="Original Seite ${compareCurrentPage}" 
                     style="width:auto;height:auto;max-width:none;display:block;margin:0 auto;cursor:zoom-in;"
                     onclick="openCompareZoom('${pdfBase64}', ${compareCurrentPage})">
            `;
        } else {
            originalPanel.innerHTML = `
                <div class="compare-empty">
                    <div style="font-size:2rem;margin-bottom:8px;">📄</div>
                    PDF-Vorschau nicht verfügbar<br>
                    <small style="color:var(--text-muted);">Seite ${compareCurrentPage} konnte nicht gerendert werden</small>
                </div>
            `;
        }
    }
    
    // Render extracted panel
    const extractedPanel = $('#compareExtracted');
    const badge = $('#compareBadge');
    if (extractedPanel) {
        if (data.extractedImages.length > 0) {
            let html = '';
            for (let i = 0; i < data.extractedImages.length; i++) {
                const imgData = data.extractedImages[i];
                const fname = data.fnames[i] || '';
                const desc = data.descriptions[i] || '';
                const imgId = `compare-img-${compareCurrentPage}-${i}`;
                const textareaId = `compare-desc-${compareCurrentPage}-${i}`;
                // Ensure proper data URL format
                const imgSrc = imgData.startsWith('data:') ? imgData : `data:image/jpeg;base64,${imgData}`;
                const safeFname = fname.replace(/'/g, "\\'");
                html += `
                    <div class="compare-image-card" data-fname="${fname}" data-imgidx="${i}">
                        <img src="${imgSrc}" alt="Erkanntes Bild ${i + 1}"
                             style="max-width:100%;cursor:pointer;"
                             onclick="openEditor('${safeFname}')"
                             title="Klicken zum Bearbeiten">
                        <div class="compare-image-actions">
                            <textarea id="${textareaId}" class="compare-desc-textarea" 
                                placeholder="Beschreibung eingeben..." rows="6">${escapeHtml(desc)}</textarea>
                            <div class="compare-image-buttons">
                                <button class="btn btn-primary btn-save-desc" data-fname="${fname}" data-ta="${textareaId}" style="font-size:0.8rem;padding:4px 10px;">
                                    💾 Speichern
                                </button>
                                <button class="btn btn-secondary btn-redescribe" data-fname="${fname}" data-imgid="${imgId}" style="font-size:0.8rem;padding:4px 10px;">
                                    🔄 KI-Neu
                                </button>
                            </div>
                        </div>
                    </div>
                `;
            }
            extractedPanel.innerHTML = html;
            
            // Attach event listeners to buttons
            extractedPanel.querySelectorAll('.btn-save-desc').forEach(btn => {
                btn.addEventListener('click', () => {
                    const fname = btn.dataset.fname;
                    const taId = btn.dataset.ta;
                    const newDesc = $(`#${taId}`)?.value || '';
                    saveDescription(fname, newDesc);
                });
            });
            extractedPanel.querySelectorAll('.btn-redescribe').forEach(btn => {
                btn.addEventListener('click', async () => {
                    const fname = btn.dataset.fname;
                    btn.disabled = true;
                    btn.textContent = '⏳ Lädt...';
                    await reDescribeImage(fname);
                    btn.disabled = false;
                    btn.textContent = '🔄 KI-Neu';
                });
            });
        } else {
            extractedPanel.innerHTML = `
                <div class="compare-empty">
                    <div style="font-size:2rem;margin-bottom:8px;">🖼️</div>
                    Keine Bilder auf dieser Seite erkannt
                </div>
            `;
        }
    }
    if (badge) badge.textContent = data.extractedImages.length;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function saveDescription(fname, newDesc) {
    if (!fname || !state.images[fname]) {
        showToast('Bild nicht gefunden', 'error');
        return;
    }
    
    // Update state
    state.descriptions[fname] = newDesc;
    
    // Update markdown - replace the alt text in image references
    const oldDesc = state.descriptions[fname];
    const md = state.markdown;
    
    // Find image reference and update its caption
    // Pattern: ![oldDesc](fname) or just the alt text
    const imgPattern = new RegExp(`!\\[[^\\]]*\\]\\(${fname.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\)`, 'g');
    const match = md.match(imgPattern);
    
    if (match) {
        // Replace the image reference with new description
        const newImgRef = `![${newDesc}](${fname})`;
        state.markdown = md.replace(imgPattern, newImgRef);
        
        // Also update the caption line after the image if it exists
        const lines = state.markdown.split('\n');
        for (let i = 0; i < lines.length; i++) {
            if (lines[i].includes(`](${fname})`)) {
                // Check next non-empty line
                let j = i + 1;
                while (j < lines.length && lines[j].trim() === '') j++;
                if (j < lines.length && !lines[j].trim().startsWith('![') && !lines[j].trim().startsWith('#')) {
                    lines[j] = newDesc;
                }
                break;
            }
        }
        state.markdown = lines.join('\n');
    }
    
    // Re-render markdown preview
    renderMarkdown(state.markdown);
    
    // Update comparison view
    comparePageMap = buildComparePageMap();
    renderComparePage();
    
    // Regenerate ZIP in background
    regenerateZip();
    
    showToast('Beschreibung gespeichert', 'success');
}

async function reDescribeImage(fname) {
    if (!fname || !state.images[fname]) {
        showToast('Bild nicht gefunden', 'error');
        return;
    }
    
    try {
        // Get custom prompt or use default
        const customPrompt = $('#imagePrompt')?.value?.trim();
        const promptText = customPrompt || DEFAULT_IMAGE_PROMPT;
        
        const payload = {
            model: CONFIG.model,
            stream: false,
            messages: [
                {
                    role: 'user',
                    content: [
                        {
                            type: 'text',
                            text: promptText
                        },
                        {
                            type: 'image_url',
                            image_url: {
                                url: `data:image/jpeg;base64,${state.images[fname]}`
                            }
                        }
                    ]
                }
            ]
        };
        
        let baseUrl = CONFIG.openwebuiUrl.replace(/\/+$/, '');
        const chatUrl = baseUrl + '/chat/completions';
        
        const response = await fetch(chatUrl, {
            method: 'POST',
            headers: {
                'Authorization': 'Bearer ' + CONFIG.apiToken,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });
        
        if (!response.ok) {
            throw new Error(`API-Fehler: ${response.status}`);
        }
        
        const data = await response.json();
        const newDesc = data.choices?.[0]?.message?.content?.trim() || 'Keine Beschreibung erhalten';
        
        // Save the new description
        saveDescription(fname, newDesc);
        
        showToast('Bild neu beschrieben', 'success');
    } catch (err) {
        console.error('Re-describe error:', err);
        showToast('Fehler bei KI-Beschreibung: ' + err.message, 'error');
    }
}



function openCompareZoom(src, pageNum) {
    const overlay = document.createElement('div');
    overlay.className = 'compare-zoom-overlay';
    overlay.innerHTML = `
        <img src="${src}" alt="Seite ${pageNum}">
        <button class="compare-zoom-close">✕</button>
        <div style="position:absolute;top:20px;left:20px;color:#94a3b8;font-size:0.9rem;">Seite ${pageNum}</div>
    `;
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay || e.target.closest('.compare-zoom-close')) {
            overlay.remove();
        }
    });
    document.body.appendChild(overlay);
}



on('#comparePrev', 'click', async () => {
    const allPages = Object.keys(comparePageMap).map(Number).sort((a, b) => a - b);
    const idx = allPages.indexOf(Number(compareCurrentPage));
    if (idx > 0) {
        compareCurrentPage = String(allPages[idx - 1]);
        await renderComparePage();
        scrollMdToPage(compareCurrentPage);
    }
});

on('#compareNext', 'click', async () => {
    const allPages = Object.keys(comparePageMap).map(Number).sort((a, b) => a - b);
    const idx = allPages.indexOf(Number(compareCurrentPage));
    if (idx < allPages.length - 1) {
        compareCurrentPage = String(allPages[idx + 1]);
        await renderComparePage();
        scrollMdToPage(compareCurrentPage);
    }
});



// Keyboard navigation for comparison view
document.addEventListener('keydown', (e) => {
    if (!compareViewOpen) return;
    if (e.key === 'ArrowLeft') {
        const btn = $('#comparePrev');
        if (btn && !btn.disabled) {
            btn.click();
            setTimeout(() => scrollMdToPage(compareCurrentPage), 300);
        }
    } else if (e.key === 'ArrowRight') {
        const btn = $('#compareNext');
        if (btn && !btn.disabled) {
            btn.click();
            setTimeout(() => scrollMdToPage(compareCurrentPage), 300);
        }
    } else if (e.key === 'Escape') {
        const overlay = document.querySelector('.compare-zoom-overlay');
        if (overlay) {
            overlay.remove();
        }
    }
});


// ===== Layout Toggle Functions =====
function togglePanel(panelId) {
    const panel = document.getElementById(panelId);
    if (!panel) return;
    
    panel.classList.toggle('panel-minimized');
    
    const icon = panel.querySelector('.panel-toggle-icon');
    if (icon) {
        icon.textContent = panel.classList.contains('panel-minimized') ? '▶' : '◀';
    }
    
    // Smooth layout adjustment
    setTimeout(() => window.dispatchEvent(new Event('resize')), 300);
}



// ===== Keyboard Shortcuts =====
function initShortcuts() {
    document.addEventListener('keydown', (e) => {
        // Skip if typing in a text field
        if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) {
             // Exception: ESC should still work to blur
             if (e.key === 'Escape') document.activeElement.blur();
             return;
        }

        // Use Alt as modifier
        if (e.altKey) {
            switch(e.key.toLowerCase()) {
                case 'p': // Pipeline starten
                    e.preventDefault();
                    $('#btnStart')?.click();
                    break;
                case 's': // Word anfordern
                    e.preventDefault();
                    $('#btnDownloadDocx')?.click();
                    break;
                case 'm': // Markdown laden
                    e.preventDefault();
                    $('#btnDownloadMd')?.click();
                    break;
                case 'c': // Kopieren
                    e.preventDefault();
                    $('#btnCopyMd')?.click();
                    break;
                case 'r': // Reset
                    e.preventDefault();
                    $('#btnReset')?.click();
                    break;
                case 'e': // Einstellungen (Sidebar)
                    e.preventDefault();
                    $('#sidebarToggle')?.click();
                    break;
            }
        }
    });
    
    debugLog('Tastenkürzel aktiviert: Alt+P (Start), Alt+S (Word), Alt+M (MD), Alt+C (Copy), Alt+E (Settings)', 'info');
}

// Initialisiere Zusatzfunktionen
initShortcuts();

// Export for HTML onclick calls
window.togglePanel = togglePanel;

// ===== Shortcuts Modal =====
function openShortcutsModal() {
    const modal = $('#shortcutsModal');
    if (modal) modal.style.display = 'flex';
}

function closeShortcutsModal() {
    const modal = $('#shortcutsModal');
    if (modal) modal.style.display = 'none';
}

on('#logoClick', 'click', () => {
    openShortcutsModal();
});

on('#shortcutsClose', 'click', () => {
    closeShortcutsModal();
});

// Close shortcuts modal on backdrop click or Escape
$('#shortcutsModal')?.addEventListener('click', (e) => {
    if (e.target === $('#shortcutsModal')) {
        closeShortcutsModal();
    }
});

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        const modal = $('#shortcutsModal');
        if (modal && modal.style.display === 'flex') {
            closeShortcutsModal();
        }
    }
});

console.log('PDF Pipeline Frontend loaded! 🚀');
