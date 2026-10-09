"use strict";

import { countTokens } from "gpt-tokenizer";
import "./ui.js";
import "./chatgpt-bridge-client.js";
import "./attachments/attachment-saver.js";

window.IKO = window.IKO || {};

let timer = null;
let counting = false;

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
const BUDGETS = { ChatGPT: 200000, Claude: 200000, Gemini: 1000000, Perplexity: 127000, Copilot: 128000, Grok: 131000, DeepSeek: 64000, Mistral: 32000, Poe: 128000 };
const PRICES = { ChatGPT: 2.5, Claude: 3.0, Gemini: 1.25, Perplexity: 1.0, Copilot: 2.0, Grok: 2.0, DeepSeek: 0.5, Mistral: 1.0, Poe: 2.0 };
function textOf(el) {
    const md = el.querySelector?.(".markdown, [data-testid='markdown']");
    return ((md || el).innerText || el.textContent || "").trim();
}

function fallbackBlocks() {
    const main = document.querySelector("main") || document.body;
    const out = [];
    try {
        const cands = [];
        for (const el of Array.from(main.querySelectorAll("div, article, section, p")).slice(0, 2500)) {
            if (!(el instanceof HTMLElement)) continue;
            if (/^(SCRIPT|STYLE|NAV|HEADER|FOOTER|BUTTON|TEXTAREA)$/.test(el.tagName)) continue;
            if (el === main || el.hasAttribute?.("data-app-shell-thread-content-overlap")) continue;
            const t = (el.innerText || "").trim();
            if (t.length < 120 || t.length > 50000) continue;
            cands.push({ el, len: t.length, text: t });
            if (cands.length > 1200) break;
        }
        // leaf-only: drop containers that contain another candidate
        const leaves = cands.filter(a => !cands.some(b => b !== a && a.el.contains(b.el) && b.text.length > 80));
        leaves.sort((a, b) => a.el.compareDocumentPosition(b.el) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1);
        const seen = new Set();
        for (const k of leaves) {
            const key = k.text.slice(0, 120);
            if (seen.has(key)) continue;
            seen.add(key);
            if (out.length && out[out.length - 1].content === k.text) continue;
            out.push({ role: out.length % 2 === 0 ? "user" : "assistant", content: k.text, fallback: true });
            if (out.length >= 80) break;
        }
    } catch { /* ignore */ }
    return out;
}

function extractMessages() {
    // Keep in sync with chatgpt-source-adapter: ChatGPT renamed DOM in 2025-26.
    const selectors = [
        "[data-message-author-role]",
        '[data-testid^="conversation-turn-"]',
        "[data-message-id]",
        "main article",
        "main [data-turn]",
        'main div[id^="message-"]'
    ];
    const seen = new Set();
    const nodes = [];
    for (const sel of selectors) {
        try {
            for (const n of document.querySelectorAll(sel)) {
                if (!seen.has(n)) { seen.add(n); nodes.push(n); }
            }
        } catch { /* bad selector on old Chrome */ }
    }
    const structured = nodes
        .map((element) => {
            const roleAttr = element.getAttribute("data-message-author-role");
            const testid = element.getAttribute("data-testid") || "";
            const role = roleAttr === "assistant" ? "assistant"
                : roleAttr === "system" ? "system"
                : /assistant/i.test(testid) ? "assistant" : "user";
            const content = textOf(element);
            if (!content || content.length < 2) return null;
            return { role, content };
        })
        .filter(Boolean);
    // dedupe identical neighbours (nested selectors double-count)
    const deduped = structured.filter((m, i) => i === 0 || m.content !== structured[i - 1].content);
    if (deduped.length >= 1) return deduped;

    const fb = fallbackBlocks().filter(b => b.content.length > 120 && !/^Ask ChatGPT/i.test(b.content));
    if (fb.length) {
        try { window.IKO?.logger?.warn?.("ChatGPT-HUD", `fallback used: ${fb.length} blocks`, {}); } catch { /* ignore */ }
        console.log(`[IKO:ChatGPT-HUD] fallback used: ${fb.length} blocks`);
        return fb;
    }
    return deduped;
}

function update() {
    if (counting || !window.IKO.ui) return;

    const messages = extractMessages();

    if (!messages.length) {
        window.IKO.ui.update({
            platform: detectPlatform(),
            tokens: 0,
            messageCount: 0,
            usagePercentage: 0,
            tokenizer: "o200k_base",
            status: "Waiting for messages"
        });
        return;
    }

    counting = true;
    window.IKO.ui.setLoading(true, "Counting context…");

    try {
        const usedFallback = messages.length && messages[0].fallback;
        const tokens = messages.reduce(
            (total, message) => total + countTokens(message.content.slice(0, 20000)),
            0
        );

        const plat = detectPlatform();
        const budget = Number(window.IKO.config?.contextBudget || BUDGETS[plat] || 200000);
        const price = PRICES[plat] || 2.0;
        const cost = tokens / 1000000 * price;
        const pct = Math.min(100, Math.round((tokens / budget) * 100));
        const health = pct >= 95 ? "⚠ Context critical — migrate or summarize" : pct >= 80 ? "⚠ Context filling — consider migrate" : (usedFallback ? "Fallback estimate — verify roles" : "Local tokenizer estimate");

        window.IKO.latestData = {
            platform: plat,
            tokens,
            messageCount: messages.length,
            usagePercentage: pct,
            tokenizer: "o200k_base",
            cost,
            status: `${health} · ~$${cost.toFixed(3)}`
        };

        window.IKO.ui.update(window.IKO.latestData);
    } catch (error) {
        console.error("[IKO ChatGPT] Tokenizer failed:", error);
        window.IKO.ui.update({
            platform: detectPlatform(),
            tokens: 0,
            messageCount: messages.length,
            usagePercentage: 0,
            tokenizer: "o200k_base",
            status: "Tokenizer error"
        });
    } finally {
        window.IKO.ui.setLoading(false);
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
