"use strict";

(function () {
    const UI_ID = "iko-migration-panel";

    function el(tag, className, text) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = text;
        return node;
    }

    function showStatus(node, text, type = "info") {
        node.textContent = text;
        node.className = `iko-migration-status iko-status-${type}`;
    }

    function showError(node, error) {
        console.error("[IKO Migration]", error);
        try {
            window.IKO?.logger?.error?.("Migration-UI", error?.message || String(error), {
                stack: error?.stack?.slice(0, 2000)
            });
        } catch { /* ignore */ }
        const hint = "\n\nTip: open 'View logs' below → Copy logs → paste in DevTools issue.";
        showStatus(node, (error?.message || String(error)) + hint, "error");
    }

    function download(filename, text, mime) {
        try {
            const blob = new Blob([text], { type: mime || "text/plain" });
            const a = document.createElement("a");
            a.href = URL.createObjectURL(blob);
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
        } catch (e) { console.error("[IKO] download failed:", e); }
    }

    function sessionToMarkdown(session) {
        const s = session?.source || {};
        const lines = [`# ${s.title || "Migrated session"}`, ``, `Source: ${s.platform || "?"} · ${s.conversationId || ""}`, ``];
        for (const m of (session?.messages || [])) {
            const content = Array.isArray(m.content) ? m.content.map(b => b?.text || b?.code || "").join("\n") : String(m.content || "");
            lines.push(`## ${String(m.role || "user").toUpperCase()}`, ``, content, ``);
        }
        return lines.join("\n");
    }

    function renderReview(container, session, helpers = {}) {
        const safe = session || {};
        const source = safe.source || {};
        const messages = Array.isArray(safe.messages) ? safe.messages : [];
        container.innerHTML = "";
        container._excluded = new Set();

        container.appendChild(el("div", "iko-review-title", "Migration Preview"));
        for (const [label, value] of [
            ["Conversation", source.title || "Untitled Session"],
            ["Messages", String(messages.length)],
            ["Source", source.platform || "Unknown"],
            ["Conversation ID", source.conversationId || "Unknown"]
        ]) {
            const row = el("div", "iko-review-row");
            row.appendChild(el("span", "iko-review-label", label));
            row.appendChild(el("strong", "iko-review-value", value));
            container.appendChild(row);
        }
        if (safe.branchInfo?.hadAlternateBranches) {
            container.appendChild(el("div", "iko-review-integrity", `⑂ Branches pruned: ${safe.branchInfo.prunedBranchCount} — active branch kept`));
        }

        // Message picker: uncheck to exclude from insert
        const pick = el("details", "iko-review-pick");
        pick.appendChild(el("summary", "iko-logs-summary", `Messages (${messages.length}) — uncheck to exclude`));
        const list = el("div", "iko-pick-list");
        messages.slice(0, 60).forEach((m, i) => {
            const label = document.createElement("label");
            label.className = "iko-pick-row";
            const cb = document.createElement("input");
            cb.type = "checkbox"; cb.checked = true;
            cb.addEventListener("change", () => {
                if (cb.checked) container._excluded.delete(m.id);
                else container._excluded.add(m.id);
            });
            const span = document.createElement("span");
            const txt = Array.isArray(m.content) ? m.content.map(b => b?.text || b?.code || "").join(" ") : String(m.content || "");
            span.textContent = `${String(m.role || "?").toUpperCase()}: ${txt.slice(0, 90)}${txt.length > 90 ? "…" : ""}`;
            label.append(cb, span);
            list.appendChild(label);
        });
        if (messages.length > 60) list.appendChild(el("div", "iko-review-label", `…and ${messages.length - 60} more (included)`));
        pick.appendChild(list);
        container.appendChild(pick);

        const integrity = el("div", "iko-review-integrity", "✓ Session validated and packaged");
        container.appendChild(integrity);

        // Export + save row
        const row = el("div", "iko-logs-row");
        const bMd = el("button", "iko-migration-button secondary iko-logs-copy", "↓ .md");
        bMd.type = "button";
        bMd.addEventListener("click", () => download(`${(source.title || "iko-session").slice(0, 40)}.md`, sessionToMarkdown(session), "text/markdown"));
        const bJson = el("button", "iko-migration-button secondary iko-logs-copy", "↓ .json");
        bJson.type = "button";
        bJson.addEventListener("click", () => download(`${(source.title || "iko-session").slice(0, 40)}.json`, JSON.stringify(session, null, 2), "application/json"));
        const bSir = el("button", "iko-migration-button secondary iko-logs-copy", "↓ .sir");
        bSir.type = "button";
        bSir.title = "Semantic IR — token-efficient representation";
        bSir.addEventListener("click", () => {
            try {
                const sir = window.IKOSIRCore?.sessionToSIR?.(session) || "; SIR unavailable";
                download(`${(source.title || "iko-session").slice(0, 40)}.sir.txt`, `; SIR v${window.IKOSIRCore?.SIR_VERSION || "0.1"}\n${sir}`, "text/plain");
            } catch (e) { console.error("[IKO] SIR export failed:", e); }
        });
        const bSave = el("button", "iko-migration-button secondary iko-logs-copy", "★ Save");
        bSave.type = "button";
        bSave.addEventListener("click", async () => {
            bSave.textContent = "Saving…";
            try { await helpers.onSave?.(); bSave.textContent = "Saved ✓"; }
            catch (e) { bSave.textContent = "Save failed"; }
            setTimeout(() => { bSave.textContent = "★ Save"; }, 1500);
        });
        row.append(bMd, bJson, bSir, bSave);
        container.appendChild(row);
        container.hidden = false;
    }

    function createMigrationUI(options = {}) {
        document.getElementById(UI_ID)?.remove();

        const root = el("div", "iko-migration-root");
        root.id = UI_ID;
        const panel = el("section", "iko-migration-panel");
        panel.setAttribute("role", "dialog");
        panel.setAttribute("aria-modal", "true");

        const header = el("header", "iko-migration-header");
        const headerText = el("div", "iko-migration-header-text");
        headerText.appendChild(el("div", "iko-migration-title", "IKO Session Migration"));
        headerText.appendChild(el("div", "iko-migration-subtitle", "One-click session transfer"));
        const close = el("button", "iko-migration-close", "×");
        close.type = "button";
        close.addEventListener("click", closeMigrationPanel);
        header.append(headerText, close);

        const body = el("div", "iko-migration-body");
        const direction = el("div", "iko-migration-direction");
        direction.appendChild(el("span", "iko-direction-source", options.sourceName || "Current AI Session"));
        direction.appendChild(el("span", "iko-direction-arrow", "→"));
        direction.appendChild(el("span", "iko-direction-destination", options.destinationName || "Destination AI"));
        body.appendChild(direction);

        const sourceCard = el("div", "iko-migration-card");
        sourceCard.appendChild(el("div", "iko-card-label", "SOURCE"));
        sourceCard.appendChild(el("div", "iko-card-title", options.sourceName || "Current AI Session"));
        sourceCard.appendChild(el("div", "iko-card-description", "Detected automatically from this tab."));
        body.appendChild(sourceCard);

        const destinationCard = el("div", "iko-migration-card");
        destinationCard.appendChild(el("div", "iko-card-label", "DESTINATION"));
        const destTitle = el("div", "iko-card-title", options.destinationName || "Destination AI");
        destinationCard.appendChild(destTitle);
        // Universal: let user pick any LLM, not just auto-paired one
        const destSelect = document.createElement("select");
        destSelect.className = "iko-migration-select";
        const dests = options.destinations || [];
        for (const d of dests) {
            const opt = document.createElement("option");
            opt.value = d.id;
            opt.textContent = d.name;
            if (d.id === options.destinationId) opt.selected = true;
            destSelect.appendChild(opt);
        }
        if (!dests.length) {
            const opt = document.createElement("option");
            opt.value = options.destinationId || "";
            opt.textContent = options.destinationName || "Destination AI";
            destSelect.appendChild(opt);
        }
        destSelect.addEventListener("change", () => {
            const chosen = dests.find(d => d.id === destSelect.value);
            if (chosen) {
                destTitle.textContent = chosen.name;
                openDestination.textContent = `Open ${chosen.name}`;
                options.destinationId = chosen.id;
                // Changing destination invalidates any prepared package — force re-prepare
                migrationPackage = null;
                try { activeRetrieval = null; } catch { /* declared below, runs later */ }
                review.hidden = true;
                review.innerHTML = "";
                openDestination.disabled = true;
                prepare.disabled = false;
                prepare.textContent = "Prepare Migration";
                showStatus(status, `Destination changed to ${chosen.name} — click Prepare Migration again.`, "info");
                options.onDestinationChange?.(chosen.id);
            }
        });
        destinationCard.appendChild(destSelect);
        destinationCard.appendChild(el("div", "iko-card-description", "Pick any LLM to send this session to."));
        body.appendChild(destinationCard);

        const status = el("div", "iko-migration-status iko-status-info", "Ready to prepare migration.");
        body.appendChild(status);

        const review = el("div", "iko-migration-review");
        review.hidden = true;
        body.appendChild(review);

        const actions = el("div", "iko-migration-actions");
        const cancel = el("button", "iko-migration-button secondary", "Cancel");
        cancel.type = "button";
        cancel.addEventListener("click", closeMigrationPanel);
        const prepare = el("button", "iko-migration-button primary", "Prepare Migration");
        prepare.type = "button";
        actions.append(cancel, prepare);
        body.appendChild(actions);

        const openDestination = el("button", "iko-migration-button destination", `Open ${options.destinationName || "Destination"}`);
        openDestination.type = "button";
        openDestination.disabled = true;
        body.appendChild(openDestination);

        // ---- Logs viewer: so breakage can be diagnosed without DevTools ----
        const logWrap = el("details", "iko-migration-logs");
        const logSummary = el("summary", "iko-logs-summary", "View logs (for debugging)");
        const logPre = el("pre", "iko-logs-pre", "Logs will appear here…");
        const logRow = el("div", "iko-logs-row");
        const copyBtn = el("button", "iko-migration-button secondary iko-logs-copy", "Copy logs");
        copyBtn.type = "button";
        copyBtn.addEventListener("click", async (ev) => {
            ev.preventDefault();
            const ok = await window.IKO?.logger?.copyAll?.();
            copyBtn.textContent = ok ? "Copied ✓" : "Copy failed — select manually";
            setTimeout(() => { copyBtn.textContent = "Copy logs"; }, 2000);
        });
        const refreshLogs = () => {
            try {
                const text = window.IKO?.logger?.formatAll?.() || "(logger not ready)";
                logPre.textContent = text.slice(-6000) || "(no logs yet)";
            } catch { /* ignore */ }
        };
        logRow.appendChild(copyBtn);
        logWrap.append(logSummary, logPre, logRow);
        body.appendChild(logWrap);
        window.addEventListener("iko-log-updated", refreshLogs);
        setTimeout(refreshLogs, 500);

        panel.append(header, body);
        root.appendChild(panel);
        document.body.appendChild(root);

        let migrationPackage = null;
        let lastSession = null;
        let activeRetrieval = null;

        // ---- QASC: optional question → minimal relevant context ----
        const qWrap = el("details", "iko-migration-logs");
        qWrap.appendChild(el("summary", "iko-logs-summary", "🎯 Minimal context for a question (optional)"));
        const qInput = document.createElement("input");
        qInput.type = "text";
        qInput.placeholder = "e.g. What is the invoice number?";
        qInput.className = "iko-migration-select";
        qInput.style.height = "36px";
        const qRow = el("div", "iko-logs-row");
        const qBtn = el("button", "iko-migration-button secondary iko-logs-copy", "Retrieve");
        qBtn.type = "button";
        const qClear = el("button", "iko-migration-button secondary iko-logs-copy", "Full");
        qClear.type = "button";
        qClear.title = "Clear minimal retrieval — migrate everything";
        const qPrev = el("pre", "iko-logs-pre", "Type a question, Prepare first, then Retrieve.");
        qBtn.addEventListener("click", () => {
            try {
                const R = window.IKORETRIEVALCore;
                const SIRc = window.IKOSIRCore;
                if (!R) { qPrev.textContent = "(retrieval engine loading — wait 2s)"; return; }
                if (!lastSession) { qPrev.textContent = "Click Prepare Migration first."; return; }
                const q = qInput.value || "";
                if (!q.trim()) { qPrev.textContent = "Type the question you will ask on the destination."; return; }
                const count = (t) => { try { return SIRc?.countTokens?.(t) ?? Math.ceil(String(t || "").length / 4); } catch { return Math.ceil(String(t || "").length / 4); } };
                activeRetrieval = R.retrieve(lastSession, q, { countTokens: count });
                const min = R.formatMinimal(lastSession, activeRetrieval);
                qPrev.textContent = `intent=${activeRetrieval.intent} · ${activeRetrieval.tokensFull}→${activeRetrieval.tokensMin} tokens (−${activeRetrieval.savedPct}%) · ${activeRetrieval.messageIds.length} turn(s)\n\n${min.slice(0, 2500)}`;
                try { window.IKO?.logger?.info?.("Retrieval", "minimal retrieved", { intent: activeRetrieval.intent, saved: activeRetrieval.savedPct }); } catch { /* ignore */ }
            } catch (e) { qPrev.textContent = `Retrieve failed: ${String(e?.message || e).slice(0, 200)}`; }
        });
        qClear.addEventListener("click", () => {
            activeRetrieval = null;
            qInput.value = "";
            qPrev.textContent = "Full context will be migrated.";
        });
        qRow.append(qBtn, qClear);
        qWrap.append(qInput, qRow, qPrev);
        body.appendChild(qWrap);

        // ---- Session library (persisted packages) ----
        const libWrap = el("details", "iko-migration-logs");
        libWrap.appendChild(el("summary", "iko-logs-summary", "★ Saved sessions"));
        const libList = el("div", "iko-pick-list");
        libList.textContent = "Loading…";
        libWrap.appendChild(libList);
        body.appendChild(libWrap);
        async function refreshLibrary() {
            try {
                const items = await options.onListLibrary?.() || [];
                libList.innerHTML = "";
                if (!items.length) { libList.textContent = "(none saved yet — Prepare then ★ Save)"; return; }
                for (const it of items.slice(0, 20)) {
                    const row = el("div", "iko-review-row");
                    row.appendChild(el("span", "iko-review-label", `${it.title || it.id} · ${it.messages || "?"} msgs`));
                    const open = el("button", "iko-migration-button secondary iko-logs-copy", "Load");
                    open.type = "button";
                    open.addEventListener("click", async () => {
                        try {
                            const loaded = await options.onLoadLibrary?.(it.id);
                            if (!loaded?.session) throw new Error("Saved session not found.");
                            lastSession = loaded.session;
                            migrationPackage = loaded.package || loaded.migrationPackage || loaded;
                            renderReview(review, lastSession, { onSave: saveCurrent });
                            showStatus(status, `Loaded “${it.title}”. Review it, then click Open destination.`, "success");
                            openDestination.disabled = false;
                            prepare.textContent = "Migration Ready";
                            try { review.scrollIntoView({ block: "nearest" }); } catch { /* ignore */ }
                        } catch (e) { showError(status, e); }
                    });
                    const del = el("button", "iko-migration-button secondary iko-logs-copy", "✕");
                    del.type = "button";
                    del.addEventListener("click", async () => { await options.onDeleteLibrary?.(it.id); refreshLibrary(); });
                    const btns = el("div", "iko-logs-row");
                    btns.append(open, del);
                    row.appendChild(btns);
                    libList.appendChild(row);
                }
            } catch { libList.textContent = "(library unavailable)"; }
        }
        setTimeout(refreshLibrary, 600);

        async function saveCurrent() {
            if (!lastSession) throw new Error("Nothing to save yet.");
            await options.onSaveLibrary?.({ session: lastSession, package: migrationPackage });
            refreshLibrary();
        }

        prepare.addEventListener("click", async () => {
            prepare.disabled = true;
            openDestination.disabled = true;
            showStatus(status, "Preparing migration…", "loading");
            review.hidden = true;

            try {
                const result = await options.onPrepareMigration?.(options.destinationId, {
                    sourceId: options.sourceId,
                    destinationId: options.destinationId
                });
                if (!result) throw new Error("Migration returned no package.");
                migrationPackage = result.migrationPackage || result.package || result;
                lastSession = result.session || migrationPackage.session || result;
                renderReview(review, lastSession, { onSave: saveCurrent });
                showStatus(status, "Migration package ready.", "success");
                openDestination.disabled = false;
                prepare.textContent = "Migration Ready";
            } catch (error) {
                showError(status, error);
                prepare.disabled = false;
                prepare.textContent = "Prepare Migration";
            }
        });

        openDestination.addEventListener("click", async () => {
            openDestination.disabled = true;
            showStatus(status, `Opening ${options.destinationName || "destination"}…`, "loading");
            try {
                // Keep the package's integrity metadata in sync when we filter,
                // but tolerate packages that don't carry an integrity block
                // (e.g. rebuilt from an older saved session).
                const syncIntegrity = pkg => {
                    if (pkg?.session?.messages && pkg.integrity) pkg.integrity.messageCount = pkg.session.messages.length;
                    return pkg;
                };
                // QASC minimal retrieval wins over full package when active
                try {
                    if (activeRetrieval?.messageIds?.length && migrationPackage?.session?.messages) {
                        migrationPackage = JSON.parse(JSON.stringify(migrationPackage));
                        const keep = new Set(activeRetrieval.messageIds);
                        migrationPackage.session.messages = migrationPackage.session.messages.filter(m => keep.has(m.id));
                        syncIntegrity(migrationPackage);
                    }
                } catch { /* ignore filter errors */ }
                // Apply message picker exclusions to the outgoing package
                try {
                    const excluded = review._excluded;
                    if (excluded && excluded.size && migrationPackage?.session?.messages) {
                        migrationPackage = JSON.parse(JSON.stringify(migrationPackage));
                        migrationPackage.session.messages = migrationPackage.session.messages.filter(m => !excluded.has(m.id));
                        syncIntegrity(migrationPackage);
                    }
                } catch { /* ignore filter errors */ }
                await options.onOpenDestination?.(options.destinationId, migrationPackage);
                showStatus(status, "Destination opened.", "success");
            } catch (error) {
                openDestination.disabled = false;
                showError(status, error);
            }
        });

        root.addEventListener("click", event => {
            if (event.target === root) closeMigrationPanel();
        });

        const escape = event => {
            if (event.key === "Escape") closeMigrationPanel();
        };
        document.addEventListener("keydown", escape, { once: true });

        requestAnimationFrame(() => root.classList.add("iko-migration-visible"));

        function closeMigrationPanel() {
            try { window.removeEventListener("iko-log-updated", refreshLogs); } catch { /* ignore */ }
            document.removeEventListener("keydown", escape);
            root.remove();
            options.onClose?.();
        }

        return {
            root,
            close: closeMigrationPanel
        };
    }

    window.IKOMigrationUI = {
        createMigrationUI,
        open: () => window.IKOMigrationMain?.open?.(),
        close: () => window.IKOMigrationMain?.close?.(),
        showError: error => console.error("[IKO Migration]", error)
    };
})();
