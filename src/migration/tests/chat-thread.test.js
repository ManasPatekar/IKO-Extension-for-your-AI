"use strict";

// Regression tests for the shared chat-thread reader behind the Context HUD.
// These guard the bugs found in the wild:
//   - nested selectors (turn wrapper + message body) counted every message
//     twice, so the HUD showed 2x the real tokens
//   - only ChatGPT-shaped markup was read; other platforms fell into a text
//     heuristic that dropped short user messages, so the count sat at a tiny
//     number that never moved
//   - a selector list that knows the answers but not the questions produced a
//     confident, far-too-small number instead of an honest estimate

const test = require("node:test");
const assert = require("node:assert");
const { extractChatThread, extractConversationMessages, selectorsFor, readText, textOf, matchPlatform } = require("../core/chat-thread.js");

let order = 0;

const collapse = (value) => String(value).replace(/\s+/g, " ").trim();

// Faithful-enough element double: text always lives in text nodes, innerText
// collapses whitespace like Chrome does, textContent does not.
function node(tag, { text = "", attrs = {}, innerText } = {}) {
    const el = {
        nodeType: 1,
        tagName: String(tag).toUpperCase(),
        _order: order++,
        _attrs: Object.assign({}, attrs),
        _hidden: innerText === "",
        childNodes: [],
        children: [],
        parent: null,
        get innerText() { return el._hidden ? "" : collapse(el.textContent); },
        get textContent() {
            let out = "";
            for (const child of el.childNodes) out += child.textContent;
            return out;
        },
        getAttribute(name) { return name in el._attrs ? el._attrs[name] : null; },
        setAttribute(name, value) { el._attrs[name] = value; },
        querySelector() { return null; },
        querySelectorAll() { return []; },
        contains(other) {
            for (let p = other; p; p = p.parent) if (p === el) return true;
            return false;
        },
        compareDocumentPosition(other) { return el._order < other._order ? 4 : 2; },
        appendChild(child) { child.parent = el; el.childNodes.push(child); el.children.push(child); return child; }
    };
    if (text) el.appendChild(textNode(text));
    return el;
}

function textNode(value) {
    return { nodeType: 3, nodeValue: value, textContent: String(value), parent: null };
}

function installDom({ main, body, selectors = {} } = {}) {
    globalThis.document = {
        querySelector: (selector) => {
            if (selector === "main") return main || null;
            if (selector === "body") return body || main || null;
            return null;
        },
        querySelectorAll: (selector) => selectors[selector] || []
    };
}

const big = (label) => collapse(`${label}: ` + "The migration flow reads the current session, normalises every message and streams it to the destination. ".repeat(2));

// ---------------------------------------------------------------------------
// selector list
// ---------------------------------------------------------------------------

test("selectorsFor puts the platform selectors first and de-duplicates", () => {
    const list = selectorsFor("gemini");
    assert.equal(list[0], "message-content");
    assert.ok(list.includes(".query-content"));
    assert.ok(list.includes("[data-message-author-role]"));
    assert.equal(new Set(list).size, list.length);
    // unknown platform still gets the universal conventions
    assert.deepEqual(selectorsFor("nope").includes("main article"), true);
});

test("every supported host resolves to the context budget the HUD divides by", () => {
    // The usage percentage is tokens / budget. These are the numbers the HUD
    // used to keep in a private table; platforms.js is now the only copy.
    const expected = [
        ["chatgpt", "chatgpt.com", 200000, 2.5],
        ["claude", "claude.ai", 200000, 3.0],
        ["gemini", "gemini.google.com", 1000000, 1.25],
        ["perplexity", "www.perplexity.ai", 127000, 1.0],
        ["copilot", "copilot.microsoft.com", 128000, 2.0],
        ["grok", "grok.com", 131000, 2.0],
        ["deepseek", "chat.deepseek.com", 64000, 0.5],
        ["mistral", "chat.mistral.ai", 32000, 1.0],
        ["poe", "poe.com", 128000, 2.0]
    ];
    for (const [id, host, budget, price] of expected) {
        const match = matchPlatform(host);
        assert.equal(match?.id, id, `${host} should be ${id}`);
        assert.equal(match?.budget, budget, `${id} budget`);
        assert.equal(match?.pricePer1M, price, `${id} price`);
    }
    assert.equal(matchPlatform("example.com"), null);
});

