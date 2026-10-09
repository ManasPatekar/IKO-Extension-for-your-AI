window.IKO = window.IKO || {};
window.IKO.chatgptBridge = { latestConversation: null, ready: false,
    requestConversationRefresh() {
        try { window.postMessage({ source: "IKO_CHATGPT_CONTENT", type: "REQUEST_REFRESH" }, "*"); } catch { /* ignore */ }
    }
};
window.addEventListener("message", event => {
    if (event.source !== window) return;
    const m = event.data;
    if (!m || m.source !== "IKO_CHATGPT_BRIDGE") return;
    if (m.type === "BRIDGE_READY") { window.IKO.chatgptBridge.ready = true; console.log("[IKO ChatGPT] Bridge ready"); }
    if (m.type === "CONVERSATION_DATA") {
        window.IKO.chatgptBridge.latestConversation = m.payload?.data || null;
        try { window.IKO?.logger?.info?.("ChatGPT-bridge", "conversation captured", { url: String(m.payload?.url || "").slice(0, 120) }); } catch { /* ignore */ }
        window.dispatchEvent(new CustomEvent("iko-chatgpt-conversation-updated"));
    }
});
