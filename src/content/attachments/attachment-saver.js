"use strict";
// Attachment Token Saver — local-only. Watches file uploads (images/PDFs),
// estimates their LLM token cost, and compresses images via canvas so the
// model consumes fewer tokens. No uploads leave the browser.
window.IKO = window.IKO || {};

const MAX_DIM = 1024;
const JPEG_Q = 0.72;
const seenFiles = []; // {id, name, kind, size, width, height, origTokens, file}
let seq = 0;

function estimateImageTokens(w, h, detail = "high") {
    if (!w || !h) return 1500;
    if (detail === "low") return 85;
    const tiles = Math.ceil(w / 512) * Math.ceil(h / 512);
    return 85 + 170 * Math.min(tiles, 12);
}

function estimatePdfTokens(sizeBytes) {
    return Math.max(500, Math.ceil(sizeBytes / 4));
}

function fmtKB(n) {
    return n > 1048576 ? `${(n / 1048576).toFixed(1)}MB` : `${Math.max(1, Math.round(n / 1024))}KB`;
}
function fmtTok(n) {
    return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`;
}

function loadImageDims(file) {
    return new Promise((resolve) => {
        try {
            const url = URL.createObjectURL(file);
            const img = new Image();
            img.onload = () => {
                const w = img.naturalWidth || 0, h = img.naturalHeight || 0;
                URL.revokeObjectURL(url);
                resolve({ w, h });
            };
            img.onerror = () => { try { URL.revokeObjectURL(url); } catch { /* ignore */ } resolve({ w: 0, h: 0 }); };
            img.src = url;
        } catch { resolve({ w: 0, h: 0 }); }
    });
}

async function compressImage(file, maxDim = MAX_DIM, quality = JPEG_Q) {
    const dims = await loadImageDims(file);
    const scale = Math.min(1, maxDim / Math.max(dims.w || maxDim, dims.h || maxDim, 1));
    const w = Math.max(1, Math.round((dims.w || 800) * scale));
    const h = Math.max(1, Math.round((dims.h || 600) * scale));
    const bmp = await (async () => {
        try {
            if (window.createImageBitmap) return await createImageBitmap(file);
            throw new Error("no-bitmap");
        } catch {
            const url = URL.createObjectURL(file);
            try {
                await new Promise((res, rej) => {
                    const img = new Image();
                    img.onload = res; img.onerror = rej; img.src = url;
                });
                const img = new Image();
                img.src = url;
                await img.decode().catch(() => {});
                return img;
            } finally { setTimeout(() => { try { URL.revokeObjectURL(url); } catch { /* ignore */ } }, 5000); }
        }
    })();
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);
    try { ctx.drawImage(bmp, 0, 0, w, h); } catch { /* ignore */ }
    const blob = await new Promise((res) => canvas.toBlob(res, "image/jpeg", quality));
    if (bmp?.close) { try { bmp.close(); } catch { /* ignore */ } }
    return { blob, w, h, origW: dims.w, origH: dims.h };
}

function compactDescriptor(rec, opt) {
    const dim = opt ? `${opt.w}x${opt.h}` : rec.width && rec.height ? `${rec.width}x${rec.height}` : "?";
    const size = opt ? `${fmtKB(rec.size)}→${fmtKB(opt.blob?.size || rec.size)}` : fmtKB(rec.size);
    const tok = opt ? `${fmtTok(rec.origTokens)}→${fmtTok(opt.newTokens)}` : `~${fmtTok(rec.origTokens)}`;
    return `[media:${rec.kind} ${rec.name} ${dim} ${size} tokens:${tok}]`;
}

function recordFile(file) {
    try {
        if (!file || seenFiles.some(f => f.name === file.name && f.size === file.size)) return null;
        const isImg = /^image\//.test(file.type || "") || /\.(png|jpe?g|webp|gif|bmp)$/i.test(file.name || "");
        const isPdf = /pdf/i.test(file.type || "") || /\.pdf$/i.test(file.name || "");
        if (!isImg && !isPdf) return null;
        const rec = {
            id: `att-${++seq}-${Date.now() % 100000}`,
            name: file.name || `upload-${seq}`,
            kind: isImg ? "image" : "pdf",
            size: file.size || 0,
            width: 0, height: 0,
            origTokens: isPdf ? estimatePdfTokens(file.size || 0) : 1500,
            file
        };
        seenFiles.unshift(rec);
        if (seenFiles.length > 20) seenFiles.pop();
        if (isImg) {
            loadImageDims(file).then(({ w, h }) => {
                rec.width = w; rec.height = h;
                rec.origTokens = estimateImageTokens(w || 1024, h || 1024);
                renderBadge();
            });
        }
        try { window.IKO?.logger?.info?.("Attachments", "file detected", { name: rec.name, kind: rec.kind, size: rec.size }); } catch { /* ignore */ }
        renderBadge();
        return rec;
    } catch { return null; }
}

function hookFileInputs() {
    try {
        document.addEventListener("change", (e) => {
            const t = e.target;
            if (t instanceof HTMLInputElement && t.type === "file" && t.files?.length) {
                for (const f of t.files) recordFile(f);
            }
        }, true);
        // drag-drop onto composer
        document.addEventListener("drop", (e) => {
            try {
                const files = e.dataTransfer?.files;
                if (files?.length) for (const f of files) recordFile(f);
            } catch { /* ignore */ }
        }, true);
    } catch { /* ignore */ }
}

function renderBadge() {
    try {
        const btn = document.getElementById("iko-hud-files");
        if (!btn) return;
        const total = seenFiles.reduce((t, f) => t + (f.origTokens || 0), 0);
        btn.textContent = seenFiles.length ? `📎 Files·~${fmtTok(total)}` : "📎 Files";
        btn.title = seenFiles.length
            ? `${seenFiles.length} upload(s) detected · ~${fmtTok(total)} tokens. Click to optimize.`
            : "No uploads detected yet. Attach an image/PDF to optimize it.";
    } catch { /* ignore */ }
}

function openPanel() {
    try { document.getElementById("iko-attachments-panel")?.remove(); } catch { /* ignore */ }
    const root = document.createElement("div");
    root.id = "iko-attachments-panel";
    root.innerHTML = `
        <div class="iko-optimizer-panel">
            <header class="iko-optimizer-header">
                <div class="iko-optimizer-title">📎 Attachment Token Saver</div>
                <button type="button" class="iko-optimizer-close">×</button>
            </header>
            <div class="iko-optimizer-body">
                <div class="iko-optimizer-label">Detected uploads — optimize before sending</div>
                <div class="iko-pick-list" id="iko-att-list"></div>
                <div class="iko-optimizer-label" style="margin-top:10px">How it saves tokens</div>
                <ul class="iko-optimizer-tips">
                    <li>Images are billed per 512px tile (~170 tokens/tile + 85 base). Resizing to ≤${MAX_DIM}px JPEG cuts tiles.</li>
                    <li>Optimized file downloads — re-attach the smaller file instead of the original.</li>
                    <li>Copy descriptor pastes a compact machine-readable line alongside the upload.</li>
                </ul>
            </div>
        </div>`;
    root.querySelector(".iko-optimizer-close")?.addEventListener("click", () => root.remove());
    root.addEventListener("click", (e) => { if (e.target === root) root.remove(); });
    const list = root.querySelector("#iko-att-list");
    const render = () => {
        list.innerHTML = "";
        if (!seenFiles.length) {
            list.textContent = "No images/PDFs detected yet. Use the site's attach (+/📎) button, then reopen this panel.";
            return;
        }
        for (const rec of seenFiles) {
            const row = document.createElement("div");
            row.className = "iko-review-row";
            const label = document.createElement("span");
            label.className = "iko-review-label";
            const dim = rec.width ? ` ${rec.width}x${rec.height}` : "";
            label.textContent = `${rec.name} · ${rec.kind}${dim} · ${fmtKB(rec.size)} · ~${fmtTok(rec.origTokens)}`;
            const btns = document.createElement("div");
            btns.className = "iko-logs-row";
            if (rec.kind === "image") {
                const opt = document.createElement("button");
                opt.type = "button"; opt.className = "iko-migration-button secondary iko-logs-copy";
                opt.textContent = "Optimize ↓";
                opt.addEventListener("click", async () => {
                    opt.textContent = "Working…";
                    try {
                        const out = await compressImage(rec.file);
                        const newTokens = estimateImageTokens(out.w, out.h);
                        const saved = Math.max(0, Math.round((1 - newTokens / Math.max(1, rec.origTokens)) * 100));
                        // download optimized file for re-attach
                        const a = document.createElement("a");
                        a.href = URL.createObjectURL(out.blob);
                        a.download = rec.name.replace(/\.\w+$/, "") + "-iko-1024.jpg";
                        document.body.appendChild(a); a.click();
                        setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 5000);
                        try { await navigator.clipboard.writeText(compactDescriptor(rec, { ...out, newTokens })); } catch { /* ignore */ }
                        label.textContent = `${rec.name} · ${rec.width || "?"}x${rec.height || "?"}→${out.w}x${out.h} · ${fmtKB(rec.size)}→${fmtKB(out.blob.size)} · ~${fmtTok(rec.origTokens)}→${fmtTok(newTokens)} (−${saved}%) · descriptor copied`;
                        try { window.IKO?.logger?.info?.("Attachments", "optimized", { name: rec.name, savedPct: saved }); } catch { /* ignore */ }
                        opt.textContent = `Saved ${saved}% ✓`;
                    } catch (err) { opt.textContent = "Failed"; }
                    setTimeout(() => { opt.textContent = "Optimize ↓"; }, 2000);
                });
                btns.appendChild(opt);
                const ocrBtn = document.createElement("button");
                ocrBtn.type = "button"; ocrBtn.className = "iko-migration-button secondary iko-logs-copy";
                ocrBtn.textContent = "OCR";
                ocrBtn.title = "Run local OCR engine if installed (Tesseract/peer), else setup guidance";
                ocrBtn.addEventListener("click", async () => {
                    ocrBtn.textContent = "OCR…";
                    try {
                        const ocr = window.IKOOCRCore;
                        const sir = window.IKOSIRCore;
                        if (!ocr) throw new Error("OCR engine loading — wait 2s and retry");
                        const res = await ocr.scannedToSIR(rec.file, { id: rec.name, title: rec.name, kind: rec.kind }, sir || null);
                        if (res.route === "sir") {
                            try { await navigator.clipboard.writeText(res.l3); } catch { /* ignore */ }
                            label.textContent = `${rec.name} · OCR SIR copied (conf ${Number(res.ocr.confidence || 0).toFixed(2)}, ${res.ocr.engine})`;
                            ocrBtn.textContent = "SIR ✓";
                        } else {
                            label.textContent = `${rec.name} · OCR unavailable (${res.route}). Add Tesseract vendor or register window.IKOOCR.peer, or run localhost VLM.`;
                            ocrBtn.textContent = "No engine";
                        }
                    } catch (err) { ocrBtn.textContent = "Failed"; }
                    setTimeout(() => { ocrBtn.textContent = "OCR"; }, 2000);
                });
                btns.appendChild(ocrBtn);
            } else {
                const parse = document.createElement("button");
                parse.type = "button"; parse.className = "iko-migration-button secondary iko-logs-copy";
                parse.textContent = "Parse → SIR";
                parse.addEventListener("click", async () => {
                    parse.textContent = "Parsing…";
                    try {
                        const pdf = window.IKOPDFCore;
                        const sir = window.IKOSIRCore;
                        if (!pdf) throw new Error("PDF engine loading — wait 2s and retry");
                        const buf = await rec.file.arrayBuffer();
                        const res = pdf.pdfToSIR(buf, { id: rec.name, title: rec.name }, sir || null);
                        if (res.route === "ocr-required") {
                            label.textContent = `${rec.name} · scanned/image-only (${res.l1.pages || "?"}p) — needs OCR, not sent to LLM`;
                            try { await navigator.clipboard.writeText(`[media:pdf ${rec.name} pages=${res.l1.pages || "?"} status=needs-ocr]`); } catch { /* ignore */ }
                            parse.textContent = "Flagged OCR";
                        } else {
                            const before = sir ? sir.countTokens(res.l2.preview + "") : res.l1.chars / 4;
                            const after = sir ? sir.countTokens(res.l3) : res.l3.length / 4;
                            try { await navigator.clipboard.writeText(res.l3); } catch { /* ignore */ }
                            label.textContent = `${rec.name} · text-native ${res.l1.pages}p · SIR copied (~${Math.round(before)}→${Math.round(after)} tokens)`;
                            try { window.IKO?.logger?.info?.("Attachments", "pdf parsed", { name: rec.name, pages: res.l1.pages }); } catch { /* ignore */ }
                            parse.textContent = "SIR copied ✓";
                        }
                    } catch (err) { parse.textContent = "Failed"; label.textContent = `${rec.name} · parse failed: ${String(err?.message || err).slice(0, 120)}`; }
                    setTimeout(() => { parse.textContent = "Parse → SIR"; }, 2000);
                });
                const cp = document.createElement("button");
                cp.type = "button"; cp.className = "iko-migration-button secondary iko-logs-copy";
                cp.textContent = "Copy descriptor";
                cp.addEventListener("click", async () => {
                    try { await navigator.clipboard.writeText(compactDescriptor(rec, null) + " — paste text content instead of scanned pages where possible."); cp.textContent = "Copied ✓"; }
                    catch { cp.textContent = "Select manually"; }
                    setTimeout(() => { cp.textContent = "Copy descriptor"; }, 1500);
                });
                btns.append(parse, cp);
                const ocrBtn = document.createElement("button");
                ocrBtn.type = "button"; ocrBtn.className = "iko-migration-button secondary iko-logs-copy";
                ocrBtn.textContent = "OCR";
                ocrBtn.title = "Scanned pages: run local OCR engine if installed";
                ocrBtn.addEventListener("click", async () => {
                    ocrBtn.textContent = "OCR…";
                    try {
                        const ocr = window.IKOOCRCore;
                        const sir = window.IKOSIRCore;
                        if (!ocr) throw new Error("OCR engine loading — wait 2s and retry");
                        const buf = await rec.file.arrayBuffer();
                        // Scanned PDFs need page raster (pdf.js render) before pixels exist —
                        // try peer/VLM directly on the blob; honest route when absent.
                        const res = await ocr.scannedToSIR(rec.file, { id: rec.name, title: rec.name, kind: "pdf-scan" }, sir || null);
                        void buf;
                        if (res.route === "sir") {
                            try { await navigator.clipboard.writeText(res.l3); } catch { /* ignore */ }
                            label.textContent = `${rec.name} · OCR SIR copied (conf ${Number(res.ocr.confidence || 0).toFixed(2)})`;
                            ocrBtn.textContent = "SIR ✓";
                        } else {
                            label.textContent = `${rec.name} · ${res.route}: raster page (screenshot) or add Tesseract/peer/localhost VLM. Raw bytes never sent.`;
                            ocrBtn.textContent = "No engine";
                        }
                    } catch (err) { ocrBtn.textContent = "Failed"; }
                    setTimeout(() => { ocrBtn.textContent = "OCR"; }, 2000);
                });
                btns.appendChild(ocrBtn);
            }
            row.append(label, btns);
            list.appendChild(row);
        }
    };
    render();
    document.body.appendChild(root);
    requestAnimationFrame(() => root.classList.add("iko-optimizer-visible"));
}

window.IKO.attachments = {
    recordFile, compressImage, estimateImageTokens, estimatePdfTokens,
    list: () => [...seenFiles], openPanel, compactDescriptor
};
try { window.addEventListener("iko-attachments-requested", openPanel); } catch { /* ignore */ }
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", hookFileInputs, { once: true });
else hookFileInputs();
export { compressImage, estimateImageTokens, estimatePdfTokens };
