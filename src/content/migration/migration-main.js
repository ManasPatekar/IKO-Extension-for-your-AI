"use strict";

(function () {
    let migrationPanel = null;

    function getPlatforms() {
        try {
            if (window.IKOMigrationCore?.PLATFORMS) return window.IKOMigrationCore.PLATFORMS;
        } catch { /* ignore */ }
        return null;
    }

    function getCurrentPlatform() {
        const host = location.hostname.toLowerCase();
        const plats = getPlatforms();
        if (plats) {
            for (const p of Object.values(plats)) {
                if ((p.hosts || []).some(h => host === h || host.endsWith("." + h))) return p.id;
            }
        }
        // fallback for first load before core ready
        if (host === "claude.ai" || host.endsWith(".claude.ai")) return "claude";
        if (host === "chatgpt.com" || host.endsWith(".chatgpt.com") || host === "chat.openai.com" || host.endsWith(".chat.openai.com")) return "chatgpt";
        if (host.includes("gemini")) return "gemini";
        if (host.includes("perplexity")) return "perplexity";
        if (host.includes("copilot")) return "copilot";
        if (host.includes("grok")) return "grok";
        return null;
    }

    function platformName(id) {
        const plats = getPlatforms();
        if (plats?.[id]?.name) return plats[id].name;
        return id === "claude" ? "Claude" : id === "chatgpt" ? "ChatGPT" : (id || "Unknown");
    }

    function getDirection() {
        const platform = getCurrentPlatform();
        if (!platform) return null;
        const plats = getPlatforms();
        const all = plats ? Object.values(plats).filter(p => p.id !== platform).map(p => ({ id: p.id, name: p.name })) : [];
        // sensible default: chatgpt<->claude, others -> chatgpt
        const def = platform === "chatgpt" ? "claude" : "chatgpt";
        return {
            source: platform,
            sourceName: `${platformName(platform)} — Current Session`,
            destination: def,
            destinationName: platformName(def),
            destinations: all.length ? all : [{ id: def, name: platformName(def) }]
        };
    }

    function createLauncher() {
        // Unified dock: single #iko-bot toggles HUD which contains Migrate.
        // Remove legacy floater so only bot + HUD remain.
        try { document.getElementById("iko-migration-launcher")?.remove(); } catch { /* ignore */ }
        return null;
    }

    function createSourceAdapter(id) {
        const core = window.IKOMigrationCore;
        // precise parsers where we have them, universal fallback everywhere else
        if (id === "claude" && core.ClaudeSourceAdapter) {
            try { return new core.ClaudeSourceAdapter(); } catch { /* fall through */ }
        }
        if (id === "chatgpt" && core.ChatGPTSourceAdapter) {
            try { return new core.ChatGPTSourceAdapter(); } catch { /* fall through */ }
        }
        return new core.UniversalSourceAdapter(id);
    }

    function createDestinationAdapter(id) {
        const core = window.IKOMigrationCore;
        if (id === "chatgpt" && core.ChatGPTDestinationAdapter) return new core.ChatGPTDestinationAdapter();
        if (id === "claude" && core.ClaudeDestinationAdapter) return new core.ClaudeDestinationAdapter();
        return new core.UniversalDestinationAdapter(id);
    }

    function openMigrationPanel() {
        const existing = document.getElementById("iko-migration-panel");
        if (existing) existing.remove();
        migrationPanel = null;

        if (!window.IKOMigrationUI || !window.IKOMigrationCore) {
            console.error("[IKO Migration] Migration modules are not ready.");
            return;
        }

        const direction = getDirection();
        if (!direction) {
            console.warn("[IKO Migration] Unsupported page.");
            return;
        }

        const sourceAdapter = createSourceAdapter(direction.source);
        let destinationAdapter = createDestinationAdapter(direction.destination);
        let engine = new window.IKOMigrationCore.MigrationEngine({ sourceAdapter, destinationAdapter });
        let lastResult = null;
        let currentDestination = direction.destination;

        migrationPanel = window.IKOMigrationUI.createMigrationUI({
            sourceId: direction.source,
            sourceName: direction.sourceName,
            destinationId: direction.destination,
            destinationName: direction.destinationName,
            destinations: direction.destinations,
            directionLabel: `${direction.sourceName} → ${direction.destinationName}`,
            onListLibrary: listLibrary,
            onLoadLibrary: loadLibraryItem,
            onDeleteLibrary: deleteLibraryItem,
            onSaveLibrary: saveLibraryItem,
            onDestinationChange: (newDest) => {
                currentDestination = newDest;
                lastResult = null;
                try {
                    destinationAdapter = createDestinationAdapter(newDest);
                    engine = new window.IKOMigrationCore.MigrationEngine({ sourceAdapter, destinationAdapter });
                    window.IKO?.logger?.info?.("Migration", "destination changed", { to: newDest });
                } catch (e) { window.IKO?.logger?.error?.("Migration", "bad destination", { error: String(e) }); }
            },
            onPrepareMigration: async () => {
                try { window.IKO?.logger?.info?.("Migration", "prepare clicked", { ...direction, destination: currentDestination }); } catch { /* ignore */ }
                const result = await engine.run();
                try {
                    window.IKO?.logger?.info?.("Migration", result.success ? "engine success" : "engine failed",
                        result.success
                            ? { messages: result.session?.messages?.length, state: result.state?.stage }
                            : { error: String(result.error?.message || result.error), history: result.state?.history });
                } catch { /* ignore */ }
                if (!result.success) throw result.error;
                lastResult = result;
                return { session: result.session, migrationPackage: result.migrationPackage };
            },
            onOpenDestination: async (_destination, migrationPackage) => {
                if (!lastResult?.migrationPackage) throw new Error("Migration package is not ready.");
                const result = await engine.prepareDestination(migrationPackage);
                if (!result.success) throw result.error;
                return result;
            },
            onClose: () => { migrationPanel = null; }
        });
    }

    function closeMigrationPanel() {
        const root = document.getElementById("iko-migration-panel");
        if (root) root.remove();
        migrationPanel = null;
    }

    function deepQueryAll(selector) {
        const out = [];
        const seen = new Set();
        const pushAll = (root) => {
            try {
                for (const n of root.querySelectorAll(selector)) {
                    if (!seen.has(n)) { seen.add(n); out.push(n); }
                }
            } catch { /* bad selector for this root */ }
            // one recursive shadow pass (Gemini rich-textarea, etc.)
            try {
                for (const n of root.querySelectorAll("*")) {
                    const sr = n.shadowRoot;
                    if (sr) pushAll(sr);
                    if (out.length > 200) break;
                }
            } catch { /* ignore */ }
        };
        pushAll(document);
        return out;
    }

    function findComposer() {
        const selectors = [
            "#prompt-textarea",
            "[data-testid='chat-input']",
            ".ProseMirror",
            "div.ProseMirror[contenteditable='true']",
            "rich-textarea",
            "rich-textarea [contenteditable='true']",
            "[aria-label*='prompt' i]",
            "[aria-label*='Ask' i]",
            "[placeholder*='Ask' i]",
            ".ql-editor[contenteditable='true']",
            "div[role='textbox']",
            "fieldset [contenteditable='true']",
            "form textarea",
            "form [contenteditable='true']",
            "form [role='textbox']",
            "textarea",
            "[contenteditable='true']",
            "[role='textbox']"
        ];
        const candidates = [];
        for (const selector of selectors) {
            try {
                deepQueryAll(selector).forEach(element => {
                    const rect = element.getBoundingClientRect?.() || { width: 0, height: 0, bottom: -1, top: 9999 };
                    // Gemini bar is short (~50px) — lower thresholds vs ChatGPT
                    if (rect.width > 180 && rect.height > 18 && rect.bottom > 0 && rect.top < innerHeight) {
                        const editable = element.getAttribute?.("contenteditable") === "true" || element.tagName === "TEXTAREA" || element.tagName === "RICH-TEXTAREA";
                        candidates.push({ element, editable, bottom: rect.bottom, area: rect.width * rect.height, selector });
                    } else if (rect.width === 0 && rect.height === 0 && (element.tagName === "RICH-TEXTAREA" || /prompt|ask/i.test(element.getAttribute?.("aria-label") || ""))) {
                        // shadow host with zero rect — keep inner editable instead
                        try {
                            const inner = element.shadowRoot?.querySelector?.("[contenteditable='true'], div[role='textbox']");
                            if (inner) candidates.push({ element: inner, editable: true, bottom: innerHeight - 100, area: 50000, selector: selector + "::shadow" });
                        } catch { /* ignore */ }
                    }
                });
            } catch { /* bad selector */ }
        }
        // Last resort on Gemini: box labelled "Ask Gemini"
        if (!candidates.length) {
            try {
                const labelled = document.querySelector("[aria-label*='Ask Gemini' i], [placeholder*='Ask Gemini' i]");
                if (labelled) {
                    const inner = labelled.shadowRoot?.querySelector?.("[contenteditable]") || labelled.querySelector?.("[contenteditable]") || labelled;
                    candidates.push({ element: inner, editable: true, bottom: innerHeight - 100, area: 50000, selector: "ask-gemini-fallback" });
                }
            } catch { /* ignore */ }
        }
        try { window.IKO?.logger?.info?.("Migration", "composer scan", { found: candidates.length, sels: candidates.slice(0, 4).map(c => c.selector) }); } catch { /* ignore */ }
        if (!candidates.length) return null;
        // Editable nodes first, then lowest on screen, then largest
        candidates.sort((a, b) => (b.editable - a.editable) || (b.bottom - a.bottom) || (b.area - a.area));
        return candidates[0].element;
    }

    function sessionToPrompt(session, excluded) {
        const source = session?.source || {};
        const messages = (Array.isArray(session?.messages) ? session.messages : [])
            .filter(m => !(excluded && excluded.has?.(m.id)));
        const lines = [
            "IKO SESSION MIGRATION",
            `Source: ${source.platform || "AI"}`,
            `Conversation: ${source.title || "Untitled Session"}`,
            "",
            "The following is the preserved conversation context. Continue from it without losing the previous decisions, requirements, or code context.",
            "",
            "--- CONVERSATION ---"
        ];
        for (const message of messages) {
            const content = Array.isArray(message.content)
                ? message.content.map(block => block?.text || block?.code || (block?.input ? JSON.stringify(block.input) : "") || (block?.output ? JSON.stringify(block.output) : "") || "").join("\n")
                : String(message.content || "");
            if (content.trim()) lines.push(`${String(message.role || "user").toUpperCase()}:\n${content}`);
        }
        lines.push("", "--- END CONVERSATION ---", "", "Continue from the conversation above.");
        return lines.join("\n");
    }

    function sessionToChunks(session, excluded, maxChars = 7500) {
        const full = sessionToPrompt(session, excluded);
        if (full.length <= maxChars) return [full];
        // greedy split by message turns so we never cut code mid-block
        const source = session?.source || {};
        const header = `IKO SESSION MIGRATION (Source: ${source.platform || "AI"} — ${source.title || "Untitled"})`;
        const turns = [];
        for (const m of (session?.messages || []).filter(x => !(excluded && excluded.has?.(x.id)))) {
            const c = Array.isArray(m.content) ? m.content.map(b => b?.text || b?.code || "").join("\n") : String(m.content || "");
            if (c.trim()) turns.push(`${String(m.role || "user").toUpperCase()}:\n${c}`);
        }
        const chunks = [];
        let cur = [];
        let len = 0;
        for (const t of turns) {
            if (len + t.length > maxChars && cur.length) { chunks.push(cur); cur = []; len = 0; }
            cur.push(t); len += t.length + 2;
        }
        if (cur.length) chunks.push(cur);
        return chunks.map((parts, i) => [header, `Part ${i + 1}/${chunks.length} — paste all parts in order, then continue.`, "", "--- CONVERSATION ---", ...parts, "--- END ---"].join("\n"));
    }

    // ---- Session library (local, max 20) ----
    function storageGet(keys) {
        return new Promise(resolve => {
            try { chrome.storage.local.get(keys, r => resolve(r || {})); }
            catch { resolve({}); }
        });
    }
    function storageSet(obj) {
        return new Promise((resolve, reject) => {
            try { chrome.storage.local.set(obj, () => chrome.runtime.lastError ? reject(new Error(chrome.runtime.lastError.message)) : resolve()); }
            catch (e) { reject(e); }
        });
    }
    async function listLibrary() {
        const { ikoSessions } = await storageGet(["ikoSessions"]);
        return Array.isArray(ikoSessions) ? ikoSessions : [];
    }
    async function saveLibraryItem({ session, package: pkg }) {
        const items = await listLibrary();
        const id = `${session?.source?.conversationId || Date.now()}-${Date.now()}`;
        items.unshift({
            id,
            title: session?.source?.title || "Untitled",
            platform: session?.source?.platform || "?",
            messages: session?.messages?.length || 0,
            savedAt: new Date().toISOString(),
            session: JSON.parse(JSON.stringify(session)),
            package: pkg ? JSON.parse(JSON.stringify(pkg)) : null
        });
        await storageSet({ ikoSessions: items.slice(0, 20) });
        try { window.IKO?.logger?.info?.("Library", "saved", { id }); } catch { /* ignore */ }
    }
    async function loadLibraryItem(id) {
        const items = await listLibrary();
        const it = items.find(x => x.id === id);
        if (!it) throw new Error("Saved session not found.");
        return { session: it.session, package: it.package };
    }
    async function deleteLibraryItem(id) {
        const items = await listLibrary();
        await storageSet({ ikoSessions: items.filter(x => x.id !== id) });
    }

    function setComposerValue(element, value) {
        if (!element) return false;
        try { window.IKO?.logger?.info?.("Migration", "inserting into composer", { tag: element.tagName, cls: String(element.className || "").slice(0, 120) }); } catch { /* ignore */ }
        element.focus();
        // Claude ProseMirror needs execCommand / beforeinput, plain textContent alone won't trigger it
        const isProseMirror = element.classList?.contains("ProseMirror") || element.querySelector?.(".ProseMirror");
        const target = (isProseMirror && element.classList?.contains("ProseMirror")) ? element : (element.querySelector?.(".ProseMirror") || element);
        try { target.focus(); } catch { /* ignore */ }
        if (target.tagName === "TEXTAREA" || target.tagName === "INPUT") {
            const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set || Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
            setter?.call(target, value);
        } else {
            // Clear placeholder <p><br></p> that ProseMirror leaves behind
            try {
                target.innerHTML = "";
                // insertText preserves undo stack and fires TipTap listeners
                if (!document.execCommand("insertText", false, value)) {
                    target.textContent = value;
                }
            } catch {
                target.textContent = value;
            }
        }
        try { target.dispatchEvent(new InputEvent("beforeinput", { bubbles: true, inputType: "insertText", data: value })); } catch { /* ignore */ }
        target.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
        target.dispatchEvent(new Event("change", { bubbles: true }));
        return true;
    }

    function showPendingMigration(packageData) {
        const current = getCurrentPlatform();
        if (!current || !packageData?.session) return;
        const pkgSource = packageData.source?.platform || packageData.session?.source?.platform || null;
        try { window.IKO?.logger?.info?.("Migration", "pending check", { current, pkgSource }); } catch { /* ignore */ }
        // Show ONLY on destination: current tab must differ from package origin.
        // Old code compared against direction.source (== current tab) with !== and
        // therefore showed on ChatGPT source and hid on Claude destination.
        if (pkgSource && pkgSource === current) return;
        if (document.getElementById("iko-pending-migration")) return;

        const bar = document.createElement("div");
        bar.id = "iko-pending-migration";
        bar.innerHTML = `
            <div>
                <strong>IKO migration ready</strong>
                <span>${packageData.session.source?.title || "Migrated session"}</span>
            </div>
            <button type="button">Insert session context</button>
            <button type="button" aria-label="Dismiss">×</button>
        `;
        document.body.appendChild(bar);

        bar.querySelector("button")?.addEventListener("click", () => {
            const composer = findComposer();
            if (!composer) {
                alert("IKO could not find the destination composer. Click the chat box and try again.");
                return;
            }
            // Chunked insert: big sessions exceed composer limits — paste part by part
            const chunks = sessionToChunks(packageData.session, null);
            let idx = Number(bar.dataset.chunk || 0);
            setComposerValue(composer, chunks[idx]);
            try { window.IKO?.logger?.info?.("Migration", "inserted chunk", { idx: idx + 1, of: chunks.length }); } catch { /* ignore */ }
            if (idx + 1 < chunks.length) {
                bar.dataset.chunk = String(idx + 1);
                bar.querySelector("button").textContent = `Insert part ${idx + 2}/${chunks.length}`;
            } else {
                try {
                    chrome.runtime.sendMessage(
                        { type: "IKO_CLEAR_MIGRATION" },
                        () => { void chrome.runtime?.lastError; }
                    );
                } catch (error) {
                    console.debug("[IKO Migration] Could not clear migration state:", error?.message || error);
                }
                bar.remove();
            }
        });

        bar.querySelectorAll("button")[1]?.addEventListener("click", () => {
            bar.remove();
        });
    }

    function checkPendingMigration() {
        if (!globalThis.chrome?.runtime?.sendMessage) return;

        try {
            chrome.runtime.sendMessage(
                { type: "IKO_GET_MIGRATION" },
                response => {
                    if (chrome.runtime?.lastError) {
                        console.debug("[IKO Migration] Context unavailable:", chrome.runtime.lastError.message);
                        return;
                    }
                    if (!response?.success || !response.package) return;
                    showPendingMigration(response.package);
                }
            );
        } catch (error) {
            // A stale content script can survive an extension reload. Never let it throw.
            console.debug("[IKO Migration] Extension context unavailable:", error?.message || error);
        }
    }

    function initialize() {
        // migration-entry.js also calls start() — guard against double init
        // (double init = double polling, double logs, double launchers).
        try {
            if (window.__IKO_MIGRATION_STARTED__) return;
            window.__IKO_MIGRATION_STARTED__ = true;
        } catch { /* ignore */ }
        createLauncher();
        console.log("[IKO Migration] Ready:", getDirection());
        setTimeout(checkPendingMigration, 1200);
        setInterval(checkPendingMigration, 1500);
    }

    window.IKOMigrationMain = {
        start: initialize,
        open: openMigrationPanel,
        close: closeMigrationPanel,
        getDirection
    };

    window.IKO = window.IKO || {};
    window.IKO.migration = window.IKO.migration || {};
    Object.assign(window.IKO.migration, {
        start: initialize,
        open: openMigrationPanel,
        close: closeMigrationPanel,
        getDirection
    });

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", initialize, { once: true });
    } else {
        initialize();
    }
})();
