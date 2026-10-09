/*
 * helpers.js
 * Small tools the other files share: finding and creating page elements,
 * shuffling, and wording counts ("1 question", "3 questions").
 *
 * Every script adds its part to one shared object, window.RecallQuiz,
 * so nothing leaks into the global scope except that one name.
 */
(function setUpHelpers(quiz) {
  "use strict";

  /**
   * Find an element on the page by its id.
   * @param {string} id
   * @returns {HTMLElement}
   */
  function findElement(id) {
    return document.getElementById(id);
  }

  /**
   * Create an element with an optional class name and text.
   * @param {string} tagName  e.g. "div", "button"
   * @param {string} [className]  one or more classes, space separated
   * @param {string} [text]  plain text content (never parsed as HTML)
   * @returns {HTMLElement}
   */
  function createElement(tagName, className, text) {
    const element = document.createElement(tagName);
    if (className) {
      element.className = className;
    }
    if (text !== undefined && text !== null) {
      element.textContent = text;
    }
    return element;
  }

  /**
   * Create a <button> that runs a function when clicked.
   * @param {string} label  the text on the button
   * @param {string} className  e.g. "button primary"
   * @param {Function} [onClick]
   * @returns {HTMLButtonElement}
   */
  function createButton(label, className, onClick) {
    const button = createElement("button", className, label);
    button.type = "button";
    if (onClick) {
      button.addEventListener("click", onClick);
    }
    return button;
  }

  /**
   * Create the main "Check ..." button used by most question types.
   * It gets a tick icon instead of the usual arrow.
   * @param {string} label  e.g. "Check order"
   * @param {Function} onClick
   * @returns {HTMLButtonElement}
   */
  function createCheckButton(label, onClick) {
    return createButton(label, "button primary is-check", onClick);
  }

  /**
   * Create a paragraph from a mix of plain text and bold parts.
   * Example: createParagraph("note", ["Reread ", {bold: "Chapter 2"}])
   * @param {string} className
   * @param {Array<string|{bold: string}>} parts
   * @returns {HTMLParagraphElement}
   */
  function createParagraph(className, parts) {
    const paragraph = createElement("p", className);
    parts.forEach(function addPart(part) {
      if (typeof part === "string") {
        paragraph.appendChild(document.createTextNode(part));
      } else {
        paragraph.appendChild(createElement("b", null, part.bold));
      }
    });
    return paragraph;
  }

  /**
   * Make a shuffled copy of a list. The original list is not changed.
   * (Fisher-Yates shuffle.)
   * @template T
   * @param {T[]} list
   * @returns {T[]}
   */
  function shuffledCopy(list) {
    const copy = list.slice();
    for (let index = copy.length - 1; index > 0; index--) {
      const swapWith = Math.floor(Math.random() * (index + 1));
      const kept = copy[index];
      copy[index] = copy[swapWith];
      copy[swapWith] = kept;
    }
    return copy;
  }

  /**
   * Word a count: countWithWord(1, "day") is "1 day",
   * countWithWord(3, "day") is "3 days".
   * @param {number} count
   * @param {string} singular
   * @param {string} [plural]  defaults to singular + "s"
   * @returns {string}
   */
  function countWithWord(count, singular, plural) {
    const word = count === 1 ? singular : plural || singular + "s";
    return count + " " + word;
  }

  /**
   * Round to one decimal place and drop a trailing ".0".
   * @param {number} value
   * @returns {string}  e.g. "7.5", "8"
   */
  function formatOneDecimal(value) {
    return String(Math.round(value * 10) / 10);
  }

  /**
   * Read a whole number from an input box.
   * @param {string} inputId
   * @param {number} fallback  used when the box is empty, zero or not a
   *   number
   * @returns {number}
   */
  function readWholeNumber(inputId, fallback) {
    const value = parseInt(findElement(inputId).value, 10);
    return value || fallback;
  }

  /**
   * True when the reader has asked their device for less motion.
   * @returns {boolean}
   */
  function prefersReducedMotion() {
    return Boolean(
      window.matchMedia &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches
    );
  }

  quiz.helpers = {
    findElement,
    createElement,
    createButton,
    createCheckButton,
    createParagraph,
    shuffledCopy,
    countWithWord,
    formatOneDecimal,
    readWholeNumber,
    prefersReducedMotion,
  };
})((window.RecallQuiz = window.RecallQuiz || {}));
