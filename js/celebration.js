/*
 * celebration.js
 * A small burst of confetti for right answers and good results.
 * The confetti uses the current theme's colours. Readers who ask for
 * less motion get no confetti.
 */
(function setUpCelebration(quiz) {
  "use strict";

  const THEME_COLOUR_VARIABLES = [
    "--color-pop-1",
    "--color-pop-2",
    "--color-pop-3",
    "--color-pop-4",
    "--color-accent",
  ];
  const FALLBACK_COLOURS = ["#ff5d73", "#12b5a6", "#7c5cff"];
  const DEFAULT_PIECE_COUNT = 16;

  /**
   * Throw confetti out from an element.
   * @param {HTMLElement} element  where the burst starts
   * @param {number} [pieceCount]  how many pieces (default 16)
   */
  function celebrate(element, pieceCount) {
    if (quiz.helpers.prefersReducedMotion()) {
      return;
    }
    const colours = currentThemeColours();
    const startPoint = burstStartPoint(element);
    const count = pieceCount || DEFAULT_PIECE_COUNT;
    for (let pieceNumber = 0; pieceNumber < count; pieceNumber++) {
      const colour = colours[pieceNumber % colours.length];
      launchPiece(startPoint, colour);
    }
  }

  /** @returns {string[]} the theme's accent colours */
  function currentThemeColours() {
    const styles = getComputedStyle(document.documentElement);
    const colours = THEME_COLOUR_VARIABLES
      .map(function readVariable(name) {
        return styles.getPropertyValue(name).trim();
      })
      .filter(Boolean);
    return colours.length ? colours : FALLBACK_COLOURS;
  }

  /**
   * The point the confetti flies out from: the left part of the element,
   * halfway down.
   * @param {HTMLElement} element
   * @returns {{x: number, y: number}}
   */
  function burstStartPoint(element) {
    const box = element.getBoundingClientRect();
    return {
      x: box.left + Math.min(box.width / 2, 60),
      y: box.top + box.height / 2,
    };
  }

  /**
   * Send one piece of confetti flying in a random direction.
   * @param {{x: number, y: number}} startPoint
   * @param {string} colour
   */
  function launchPiece(startPoint, colour) {
    const piece = quiz.helpers.createElement("div", "confetti-piece");
    piece.style.left = startPoint.x + "px";
    piece.style.top = startPoint.y + "px";
    piece.style.background = colour;
    document.body.appendChild(piece);

    const angle = Math.random() * 2 * Math.PI;
    const distance = 50 + Math.random() * 70;
    const moveX = Math.cos(angle) * distance;
    const moveY = Math.sin(angle) * distance + 20;   // a little gravity
    const flight = piece.animate(
      [
        { transform: "translate(0,0) scale(1)", opacity: 1 },
        {
          transform: `translate(${moveX}px,${moveY}px) scale(.2)`,
          opacity: 0,
        },
      ],
      {
        duration: 650 + Math.random() * 250,
        easing: "cubic-bezier(.2,.8,.3,1)",
      }
    );
    flight.onfinish = function removePiece() {
      piece.remove();
    };
  }

  quiz.celebrate = celebrate;
})((window.RecallQuiz = window.RecallQuiz || {}));