// ---------------------------------------------------------------------------
// selector path
// ---------------------------------------------------------------------------

test("nested turn wrapper + message body counts each message once", () => {
    const users = ["How do I move a chat?", "And the attachments?"];
    const answers = [big("Answer one"), big("Answer two")];

    const body = (i, role, content) => {
        const div = node("div", { attrs: { "data-message-author-role": role, "data-message-id": `msg-${i}` } });
        div.appendChild(textNode(content));
        return div;
    };
    const turn = (i, child) => {
        const section = node("section", { attrs: { "data-testid": `conversation-turn-${i}` } });
        section.appendChild(child);
        return section;
    };

    const bodies = [body(1, "user", users[0]), body(2, "assistant", answers[0]), body(3, "user", users[1]), body(4, "assistant", answers[1])];
    const sections = bodies.map((b, i) => turn(i + 1, b));
    const main = node("main");
    for (const section of sections) main.appendChild(section);

    installDom({
        main,
        selectors: {
            "[data-message-author-role]": bodies,
            '[data-testid^="conversation-turn-"]': sections,
            "[data-message-id]": bodies,
            "main article": []
        }
    });

    const result = extractChatThread("chatgpt");
    assert.equal(result.source, "selectors");
    assert.deepEqual(result.messages.map((m) => m.content), [users[0], answers[0], users[1], answers[1]]);
    assert.deepEqual(result.messages.map((m) => m.role), ["user", "assistant", "user", "assistant"]);
});

test("per-platform selectors read a non-ChatGPT DOM (answers and questions)", () => {
    const question = (raw) => {
        const el = node("div", { attrs: { class: "query-content" } });
        el.appendChild(textNode(raw));
        return el;
    };
    const answer = (raw) => {
        const el = node("message-content", {});
        el.appendChild(textNode(raw));
        return el;
    };
    const q1 = question("Question one, short.");
    const a1 = answer(big("Answer one"));
    const q2 = question("Question two, also short.");
    const a2 = answer(big("Answer two"));

    const main = node("main");
    for (const el of [q1, a1, q2, a2]) main.appendChild(el);

    installDom({
        main,
        selectors: {
            "message-content": [a1, a2],
            ".query-content": [q1, q2],
            "main article": []
        }
    });

    const result = extractChatThread("gemini");
    assert.equal(result.source, "selectors");
    assert.equal(result.messages.length, 4);
    assert.equal(result.messages[0].content, "Question one, short.");
    assert.deepEqual(result.messages.map((m) => m.role), ["user", "assistant", "user", "assistant"]);
});

test("the same long text matched twice is counted once", () => {
    const copy = (attrs) => {
        const el = node("div", { attrs });
        el.appendChild(textNode(big("Repeated")));
        return el;
    };
    const first = copy({ "data-testid": "message" });
    const second = copy({ class: "message-wrapper" });
    const main = node("main");
    main.appendChild(first);
    main.appendChild(second);

    installDom({ main, selectors: { "[data-testid='message']": [first], "main article": [second] } });

    const result = extractChatThread("grok");
    assert.equal(result.messages.length, 1);
});

// ---------------------------------------------------------------------------
// fallbacks
// ---------------------------------------------------------------------------

test("unknown markup falls back to one thread estimate, not to tiny blocks", () => {
    const parts = [big("First"), "short question?", big("Second"), big("Third")];
    const main = node("main");
    for (const part of parts) main.appendChild(node("msg-body", { text: part }));

    installDom({ main, selectors: {} });

    const result = extractChatThread("unknown-site");
    assert.equal(result.source, "thread");
    assert.equal(result.messages.length, 1);
    for (const part of parts) assert.ok(result.messages[0].content.includes(collapse(part)), `missing "${part}"`);
    assert.equal(result.messages[0].fallback, true);
});

