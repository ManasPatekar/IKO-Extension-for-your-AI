# IKO BRAIN — Complete Project Knowledge (v0.2.0-universal+attachments+dragbot+sir-p0+p1-pdf+p1b-ocr+p2-retrieval+hud-drag+copilot-fix+claude-fix)

> Read this first. It documents every feature, file, data flow, upgrade,
> and how to extend the project without breaking it.
>
> ## ⛔ MANDATORY MAINTENANCE RULE — ALL MODELS MUST FOLLOW
> Whenever ANY model (human-assisted or autonomous) makes ANY code change in
> this project — feature, fix, refactor, config, CSS, docs, or single-line edit —
> it MUST also upgrade this `brain.md` in the SAME change set:
> 1. Update the affected feature section (§3) with new behavior/files/limits.
> 2. Append a numbered entry to `§4 Upgrades changelog` explaining what + why.
> 3. Update `§1 Repo map` if files were added/removed/renamed.
> 4. Bump the version suffix in the title if user-facing behavior changed.
> 5. Never finish a change with “code updated, docs later” — docs ARE the change.
> A change without a matching `brain.md` upgrade is INCOMPLETE and must be rejected
> in review. Future models rely solely on this file for full project context.

## 0. One-paragraph summary

IKO is a Chrome MV3 extension that runs on 9 LLMs (ChatGPT, Claude, Gemini,
Perplexity, Copilot, Grok, DeepSeek, Mistral, Poe). It provides: (1) a Context
HUD with token/usage/cost estimates, (2) one-click session migration between
any two LLMs via a validated package relayed through the service worker,
(3) a local prompt optimizer, (4) session library, chunked insert, export,
message picker. No backend, API key, or localhost required (optional localhost
counter proxy supported). Built with esbuild IIFE bundles (`dist/`).

## 1. Repo map

```
manifest.json                 MV3: permissions(storage), host_permissions(9 LLMs),
                              content_scripts(ISOLATED ×2 + MAIN bridges), background SW
background.js                 storage relay + tabs.create opener. No HUD logic.
build.js                      esbuild ×5 (content, claude-content, claude-bridge,
                              chatgpt-bridge, migration) + css copies → dist/
package.json                  scripts: build, test:migration. deps: gpt-tokenizer, esbuild.
src/content/main.js           Universal HUD controller (all non-Claude sites).
src/content/ui.js             HUD singleton + #iko-bot dock + Migrate/Optimize buttons.
src/content/style.css         HUD + bot + actions styles.
src/content/claude-entry.js   Bundles bridge-client + ui + attachments-saver + claude-main.
src/content/claude-main.js    Claude HUD controller (bridge data → per-model budget/price/cost → ui).
src/content/claude-bridge-client.js  ISOLATED listener → IKO.claudeBridge + CustomEvent.
src/content/chatgpt-bridge-client.js Same for ChatGPT backend-api.
src/content/claude-api.js     Local estimate ceil(chars/4). Labelled as estimate.
src/content/claude-message-converter.js  Claude API shape → [{role,content}].
src/content/claude-token.js / claude-tokens.js  LEGACY, currently dead — do not use.
src/content/token.js / token-engine.js / content-analyzer.js / constants.js  LEGACY/duplicates.
src/content/platform-detector.js  Table-driven hostname → display name + fallback prettify.
src/injected/claude-bridge.js    MAIN world: patches fetch/XHR for /chat_conversations|/conversations|/api/*chat*.
src/injected/chatgpt-bridge.js   MAIN world: captures /backend-api/conversation*.
src/content/migration/migration-entry.js  Bundles engine+adapters+platforms+optimizer+UI+main.
src/content/migration/iko-log.js          Ring-buffer logger (500), diagnostics, copyAll.
src/content/migration/migration-ui.js     Modal: source/dest cards, dest <select>,
                                          review+checklist, export/save, library, logs.
src/content/migration/migration-main.js   Launcher removed (unified dock),
                                          direction, composer find/set (shadow-aware),
                                          prompt build + chunking, library storage,
                                          pending bar (destination-only).
src/content/migration/migration.css       Modal + launcher + pending bar + logs + picker + optimizer.
src/migration/sir/sir.js             SIR v0.1 UMD (Node+browser): @DOC/@ENTITY/
                                     @METRIC/@REL/@TABLE/@TURN/@SRC/@CONF builders,
                                     markdown-table parse, kv extract, image semantics
                                     (standard+aggressive), sessionToSIR, token compare.
src/migration/tests/sir.test.js      7 tests: determinism, table compaction beats raw,
                                     kv extract, aggressive<verbose, kv<JSON measured.
src/migration/sir/pdf.js             P1 PDF layer UMD: detectPdfKind (text-native vs
                                     scanned vs mixed via Tj/TJ vs Image XObjects),
                                     extractTextNative (BT..ET literal/hex decode),
                                     pdfToSIR (text→SIR L3 or ocr-required route).
src/migration/tests/pdf.test.js      4 tests: kind detect, native extract + scanned flag,
                                     SIR routing, determinism (synthetic PDFs).
src/migration/sir/ocr.js             P1b OCR UMD: deterministic preprocess (grayscale+
                                     contrast+2x), peer/Tesseract probe, recognize()
                                     with honest routes, scannedToSIR (+@CONF).
src/migration/tests/ocr.test.js      5 tests: preprocess determinism, no-engine honesty,
                                     peer plug-in, SIR+confidence wrap, empty→ocr-empty.
src/content/attachments/attachment-saver.js  Attachment Token Saver: file watcher,
                                     image token estimate, canvas compress, panel.
                                     OCR buttons (peer/Tesseract → SIR).
src/migration/sir/retrieval.js       P2 QASC-lite UMD: intent→level classifier,
                                     per-turn+per-row units, overlap scoring,
                                     retrieve() + formatMinimal (@QUERY/@DOC/@HIT).
src/migration/tests/retrieval.test.js 6 tests: levels, id/metric hits, empty→full,
                                     determinism+format, savings.
src/content/prompt-optimizer/optimizer.js      Pure rule-based rewrite (intent→Role/Task/Req/Output).
src/content/prompt-optimizer/optimizer-ui.js   Modal with modes/score/tips/copy/apply.
src/content/prompt-optimizer/optimizer-main.js Composer read/write + event listener.
src/migration/platforms.js           SINGLE SOURCE OF TRUTH: id,name,hosts,newUrl,
                                     budget,pricePer1M,selectors,composers. Add LLM here.
src/migration/core/schema.js         Session shape v1.0.0, roles, content types, validator.
src/migration/core/normalizer.js     Raw → canonical, active-branch resolve, clone.
src/migration/core/integrity.js      Canonical JSON → SHA-256 attach/verify.
src/migration/core/validator.js      Schema + parent refs + integrity → {valid,errors}.
src/migration/core/migration-package.js  Session → transport envelope + serialize.
src/migration/core/migration-state.js     FSM: idle→extracting→…→ready→opening→review.
src/migration/core/migration-engine.js   run() 6 steps + prepareDestination(). Logs stages.
src/migration/adapters/adapter-interface.js  Abstract Source/Destination + AdapterError.
src/migration/adapters/chatgpt-source-adapter.js  Bridge-first (mapping/current_node),
                                     direct /backend-api fetch, DOM selectors, leaf fallback.
src/migration/adapters/claude-source-adapter.js   Bridge-first (multi-shape parser +
                                     detectRole/extractTextDeep pure helpers) +
                                     structured DOM + leaf fallback + fingerprint.
src/migration/tests/claude.test.js      5 tests: role variants, text unwrap, bridge
                                     normalize + chain links, unknown-shape skip.
src/migration/adapters/universal-source-adapter.js Generic: platform selectors + <main> fallback.
src/migration/adapters/chatgpt/claude-destination-adapter.js  Legacy (kept for compat).
src/migration/adapters/universal-destination-adapter.js  One class for all dests (save+open).
src/migration/adapters/mock-source-adapter.js + mock/mock-session.js + tests/migration.test.js
```

