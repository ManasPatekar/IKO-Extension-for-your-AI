const { SourceAdapter, AdapterError } = require("./adapter-interface.js");

function log(level, message, data) {
    try {
        const logger = globalThis.window?.IKO?.logger;
        if (logger && logger[level]) logger[level]("ChatGPT-extract", message, data);
        else console.log(`[IKO:ChatGPT-extract] ${message}`, data ?? "");
    } catch { /* ignore */ }
}

function fingerprintMain() {
    try {
        const main = document.querySelector("main");
        if (!main) return { hasMain: false, bodyLen: (document.body?.innerText || "").length };
        const all = Array.from(main.querySelectorAll("*")).slice(0, 4000);
        const dataAttrs = new Set();
        const testids = new Set();
        const tagCounts = {};
        for (const el of all) {
            const tag = el.tagName.toLowerCase();
            tagCounts[tag] = (tagCounts[tag] || 0) + 1;
            for (const a of el.attributes || []) {
                if (a.name.startsWith("data-")) {
                    dataAttrs.add(a.name);
                    if (a.name === "data-testid" && testids.size < 40) testids.add(a.value.slice(0, 80));
                }
            }
            if (testids.size >= 40) break;
        }
        return {
            hasMain: true,
            totalNodes: all.length,
            mainTextLen: (main.innerText || "").length,
            dataAttrs: [...dataAttrs].slice(0, 30),
            testids: [...testids].slice(0, 30),
            topTags: Object.entries(tagCounts).sort((a, b) => b[1] - a[1]).slice(0, 12),
            mainHtmlSample: main.innerHTML.slice(0, 3000)
        };
    } catch (e) {
        return { error: String(e) };
    }
}

function partsToText(content) {
    try {
        if (!content) return "";
        if (typeof content === "string") return content;
        if (Array.isArray(content.parts)) {
            return content.parts.map(p => {
                if (typeof p === "string") return p;
                if (p?.text) return p.text;
                try { return JSON.stringify(p); } catch { return ""; }
            }).join("\n").trim();
        }
        if (typeof content.text === "string") return content.text;
        return "";
    } catch { return ""; }
}

function parseListMessages(list) {
    const out = [];
    for (const raw of (list || [])) {
        const msg = raw?.message || raw;
        const role = msg?.author?.role || msg?.role || msg?.sender;
        if (role !== "user" && role !== "assistant" && role !== "system") continue;
        const text = partsToText(msg?.content).trim();
        if (!text || text.length < 2) continue;
        out.push({
            id: String(msg?.id || raw?.id || `chatgpt-api-${out.length + 1}`),
            role, sourceRole: String(role),
            content: text.slice(0, 20000),
            parentId: out.length ? out[out.length - 1].id : null,
            timestamp: msg?.create_time || raw?.create_time || null,
            model: msg?.metadata?.model_slug || null,
            raw: { api: true }
        });
    }
    return out.length ? out : null;
}

function parseBridgeData(data) {
    try {
        // Shape 1: full conversation with mapping (classic /backend-api/conversation/<id>)
        const root = data?.mapping ? data : data?.conversation || data?.data || null;
        const mapping = root?.mapping;
        if (mapping && typeof mapping === "object") {
            // walk current_node -> parent chain to preserve order
            let nodeId = root.current_node || root.currentNode || null;
            const chain = [];
            const seen = new Set();
            if (nodeId && mapping[nodeId]) {
                while (nodeId && !seen.has(nodeId)) {
                    seen.add(nodeId);
                    const node = mapping[nodeId];
                    if (!node) break;
                    chain.unshift(node);
                    nodeId = node.parent || node.parentId || null;
                }
            } else {
                // no current_node: take all message nodes in insertion order
                for (const n of Object.values(mapping)) chain.push(n);
            }
            const out = [];
            for (const n of chain) {
                const msg = n?.message || n;
                const role = msg?.author?.role || msg?.role;
                if (role !== "user" && role !== "assistant" && role !== "system") continue;
                const text = partsToText(msg?.content).trim();
                if (!text || text.length < 2) continue;
                out.push({
                    id: String(msg?.id || n?.id || `chatgpt-api-${out.length + 1}`),
                    role, sourceRole: String(role),
                    content: text.slice(0, 20000),
                    parentId: out.length ? out[out.length - 1].id : null,
                    timestamp: msg?.create_time || null, model: msg?.metadata?.model_slug || null,
                    raw: { api: true }
                });
            }
            if (out.length) return out;
        }
        // Shape 2: metadata + messages[] list (/backend-api/conversations/<id>?num_turns=)
        for (const key of ["messages", "turns", "conversation_messages", "items"]) {
            const list = data?.[key] || root?.[key];
            if (Array.isArray(list) && list.length) {
                const parsed = parseListMessages(list);
                if (parsed?.length) return parsed;
            }
        }
        return null;
    } catch { return null; }
}

function allKeys(data) {
    try { return Object.keys(data || {}); } catch { return []; }
}

