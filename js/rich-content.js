/*
 * rich-content.js
 * The extra things a card or question can show in template v2: a code
 * block, labelled blocks, pictures and clips, and a genre chip. All text
 * is added as text, never as HTML.
 *
 * questions.json fields (all optional, older banks do not use them):
 *   concept.genre            short label, for example "Algorithms"
 *   card.blocks              [{ label, text, code, lang, media, study,
 *                                lines, words }]
 *   block.study              true marks a verse-study block (own colours)
 *   block.key                which part of a Sanskrit card this is (ref,
 *                            verse, words, hindi, english, explain, aids,
 *                            note); Settings can hide each part
 *   block.lines              ["line", ...] shown one per line (verse text)
 *   block.words              [[{ w, gloss, gram }, ...], ...] one list of
 *                            word chips per verse line; tap shows gram
 *   card.media               [{ id, alt, role, type }] shown under the card text
 *   cover                    one media entry (role "cover"), shown by the title
 *   question.code, .lang     a code listing under the question
 *   question.media, block.media
 *                            [{ id, alt, role, type }] see media-store.js
 * A picture whose file cannot be opened shows its text alternative, so a
 * question is always answerable from the words.
 */
(function setUpRichContent(quiz) {
  "use strict";

  const { createElement } = quiz.helpers;
  const SHOW_GRAMMAR = "Show all grammar";
  const HIDE_GRAMMAR = "Hide grammar";

  /**
   * A code listing.
   * @param {string} code
   * @param {string} [lang]
   * @returns {HTMLElement}
   */
  function createCode(code, lang) {
    const block = createElement("pre", "code-block");
    if (lang) {
      block.setAttribute("data-lang", lang);
    }
    block.appendChild(createElement("code", null, code));
    return block;
  }

  /**
   * Put a loaded address into a figure, as a picture or a clip.
   * @param {HTMLElement} figure
   * @param {object} entry
   * @param {string} url
   */
  function fillFigure(figure, entry, url) {
    const isClip = /^video\//.test(entry.type || "");
    const shown = createElement(isClip ? "video" : "img", "media-item");
    shown.src = url;
    if (isClip) {
      shown.controls = true;
      shown.muted = true;
      shown.loop = true;
      shown.playsInline = true;
    } else {
      shown.alt = entry.role === "decorative" ? "" : entry.alt || "";
      shown.loading = "lazy";
    }
    figure.classList.remove("is-loading");
    figure.classList.add("is-ready");
    figure.insertBefore(shown, figure.firstChild);
  }

  /**
   * One figure. It starts with its text alternative and swaps in the
   * picture when it has loaded.
   * @param {object} entry
   * @returns {HTMLElement}
   */
  function createFigure(entry) {
    const figure = createElement("figure", "media-figure is-loading");
    figure.setAttribute("data-role", entry.role || "figure");
    figure.appendChild(createElement("figcaption", "media-alt",
      entry.alt || ""));
    openFigure(figure, entry);
    document.addEventListener("recallquiz:media-key-changed",
      function retry() {
        if (!figure.isConnected) {
          return;
        }
        if (!figure.querySelector(".media-item")) {
          figure.classList.remove("is-missing");
          figure.classList.add("is-loading");
          const old = figure.querySelector(".media-reason");
          if (old) {
            old.remove();
          }
          openFigure(figure, entry);
        }
      });
    return figure;
  }

  /**
   * Load a figure's file; show it, or leave the words if there is none.
   * @param {HTMLElement} figure
   * @param {object} entry
   */
  function openFigure(figure, entry) {
    quiz.media.load(entry).then(function show(url) {
      if (url) {
        if (!figure.querySelector(".media-item")) {
          fillFigure(figure, entry, url);
        }
      } else {
        figure.classList.remove("is-loading");
        figure.classList.add("is-missing");
        showReason(figure, entry);
      }
    });
  }

  /**
   * Say, under the words, why the picture did not open.
   * @param {HTMLElement} figure
   * @param {object} entry
   */
  function showReason(figure, entry) {
    const old = figure.querySelector(".media-reason");
    if (old) {
      old.remove();
    }
    const reason = quiz.media.reasonFor ? quiz.media.reasonFor(entry.id) : "";
    if (reason) {
      figure.appendChild(createElement("small", "media-reason", reason));
    }
  }

  /**
   * All the figures of a list.
   * @param {object[]} entries
   * @returns {HTMLElement}
   */
  function createMedia(entries) {
    const wrap = createElement("div", "media-list");
    entries.forEach(function add(entry) {
      if (entry.role !== "decorative") {
        wrap.appendChild(createFigure(entry));
      }
    });
    return wrap;
  }

  /**
   * Show the book's cover next to its title, when the bank has one and it
   * can be opened. With no key or no file the cover stays hidden.
   * @param {object|undefined} entry  bank.cover
   */
  function showCover(entry) {
    const image = document.getElementById("book-cover");
    if (!image) {
      return;
    }
    image.classList.add("hidden");
    if (!entry) {
      return;
    }
    quiz.media.load(entry).then(function show(url) {
      if (url) {
        image.src = url;
        image.alt = entry.alt || "";
        image.classList.remove("hidden");
      }
    });
  }

  document.addEventListener("recallquiz:media-key-changed", function again() {
    if (quiz.book && quiz.book.data) {
      showCover(quiz.book.data.cover);
    }
  });

  /**
   * Add a thing's code and pictures to an element.
   * @param {HTMLElement} parent
   * @param {object} thing  a question or a block
   */
  function appendExtras(parent, thing) {
    if (thing.code) {
      parent.appendChild(createCode(thing.code, thing.lang));
    }
    if (thing.media && thing.media.length) {
      parent.appendChild(createMedia(thing.media));
    }
  }

  /**
   * The lines of a verse, one paragraph per line.
   * @param {string[]} lines
   * @returns {HTMLElement}
   */
  function createVerseLines(lines) {
    const verse = createElement("div", "verse-lines");
    lines.forEach(function addLine(line) {
      verse.appendChild(createElement("p", "verse-line", line));
    });
    return verse;
  }

  /**
   * One word chip: the word, its meaning, and its grammar on tap.
   * @param {{w: string, gloss: string, gram: string}} word
   * @returns {HTMLElement}
   */
  function createWordChip(word) {
    const chip = createElement("button", "word-chip");
    chip.type = "button";
    chip.setAttribute("aria-expanded", "false");
    chip.appendChild(createElement("b", "word-form", word.w));
    chip.appendChild(createElement("span", "word-gloss", word.gloss));
    chip.appendChild(createElement("small", "word-gram", word.gram || ""));
    chip.addEventListener("click", function toggleGrammar() {
      const open = chip.classList.toggle("is-open");
      chip.setAttribute("aria-expanded", String(open));
    });
    return chip;
  }

  /**
   * A button that shows or hides the grammar of every chip in a list.
   * @param {HTMLElement} list the element that holds the chips
   * @returns {HTMLElement}
   */
  function createGrammarToggle(list) {
    const button = createElement("button", "grammar-toggle",
      SHOW_GRAMMAR);
    button.type = "button";
    button.setAttribute("aria-pressed", "false");
    button.addEventListener("click", function toggleAll() {
      const show = button.getAttribute("aria-pressed") !== "true";
      button.setAttribute("aria-pressed", String(show));
      button.textContent = show ? HIDE_GRAMMAR : SHOW_GRAMMAR;
      list.querySelectorAll(".word-chip").forEach(function set(chip) {
        chip.classList.toggle("is-open", show);
        chip.setAttribute("aria-expanded", String(show));
      });
    });
    return button;
  }

  /**
   * Word chips for a verse, one row per verse line, with a button that
   * shows all the grammar at once.
   * @param {object[][]} rows
   * @returns {HTMLElement}
   */
  function createWordRows(rows) {
    const list = createElement("div", "word-rows");
    rows.forEach(function addRow(row) {
      const line = createElement("div", "word-row");
      row.forEach(function addWord(word) {
        line.appendChild(createWordChip(word));
      });
      list.appendChild(line);
    });
    const wrapper = createElement("div", "word-list");
    wrapper.appendChild(createGrammarToggle(list));
    wrapper.appendChild(list);
    return wrapper;
  }

  /**
   * The memory aids of a block: one labelled item per aid, each marked
   * with its kind (data-aid) so Settings can switch the kind off.
   * @param {object[]} aids
   * @returns {HTMLElement}
   */
  function createAids(aids) {
    const list = createElement("div", "aid-list");
    aids.forEach(function addAid(aid) {
      const item = createElement("div", "aid-item");
      item.dataset.aid = aid.aid;
      item.appendChild(createElement("small", "aid-label", aid.label));
      if (aid.text) {
        item.appendChild(createElement("p", "aid-text", aid.text));
      }
      if (aid.steps) {
        const steps = createElement("ol", "aid-steps");
        aid.steps.forEach(function addStep(step) {
          steps.appendChild(createElement("li", null, step));
        });
        item.appendChild(steps);
      }
      if (aid.groups) {
        const tiers = createElement("div", "aid-tiers");
        aid.groups.forEach(function addTier(group, index) {
          const tier = createElement("div", "aid-tier");
          tier.dataset.tier = String(index);
          tier.appendChild(createElement("b", null, group.label));
          tier.appendChild(createElement("span", null,
            group.items.join(" · ")));
          tiers.appendChild(tier);
        });
        item.appendChild(tiers);
      }
      if (aid.lines) {
        aid.lines.forEach(function addLine(line) {
          item.appendChild(createElement("p", "aid-line", line));
        });
      }
      if (aid.image) {
        const picture = createElement("img", "aid-image");
        picture.src = aid.image.src;
        picture.alt = aid.image.alt;
        picture.loading = "lazy";
        item.appendChild(picture);
      }
      list.appendChild(item);
    });
    return list;
  }

  /**
   * The labelled blocks of a card.
   * @param {object[]} blocks
   * @returns {HTMLElement[]}
   */
  function createBlocks(blocks) {
    return blocks.map(function build(block) {
      const element = createElement("div", "idea-block");
      if (block.study) {
        element.classList.add("is-study");
      }
      if (block.key) {
        element.dataset.part = block.key;
      }
      element.appendChild(createElement("b", "idea-block-label",
        block.label));
      if (block.lines) {
        element.appendChild(createVerseLines(block.lines));
      }
      if (block.words) {
        element.appendChild(createWordRows(block.words));
      }
      if (block.text) {
        element.appendChild(createElement("p", null, block.text));
      }
      if (block.aids) {
        element.classList.add("aid-block");
        element.appendChild(createAids(block.aids));
      }
      appendExtras(element, block);
      if (block.aids && quiz.studyAids) {
        quiz.studyAids.applyToBlock(element);
      }
      return element;
    });
  }

  /**
   * The chip that names the kind of book, or null.
   * @param {object} concept
   * @returns {HTMLElement|null}
   */
  function createGenreChip(concept) {
    const genre = concept.genre || (quiz.book.data && quiz.book.data.genre);
    return genre ? createElement("span", "idea-genre", genre) : null;
  }

  quiz.rich = { createCode, createMedia, appendExtras, createBlocks, showCover,
                createGenreChip };
})(window.RecallQuiz = window.RecallQuiz || {});
