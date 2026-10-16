/*
 * study-aids.js
 * The Sanskrit cards section of the Settings screen, and what it does to a
 * verse card (a card whose blocks have a "key": reference line, verse,
 * word split, Hindi, English, explanation, memory aids, text note).
 *
 * The reader can switch off every PART of the card, every KIND of memory
 * aid inside the aids part, and choose the font of the verse text. Every
 * part and kind is on by default. The choice is part of the book settings
 * (js/book-settings.js, record.sanskrit), so it is saved per book in this
 * browser and, when the reader is signed in, in the account: the copy
 * changed last wins, on every device. It applies wherever a card is shown
 * (the idea list, Teach me, Keep me going and every session), because
 * they all draw the card with js/rich-content.js.
 *
 * Ids in the saved list: "part:<key>" and "aid:<kind>".
 *
 * How hiding works: the <html> element carries data-hide-parts="hindi
 * note" and data-hide-aids="chain pegs" (what is off) and
 * css/rich-content.css hides the matching elements, so a card that is
 * already open changes at once. An aids block whose items are all hidden
 * is hidden too (applyToBlock). The font is the CSS variable --font-verse
 * on <html>.
 *
 * The section is shown only for a book that has such cards.
 *
 * Older versions kept the aid choice under its own local key
 * "recall-quiz-aids:<bookId>"; it is read once and moved into the
 * settings.
 */
