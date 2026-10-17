"use strict";

import { countTokens } from "gpt-tokenizer";
import chatThread from "../migration/core/chat-thread.js";
import "./ui.js";
import "./chatgpt-bridge-client.js";
import "./attachments/attachment-saver.js";

window.IKO = window.IKO || {};
// Shared thread reader (also reusable by migration code and test harnesses).
window.IKO.chatThread = chatThread;

let timer = null;
let counting = false;
let lastSignature = "";

// One message can be huge (a pasted document). The tokenizer runs at ~35M
// chars/s, so this is only a guard against pathological pages.
const MAX_MESSAGE_CHARS = 400000;

function resetCounting() {
    counting = false;
}
window.IKO.resetCounting = resetCounting;

// Label fallback for hosts the platform registry does not know. Budgets and
// prices always come from platforms.js — never from a second table here.
function detectPlatform() {
    try {
        const d = window.IKO?.platform?.detect?.();
        if (d && d !== "Unknown" && d !== "AI") return d;
    } catch { /* ignore */ }
    const h = location.hostname.toLowerCase();
    if (h.includes("gemini")) return "Gemini";
    if (h.includes("perplexity")) return "Perplexity";
    if (h.includes("copilot")) return "Copilot";
    if (h.includes("grok")) return "Grok";
    if (h.includes("deepseek")) return "DeepSeek";
    if (h.includes("mistral")) return "Mistral";
    if (h.includes("poe")) return "Poe";
    if (h.includes("claude")) return "Claude";
    if (h.includes("chatgpt") || h.includes("openai")) return "ChatGPT";
    return "AI";
}

function platformInfo() {
    let match = null;
    try {
        match = typeof chatThread.matchPlatform === "function" ? chatThread.matchPlatform(location.hostname) : null;
    } catch { match = null; }
    return {
        id: match?.id || "",
        name: match?.name || detectPlatform(),
        budget: Number(window.IKO.config?.contextBudget || match?.budget || 200000),
        price: Number(match?.pricePer1M ?? 2.0)
    };
}

// Gemini /app is the empty "new chat" screen: no conversation to count, and the
// welcome text must not show up as context.
function hasActiveConversation() {
    const h = location.hostname.toLowerCase();
    const p = location.pathname;
    return !(h.includes("gemini") && (p === "/app" || p === "/app/"));
}

function readThread(platformId) {
    if (!hasActiveConversation()) return { messages: [], source: "none" };
    if (typeof chatThread.extractChatThread !== "function") return { messages: [], source: "none" };
    return chatThread.extractChatThread(platformId);
}

// --- whole-conversation counting ---------------------------------------------
// The DOM only holds the turns the site happens to have mounted (long chats
// unmount / virtualise history). The page bridge captures the API payload the
// site itself fetched, whose mapping holds the whole conversation — the number
// that matters when deciding to migrate. It is only as fresh as the last fetch,
// so it is combined with the live DOM reading, never replacing it.
let bridgeCache = { payload: null, messages: [], tokens: -1 };
// Rolling back the count when a site unmounts old turns would state the
// opposite of the truth ("less context in use"). Keep the largest count seen
// for this conversation; starting or switching chats resets it.
let highWater = { key: "", tokens: 0 };

function conversationKey() {
    return `${location.hostname}${location.pathname}`;
}

function bridgeMessages() {
    try {
        const payload = window.IKO?.chatgptBridge?.latestConversation;
        if (!payload) return [];
        if (payload !== bridgeCache.payload) {
            const messages = typeof chatThread.extractConversationMessages === "function"
                ? chatThread.extractConversationMessages(payload)
                : null;
            bridgeCache = { payload, messages: Array.isArray(messages) ? messages : [], tokens: -1 };
        }
        return bridgeCache.messages;
    } catch { return []; }
}

function bridgeTokens() {
    const messages = bridgeMessages();
    if (!messages.length) return -1;
    if (bridgeCache.tokens < 0) {
        bridgeCache.tokens = messages.reduce(
            (total, message) => total + countTokens(String(message.content || "").slice(0, MAX_MESSAGE_CHARS)),
            0
        );
    }
    return bridgeCache.tokens;
}