test("known markup covering only part of the thread is treated as a thread estimate", () => {
    // gemini-style question markup on the first turn, everything else renamed
    const known = node("div", { attrs: { class: "query-content" } });
    known.appendChild(textNode("Question one, short."));
    const main = node("main");
    main.appendChild(known);
    for (const label of ["Answer one", "Question two", "Answer two"]) {
        main.appendChild(node("msg-body", { text: big(label) }));
    }

    installDom({ main, selectors: { ".query-content": [known] } });

    const result = extractChatThread("gemini");
    assert.equal(result.source, "thread");
    assert.ok(result.messages[0].content.length > 300, `thread text too small: ${result.messages[0].content.length}`);
});

test("a welcome screen is not a conversation", () => {
    const main = node("main");
    main.appendChild(node("div", { text: "What can I help with today? Start a new conversation to see token usage here." }));

    installDom({ main, selectors: {} });

    const result = extractChatThread("chatgpt");
    assert.equal(result.source, "none");
    assert.equal(result.messages.length, 0);
    // the reason is what the HUD logs when it can read nothing
    assert.match(result.reason, /welcome-screen|thread-too-small/);
});

test("no main and no body at all reports no-container", () => {
    installDom({ selectors: {} });

    const result = extractChatThread("chatgpt");
    assert.equal(result.source, "none");
    assert.equal(result.messages.length, 0);
    assert.equal(result.reason, "no-container");
});

test("an inline JSON script blob is never mistaken for the conversation", () => {
    // The page renders without <main> and keeps a large inline state blob in
    // the body — the shape that made the HUD read 0 tokens in the wild.
    const blob = JSON.stringify({ data: "x".repeat(5000) });
    const thread = node("div", { attrs: { id: "thread" } });
    thread.appendChild(node("msg-body", { text: big("First answer") }));
    thread.appendChild(node("msg-body", { text: big("Second answer") }));
    const root = node("div", { attrs: { id: "app-root" } });
    root.appendChild(thread);
    const body = node("body");
    body.appendChild(node("script", { attrs: { type: "application/json" }, text: blob }));
    body.appendChild(root);

    installDom({ body, selectors: {} });

    const result = extractChatThread("chatgpt");
    assert.equal(result.source, "thread");
    assert.equal(result.messages.length, 1);
    assert.ok(!/xxxx/.test(result.messages[0].content), "script text leaked into the count");
    assert.ok(result.messages[0].content.includes(big("Second answer")), "thread text missing");
});

test("a thread dominated by its last answer is still counted whole", () => {
    // The last answer holds ~90% of the thread text. Walking into it would
    // count one message and (with the old block guard) collapse to 0.
    const main = node("main");
    const thread = node("div", { attrs: { id: "thread" } });
    const question = node("msg-body", { text: "And what about attachments?" });
    const answer = node("msg-body", { text: big("First answer") });
    const huge = node("msg-body", { text: collapse("The long answer: " + "Every step of the migration checklist, spelled out in detail. ".repeat(40)) });
    for (const el of [question, answer, huge]) thread.appendChild(el);
    main.appendChild(thread);

    installDom({ main, selectors: {} });

    const result = extractChatThread("unknown-site");
    assert.equal(result.source, "thread");
    assert.ok(result.messages[0].content.includes(big("First answer")), "earlier answer was dropped");
    assert.ok(result.messages[0].content.includes("And what about attachments?"), "the question was dropped");
});

test("a one-message thread with a single paragraph still counts", () => {
    // No block split anywhere: the old blockCount guard rejected this too.
    const main = node("main");
    const thread = node("div");
    const body = node("msg-body", { text: collapse("Answer: " + "One long paragraph without any block split inside it. ".repeat(12)) });
    thread.appendChild(body);
    main.appendChild(thread);

    installDom({ main, selectors: {} });

    const result = extractChatThread("unknown-site");
    assert.equal(result.source, "thread");
    assert.equal(result.messages.length, 1);
    assert.ok(result.messages[0].content.length > 400, `too small: ${result.messages[0].content.length}`);
});