## 2. Runtime worlds (critical)

- ISOLATED (content scripts): see DOM, separate JS heap. `dist/content.js`,
  `dist/claude-content.js`, `dist/migration.js` run here at `document_idle`.
- MAIN (injected): shares heap with page, can patch `fetch/XHR`.
  `dist/claude-bridge.js`, `dist/chatgpt-bridge.js` run here at `document_start`.
- Only bridge between worlds: `window.postMessage({source, type, payload})`
  + `CustomEvent` inside ISOLATED. Never assume shared variables.
- Service worker (`background.js`): only `chrome.storage.local.ikoPendingMigration`
  + `chrome.tabs.create`. Validates sender hostname against `SOURCE_HOSTS`.

## 3. Features in detail

### 3.1 Context HUD + bot dock (`ui.js`, `main.js`, `claude-main.js`, `style.css`)

- HUD `#iko-context-hud` fixed bottom-right (24px/105px, z 2147483640),
  appended to `document.documentElement` to escape site containers.
  Re-pinned on resize + 2s interval (SPA reflows).
- Contents: brand+dot, `#iko-hud-platform`, stats Context/Usage,
  loading indeterminate bar, progress bar, status, actions row
  `[↗ Migrate][✨ Optimize][📎 Files]` (`#iko-hud-actions`).
- Bot `#iko-bot` (pill) toggles HUD `display`. Both bot and HUD card are draggable
  via generic `makeDraggable(el, {storageKey, dragClass, dragHandle, onDrop})`
  (Pointer + mouse + touch, window-level tracking, 5px click-vs-drag threshold,
  viewport clamp, left/top positioning, persisted to localStorage + chrome.storage).
  HUD drag uses its header (`.iko-hud-top`, move cursor) as handle; first drop sets
  `dataset.pinned=1` (key `ikoHudPos`) after which `position()` stops resetting it
  (keeps z-index only) so it never snaps back over the composer. Bot key is
  `ikoBotPos` (legacy `{right,bottom}` shape auto-migrated). Watchdog in the 2s
  interval resurrects bot/actions/drag wiring if site scripts nuke nodes.
  Single entry point;
  legacy `#iko-migration-launcher` / `#iko-optimizer-launcher` removed/hidden.
