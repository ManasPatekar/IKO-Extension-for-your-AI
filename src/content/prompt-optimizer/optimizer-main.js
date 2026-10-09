"use strict";
(function () {
    function deepQueryAll(selector) {
        const out = []; const seen = new Set();
        const pushAll = (root) => {
            try { for (const n of root.querySelectorAll(selector)) { if (!seen.has(n)) { seen.add(n); out.push(n); } } } catch { /* ignore */ }
            try { for (const n of root.querySelectorAll("*")) { if (n.shadowRoot) pushAll(n.shadowRoot); if (out.length > 200) break; } } catch { /* ignore */ }
        };
        pushAll(document);
        return out;
    }
    function findComposer() {
        const sels = ["#prompt-textarea", "[data-testid='chat-input']", ".ProseMirror",
            "div.ProseMirror[contenteditable='true']", "rich-textarea", "rich-textarea [contenteditable='true']",
            "[aria-label*='prompt' i]", "[aria-label*='Ask' i]", "[placeholder*='Ask' i]",
            "fieldset [contenteditable='true']",
            "form textarea", "textarea", "[contenteditable='true']", "[role='textbox']"];
        const cands = [];
        for (const s of sels) {
            try {
                deepQueryAll(s).forEach(elm => {
                    const r = elm.getBoundingClientRect?.() || { width: 0, height: 0, bottom: -1, top: 9999 };
                    if (r.width > 180 && r.height > 18 && r.bottom > 0 && r.top < innerHeight) {
                        cands.push({ elm, bottom: r.bottom, area: r.width * r.height });
                    } else if (r.width === 0 && elm.tagName === "RICH-TEXTAREA") {
                        try {
                            const inner = elm.shadowRoot?.querySelector?.("[contenteditable='true']");
                            if (inner) cands.push({ elm: inner, bottom: innerHeight - 100, area: 50000 });
                        } catch { /* ignore */ }
                    }
                });
            } catch { /* ignore */ }
        }
        if (!cands.length) {
            try {
                const labelled = document.querySelector("[aria-label*='Ask Gemini' i]");
                if (labelled) {
                    const inner = labelled.shadowRoot?.querySelector?.("[contenteditable]") || labelled;
                    cands.push({ elm: inner, bottom: innerHeight - 100, area: 50000 });
                }
            } catch { /* ignore */ }
        }
        if (!cands.length) return null;
        cands.sort((a, b) => b.bottom - a.bottom || b.area - a.area);
        const pm = cands.find(c => c.elm.classList?.contains("ProseMirror")) || cands.find(c => c.elm.querySelector?.(".ProseMirror"));
        return (pm?.elm?.querySelector?.(".ProseMirror") || pm?.elm || cands[0].elm);
    }

    function readComposer(elm) {
        if (!elm) return "";
        if (elm.tagName === "TEXTAREA" || elm.tagName === "INPUT") return elm.value || "";
        const pm = elm.classList?.contains("ProseMirror") ? elm : elm.querySelector?.(".ProseMirror");
        const t = pm || elm;
        return (t.innerText || t.textContent || "").trim();
    }

    function writeComposer(elm, value) {
        if (!elm) return false;
        elm.focus();
        try { elm.focus(); } catch { /* ignore */ }
        if (elm.tagName === "TEXTAREA" || elm.tagName === "INPUT") {
            const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set
                || Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
            setter?.call(elm, value);
        } else {
            try {
                elm.innerHTML = "";
                if (!document.execCommand("insertText", false, value)) elm.textContent = value;
            } catch { elm.textContent = value; }
        }
        try { elm.dispatchEvent(new InputEvent("beforeinput", { bubbles: true, inputType: "insertText", data: value })); } catch { /* ignore */ }
        elm.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
        elm.dispatchEvent(new Event("change", { bubbles: true }));
        return true;
    }

    // Fix stray paren above at build time guard
    function safeWrite(elm, value) {
        try { return writeComposer(elm, value); }
        catch (e) {
            try {
                elm.focus();
                elm.textContent = value;
                elm.dispatchEvent(new InputEvent("input", { bubbles: true }));
                return true;
            } catch { return false; }
        }
    }

    function createLauncher() {
        // Unified dock: Migrate + Optimize now live inside the HUD (#iko-hud-actions)
        // and behind the single #iko-bot button. Remove legacy floaters to avoid 3 buttons.
        try {
            document.getElementById("iko-optimizer-launcher")?.remove();
            document.getElementById("iko-migration-launcher")?.remove();
        } catch { /* ignore */ }
        return null;
    }

    function start() { createLauncher(); wireEvent(); }

    function wireEvent() {
        try {
            window.addEventListener("iko-optimize-requested", () => {
                const composer = findComposer();
                if (!composer) { alert("IKO could not find the chat box. Click inside it once and retry."); return; }
                const original = readComposer(composer);
                if (!original || original.length < 3) { alert("Type your prompt in the chat box first, then click Optimize."); return; }
                window.IKOOptimizerUI.createOptimizerUI({ original, onApply: (optimized) => { safeWrite(composer, optimized); } });
            });
        } catch { /* ignore */ }
    }

    window.IKOOptimizerMain = { start };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
    else start();
})();
