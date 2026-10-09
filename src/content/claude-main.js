"use strict";

import { countClaudeTokens } from "./claude-api.js";
import { convertClaudeConversationToMessages } from "./claude-message-converter.js";
import "./ui.js";

window.IKO = window.IKO || {};

let updateTimer = null;
let counting = false;
let lastConversation = null;

// Universal budgets/prices mirror platforms.js; model slug refines them.
const CLAUDE_DEFAULT = { budget: 200000, price: 3.0, label: "Claude" };
function detectClaudeModel(conversation) {
    const raw = String(conversation?.model || "").toLowerCase();
    if (raw.includes("opus")) return { budget: 200000, price: 15.0, label: "Claude Opus" };
    if (raw.includes("sonnet")) return { budget: 200000, price: 3.0, label: "Claude Sonnet" };
    if (raw.includes("haiku")) return { budget: 200000, price: 0.8, label: "Claude Haiku" };
    return CLAUDE_DEFAULT;
}

function isClaudePage() {
    const host = window.location.hostname.toLowerCase();
    return host === "claude.ai" || host.endsWith(".claude.ai");
}

function removeLegacyHUD() {
    for (const id of [
        "iko-claude-hud",
        "iko-claude-token-hud",
        "iko-claude-legacy-hud"
    ]) {
        document.getElementById(id)?.remove();
    }
}

function updateUI(data) {
    if (window.IKO?.ui) {
        window.IKO.ui.update(data);
    }
}

async function updateClaude(conversation) {
    if (!isClaudePage() || counting) return;

    removeLegacyHUD();

    if (!conversation) {
        updateUI({
            platform: "Claude",
            tokens: 0,
            messageCount: 0,
            usagePercentage: 0,
            tokenizer: "Anthropic count_tokens",
            status: "Waiting for Claude messages"
        });
        return;
    }

    counting = true;
    window.IKO.ui?.setLoading(true, "Counting Claude context…");

    try {
        const messages = convertClaudeConversationToMessages(conversation);

        if (!messages.length) {
            updateUI({
                platform: "Claude",
                tokens: 0,
                messageCount: 0,
                usagePercentage: 0,
                tokenizer: "Anthropic count_tokens",
                status: "No usable Claude messages"
            });
            return;
        }

        const inputTokens = await countClaudeTokens({ messages });
        const model = detectClaudeModel(conversation);
        const price = model.price;
        const cost = inputTokens / 1000000 * price;
        const pct = Math.min(100, Math.round((inputTokens / model.budget) * 100));
        const health = pct >= 95 ? "⚠ Context critical — migrate or summarize"
            : pct >= 80 ? "⚠ Context filling — consider migrate"
            : "Local token estimate (no IKO server required)";

        window.IKO.latestData = {
            platform: model.label,
            tokens: inputTokens,
            messageCount: messages.length,
            usagePercentage: pct,
            tokenizer: "Local estimate",
            cost,
            status: `${health} · ~$${cost.toFixed(3)}`
        };

        updateUI(window.IKO.latestData);
    } catch (error) {
        console.error("[IKO Claude] Token count failed:", error);
        updateUI({
            platform: "Claude",
            tokens: 0,
            messageCount: 0,
            usagePercentage: 0,
            tokenizer: "Anthropic count_tokens",
            status: "Token count unavailable"
        });
    } finally {
        window.IKO.ui?.setLoading(false);
        counting = false;
    }
}

function requestConversation() {
    const bridge = window.IKO?.claudeBridge;
    if (!bridge) return;

    if (bridge.latestConversation) {
        lastConversation = bridge.latestConversation;
        updateClaude(lastConversation);
        return;
    }

    bridge.requestConversationRefresh?.();
}

function initialize() {
    if (!isClaudePage()) return;

    console.log("[IKO Claude] Initializing Context HUD");
    removeLegacyHUD();
    window.IKO.ui?.create();
    requestConversation();

    window.addEventListener("iko-claude-conversation-updated", (event) => {
        const conversation =
            event?.detail || window.IKO?.claudeBridge?.latestConversation || null;
        if (!conversation) return;
        lastConversation = conversation;
        updateClaude(conversation);
    });

    clearInterval(updateTimer);
    updateTimer = setInterval(() => {
        removeLegacyHUD();
        requestConversation();
    }, 2500);
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initialize, { once: true });
} else {
    initialize();
}
