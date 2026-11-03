/* Reader: fetches encrypted chapter bundles, decrypts them in the browser
 * and shows original text, notes, visual summaries, ideas and questions per
 * section/subtopic. The key comes from js/unlock.js (page runs it first). */
(() => {
  "use strict";
  /* Page shell: a book's index.html only needs the <link> to style.css and the
   * <script> for this file; the header, drawers and settings are built here. */
  const SHELL = `<header class="bar" id="bar">
  <button id="menu" class="icon-btn" aria-label="Table of contents" aria-controls="dr-left" aria-expanded="false"><svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"/></svg></button>
  <div class="ttl"><small id="kicker"></small><h1 id="title">Loading</h1></div>
  <button id="pagemenu" class="icon-btn" aria-label="On this page" aria-controls="dr-right" aria-expanded="false" hidden><svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M9 6h11M9 12h11M9 18h11" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"/><circle cx="4.5" cy="6" r="1.3" fill="currentColor"/><circle cx="4.5" cy="12" r="1.3" fill="currentColor"/><circle cx="4.5" cy="18" r="1.3" fill="currentColor"/></svg></button>
</header>
<aside id="dr-left" class="drawer left" aria-hidden="true" aria-label="Table of contents"><div class="dr-head"><b>Contents</b><button class="icon-btn dr-close" aria-label="Close">&times;</button></div><nav id="toc"></nav></aside>
<aside id="dr-right" class="drawer right" aria-hidden="true" aria-label="On this page"><div class="dr-head"><b>On this page</b><button class="icon-btn dr-close" aria-label="Close">&times;</button></div><nav id="pagetoc"></nav></aside>
<div id="scrim" hidden></div>
<main id="app"><p class="muted">Loading&hellip;</p></main>`;
  if (!document.getElementById("app")) document.body.insertAdjacentHTML("afterbegin", SHELL);
  /* The shared files (themes, reading settings, the gear panel) sit beside
   * this script, in the same tagged copy of the template. */
  const SCRIPT_ADDRESS = document.currentScript ? document.currentScript.src : "";
  const SHARED_BASE = SCRIPT_ADDRESS.replace(/reader\/app\.js(\?.*)?$/, "");
  if (typeof window.RecallQuizAssetBase !== "string") window.RecallQuizAssetBase = SHARED_BASE;
  /* Loaded in this order: each one needs the one before it. */
  const SHARED_SCRIPTS = ["js/default-settings.js", "js/themes-list.js", "js/theme-picker.js",
    "js/helpers.js", "js/reading-settings.js", "js/reading-panel.js"];
  /* Optional <meta name="book-base" content="books/xyz/"> when the encrypted files
   * are not next to the page. */
  const BASE = (document.querySelector('meta[name="book-base"]') || {}).content || "";
  const $ = (s, r = document) => r.querySelector(s);
  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };
  const app = $("#app"), titleEl = $("#title"), kicker = $("#kicker");
  let KEY = null, MANIFEST = null, CUR = null; // CUR = {prefix, ch}
  const chapters = new Map(), mediaUrls = new Map();
  const T0 = performance.now();
  const stats = { bytes: 0, files: 0 };
  window.__trial = stats;

  const lsGet = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } };

  // ---------------------------------------------------------------- crypto
  const hexToBytes = (h) => Uint8Array.from(h.match(/../g), (x) => parseInt(x, 16));

  // The subject key comes from js/unlock.js, which the page runs first
  // (sign in with Google, or paste the key).
  async function loadKey() {
    return (await window.SubjectUnlock.ready()).key;
  }

  async function decryptBuf(buf) {
    const b = new Uint8Array(buf), head = b.slice(0, 9);
    if (String.fromCharCode(...head.slice(0, 4)) !== "RQE1") throw new Error("not an encrypted file");
    const plain = new Uint8Array(await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: b.slice(9, 21), additionalData: head }, KEY, b.slice(21)));
    if (!(head[4] & 1)) return plain;
    const stream = new Blob([plain]).stream().pipeThrough(new DecompressionStream("gzip"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  async function fetchEnc(path) {
    const r = await fetch(BASE + path);
    if (!r.ok) throw new Error(path + " " + r.status);
    const buf = await r.arrayBuffer();
    stats.bytes += buf.byteLength; stats.files += 1;
    return decryptBuf(buf);
  }
  const fetchJson = async (p) => JSON.parse(new TextDecoder().decode(await fetchEnc(p)));

  function sniff(b) {
    const h = (...a) => a.every((v, i) => b[i] === v);
    if (h(0x89, 0x50, 0x4e, 0x47)) return "image/png";
    if (h(0xff, 0xd8)) return "image/jpeg";
    if (h(0x47, 0x49, 0x46)) return "image/gif";
    if (h(0x52, 0x49, 0x46, 0x46)) return "image/webp";
    if (b[4] === 0x66 && b[5] === 0x74) return "video/mp4";
    if (h(0x1a, 0x45, 0xdf, 0xa3)) return "video/webm";
    return "image/svg+xml";
  }

  async function mediaUrl(id) {
    if (!mediaUrls.has(id)) {
      mediaUrls.set(id, (async () => {
        const bytes = await fetchEnc("media/" + id.replace(/\//g, "_") + ".enc");
        return { url: URL.createObjectURL(new Blob([bytes], { type: sniff(bytes) })), type: sniff(bytes) };
      })());
    }
    return mediaUrls.get(id);
  }

  async function mediaElement(entry, alt) {
    const { url, type } = await mediaUrl(entry.id);
    if (type.startsWith("video/")) {
      const v = el("video"); v.src = url; v.controls = true; v.preload = "metadata";
      v.setAttribute("aria-label", alt); return v;
    }
    const img = el("img"); img.src = url; img.alt = alt; img.loading = "lazy"; return img;
  }

  // ------------------------------------------------------------- progress
  const bookId = () => (MANIFEST ? MANIFEST.book.id : "book");
  const resKey = (id) => `trial:${bookId()}:q:${id}`;
  const getRes = (id) => lsGet(resKey(id));
  const setRes = (id, r) => lsSet(resKey(id), r);
  const answeredCount = (ids) => ids.filter((i) => getRes(i)).length;
  const flagKey = (id) => `trial:${bookId()}:flag:${id}`;
  const getFlag = (id) => lsGet(flagKey(id)) || "";
  const setFlag = (id, f) => lsSet(flagKey(id), f);
  const HIDING = ["bad", "useless"];

  // ------------------------------------------------------------- settings
  /* Look: the quiz's themes and the shared reading settings (font size, font,
   * spacing, width, colours), saved per book and the same in the quiz. What is
   * left here is what only the ereader has: which parts of a section to show. */
  const SHOW_PARTS = [["notes", "Your notes"], ["visuals", "Visual summaries"], ["ideas", "Ideas"], ["questions", "Questions"]];
  const SHOW_KEY = "recall-quiz:reader-show:";
  // "Your notes" start hidden; the reader turns them on in the gear panel.
  const defaultShow = () => ({ notes: false, ideas: true, questions: true, visuals: true });
  let SHOW = defaultShow();
  let panel = null;

  function loadShow() {
    SHOW = defaultShow();
    try { Object.assign(SHOW, JSON.parse(lsGet(SHOW_KEY + bookId()) || "{}")); } catch (e) { /* defaults */ }
    applyShow();
  }

  function applyShow() {
    for (const [k] of SHOW_PARTS) document.body.classList.toggle("hide-" + k, !SHOW[k]);
    lsSet(SHOW_KEY + bookId(), JSON.stringify(SHOW));
  }

  /* The ereader's own section of the gear panel. */
  function addShowSection(body) {
    body.appendChild(el("h4", null, "Show"));
    SHOW_PARTS.forEach(([k, label]) => {
      const l = el("label", "reading-toggle"); l.appendChild(el("span", null, label));
      const c = el("input"); c.type = "checkbox"; c.checked = SHOW[k]; c.dataset.setting = k;
      c.addEventListener("change", () => { SHOW[k] = c.checked; applyShow(); });
      l.appendChild(c); body.appendChild(l);
    });
  }

  function resetShow() {
    SHOW = defaultShow();
    applyShow();
  }

  function goBookHome() {
    closeDrawers(); window.scrollTo(0, 0);
    if (location.hash) location.hash = ""; else route();
  }

  function setUpPanel() {
    window.RecallQuiz.reading.configure({ fontSize: 18, font: "serif" });
    panel = window.RecallQuiz.readingPanel.create({
      homeLabel: "Book home", onHome: goBookHome,
      subjectPageAddress: new URL("../", location.href).href,
      addSections: addShowSection, onReset: resetShow,
    });
  }

  function loadShared() {
    return SHARED_SCRIPTS.reduce((chain, file) => chain.then(() => window.SubjectUnlock.loadScript(SHARED_BASE + file)),
      Promise.resolve());
  }

  // -------------------------------------------------------------- drawers
  function openDrawer(which) {
    closeDrawers();
    const d = $("#dr-" + which); if (!d) return;
    if (which === "left") renderToc(); else renderPageToc();
    d.classList.add("open"); d.setAttribute("aria-hidden", "false");
    $("#scrim").hidden = false;
    (which === "left" ? $("#menu") : $("#pagemenu")).setAttribute("aria-expanded", "true");
    const c = $(".drawer.open .cur"); if (c) c.scrollIntoView({ block: "center" });
  }
  function closeDrawers() {
    document.querySelectorAll(".drawer").forEach((d) => { d.classList.remove("open"); d.setAttribute("aria-hidden", "true"); });
    $("#scrim").hidden = true;
    $("#menu").setAttribute("aria-expanded", "false"); $("#pagemenu").setAttribute("aria-expanded", "false");
  }

  function renderToc() {
    const nav = $("#toc"); nav.replaceChildren();
    const home = el("a", null, "All chapters"); home.href = "#"; home.className = "chl" + (CUR ? "" : " cur");
    home.addEventListener("click", (e) => { e.preventDefault(); closeDrawers(); location.hash = ""; if (!location.hash) route(); });
    nav.appendChild(home);
    let last = null;
    for (const c of MANIFEST.chapters) {
      if (c.group !== last) { nav.appendChild(el("div", "grp", c.group)); last = c.group; }
      const isCur = CUR && CUR.prefix === c.prefix;
      const b = el("button", "chl" + (isCur ? " cur" : ""), `${c.unit === c.title ? "" : c.unit + ": "}${c.title}`);
      b.type = "button";
      const sub = el("div", "sub" + (isCur ? " open" : ""));
      b.addEventListener("click", () => { sub.classList.toggle("open"); });
      nav.append(b, sub);
      const open = el("a", "l2", "Open chapter"); open.href = "#/" + c.prefix;
      open.addEventListener("click", (e) => { e.preventDefault(); closeDrawers(); goTo(c.prefix); });
      sub.appendChild(open);
      for (const t of c.outline || []) {
        const a = el("a", "l2" + (CUR && CUR.node === t.id ? " cur" : ""), t.title); a.href = `#/${c.prefix}/${t.id}`;
        a.addEventListener("click", (e) => { e.preventDefault(); closeDrawers(); goTo(c.prefix, t.id); });
        sub.appendChild(a);
        for (const s of t.subs) {
          const a3 = el("a", "l3", s.title); a3.href = `#/${c.prefix}/${s.id}`;
          a3.addEventListener("click", (e) => { e.preventDefault(); closeDrawers(); goTo(c.prefix, s.id); });
          sub.appendChild(a3);
        }
      }
    }
  }

  function renderPageToc() {
    const nav = $("#pagetoc"); nav.replaceChildren();
    if (!CUR) { nav.appendChild(el("p", "muted small", "Open a chapter to see its sections here.")); return; }
    const y = window.scrollY + 90; let active = null;
    for (const n of CUR.ch.nodes) { const s = document.getElementById(n.id); if (s && s.offsetTop <= y) active = n.id; }
    const top = el("a", "chl", "Top of chapter"); top.href = "#";
    top.addEventListener("click", (e) => { e.preventDefault(); closeDrawers(); window.scrollTo({ top: 0, behavior: "smooth" }); });
    nav.appendChild(top);
    for (const n of CUR.ch.nodes) {
      const a = el("a", n.level === 3 ? "l3" : "l2", n.title === "Opening" ? "Chapter opening" : n.title);
      if (n.id === active) a.classList.add("cur");
      a.href = `#/${CUR.prefix}/${n.id}`;
      a.addEventListener("click", (e) => { e.preventDefault(); closeDrawers(); goTo(CUR.prefix, n.id); });
      nav.appendChild(a);
    }
  }

  // ------------------------------------------------------------ home view
  const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
  function counts(o) {
    const bits = [];
    if (o.subCount) bits.push(plural(o.subCount, "subsection"));
    bits.push(plural(o.ideas, "idea"), plural(o.questions, "question"));
    if (o.figures) bits.push(plural(o.figures, "figure"));
    if (o.visuals) bits.push(plural(o.visuals, "visual"));
    return bits.join(" · ");
  }

  function showHome() {
    CUR = null;
    titleEl.textContent = MANIFEST.book.title; kicker.textContent = "";
    $("#pagemenu").hidden = true;
    document.title = MANIFEST.book.title;
    app.replaceChildren();
    if (MANIFEST.book.summary) app.appendChild(el("p", "muted", MANIFEST.book.summary));
    if (MANIFEST.notesExtra && MANIFEST.notesExtra.length) {
      const dn = el("details", "idea");
      dn.appendChild(el("summary", null, `Your notes: overview and parts (${MANIFEST.notesExtra.length})`));
      for (const x of MANIFEST.notesExtra) {
        const dd = el("details", "idea"); dd.appendChild(el("summary", null, x.title));
        const bd = el("div", "notes-body"); bd.innerHTML = x.html; dd.appendChild(bd); dn.appendChild(dd);
      }
      dn.classList.add("home-notes");
      app.appendChild(dn);
    }
    let lastGroup = null;
    for (const c of MANIFEST.chapters) {
      if (c.group !== lastGroup) { app.appendChild(el("div", "group", c.group)); lastGroup = c.group; }
      const card = el("div", "chcard"); card.dataset.prefix = c.prefix;
      const head = el("button", "chhead"); head.type = "button"; head.setAttribute("aria-expanded", "false");
      head.appendChild(el("b", null, `${c.unit === c.title ? "" : c.unit + ": "}${c.title}`));
      head.appendChild(el("div", "meta", [plural(c.sections, "section"), plural(c.ideas, "idea"), plural(c.questions, "question"),
        ...(c.figures ? [plural(c.figures, "figure")] : [])].join(" · ")));
      const prog = el("div", "bar-prog"), fill = el("i");
      fill.style.width = "0%"; fill.dataset.prefix = c.prefix; prog.appendChild(fill); head.appendChild(prog);
      const list = el("div", "topics");
      const oc = el("button", "opench", "Open whole chapter →"); oc.type = "button";
      oc.addEventListener("click", () => goTo(c.prefix)); list.appendChild(oc);
      for (const t of c.outline || []) {
        const b = el("button", "topic"); b.type = "button";
        b.appendChild(el("span", "t", t.title === "Opening" ? "Chapter opening" : t.title));
        b.appendChild(el("div", "meta", counts(t)));
        b.addEventListener("click", () => goTo(c.prefix, t.id));
        list.appendChild(b);
      }
      head.addEventListener("click", () => {
        const open = card.classList.toggle("open"); head.setAttribute("aria-expanded", String(open));
      });
      card.append(head, list); app.appendChild(card);
    }
    for (const [prefix, data] of chapters) {
      const f = app.querySelector(`i[data-prefix="${prefix}"]`);
      if (f) f.style.width = Math.round(100 * answeredCount(data.questions.map((q) => q.id)) / Math.max(1, data.questions.length)) + "%";
    }
    window.scrollTo(0, 0);
  }

  // --------------------------------------------------------- chapter view
  async function getChapter(prefix) {
    if (!chapters.has(prefix)) chapters.set(prefix, await fetchJson(`data/ch/${prefix}.enc`));
    return chapters.get(prefix);
  }

  function renderIdea(idea, qs) {
    const d = el("details", "idea");
    d.appendChild(el("summary", null, idea.title));
    d.appendChild(el("p", "muted small", idea.question));
    for (const blk of idea.card.blocks || []) {
      const b = el("div", "blk");
      if (blk.label) b.appendChild(el("b", null, blk.label));
      if (blk.text) b.appendChild(el("p", null, blk.text));
      if (blk.code) b.appendChild(el("pre", null, blk.code));
      d.appendChild(b);
    }
    if (idea.card.rule) d.appendChild(el("p", "rule", idea.card.rule));
    if (idea.card.limits) d.appendChild(el("p", "muted small", idea.card.limits));
    if (qs && qs.length) {
      const wrap = el("div", "idea-qs");
      const row = el("div", "row"), host = el("div");
      const done = answeredCount(qs.map((q) => q.id));
      const b = el("button", "btn ghost", done ? `Questions on this idea (${done}/${qs.length} done)` : `Questions on this idea (${qs.length})`);
      b.type = "button";
      b.addEventListener("click", () => { b.hidden = true; buildCarousel(host, qs, "idea", () => { b.hidden = false; }); });
      row.appendChild(b); wrap.append(row, host); d.appendChild(wrap);
    }
    return d;
  }

  async function showChapter(prefix, nodeId) {
    const meta = MANIFEST.chapters.find((c) => c.prefix === prefix);
    if (!meta) { location.hash = ""; return; }
    closeDrawers();
    if (CUR && CUR.prefix === prefix && CUR.rendered) { scrollToNode(nodeId); return; }
    titleEl.textContent = meta.title;
    kicker.textContent = meta.unit === meta.title ? meta.group : meta.unit;
    document.title = meta.title + " · " + MANIFEST.book.title;
    $("#pagemenu").hidden = false;
    app.replaceChildren(el("p", "muted", "Decrypting chapter…"));
    const ch = await getChapter(prefix);
    CUR = { prefix, ch, node: nodeId || null, rendered: false };
    app.replaceChildren();
    if (ch.summary) app.appendChild(el("p", "muted", ch.summary));
    if (ch.notesIntro) {
      const ni = el("div", "slot notes"); ni.appendChild(el("b", null, "Your notes: this chapter"));
      const d = el("div", "notes-body"); d.innerHTML = ch.notesIntro; ni.appendChild(d); app.appendChild(ni);
    }
    const mediaById = Object.fromEntries(ch.media.map((m) => [m.id, m]));
    const qById = Object.fromEntries(ch.questions.map((q) => [q.id, q]));
    const lazy = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        lazy.unobserve(e.target);
        const t = e.target;
        buildCarousel(t, t._list, "node");
      }
    }, { rootMargin: "500px 0px" });
    for (const n of ch.nodes) {
      const sec = el("section"); sec.id = n.id;
      if (n.title !== "Opening") sec.appendChild(el(n.level === 2 ? "h2" : "h3", null, n.title));
      if (n.html) {
        const orig = el("div", "orig"); orig.innerHTML = n.html; sec.appendChild(orig);
        orig.querySelectorAll("figure[data-media]").forEach(async (fig) => {
          const m = mediaById[fig.dataset.media];
          if (!m) return;
          try { fig.appendChild(await mediaElement(m, m.alt)); } catch (e) { fig.textContent = m.alt; }
        });
      }
      if (n.level >= 2 && !String(n.id).endsWith("-whole")) {
        const notes = el("div", "slot notes"); notes.appendChild(el("b", null, "Your notes"));
        if (n.notes) { const d = el("div", "notes-body"); d.innerHTML = n.notes; notes.appendChild(d); }
        else notes.appendChild(el("span", "muted small", `No notes yet for this ${n.level === 3 ? "subtopic" : "section"}.`));
        sec.appendChild(notes);
      }
      if (n.visuals && n.visuals.length) {
        const v = el("div", "slot visual"); v.appendChild(el("b", null, "Visual summary"));
        for (const vis of n.visuals) {
          const fig = el("figure");
          mediaElement(vis, vis.alt).then((e) => fig.prepend(e)).catch(() => {});
          if (vis.caption) fig.appendChild(el("figcaption", null, vis.caption));
          v.appendChild(fig);
        }
        sec.appendChild(v);
      }
      if (n.ideas.length) {
        const s = el("div", "slot ideas"); s.appendChild(el("b", null, `Ideas (${n.ideas.length})`));
        n.ideas.forEach((id) => s.appendChild(renderIdea(ch.ideas[id], ch.questions.filter((q) => q.ideaId === id))));
        sec.appendChild(s);
      }
      if (n.questions.length) {
        const s = el("div", "slot qs");
        const host = el("div", "qs-host"); host._list = n.questions.map((i) => qById[i]);
        const head = el("b", null, `Questions in this ${n.level === 3 ? "subtopic" : "section"} (${n.questions.length})`);
        s.append(head, host); sec.appendChild(s); lazy.observe(host);
      }
      app.appendChild(sec);
    }
    CUR.rendered = true;
    scrollToNode(nodeId, true);
  }

  function scrollToNode(nodeId, instant) {
    if (!nodeId) { window.scrollTo(0, 0); return; }
    CUR.node = nodeId;
    const go = () => { const s = document.getElementById(nodeId); if (s) s.scrollIntoView({ behavior: instant ? "auto" : "smooth", block: "start" }); };
    go();
    // figures decrypt and load after the first scroll and shift the layout: re-aim until the reader scrolls
    userMoved = false;
    const again = () => { if (!userMoved && CUR && CUR.node === nodeId) { const s = document.getElementById(nodeId); if (s && Math.abs(s.getBoundingClientRect().top - 70) > 6) s.scrollIntoView({ behavior: "auto", block: "start" }); } };
    [(instant ? 350 : 900), 1800, 3000].forEach((t) => setTimeout(again, t));
  }

  let userMoved = false;
  ["wheel", "touchstart", "keydown", "mousedown"].forEach((ev) => window.addEventListener(ev, () => { userMoved = true; }, { passive: true }));

  function goTo(prefix, nodeId) {
    const h = "#/" + prefix + (nodeId ? "/" + nodeId : "");
    if (location.hash === h) { route(); return; }
    location.hash = h;
  }

  // ------------------------------------------------------------ questions
  const shuffle = (a) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const squash = (s) => s.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, "").replace(/\b(the|a|an)\b/g, "").replace(/\s+/g, " ").trim();
  const ROLE = { warmup: "Warm-up", pretest: "Pre-test", apply: "Apply", transfer: "Transfer", extend: "Extend",
    predict: "Predict", "spot-error": "Spot the error", discriminate: "Tell apart" };

  /* Horizontally scrollable, shuffled question cards with a segmented
   * progress bar and a flag bar, like the quiz template's question card. */
  function buildCarousel(host, list, scope, onClose) {
    host.replaceChildren();
    const usable = list.filter((q) => !HIDING.includes(getFlag(q.id)));
    const hidden = list.length - usable.length;
    const items = shuffle(usable);
    const wrap = el("div", "qs-wrap");
    const head = el("div", "q-head"), note = el("span", null, hidden ? `${hidden} hidden by flags` : ""), tools = el("span", "row");
    const again = el("button", "pill", "Shuffle again"); again.type = "button";
    again.addEventListener("click", () => buildCarousel(host, list, scope, onClose));
    tools.appendChild(again);
    if (onClose) { const x = el("button", "pill", "Close"); x.type = "button"; x.addEventListener("click", () => { host.replaceChildren(); onClose(); }); tools.appendChild(x); }
    head.append(note, tools);
    const prog = el("div", "q-progress"), track = el("div", "q-track");
    track.tabIndex = 0; track.setAttribute("aria-label", "Questions: swipe or scroll sideways");
    const segs = [], slides = [], results = [];
    let score = 0, answered = 0, idx = 0;
    const total = items.length;
    prog.classList.toggle("is-dense", total > 40); // long lists: no gaps, see style.css
    const count = el("b", null, ""), nav = el("div", "q-nav");
    const prev = el("button", "q-nav-btn", "‹ Back"), next = el("button", "q-nav-btn", "Next ›");
    const refreshCount = () => {
      count.textContent = idx >= total ? "Round complete" : `Question ${idx + 1} of ${total}`;
      prev.disabled = idx <= 0; next.disabled = idx >= slides.length - 1;
      segs.forEach((s, i) => s.classList.toggle("is-current", i === idx));
    };
    const fit = () => { const s = slides[Math.min(idx, slides.length - 1)]; if (s) track.style.height = s.offsetHeight + "px"; track.scrollTop = 0; };
    const goSlide = (i) => { const s = slides[Math.max(0, Math.min(slides.length - 1, i))]; if (s) track.scrollTo({ left: s.offsetLeft - track.offsetLeft, behavior: "smooth" }); };
    items.forEach((q, i) => {
      const seg = el("i"); seg.title = `Question ${i + 1}`; seg.addEventListener("click", () => goSlide(i)); segs.push(seg); prog.appendChild(seg);
      const slide = el("div", "q-slide"), card = el("div", "question-card");
      card.appendChild(el("div", "qrole", ROLE[q.role] || q.role || "Question"));
      card.appendChild(el("div", "qt", q.q));
      const area = el("div"); area.style.display = "flex"; area.style.flexDirection = "column"; area.style.gap = "6px";
      card.appendChild(area);
      let done = false;
      const finish = (res, extra) => {
        if (done) return; done = true; answered += 1;
        setRes(q.id, res); score += res === "got" ? 1 : res === "part" ? 0.5 : 0;
        seg.classList.add(res === "miss" ? "is-wrong" : "is-done");
        card.appendChild(el("div", "fb " + res, (res === "got" ? "Got it. " : res === "part" ? "Partly. " : "Missed. ") + (extra || q.explain || "")));
        const nb = el("button", "btn", i + 1 < total ? "Next question →" : "Finish"); nb.type = "button";
        nb.addEventListener("click", () => goSlide(i + 1));
        card.insertBefore(nb, card.querySelector(".flag-bar"));
        if (answered === total) updateEnd();
      };
      KINDS[q.kind](q, area, finish, card);
      card.appendChild(flagBar(q, card));
      slide.appendChild(card); slides.push(slide); track.appendChild(slide);
    });
    const end = el("div", "q-slide"), endCard = el("div", "question-card");
    const updateEnd = () => {
      endCard.replaceChildren(el("div", "qrole", "Round complete"),
        el("div", "qt", answered === total && total ? `Score: ${score.toFixed(1)} of ${total}` : total ? "Answer every card to see your score." : "No questions to show."));
    };
    updateEnd();
    end.appendChild(endCard); slides.push(end); track.appendChild(end);
    prev.type = next.type = "button"; prev.setAttribute("aria-label", "Previous question"); next.setAttribute("aria-label", "Next question");
    prev.addEventListener("click", () => goSlide(idx - 1)); next.addEventListener("click", () => goSlide(idx + 1));
    const mid = el("span", "q-nav-mid"); mid.append(count, el("small", null, "Swipe or use the buttons"));
    nav.append(prev, mid, next);
    let raf = 0, settle = 0;
    track.addEventListener("scroll", () => {
      clearTimeout(settle); settle = setTimeout(fit, 150);   // resize only once scrolling has stopped

      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const w = track.clientWidth + 12, now = Math.max(0, Math.min(slides.length - 1, Math.round(track.scrollLeft / w)));
        if (now === idx) return;   // resizing the track on every frame cancels a smooth scroll
        idx = now; refreshCount();
      });
    }, { passive: true });
    if (window.ResizeObserver) { const ro = new ResizeObserver(fit); slides.forEach((s) => ro.observe(s)); }
    wrap.append(head, prog, nav, track); host.appendChild(wrap);
    refreshCount(); setTimeout(fit, 0);
    if (!total) track.style.height = "auto";
  }

  function flagBar(q, card) {
    const d = el("details", "flag-bar");
    d.appendChild(el("summary", null, "Flag this question"));
    const row = el("div", "flag-buttons");
    const note = el("p", "flag-note", "");
    const NAMES = [["bad", "Bad", "Delete this question"], ["revisit", "Revisit", "Fix this question later"],
      ["useless", "Useless", "Hide this question"], ["important", "Important", "Show it again and again"]];
    const btns = NAMES.map(([k, label, meaning]) => {
      const b = el("button", "pill", label); b.type = "button"; b.title = meaning;
      b.setAttribute("aria-pressed", String(getFlag(q.id) === k));
      b.addEventListener("click", () => {
        const now = getFlag(q.id) === k ? "" : k; setFlag(q.id, now);
        btns.forEach((x) => x.setAttribute("aria-pressed", String(x.dataset.k === now))); b.dataset.k = k;
        note.textContent = now ? NAMES.find((n) => n[0] === now)[2] + (HIDING.includes(now) ? " (hidden next time you open these questions)." : ".") : "Flag removed.";
      });
      b.dataset.k = k; return b;
    });
    row.append(...btns); d.append(row, note);
    return d;
  }

  /* Choose one option, then press "Check answer" to submit it (the quiz works the same way). */
  function pickThenCheck(area, options, onCheck) {
    let chosen = -1;
    const btns = options.map((o, k) => {
      const b = el("button", "opt", o); b.type = "button"; b.setAttribute("aria-pressed", "false");
      b.addEventListener("click", () => {
        chosen = k; check.disabled = false;
        btns.forEach((x) => { x.classList.toggle("on", x === b); x.setAttribute("aria-pressed", String(x === b)); });
      });
      area.appendChild(b); return b;
    });
    const check = el("button", "btn", "Check answer"); check.type = "button"; check.disabled = true;
    check.addEventListener("click", () => {
      if (chosen < 0) return;
      check.disabled = true; btns.forEach((x) => { x.disabled = true; });
      onCheck(chosen, btns);
    });
    area.appendChild(check);
  }

  const KINDS = {
    mcq(q, area, finish) {
      pickThenCheck(area, q.options, (k, btns) => {
        btns.forEach((x, j) => { if (j === q.answer) x.classList.add("right"); });
        if (k !== q.answer) btns[k].classList.add("wrong");
        finish(k === q.answer ? "got" : "miss", (q.optionExplain && q.optionExplain[k]) || q.explain);
      });
    },
    tf(q, area, finish) {
      pickThenCheck(area, ["True", "False"], (k, btns) => {
        const v = k === 0;
        btns[q.answer ? 0 : 1].classList.add("right");
        if (v !== q.answer) btns[k].classList.add("wrong");
        finish(v === q.answer ? "got" : "miss");
      });
    },
    multi(q, area, finish) {
      const boxes = q.options.map((o) => {
        const l = el("label", "opt"); const c = el("input"); c.type = "checkbox"; l.append(c, " " + o); area.appendChild(l); return c;
      });
      const go = el("button", "btn", "Check"); go.type = "button"; area.appendChild(go);
      go.addEventListener("click", () => {
        go.disabled = true; boxes.forEach((c) => (c.disabled = true));
        const chosen = boxes.map((c, k) => c.checked ? k : -1).filter((k) => k >= 0);
        const right = chosen.filter((k) => q.answers.includes(k)).length, wrong = chosen.length - right;
        finish(wrong === 0 && right === q.answers.length ? "got" : wrong === 0 && right > 0 ? "part" : "miss",
          "Correct: " + q.answers.map((k) => q.options[k]).join("; ") + ". " + (q.explain || ""));
      });
    },
    fill(q, area, finish) {
      const input = el("input"); input.type = "text"; const go = el("button", "btn", "Check"); go.type = "button";
      area.append(input, go);
      go.addEventListener("click", () => {
        go.disabled = true; input.disabled = true;
        const ok = q.accept.some((a) => squash(a) === squash(input.value));
        finish(ok ? "got" : "miss", ok ? q.explain : `Accepted answer: ${q.accept[0]}. ${q.explain || ""}`);
      });
    },
    order(q, area, finish) {
      const picked = []; const shown = shuffle(q.items); const out = el("div", "muted small", "Tap the items from first to last.");
      area.appendChild(out);
      shown.forEach((t) => {
        const b = el("button", "opt", t); b.type = "button";
        b.addEventListener("click", () => {
          if (b.disabled) return; b.disabled = true; b.classList.add("on"); picked.push(t); out.textContent = picked.map((p, k) => `${k + 1}. ${p}`).join("  ");
          if (picked.length === q.items.length) { const hit = picked.filter((p, k) => p === q.items[k]).length; finish(hit === q.items.length ? "got" : hit * 2 >= q.items.length ? "part" : "miss", "Correct order: " + q.items.join(" → ")); }
        });
        area.appendChild(b);
      });
    },
    match(q, area, finish) {
      const rights = shuffle(q.pairs.map((p) => p[1])); const sels = q.pairs.map((p) => {
        const row = el("div", "row"); row.appendChild(el("span", null, p[0] + " →"));
        const s = el("select"); s.appendChild(new Option("choose…", ""));
        rights.forEach((r) => s.appendChild(new Option(r, r))); row.appendChild(s); area.appendChild(row); return s;
      });
      const go = el("button", "btn", "Check"); go.type = "button"; area.appendChild(go);
      go.addEventListener("click", () => {
        go.disabled = true; sels.forEach((s) => (s.disabled = true)); const hit = sels.filter((s, k) => s.value === q.pairs[k][1]).length;
        finish(hit === q.pairs.length ? "got" : hit * 2 >= q.pairs.length ? "part" : "miss",
          hit === q.pairs.length ? q.explain : "Pairs: " + q.pairs.map((p) => p[0] + " → " + p[1]).join("; ") + ". " + (q.explain || ""));
      });
    },
    sort(q, area, finish) {
      const picks = q.items.map((it) => {
        const row = el("div", "row"); row.appendChild(el("span", null, it.t));
        const s = el("select"); s.appendChild(new Option("group…", ""));
        q.groups.forEach((g, k) => s.appendChild(new Option(g, String(k)))); row.appendChild(s); area.appendChild(row); return s;
      });
      const go = el("button", "btn", "Check"); go.type = "button"; area.appendChild(go);
      go.addEventListener("click", () => {
        go.disabled = true; picks.forEach((s) => (s.disabled = true)); const hit = picks.filter((s, k) => s.value === String(q.items[k].g)).length;
        finish(hit === q.items.length ? "got" : hit * 2 >= q.items.length ? "part" : "miss",
          hit === q.items.length ? q.explain : "Groups: " + q.items.map((it) => it.t + " → " + q.groups[it.g]).join("; ") + ". " + (q.explain || ""));
      });
    },
    recall(q, area, finish) {
      const show = el("button", "btn ghost", "Show answer"); show.type = "button"; area.appendChild(show);
      show.addEventListener("click", () => {
        show.hidden = true; area.appendChild(el("div", "fb", q.a));
        const row = el("div", "row");
        [["Missed", "miss"], ["Partly", "part"], ["Got it", "got"]].forEach(([t, r]) => {
          const b = el("button", "btn ghost", t); b.type = "button";
          b.addEventListener("click", () => { row.remove(); finish(r, ""); });
          row.appendChild(b);
        });
        area.appendChild(row);
      });
    },
  };

  // ---------------------------------------------------------------- router
  async function route() {
    if (!MANIFEST) return;
    const m = location.hash.match(/^#\/([a-z0-9]+)(?:\/([\w-]+))?/);
    if (m) await showChapter(m[1], m[2]); else { closeDrawers(); showHome(); }
  }

  async function setIconFromCover() {
    const id = MANIFEST.book.cover;
    if (!id) return;
    try { const { url } = await mediaUrl(id); $("#icon").href = url; } catch (e) { /* keep placeholder */ }
  }

  function wireChrome() {
    $("#menu").addEventListener("click", () => ($("#dr-left").classList.contains("open") ? closeDrawers() : openDrawer("left")));
    $("#pagemenu").addEventListener("click", () => ($("#dr-right").classList.contains("open") ? closeDrawers() : openDrawer("right")));
    document.querySelectorAll(".dr-close").forEach((b) => b.addEventListener("click", closeDrawers));
    $("#scrim").addEventListener("click", closeDrawers);
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeDrawers(); });
    $("#kicker").addEventListener("click", () => { location.hash = ""; });
  }

  wireChrome();
  (async () => {
    try {
      await loadShared();
      setUpPanel();
      KEY = await loadKey();
      MANIFEST = await fetchJson("data/manifest.enc");
      window.RecallQuiz.reading.useBook(bookId());
      window.RecallQuizTheme.useBook(bookId());
      loadShow();
      window.__trial.manifestMs = Math.round(performance.now() - T0);
      setIconFromCover();
      window.addEventListener("hashchange", route);
      await route();
      window.__trial.readyMs = Math.round(performance.now() - T0);
      document.body.dataset.ready = "1";
    } catch (e) {
      const again = el("button", "btn", "Try another account"); again.type = "button";
      again.addEventListener("click", () => window.SubjectUnlock.reset());
      app.replaceChildren(el("p", "muted", "Could not unlock: wrong or missing key. " + e.message), again);
    }
  })();
})();