async function tryBridge() {
    const b = globalThis.window?.IKO?.chatgptBridge;
    if (b?.latestConversation) {
        const parsed = parseBridgeData(b.latestConversation);
        if (parsed?.length) {
            log("info", `bridge yielded ${parsed.length} messages`, {});
            return parsed;
        }
        log("warn", "bridge data present but unparsable", {
            keys: allKeys(b.latestConversation)
        });
    }
    // Direct fetch fallback: same-origin backend-api carries auth cookies.
    // NOTE: plural /conversations/<id> is the live endpoint (singular 404s).
    try {
        const id = location.pathname.split("/").filter(Boolean).pop();
        if (id && id.length > 10) {
            for (const path of [`/backend-api/conversations/${id}`, `/backend-api/conversation/${id}`]) {
                try {
                    const r = await fetch(path, { credentials: "include" });
                    if (!r.ok) {
                        log("warn", `direct API ${path} status ${r.status}`, {});
                        continue;
                    }
                    const data = await r.json();
                    try { globalThis.window.IKO.chatgptBridge.latestConversation = data; } catch { /* ignore */ }
                    const parsed = parseBridgeData(data);
                    if (parsed?.length) {
                        log("info", `direct API (${path}) yielded ${parsed.length} messages`, {});
                        return parsed;
                    }
                    log("warn", `direct API (${path}) unparsable`, { keys: allKeys(data) });
                } catch (e) {
                    log("warn", `direct API (${path}) failed`, { error: String(e?.message || e).slice(0, 200) });
                }
            }
        }
    } catch (e) {
        log("warn", "direct API failed", { error: String(e?.message || e).slice(0, 300) });
    }
    return null;
}
function getRole(node) {
    const d = node.getAttribute?.("data-message-author-role");
    if (d === "assistant" || d === "user" || d === "system") return d;
    const tid = node.getAttribute?.("data-testid") || "";
    if (/assistant/i.test(tid)) return "assistant";
    if (/user|human/i.test(tid)) return "user";
    if (node.querySelector?.("button[aria-label*='Copy'], button[aria-label*='Read aloud']")) return "assistant";
    return null;
}

function textOf(node) {
    const md = node.querySelector?.(".markdown, [data-testid='markdown']");
    return ((md || node).innerText || node.textContent || "").trim();
}

// App-shell fallback: keep LEAF blocks (no qualifying child), not outermost.
// Old code kept the whole <main> as 1 block. Role via toolbar markers.
function fallbackBlocks() {
    const main = document.querySelector("main") || document.body;
    const cands = [];
    const walker = document.createTreeWalker(main, NodeFilter.SHOW_ELEMENT, {
        acceptNode(el) {
            if (!(el instanceof HTMLElement)) return NodeFilter.FILTER_SKIP;
            if (/^(SCRIPT|STYLE|NAV|HEADER|FOOTER|BUTTON|TEXTAREA)$/.test(el.tagName)) return NodeFilter.FILTER_SKIP;
            return NodeFilter.FILTER_ACCEPT;
        }
    });
    while (walker.nextNode()) {
        const el = walker.currentNode;
        const t = (el.innerText || "").trim();
        if (t.length < 120 || t.length > 50000) continue;
        // skip thread root / shell containers — we want turns
        if (el === main || el.hasAttribute?.("data-app-shell-thread-content-overlap")) continue;
        cands.push({ el, len: t.length, text: t });
        if (cands.length > 1200) break;
    }
    // keep only leaves: drop any candidate that CONTAINS another candidate
    const leaves = cands.filter(a =>
        !cands.some(b => b !== a && a.el.contains(b.el) && b.text.length > 80)
    );
    // dedupe identical text, document order
    const seen = new Set();
    const ordered = [];
    // document order sort
    leaves.sort((a, b) => a.el.compareDocumentPosition(b.el) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1);
    for (const c of leaves) {
        const key = c.text.slice(0, 120);
        if (seen.has(key)) continue;
        seen.add(key);
        if (ordered.length && ordered[ordered.length - 1].text === c.text) continue;
        ordered.push(c);
        if (ordered.length >= 80) break;
    }
    return ordered;
}

function roleOfFallback(el) {
    try {
        const html = (el.innerHTML || "").slice(0, 4000);
        if (/chatgpt-citation|data-testid=|Copy|Read aloud|Good response|Bad response/i.test(html)
            && el.querySelector?.("button")) return "assistant";
    } catch { /* ignore */ }
    return null; // caller alternates
}

class ChatGPTSourceAdapter extends SourceAdapter {
    constructor() { super("ChatGPT"); }