- `ensureBot/wireActions/ensureActionsIn` backfill older HUDs. Actions resolve
  globals at click-time (load-order safe): `IKOMigrationMain.open`,
  `iko-optimize-requested` event.
- `main.js` (all except Claude): `extractMessages` tries 6 selectors, else
  leaf-fallback (`div/article/section/p` >120 chars, leaf-only, doc order,
  alternating roles). `update()` every 2s with `counting` mutex:
  `tokens=sum(countTokens(slice 20k))`, `budget=BUDGETS[platform]`,
  `cost=tokens/1M*price`, `pct`, health (`≥80% filling, ≥95% critical`),
  status `"<health> · ~$x.xxx"`. `BUDGETS/PRICES` inline mirror `platforms.js`.
- `claude-main.js`: reads `IKO.claudeBridge.latestConversation` or waits for
  `iko-claude-conversation-updated`, converts, `countClaudeTokens` (local
  estimate), per-model detect (`opus $15 / sonnet $3 / haiku $0.8`, all 200k) →
  usage% + cost + health like `main.js` (was hardcoded `0%`/no cost), polls 2.5s
  + removes legacy HUD ids. Attachments saver bundled via `claude-entry.js` —
  Claude has 📎 Files parity with all other LLMs.
- `platform-detector.js`: table + pretty fallback; `main.js:detectPlatform()`
  mirrors it (bundle separation).

### 3.2 Bridges (Claude + ChatGPT)

- `claude-bridge.js`: guards `__IKO_*_INSTALLED__`, `publish()` helper,
  `isConversationUrl` broad (`chat_conversations|conversations|conversation|api+chat`),
  wraps `fetch` (clone→json→publish) + `XHR.open/send` (`__ikoUrl` + load→publish).
  Emits `BRIDGE_READY` on load.
- `chatgpt-bridge.js`: same shape, matches `/backend-api/conversation*`.
- Clients (`*-bridge-client.js`): `window.IKO.*Bridge={latestConversation,ready}`,
  `message` listener (`e.source===window`, source check), cache + dispatch
  `iko-*-conversation-updated`. Claude answers `REQUEST_REFRESH` by replaying
  cache (`BRIDGE_EMPTY` if none); ChatGPT side still relies on natural refetch +
  direct API fallback.
- ChatGPT mapping parse (`chatgpt-source-adapter.js:parseBridgeData`):
  `mapping/current_node` chain walk (parent links) else insertion order;
  `author.role→role`, `content.parts[]→text`; returns null if unparsable.
  Direct `fetch(/backend-api/conversation/<id>, credentials:include)` fallback
  if bridge missed initial load. Logs `bridge yielded N` / `direct API yielded N`.

### 3.3 Session migration core

- Schema (`schema.js` v1.0.0): `{schemaVersion, source{platform,conversationId,
  title,model,createdAt,updatedAt,extractedAt,extractorVersion}, messages[{id,
  role,sourceRole,content[{type,text,code,...}],parentId,siblingBranchIds,
  timestamp,model,raw}], branchInfo{hadAlternateBranches,prunedBranchCount,
  activeLeafId}, instructions[], integrity{}, migrationMeta{}}`.
- `normalizer.js:normalizeSession(raw)`: requires platform+conversationId,
  `resolveActiveBranch` via parent chain (cycle detect), keeps active branch,
  counts pruned, `structuredClone`, `assertValidSessionShape`.
- `integrity.js`: `stableSortObject` canonical → `SHA-256` (WebCrypto) →
  `attach/verify`. Note: canonicalizes subset; keep in sync with schema.
- `validator.js`: schema + ≥1 message + parent refs + integrity → metadata.
- `migration-package.js`: `{packageVersion 1.0.0, schemaVersion, createdAt,
  source:{...session.source}, session:clone, integrity{contentHash,messageCount},
  migration{status:prepared}}` + serialize/deserialize with version check.
- `migration-state.js`: FSM + history timestamps + fail().
- `migration-engine.js:run()`: EXTRACT→NORMALIZE→integrity→VALIDATE→PACKAGE→READY,
  logs `stage: extracting/ready`; `prepareDestination()`: OPENING→PREPARING→REVIEW.
  Returns `{success, session, migrationPackage, validation, state}` or `{success:false, error}`.

### 3.4 Adapters + platforms registry

- `platforms.js`: 9 entries with `budget, pricePer1M, selectors, composers`.
  `matchPlatform(host)`, `allHosts()`. **Add LLM = 1 entry here.**
- `chatgpt-source-adapter.js`: bridge → direct API → 6 DOM selectors → leaf
  fallback (leaf-only, skips thread root, toolbar role signal, else alternate).
  Fingerprint (`hasMain,totalNodes,mainTextLen,dataAttrs,testids,topTags,htmlSample`)
  logged on empty. Extractor `iko-chatgpt-dom-3-fallback` → `api-1` when bridged.