(function setUpStudyAids(quiz) {
  "use strict";

  const LEGACY_KEY_PREFIX = "recall-quiz-aids:";
  const NO_FONT = "";
  /**
   * The parts of a verse card, in card order: [key, name, what it is].
   * The key is the "key" of the card block in questions.json.
   */
  const PARTS = [
    ["ref", "Reference line", "Where the verse comes from and how the text was made"],
    ["verse", "Verse text", "The verse or prose line itself, in Devanagari"],
    ["words", "Word split", "Each word with its meaning; tap a word for its grammar"],
    ["hindi", "Hindi", "The Hindi translation"],
    ["english", "English", "The English translation"],
    ["explain", "Explanation", "A short explanation of what the verse says"],
    ["aids", "Memory aids", "All the aids below; switch single kinds on or off there"],
    ["note", "Text note", "Spelling, joins and doubtful readings in the text"],
  ];
  /**
   * Every kind of memory aid, in the order shown: [id, name, what it is].
   * A card may carry only the kinds that really help for its verse; a
   * kind switched on that no card has shows nothing.
   */
  const KINDS = [
    ["chain", "Chain and order", "Who passed it to whom, as a short chain or initials"],
    ["letters", "First letters", "A list of names held together by their first letters"],
    ["seesaw", "Pairs that answer each other", "यदा–तदा and other matching words"],
    ["sandhi", "Sandhi rule", "The join in the verse as a rule, and where it comes again"],
    ["frame", "Who, to whom, why", "A fixed frame to ask of every verse"],
    ["anchors", "Word families", "Link a new word to a word you already know"],
    ["diagram", "Diagram", "A chain or a ledge picture drawn from words"],
    ["metre", "Metre", "The verse cut into its quarter lines (pāda)"],
    ["chunks", "Rhythm chunks", "The verse said in short beats"],
    ["pegs", "Picture words", "A vivid picture for each key word"],
    ["puns", "Sound-alikes", "A familiar sound that carries the word"],
    ["contrast", "Look-alike pairs", "Two things that are easy to mix up, side by side"],
    ["story", "Story", "The verses as a small story with a cause at each step"],
  ];
  /**
   * Fonts for the verse text: [id, name, CSS family, Google Fonts query].
   * All draw Devanagari and Latin. The first entry is the theme's own.
   */
  const FONTS = [
    [NO_FONT, "Theme font", "", ""],
    ["kalam", "Kalam: handwriting", "Kalam", "Kalam:wght@400;700"],
    ["dekko", "Dekko: pen handwriting", "Dekko", "Dekko"],
    ["baloo", "Baloo 2: round and playful", "Baloo 2", "Baloo+2:wght@400;600"],
    ["amita", "Amita: calligraphy", "Amita", "Amita:wght@400;700"],
    ["inknut", "Inknut Antiqua: manuscript", "Inknut Antiqua",
      "Inknut+Antiqua:wght@400;600"],
    ["sarala", "Sarala: clear and open", "Sarala", "Sarala:wght@400;700"],
    ["noto-serif", "Noto Serif: book type", "Noto Serif Devanagari",
      "Noto+Serif+Devanagari:wght@400;600"],
    ["yatra", "Yatra One: bold display", "Yatra One", "Yatra+One"],
    ["rozha", "Rozha One: heavy serif", "Rozha One", "Rozha+One"],
    ["tillana", "Tillana: flowing", "Tillana", "Tillana:wght@400;600"],
  ];
  const FONT_LINK_PREFIX = "https://fonts.googleapis.com/css2?family=";
  const state = { bookId: "", off: new Set(), font: NO_FONT };
  const root = document.documentElement;
  const loadedFonts = new Set();
  let isBuilt = false;

  /** @param {string[][]} table @returns {string[]} the first column */
  function idsOf(table) {
    return table.map(function first(row) { return row[0]; });
  }

  /** @returns {Set<string>} every id that can be switched off */
  function knownIds() {
    return new Set(idsOf(PARTS).map(function part(id) {
      return "part:" + id;
    }).concat(idsOf(KINDS).map(function aid(id) { return "aid:" + id; })));
  }

  // ------------------------------------------------------------- storage

  /**
   * Read the old, local-only aid choice of this book.
   * @returns {string[]} ids ("aid:<kind>") that were off
   */
  function readLegacyChoice() {
    try {
      const raw = JSON.parse(window.localStorage.getItem(
        LEGACY_KEY_PREFIX + state.bookId));
      if (raw && Array.isArray(raw.off)) {
        return raw.off.map(function prefix(id) { return "aid:" + id; });
      }
    } catch (error) {
      // No usable old choice.
    }
    return [];
  }

  /** Take the choice from the book settings (or from the old key). */
  function load() {
    const saved = quiz.bookSettings.readSanskrit();
    const known = knownIds();
    let off = saved.off;
    if (saved.at === 0) {
      off = readLegacyChoice();
    }
    state.off = new Set(off.filter(function isKnown(id) {
      return known.has(id);
    }));
    state.font = idsOf(FONTS).includes(saved.font) ? saved.font : NO_FONT;
    if (saved.at === 0 && state.off.size) {
      save();
    }
  }

  /** Save the choice in the book settings (and so to the account). */
  function save() {
    quiz.bookSettings.saveSanskrit(
      { off: Array.from(state.off), font: state.font });
  }

  /** @param {string} id  "part:<key>" or "aid:<kind>" @returns {boolean} */
  function isOn(id) {
    return !state.off.has(id);
  }

  // ------------------------------------------------------------ applying

  /**
   * Hide an aids block when the aids part is off or every item is off.
   * @param {HTMLElement} block a card block
   */
  function applyToBlock(block) {
    if (!block.classList.contains("aid-block")) {
      return;
    }
    const items = Array.from(block.querySelectorAll(".aid-item"));
    block.hidden = items.length > 0 && items.every(function off(item) {
      return !isOn("aid:" + item.dataset.aid);
    });
  }

  /** @param {string} id  load the Google font of this choice, once */
  function loadFont(id) {
    const row = FONTS.find(function same(font) { return font[0] === id; });
    if (!row || !row[3] || loadedFonts.has(id)) {
      return;
    }
    loadedFonts.add(id);
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = FONT_LINK_PREFIX + row[3] + "&display=swap";
    document.head.appendChild(link);
  }

  /** Put the verse font on the page. */
  function applyFont() {
    const row = FONTS.find(function same(font) {
      return font[0] === state.font;
    });
    if (row && row[2]) {
      loadFont(row[0]);
      root.style.setProperty("--font-verse",
        '"' + row[2] + '", "Noto Sans Devanagari", "Nirmala UI", ' +
        'Mangal, serif');
    } else {
      root.style.removeProperty("--font-verse");
    }
  }

  /** Put the whole choice on the page. */
  function applyAll() {
    const offOf = function offOf(prefix) {
      return Array.from(state.off).filter(function mine(id) {
        return id.startsWith(prefix);
      }).map(function bare(id) { return id.slice(prefix.length); });
    };
    root.setAttribute("data-hide-parts", offOf("part:").join(" "));
    root.setAttribute("data-hide-aids", offOf("aid:").join(" "));
    document.querySelectorAll(".aid-block").forEach(applyToBlock);
    applyFont();
    refreshSettings();
  }

  /**
   * Switch one part or kind on or off.
   * @param {string} id
   * @param {boolean} on
   */
  function setItem(id, on) {
    if (on) {
      state.off.delete(id);
    } else {
      state.off.add(id);
    }
    save();
    applyAll();
  }

  /**
   * Switch every part and kind of one table on or off.
   * @param {string} prefix  "part:" or "aid:"
   * @param {boolean} on
   */
  function setAllOf(prefix, on) {
    const table = prefix === "part:" ? PARTS : KINDS;
    idsOf(table).forEach(function each(id) {
      if (on) {
        state.off.delete(prefix + id);
      } else {
        state.off.add(prefix + id);
      }
    });
    save();
    applyAll();
  }

  /** @param {string} id  choose a verse font */
  function setFont(id) {
    state.font = id;
    save();
    applyAll();
  }

  // ------------------------------------------------------------ settings

  /**
   * One row with a label and a Show / Hide choice.
   * @param {string} id  "part:<key>" or "aid:<kind>"
   * @param {string} name
   * @param {string} help
   * @returns {HTMLElement}
   */
  function createToggleRow(id, name, help) {
    const row = document.createElement("div");
    row.className = "setting-row";
    const label = document.createElement("div");
    label.className = "setting-label";
    label.appendChild(Object.assign(document.createElement("b"),
      { textContent: name }));
    label.appendChild(Object.assign(document.createElement("small"),
      { textContent: help }));
    const group = document.createElement("div");
    group.className = "choice-group";
    group.dataset.sanskrit = id;
    [["show", "Show"], ["hide", "Hide"]].forEach(function add(pair) {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.value = pair[0];
      button.textContent = pair[1];
      button.addEventListener("click", function choose() {
        setItem(id, pair[0] === "show");
      });
      group.appendChild(button);
    });
    row.appendChild(label);
    row.appendChild(group);
    return row;
  }

  /**
   * Fill one list of rows.
   * @param {string} elementId  the container
   * @param {string} prefix  "part:" or "aid:"
   * @param {string[][]} table
   */
  function buildList(elementId, prefix, table) {
    const list = document.getElementById(elementId);
    if (!list || list.children.length) {
      return;
    }
    table.forEach(function add(row) {
      list.appendChild(createToggleRow(prefix + row[0], row[1], row[2]));
    });
  }

  /** The sample shown under the font choice: Devanagari and Latin, in
   *  regular, semibold and bold (a font without a weight shows the nearest
   *  one it has). */
  const SAMPLE_ROWS = [
    ["Regular", 400, "धर्मार्थकाममोक्षाणामारोग्यं मूलमुत्तमम्"],
    ["Semibold", 600, "अथातो दीर्घञ्जीवितीयमध्यायं व्याख्यास्यामः"],
    ["Bold", 700, "चरकसंहिता · सूत्रस्थान · Charaka 123"],
  ];

  /** Show the sample in the chosen font. */
  function drawPreview() {
    const box = document.getElementById("sanskrit-font-preview");
    if (!box) {
      return;
    }
    const row = FONTS.find(function same(font) {
      return font[0] === state.font;
    });
    loadFont(state.font);
    box.style.setProperty("--preview-font", row && row[2] ?
      '"' + row[2] + '", "Noto Sans Devanagari", "Nirmala UI", serif' :
      "var(--font-heading)");
    if (box.children.length) {
      return;
    }
    SAMPLE_ROWS.forEach(function add(sample) {
      const line = document.createElement("div");
      line.className = "font-preview-row";
      line.appendChild(Object.assign(document.createElement("small"),
        { textContent: sample[0] }));
      const text = document.createElement("span");
      text.lang = "sa";
      text.style.fontWeight = String(sample[1]);
      text.textContent = sample[2];
      line.appendChild(text);
      box.appendChild(line);
    });
  }

  /** Fill the font dropdown. */
  function buildFonts() {
    const select = document.getElementById("sanskrit-font-choice");
    if (!select || select.options.length) {
      return;
    }
    FONTS.forEach(function add(font) {
      select.appendChild(Object.assign(document.createElement("option"),
        { value: font[0], textContent: font[1] }));
    });
    select.addEventListener("change", function choose() {
      setFont(select.value);
    });
  }

  /** Wire the Show all / Hide all buttons. */
  function buildAllButtons() {
    [["sanskrit-parts-all", "part:", true], ["sanskrit-parts-none", "part:", false],
      ["sanskrit-aids-all", "aid:", true], ["sanskrit-aids-none", "aid:", false],
    ].forEach(function wire(item) {
      const button = document.getElementById(item[0]);
      if (button) {
        button.addEventListener("click", function choose() {
          setAllOf(item[1], item[2]);
        });
      }
    });
  }

  /** Draw the section (once). */
  function buildSettings() {
    if (isBuilt) {
      return;
    }
    isBuilt = true;
    buildList("sanskrit-parts-list", "part:", PARTS);
    buildList("sanskrit-aids-list", "aid:", KINDS);
    buildFonts();
    buildAllButtons();
  }

  /** Show the chosen buttons and the "n of m on" summary. */
  function refreshSettings() {
    document.querySelectorAll("[data-sanskrit]").forEach(function mark(g) {
      const on = isOn(g.dataset.sanskrit);
      g.querySelectorAll("button").forEach(function press(button) {
        button.setAttribute("aria-pressed",
          String((button.dataset.value === "show") === on));
      });
    });
    const select = document.getElementById("sanskrit-font-choice");
    if (select) {
      select.value = state.font;
    }
    drawPreview();
    const current = document.getElementById("sanskrit-section-current");
    if (current) {
      const total = PARTS.length + KINDS.length;
      const count = total - state.off.size;
      current.textContent = count === total ? "All on" :
        count + " of " + total + " on";
    }
  }

  /**
   * @returns {boolean} true when the open book has cards with Sanskrit
   *   parts (a block with a "key") or memory aids
   */
  function bookHasSanskritCards() {
    const data = quiz.book.data;
    const concepts = (data && data.concepts) || [];
    return concepts.some(function check(concept) {
      const blocks = (concept.card && concept.card.blocks) || [];
      return blocks.some(function sanskrit(block) {
        return Boolean(block.key || block.aids);
      });
    });
  }

  /** Show the section only for a book that has such cards. */
  function showSectionIfNeeded() {
    const section = document.getElementById("sanskrit-section");
    if (section) {
      section.classList.toggle("hidden", !bookHasSanskritCards());
    }
  }

  /** The book was opened, or its settings arrived from the account. */
  function useSettings() {
    state.bookId = quiz.book.bookId();
    load();
    buildSettings();
    showSectionIfNeeded();
    applyAll();
  }

  document.addEventListener("recallquiz:book-opened", useSettings);
  document.addEventListener("recallquiz:book-settings-applied", useSettings);

  quiz.studyAids = { parts: PARTS, kinds: KINDS, fonts: FONTS, isOn, setItem,
                     setFont, applyToBlock, applyAll };
})(window.RecallQuiz = window.RecallQuiz || {});