    async extractSession() {
        log("info", "extract start", { url: location.href, title: document.title });

        // 1) Prefer API (bridge / direct fetch) — immune to app-shell DOM changes
        try {
            const apiMessages = await tryBridge();
            if (apiMessages?.length) {
                const convId = location.pathname.split("/").filter(Boolean).pop() || `chatgpt-${Date.now()}`;
                return {
                    platform: "chatgpt",
                    conversationId: convId,
                    title: document.title || "ChatGPT Conversation",
                    model: null, createdAt: null, updatedAt: null,
                    extractorVersion: "iko-chatgpt-api-1",
                    messages: apiMessages.map((m, i) => ({ ...m, parentId: i ? apiMessages[i - 1].id : null })),
                    activeLeafId: apiMessages[apiMessages.length - 1].id,
                    instructions: []
                };
            }
        } catch (e) {
            log("warn", "bridge path failed, falling back to DOM", { error: String(e?.message || e).slice(0, 300) });
        }

        await new Promise(r => setTimeout(r, 400));

        const selectors = [
            "[data-message-author-role]",
            '[data-testid^="conversation-turn-"]',
            "[data-message-id]",
            "main article",
            "main [data-turn]",
            'main div[id^="message-"]'
        ];
        const seen = new Set();
        const messages = [];
        for (const sel of selectors) {
            let nodes = [];
            try { nodes = Array.from(document.querySelectorAll(sel)); }
            catch (e) { log("warn", `bad selector ${sel}`, {}); continue; }
            log("info", `selector ${sel}: ${nodes.length}`, {});
            for (const node of nodes) {
                if (seen.has(node)) continue;
                seen.add(node);
                const t = textOf(node);
                if (!t || t.length < 2) continue;
                if (messages.length && messages[messages.length - 1].raw?.text === t) continue;
                const r = getRole(node) || "user";
                messages.push({
                    id: `chatgpt-${messages.length + 1}`,
                    role: r === "assistant" ? "assistant" : r === "system" ? "system" : "user",
                    sourceRole: String(r),
                    content: t,
                    parentId: messages.length ? messages[messages.length - 1].id : null,
                    timestamp: null, model: null,
                    raw: { text: t }
                });
            }
            if (messages.length >= 2) break;
        }

        // Fallback path
        let usedFallback = false;
        if (messages.length < 1) {
            const fp = fingerprintMain();
            log("warn", "structured selectors empty, fingerprint:", fp);
            const blocks = fallbackBlocks();
            log("info", `fallback blocks: ${blocks.length}`, {
                lens: blocks.map(b => b.len).slice(0, 12)
            });
            // filter obvious UI chrome (keep el for role signal)
            const cleaned = blocks.filter(b =>
                b.text.length > 120 &&
                !/^Ask ChatGPT/i.test(b.text) &&
                !/^Share$/i.test(b.text)
            );
            // alternate user/assistant starting with user (ChatGPT always starts with user),
            // but prefer toolbar signal when available
            cleaned.forEach((b, i) => {
                const t = typeof b === "string" ? b : b.text;
                const el = typeof b === "string" ? null : b.el;
                const signaled = el ? roleOfFallback(el) : null;
                const role = signaled || (i % 2 === 0 ? "user" : "assistant");
                messages.push({
                    id: `chatgpt-fb-${messages.length + 1}`,
                    role,
                    sourceRole: signaled ? `fallback-toolbar:${signaled}` : "fallback-alternating",
                    content: t.slice(0, 20000),
                    parentId: messages.length ? messages[messages.length - 1].id : null,
                    timestamp: null, model: null,
                    raw: { text: t.slice(0, 20000), strategy: "fallback-leaf" }
                });
            });
            usedFallback = cleaned.length > 0;
            if (usedFallback) log("info", `fallback produced ${messages.length} messages`, {});
        }

        if (!messages.length) {
            let diag = {};
            try { diag = globalThis.window?.IKO?.logger?.diagnostics?.() || {}; } catch { /* ignore */ }
            const fp = fingerprintMain();
            log("error", "extract failed", { diag, fp: { ...fp, mainHtmlSample: String(fp.mainHtmlSample || "").slice(0, 800) } });
            throw new AdapterError(
                "No visible ChatGPT messages were found. I logged a DOM fingerprint — open 'View logs' → 'Copy logs' and paste it so I can add your exact markup.\n\n" +
                `finger: main=${fp.hasMain} nodes=${fp.totalNodes ?? "?"} textLen=${fp.mainTextLen ?? "?"} data=[${(fp.dataAttrs || []).join(",")}]`
            );
        }

        if (usedFallback) {
            try { window.IKO?.logger?.warn?.("ChatGPT-extract", "Used fallback alternating roles — verify user/assistant order in preview", {}); } catch { /* ignore */ }
        }

        return {
            platform: "chatgpt",
            conversationId: location.pathname.split("/").filter(Boolean).pop() || `chatgpt-${Date.now()}`,
            title: document.title || "ChatGPT Conversation",
            model: null, createdAt: null, updatedAt: null,
            extractorVersion: "iko-chatgpt-dom-3-fallback",
            messages,
            activeLeafId: messages[messages.length - 1].id,
            instructions: []
        };
    }
}

module.exports = { ChatGPTSourceAdapter };