test("chat chrome around the thread is skipped by the estimate", () => {
    const nav = node("nav", { text: big("Sidebar title number one about something else entirely") });
    const thread = node("div");
    thread.appendChild(node("msg-body", { text: big("First") }));
    thread.appendChild(node("msg-body", { text: big("Second") }));
    const main = node("main");
    main.appendChild(nav);
    main.appendChild(thread);

    installDom({ main, selectors: {} });

    const result = extractChatThread("unknown-site");
    assert.equal(result.source, "thread");
    assert.ok(!/Sidebar title/.test(result.messages[0].content), "sidebar leaked into the count");
    assert.ok(result.messages[0].content.includes(big("Second")), "thread text missing");
});

// ---------------------------------------------------------------------------
// text reading
// ---------------------------------------------------------------------------

test("readText falls back to the DOM walk when Chrome reports no innerText", () => {
    const hidden = node("div", { innerText: "" });
    hidden.appendChild(textNode("virtualised turn"));
    hidden.appendChild(node("script", { text: "var leaked = true;" }));

    assert.equal(readText(hidden), "virtualised turn");
});

test("textOf prefers the markdown body over wrapper buttons", () => {
    const wrapper = node("div", { text: "Copy Regenerate" });
    const markdown = node("div", { attrs: { class: "markdown" }, text: "Real answer text." });
    wrapper.querySelector = (selector) => (selector.includes(".markdown") ? markdown : null);

    assert.equal(textOf(wrapper), "Real answer text.");
});

test("a wrapper whose markdown body is still empty keeps its message", () => {
    // Streaming placeholders and lazily filled turns have an empty .markdown;
    // reading only that subtree used to drop the whole message (→ 0 tokens).
    const wrapper = node("div", { attrs: { "data-message-author-role": "user" } });
    const markdown = node("div", { attrs: { class: "markdown" } });
    wrapper.appendChild(textNode("Question typed by the user."));
    wrapper.appendChild(markdown);
    wrapper.querySelector = (selector) => (selector.includes(".markdown") ? markdown : null);

    installDom({ main: node("main"), selectors: { "[data-message-author-role]": [wrapper] } });

    const result = extractChatThread("chatgpt");
    assert.equal(result.source, "selectors");
    assert.equal(result.messages.length, 1);
    assert.equal(result.messages[0].content, "Question typed by the user.");
});

// ---------------------------------------------------------------------------
// bridge conversation (whole chat, not just what the DOM mounts)
// ---------------------------------------------------------------------------

test("the bridge conversation is read whole, in order, and without dead branches", () => {
    const data = {
        mapping: {
            root: { id: "root", parent: null, message: null },
            a: { id: "a", parent: "root", message: { author: { role: "user" }, content: { parts: ["How do I migrate?"] } } },
            b: { id: "b", parent: "a", message: { author: { role: "assistant" }, content: { parts: [big("Answer one")] } } },
            c: { id: "c", parent: "b", message: { author: { role: "user" }, content: { parts: ["And the attachments?"] } } },
            x: { id: "x", parent: "b", message: { author: { role: "assistant" }, content: { parts: ["A regenerated answer that is no longer in the thread"] } } }
        },
        current_node: "c"
    };

    const messages = extractConversationMessages(data);
    assert.deepEqual(messages.map((m) => m.role), ["user", "assistant", "user"]);
    assert.equal(messages[0].content, "How do I migrate?");
    assert.ok(messages[1].content.includes(big("Answer one")));
    assert.ok(!messages.some((m) => /regenerated/.test(m.content)), "dead branch leaked into the count");
});

test("a plain messages[] payload parses too, and anything else yields null", () => {
    const payload = {
        data: {
            messages: [
                { author: { role: "user" }, content: { parts: ["Question one, long enough"] } },
                { author: { role: "assistant" }, content: { parts: ["Answer", "with a second part"] } },
                { author: { role: "tool" }, content: { parts: ["tool noise is not conversation"] } }
            ]
        }
    };

    const messages = extractConversationMessages(payload);
    assert.deepEqual(messages.map((m) => m.role), ["user", "assistant"]);
    assert.equal(messages[1].content, "Answer\nwith a second part");

    assert.equal(extractConversationMessages({}), null);
    assert.equal(extractConversationMessages(null), null);
    assert.equal(extractConversationMessages({ mapping: {} }), null);
});