// Re-tokenising an unchanged thread every 2s burns CPU for nothing. The
// signature also lets the HUD skip idle renders without going stale.
function signature(info, messages, source, fullTokens) {
    let hash = 2166136261;
    const mix = (text) => {
        for (let i = 0; i < text.length; i++) {
            hash ^= text.charCodeAt(i);
            hash = Math.imul(hash, 16777619);
        }
    };
    mix(`${info.name}|${source}|${messages.length}|${fullTokens}`);
    for (const message of messages) mix(message.content);
    return (hash >>> 0).toString(16);
}

function update() {
    if (!window.IKO.ui) return;
    if (counting) return;

    const info = platformInfo();

    const key = conversationKey();
    if (highWater.key !== key) highWater = { key, tokens: 0 };

    let messages = [];
    let source = "none";
    let reason = "";
    try {
        const thread = readThread(info.id);
        messages = thread.messages || [];
        source = thread.source || "none";
        reason = thread.reason || "";
    } catch (error) {
        console.warn("[IKO ChatGPT] Thread read failed:", error);
        messages = [];
    }

    // The bridge payload is the whole conversation on sites that publish one,
    // even when the DOM currently shows none of it.
    const full = bridgeMessages();

    if (!messages.length && !full.length) {
        lastSignature = "";
        // Make a site we cannot read diagnosable from the console / View logs.
        console.log(`[IKO:ChatGPT-HUD] no messages in view — ${reason || "unknown"}`);
        try { window.IKO.logger?.info?.("ChatGPT-HUD", `no messages in view — ${reason || "unknown"}`, { host: location.hostname }); } catch { /* ignore */ }
        window.IKO.latestData = {
            platform: info.name,
            tokens: 0,
            messageCount: 0,
            usagePercentage: 0,
            tokenizer: "o200k_base",
            source,
            reason,
            status: "Waiting for messages"
        };
        window.IKO.ui.update(window.IKO.latestData);
        return;
    }

    const fullTokens = full.length ? bridgeTokens() : -1;
    const sig = signature(info, messages, source, fullTokens);
    if (sig === lastSignature && window.IKO.latestData) {
        // Nothing new to count: keep the HUD in sync without re-tokenising.
        window.IKO.ui.update(window.IKO.latestData);
        return;
    }

    counting = true;
    try {
        window.IKO.ui.setLoading(true, "Counting context…");
        try {
            const domTokens = messages.reduce(
                (total, message) => total + countTokens(message.content.slice(0, MAX_MESSAGE_CHARS)),
                0
            );

            // Whole conversation when the page exposes it, live DOM otherwise,
            // and never less than the largest count already seen here: a site
            // that unmounts old turns must not look like it freed context.
            const tokens = Math.max(domTokens, fullTokens, highWater.tokens);
            highWater.tokens = tokens;
            const whole = fullTokens > domTokens;
            const usedSource = whole ? "conversation" : source;

            const cost = tokens / 1000000 * info.price;
            const pct = Math.min(100, Math.round((tokens / info.budget) * 100));
            const health = pct >= 95 ? "⚠ Context critical — migrate or summarize"
                : pct >= 80 ? "⚠ Context filling — consider migrate"
                : usedSource === "conversation" ? "Full conversation"
                : usedSource === "thread" ? "Thread estimate — no message markup"
                : "Local tokenizer estimate";

            window.IKO.latestData = {
                platform: info.name,
                tokens,
                messageCount: whole ? full.length : messages.length,
                usagePercentage: pct,
                tokenizer: "o200k_base",
                cost,
                source: usedSource,
                reason: whole ? `bridge(${full.length} msgs)` : reason,
                status: `${health} · ~$${cost.toFixed(3)}`
            };

            lastSignature = sig;
            window.IKO.ui.update(window.IKO.latestData);
        } catch (error) {
            console.error("[IKO ChatGPT] Tokenizer failed:", error);
            window.IKO.ui.update({
                platform: info.name,
                tokens: 0,
                messageCount: messages.length,
                usagePercentage: 0,
                tokenizer: "o200k_base",
                status: "Tokenizer error"
            });
        }
    } finally {
        try { window.IKO.ui.setLoading(false); } catch { /* never leave the HUD stuck counting */ }
        counting = false;
    }
}

function initialize() {
    console.log("[IKO ChatGPT] Context HUD initializing");
    window.IKO.ui.create();
    update();
    clearInterval(timer);
    timer = setInterval(update, 2000);
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initialize, { once: true });
} else {
    initialize();
}
