/*
 * rich-content.js
 * The extra things a card or question can show in template v2: a code
 * block, labelled blocks, pictures and clips, and a genre chip. All text
 * is added as text, never as HTML.
 *
 * questions.json fields (all optional, older banks do not use them):
 *   concept.genre            short label, for example "Algorithms"
 *   card.blocks              [{ label, text, code, lang, media }]
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
   * The labelled blocks of a card.
   * @param {object[]} blocks
   * @returns {HTMLElement[]}
   */
  function createBlocks(blocks) {
    return blocks.map(function build(block) {
      const element = createElement("div", "idea-block");
      element.appendChild(createElement("b", "idea-block-label",
        block.label));
      if (block.text) {
        element.appendChild(createElement("p", null, block.text));
      }
      appendExtras(element, block);
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