- `claude-source-adapter.js`: `parseBridgeMessages` tries `chat_messages|messages|
  conversation_messages|turns|message_list|history|conversation.*|data.messages`
  (unknown shapes → `[]` → DOM path, never throw); `detectRole` covers
  sender/role/author/author_role/from + nested shells; `extractTextDeep`
  (trimmed, depth-guarded) covers text/completion/answer/output_text, block arrays
  (skips thinking/tool_use), nested message shells. Pipeline: bridge →
  structured DOM (`chat-message/message-id/article`, toolbar role signal) →
  leaf fallback (innermost containers, chrome filtered) → empty-chat-specific
  error on `/new` (`open a conversation first`) else fingerprint error with
  counts + dataAttrs. Helpers exported for Node tests. Version
  `iko-claude-3-shapes+dom`.
- `claude-bridge.js` (MAIN): caches last CONVERSATION/USAGE payloads and answers
  `IKO_CLAUDE_CONTENT/REQUEST_REFRESH` by replaying them (`BRIDGE_EMPTY` if none) —
  previously the adapter's 10s wait could never resolve on quiet pages.
- `universal-source-adapter.js`: platform selectors + generic `<main>` fallback,
  alternating roles. Used for Gemini/Perplexity/etc.
- Destinations: legacy ChatGPT/Claude kept; `UniversalDestinationAdapter(id)`
  does `IKO_SAVE_MIGRATION` then `IKO_OPEN_MIGRATION_DESTINATION` for any id.
  `createSourceAdapter` prefers precise then universal; `createDestinationAdapter`
  prefers legacy then universal.

### 3.5 Migration UI flow (`migration-ui.js`, `migration-main.js`)

- Entry (`migration-entry.js`) exposes `IKOMigrationCore{engine,adapters,PLATFORMS}`,
  `IKOOptimizerCore{optimizePrompt}`, loads log→UI→main→optimizer UI→main.
- Panel: direction bar, SOURCE card (auto), DESTINATION card with `<select>`
  (all except current; dark `color-scheme:dark` + option bg fix), status,
  review, `[Cancel][Prepare]`, `[Open X]`, `★ Saved sessions`, `View logs`.
- Changing dest invalidates package: clears review, disables Open, resets
  Prepare text, status prompts re-Prepare (`migrationPackage=null` + engine rebuild).
- Review (`renderReview`): rows (title/messages/source/convId), branch note,
  message checklist (≤60, `container._excluded` set), integrity line,
  `[↓ .md][↓ .json][↓ .sir][★ Save]`. Open applies `_excluded` filter to outgoing package.
- Export: `sessionToMarkdown` (`# Title ## ROLE`), JSON stringify, blob download.
- Library (`migration-main.js`): `chrome.storage.local.ikoSessions` max 20
  `{id,title,platform,messages,savedAt,session,package}`; list/load/delete/save
  wired to UI. Load restores preview + re-arms Open.
- Prompt build: `sessionToPrompt(session, excluded)` header + turns
  (`text||code||input/output`), footer. `sessionToChunks(max 7500)` greedy by
  turns with `Part i/N` headers for composer limits.
- Composer: `deepQueryAll` pierces shadow DOM (Gemini `rich-textarea`),
  selectors include aria/proseMirror/role, thresholds 180×18, `Ask Gemini`
  fallback, logs `composer scan`. `setComposerValue` handles textarea setter +
  ProseMirror/execCommand(`insertText`)+beforeinput/input/change.
- Pending bar (`showPendingMigration`): shows ONLY when `pkgSource !== current`
  (destination-only; old inverted check fixed). Chunked insert: button becomes
  `Insert part k/N` until done, then `IKO_CLEAR_MIGRATION` + remove. Dismiss ×.
  Polls `IKO_GET_MIGRATION` at 1.2s + 1.5s interval.
- `background.js`: `DESTINATIONS` 9 URLs, `SOURCE_HOSTS` 13, message handlers
  save/get/clear/open with `lastError` handling + stale-context guards.

### 3.6 Prompt optimizer (`prompt-optimizer/`)

- `optimizer.js` (pure, tested implicitly): `cleanText`, `detectIntent`
  (code/debug/explain/summarize/translate/compare/plan/general),
  `vaguenessScore`, `optimizePrompt(raw, mode)` → `{optimized, improvements,
  score 55–95, intent}`. Template: Role per intent + `Task:` + Requirements
  (preserve exact, state assumption) + Output format per intent + detail level.
  Modes: clarify (structured), concise (single line), detailed (+edge cases).
- `optimizer-ui.js`: modal with mode buttons, score line, editable textarea,
  tips list, Copy/Apply. `refresh()` re-runs optimizer per mode, logs lengths.
- `optimizer-main.js`: shadow-aware composer find/read/safeWrite, unified-dock
  mode (legacy launcher removed), listens `iko-optimize-requested` + `start()`.
  Triggered from HUD `✨ Optimize` button.
- Styles in `migration.css` (#iko-optimizer-*). Bundled via `migration-entry.js`
  so available on all 9 LLMs. Fully local.

### 3.7 Attachment Token Saver (`attachments/attachment-saver.js`)

- Local-only watcher: global `change` (input[type=file]) + `drop` listeners record
  images/PDFs into `seenFiles` (max 20, dedupe by name+size). Exposed as
  `window.IKO.attachments.{recordFile,compressImage,estimate*,list,openPanel}`.
- Token model: images `85 + 170×tiles` (tiles=ceil(w/512)×ceil(h/512), cap 12;
  low-detail=85) mirroring OpenAI vision pricing; PDFs `max(500, size/4)`.
- `compressImage(file, 1024px, q0.72)`: `createImageBitmap`/Image → canvas white
  flatten → `toBlob(jpeg)` → `{blob,w,h}`. New tokens recomputed from output dims;
  `saved%` shown. Downloads `-iko-1024.jpg` for re-attach + copies compact
  descriptor `[media:image name WxH size→size tokens:a→b]` to clipboard.
- PDFs: no local parse (no pdf.js dep) — shows `~tokens` + Copy descriptor with
  guidance to paste text instead of scans.
- HUD: third button `📎 Files·~N` (`#iko-hud-files`, badge updates via
  `renderBadge()`), opens `#iko-attachments-panel` (reuses optimizer modal CSS).
  Bundled via `main.js` import so present on all non-Claude sites; Claude HUD
  path (`claude-entry.js`) does NOT bundle it yet — add import there for parity.
- Logs under `[Attachments]` (detect/optimized). Limits: no OCR/vision
  description (dimensions-only), no in-place File replacement (browser blocks it —
  user re-attaches download), PDF text extraction deferred to pdf.js phase 2.

### 3.8 SIR v0.1 — canonical Machine Understanding Language (universal)

- File `src/migration/sir/sir.js` (UMD: `require` in Node, `window.IKOSIR` in
  browser; exposed to UI as `window.IKOSIRCore` via `migration-entry.js`).
  Zero deps except optional `gpt-tokenizer` for measurement (falls back to
  chars/4 in browser). No DOM, no platform ids — same output on all 9 LLMs.
- Spec: `@DOC id type pages title` / `@ENTITY k=v` / `@METRIC k=v` /
  `@REL a -> b -> c` / `@TABLE name` + `cols=a,b` + `a|b` rows /
  `@TURN id role` / `@SRC k->p` / `@CONF k=v` / `@IMAGE` + `REL:` lines.
  Aggressive image form `TXT:/OBJ:/SCN:/CLR:/CMP:/STY:/BG:/REL:`.
- Builders: `buildDoc/Entity/Metric/Rel/Table/Src/Conf` (esc: first-line,
  space-collapsed, 500ch cap; table cells `/`-escape pipes), `parseMarkdownTable`
  (header+delim detect), `textToSIR` (kv lines→entity, currency/keyword lines→
  metric), `imageToSIR(sem, aggressive)`, `sessionToSIR(session)` (doc header +
  per-turn `@TURN` with table→TABLE or kv-split + 300ch text tail; deterministic).
- Schema: `CONTENT_TYPES` gained `"sir"` (backwards compatible) for future
  `content:{type:"sir"}` blocks; current export serializes whole session to
  `.sir.txt` (review `↓ .sir` button) rather than inline blocks.
- Measurement: `countTokens` (gpt-tokenizer→token.count→chars/4),
  `compareReps({name:text})` sorted ascending. Proven in tests: compact TABLE <
  raw markdown, aggressive < verbose image, kv < pretty JSON — measured, never assumed.
- Tests `sir.test.js` (7): determinism, table round-trip, kv extract, image
  aggressive wins, JSON-vs-kv ranking, session convert shorter than JSON.
  Run: `npm test` (18 total: 11 migration + 7 sir).
- Limits: P0 only — no OCR/VLM (image semantics passed in by caller), no PDF
  parser yet, no query-adaptive retrieval (session converts whole, L4 next),
  no embeddings. Next: P1 PDF text-native + Tesseract, P2 classifier+retrieval.

### 3.9 P1 PDF text-native layer (universal, dependency-free)

- File `src/migration/sir/pdf.js` (UMD like SIR; exposed as `window.IKOPDFCore`
  via `migration-entry.js`). Never OCRs text-native PDFs; flags scanned for the
  OCR phase instead of returning garbage.
- `detectPdfKind(buf)`: scans raw source for `/Type /Page`, text-showing ops
  (`Tj`/`TJ`), `/Subtype /Image`, font refs → `text-native|scanned|mixed|unknown`
  + counts + page count. No rendering, no deps.
- `extractTextNative(buf, 200k cap)`: decodes `(literal)` (escapes, octal) and
  `<hex>` strings inside `BT..ET` (global-scan fallback for bare writers);
  returns `{text, pages, kind, needsOcr, truncated}`. Scanned → `{text:""}`.
- `pdfToSIR(buf, meta, SIR)`: L1 `{kind,pages,chars,needsOcr}`; text route →
  L2 `{chars,preview}` + L3 (`@DOC` + kv + TABLE-or-tail via SIR module);
  scanned route → `{route:"ocr-required", l3:null}` with guidance message.
  Deterministic; cap 200k chars.
- Attachment panel: PDFs gained `Parse → SIR` (reads `file.arrayBuffer()`,
  routes via `IKOPDFCore`+`IKOSIRCore`, copies SIR to clipboard, label shows
  `text-native Np · SIR copied (~a→b tokens)` or `scanned → needs OCR` +
  descriptor copy). Text path never touches DOM or platform code — universal.
- Tests `pdf.test.js` (4, synthetic latin1 PDFs): kind detect, native extract +
  scanned flag, SIR routing + token sanity, determinism. `npm test` = 22 total.
- Limits: WinAnsi literal/hex only (no CMap/ToUnicode — complex encodings route
  to OCR honestly); table detection reuses markdown parser (native PDF tables
  without pipes stay prose tail). Next: P1b Tesseract OCR for `ocr-required`,
  P2 query classifier + L4 minimal-IR retrieval.

### 3.10 P1b OCR adapter (universal, engine-optional)

- File `src/migration/sir/ocr.js` (UMD; exposed as `window.IKOOCRCore`).
  Heavy engines stay OPTIONAL peers — never bundled, dist stays lean.
- `preprocessImageData`: luminance grayscale + 1.25× contrast + 2× nearest upscale
  to RGBA; deterministic (same pixels → same output); helps any downstream OCR.
- `recognize(src, {lang, timeoutMs})`: peer (`window.IKOOCR.peer.recognize`) →
  `window.Tesseract.recognize` → else `{route:"ocr-engine-missing", guidance}`.
  Normalizes to `{route: ocr-text|ocr-empty|ocr-failed|ocr-engine-missing,
  text≤20k, confidence 0–1, engine}`; empty/whitespace → `ocr-empty`, never fake text.
- `scannedToSIR(src, meta, SIR)`: OCR text → `@DOC + kv + @CONF ocr engine` via SIR
  module; non-text routes pass through with `l3:null`.
- Attachments panel: images gained `OCR` (peer/Tesseract → SIR copy + conf label);
  PDFs gained `OCR` next to `Parse → SIR` (blob → peer/VLM; scanned raster needs
  screenshot or localhost until pdf.js render lands). Missing engine shows setup
  guidance; raw bytes never sent.
- Tests `ocr.test.js` (5, synthetic ImageData): preprocess determinism/gray/alpha,
  no-engine honesty, peer plug-in + confidence norm, SIR+CONF wrap, empty→ocr-empty.
  `npm test` = 27 total (11 migration + 7 sir + 4 pdf + 5 ocr).
- Limits: no deskew (stub 0), no bundled Tesseract/traineddata (CSP/size), no PDF
  page raster (needs pdf.js render). Feeds P2 (OCR text flows into same index).

### 3.11 P2 retrieval — QASC-lite minimal context (universal, no embeddings yet)

- File `src/migration/sir/retrieval.js` (UMD; exposed as `window.IKORETRIEVALCore`
  via `migration-entry.js`). Same interface the future vector phase will implement,
  so callers don't change. No DOM, no platform ids.
- `classifyQuery`: task verbs outrank topic keywords (test-pinned:
  "summarize financials"→summarize/section, "revenue grow"→metric/fact).
  Levels: fact topK 3–5 (lookup-id/entity/metric), section 6–10
  (summarize/compare/debug/plan/enumerate), none→full (safe fallback).
- Units: one per message + one per markdown table row (dense facts retrievable
  without the whole turn). `scoreUnit`: token overlap ×2 + exact-word +1 +
  number/code +3 + row +0.5; deterministic tie-break by document order.
- `retrieve(session, query, {topK, countTokens})`: positive hits up to k (fallback
  first 3 turns when all score 0), doc-order restore; returns `{intent, level,
  hits[{id,parentId,role,score,kind}], messageIds, tokensFull/Min, savedPct}`.
- `formatMinimal`: `@QUERY / @DOC intent saved% / @HIT id role + text≤1200`.
- Migration panel: `🎯 Minimal context` details (query input + Retrieve/Full +
  preview with intent + full→min tokens + %). Open applies retrieval filter
  BEFORE picker exclusions; destination-change clears it (forces re-Prepare).
  Pending-bar insert unaffected (no query there — full chunks as before).
- Tests `retrieval.test.js` (6): level routing, id/metric hits with savings cap,
  empty→full, determinism + `@HIT` contains fact, mock-session savings.
  `npm test` = 33 total (11+7+4+5+6).
- Limits: lexical only (paraphrase misses — "CEO" won't match "chief executive");
  table rows need pipes; static topK per intent (no token-budget solver yet).
  Next: P3 embeddings (local MiniLM) behind same `retrieve()` signature +
  token-budget packing.

### 3.12 Logging + diagnostics (`iko-log.js`)

- Ring buffer 500 `{time,level,tag,message,data(safe,8k)}`, console passthrough,
  `iko-log-updated` event. API: `info/warn/error`, `getLogs/formatAll`,
  `diagnostics()` (`url,title,UA,readyState,legacy/turn/article/msgId counts,
  logCount`), `copyAll()` (diagnostics+logs to clipboard).
- Engine logs stages; extractors log selector counts, fingerprints, fallback lens;
  composer scans logged; optimizer logs in/out lens. Panel has live `<pre>`
  (last 6k) + Copy button. Convention: `window.IKO.logger.info("Tag", msg, data)`.

## 4. Upgrades changelog (why each exists)

1. Multi-selector ChatGPT (legacy→turn-testid→message-id→article) — ChatGPT
   renamed DOM 2025–26; single selector returned 0.
2. Logger + View logs/Copy — invisible failures; now pasteable diagnostics.
3. Pending-bar destination-only fix (`!==`→`===` current) — bar showed on source.
4. Claude ProseMirror insert (execCommand+beforeinput) — textContent alone ignored.
5. Fallback alternating (ChatGPT) — zero-selectors still migratable.
6. Fingerprint logging — identify new markup from user logs.
7. Leaf-only fallback — outermost kept whole `<main>` as 1 block; leaves split turns.
8. Toolbar role signal — alternating mislabels; copy/citation→assistant.
9. Destination `<select>` + engine rebuild + forced re-Prepare — hardcoded pairs.
10. Dark select fix (`color-scheme:dark`, option bg) — white-on-white dropdown.
11. Universal registry (`platforms.js` 9 LLMs) + universal adapters — per-site ifs.
12. Manifest/background/detector expansion — new hosts blocked.
13. ChatGPT MAIN bridge + mapping parse + direct API fetch — DOM unparseable
    app-shell (`data-app-shell-*`, 0 articles); API immune.
14. Claude bridge broadening + deep text + DOM fallback — shell-but-empty bridge.
15. Gemini shadow-DOM composer (`deepQueryAll`, rich-textarea, Ask fallback).
16. HUD platform dynamic + budgets/prices — hardcoded ChatGPT/200k.
17. Unified bot dock (`#iko-bot` + in-HUD actions, legacy launchers removed).
18. Cost meter (`cost, health ≥80/95`) in HUD status.
19. Session library (save/load/delete, 20, persisted).
20. Message picker (checkbox `_excluded` applied on Open) + branch note.
21. Chunked insert (7500, Part i/N) for composer limits.
22. Export .md/.json via blob.
23. Prompt optimizer (local intent→structured + modal + HUD button).
24. Attachment Token Saver (file watcher, OpenAI tile estimate, canvas 1024px/q0.72
    compress + download + descriptor copy, HUD 📎 badge + panel; PDFs metadata-only).
25. Draggable IKO bot (Pointer drag anywhere, click-vs-drag threshold, viewport
    clamp, position persisted to localStorage + chrome.storage, restored on load).
    Fix: window-level pointermove/up (fast drags outside pill still track),
    corrected vertical axis (mouse-down shrinks bottom edge), mouse fallback.
    Fix 2 (root cause): `#iko-bot` CSS used `right/bottom !important`, which beats
    JS inline styles — bot could never move. Removed `!important` from right/bottom,
    switched drag to left/top positioning with legacy-shape migration, added
    mouse+touch fallback paths and `.iko-dragging` visual.
26. SIR P0 universal (sir.js UMD + sir.test.js 7 tests + schema "sir" type +
    review ↓ .sir export + npm test 18 total). Deterministic @DOC/@ENTITY/@METRIC/
    @REL/@TABLE/@TURN/@SRC/@CONF + aggressive TXT:/OBJ: image form; measured wins
    (TABLE<markdown, aggressive<verbose, kv<JSON) via gpt-tokenizer compareReps.
27. P1 PDF text-native layer (pdf.js UMD + pdf.test.js 4 tests, npm test 22 total;
    exposed IKOPDFCore; attachments Parse → SIR button with token delta label).
    Heuristic kind detect (text ops vs Image XObjects), BT..ET literal/hex decode,
    scanned→ocr-required route (never garbage), text→SIR L3 via SIR module.
28. P1b OCR adapter (ocr.js UMD + ocr.test.js 5 tests, npm test 27 total; exposed
    IKOOCRCore; attachments OCR buttons for images + scanned PDFs). Deterministic
    preprocess, peer/Tesseract probe, honest routes (never fake text), scanned→SIR
    with @CONF. Engines stay optional peers; dist lean.
29. P2 retrieval QASC-lite (retrieval.js UMD + retrieval.test.js 6 tests, npm test
    33 total; exposed IKORETRIEVALCore; 🎯 panel with Retrieve/Full + token-savings
    preview; Open filters to messageIds before picker exclusions). Lexical
    intent→level + overlap scoring, empty→full fallback; vectors plug in later
    behind the same signature.
30. Universal parity: Claude bundles attachments saver (📎 Files everywhere) +
    per-model Opus/Sonnet/Haiku budget/price/cost/health in HUD (was 0%/no cost).
31. Draggable HUD card (header handle, pinned spot survives re-pin interval) +
    bot/HUD watchdog resurrection + `#iko-bot`/`#iko-context-hud` CSS `!important`
    root-cause fixes (stylesheet !important beats JS inline — drag could never apply).
    Fix 2: same trap on `#iko-context-hud` (`right/bottom/left/top !important`) —
    cursor changed (handle wired) but card frozen. Removed `!important` from the
    five position props, added `.iko-dragging` no-transition style.
32. Copilot/subdomain injection fix: generic `content_scripts` entry lacked `*.`
    wildcards (gemini/copilot/grok/x/deepseek/mistral subdomains never injected —
    no HUD, no migrate). Added all wildcards + `m365.cloud.microsoft` to manifest
    (matches + host_permissions), `platforms.js` copilot hosts, `background.js`
    SOURCE_HOSTS. Rule: every host in host_permissions needs a matching match
    pattern, or scripts silently never run.
33. ChatGPT bridge shape-2 + endpoint fix + init-dedupe (from live-log diagnosis):
    `parseBridgeData` now accepts metadata+`messages[]/turns[]` lists (the live
    `/conversations/<id>` endpoint has no `mapping`), logs ALL payload keys,
    direct fetch tries plural `/conversations/` before legacy singular (was 404);
    `migration-main` init guarded against double-start (was double polling/logs).
34. Claude extractor failure fix (your screenshot): MAIN bridge replays cached
    payloads on `REQUEST_REFRESH` (the 10s wait could never resolve before);
    9-shape `parseBridgeMessages`, `detectRole`/`extractTextDeep` pure helpers
    (5 Node tests in `claude.test.js`), structured-DOM + leaf-DOM passes,
    `/new` empty-chat-specific error. `npm test` = 38 total (11+7+4+5+6+5).

## 5. Build / test / run

```bash
npm install
node build.js        # or npm run build → dist/{content,claude-content,claude-bridge,chatgpt-bridge,migration}.js + css
npm test             # 38 tests: 11 migration + 7 sir + 4 pdf + 5 ocr + 6 retrieval + 5 claude
```
Load: `chrome://extensions` → Developer → Load unpacked → folder with
`manifest.json`. Open **fresh** LLM tab (old tabs → `Extension context invalidated`).
Debug: page `F12 → filter [IKO]`, `View logs → Copy logs`,
`chrome://extensions → Service worker` console.
`dist/` is gitignored build output — never edit; edit `src/` + rebuild.
`sourcemap:false`; set true temporarily to map `dist`→`src` in DevTools.

## 6. How to extend (rules for new models)

- New LLM: add 6-line entry to `platforms.js` (hosts/newUrl/budget/price/
  selectors/composers). Universal adapters + manifest/background/detector read it.
  If selectors unknown, leave generic — leaf fallback works day one, then add exact
  from user `Copy logs` fingerprint.
- New bridge: copy `chatgpt-bridge.js` (30 lines), change URL matcher + source
  string, add client (copy `chatgpt-bridge-client.js`), build entry in `build.js`,
  MAIN entry in `manifest.json`, parse in source adapter (prefer API → DOM).
- New HUD metric: compute in `main.js/claude-main.js:update()`, pass in
  `latestData`, render in `ui.js:update()`. Keep `counting` mutex + slice 20k.
- New migration step: add to `migration-state.js` stages + `engine.run()`
  between validate/package; log via `IKO.logger`; cover in `migration.test.js`.
- New modal feature: extend `migration-ui.js` with `details` section +
  callbacks via `options.onX` wired in `migration-main.js` (load-order safe).
- Never: hardcode host/selector outside `platforms.js`, use `window.open()`,
  `postMessage("*")` without source check relaxation, or edit `dist/`.

## 7. Known limitations / debt

- `claude-token.js/claude-tokens.js/token.js/content-analyzer.js/constants.js`
  are dead duplicates — delete after confirming no import.
- Token counts are local estimates (Claude chars/4, others o200k). Add localhost
  `count_tokens` proxy or per-model limit API for exact server-side counts.
- ChatGPT `REQUEST_REFRESH` still no-op on bridge side; relies on natural fetch + direct API.
- `integrity.js` canonical subset vs schema drift — keep aligned.
- Fallback roles positional when toolbar signal absent — verify in preview.
- `checkPendingMigration` 1.5s poll + HUD 2s poll — replace with
  `MutationObserver` + `storage.onChanged` for battery.
- `postMessage("*")` + broad selectors — tighten origin + validate payload shape.
- No e2e on real DOM; only Node unit tests. Add Playwright fixtures per LLM.
- Accessibility/i18n minimal; settings page absent (budgets hardcoded + override
  via `IKO.config` only).

## 8. Roadmap (suggested order)

1. Per-model budget/price auto-detect from bridge `model_slug` (exact $).
2. History sparkline (`storage.session` 10s samples) + growth alert.
3. Reply-compare (same prompt → 2 tabs → diff view).
4. Auto-continuity templates per optimizer intent on migrated insert.
5. Settings page (budget, position, theme, debug) + shortcuts (`Ctrl+Shift+M/K`).
6. `MutationObserver` + event-driven refresh; Firefox `browser.*` shim.
7. Server-optional exact counters (Anthropic/Gemini) with local fallback label.
8. Onboarding coach marks; export PDF; onboarding → fewer support pastes.
