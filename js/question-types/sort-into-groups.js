/*
 * sort-into-groups.js
 * "sort": tap an item, then tap the group it belongs to.
 *
 * questions.json:
 *   "groups": ["First group", "Second group"],
 *   "items": [{"t": "item text", "g": 0}, ...]   (g = group index)
 *
 * All items in the right group is "got", at least half is "part".
 */
(function setUpSortIntoGroups(quiz) {
  "use strict";

  const { createElement, createButton, createCheckButton, shuffledCopy } =
    quiz.helpers;

  /**
   * Draw this question type and wait for the answer.
   * @param {object} question
   * @param {object} card
   */
  function showSortIntoGroups(question, card) {
    // placedIn is the group the reader put the item in (null = not yet).
    const items = shuffledCopy(question.items.map(function toSortItem(item) {
      return { text: item.t, rightGroup: item.g, placedIn: null };
    }));
    let selectedItem = null;
    let isChecked = false;

    const pool = createElement("div", "sort-pool");
    const groupItemAreas = question.groups.map(function createItemArea() {
      return createElement("div", "sort-group-items");
    });
    const groupsGrid = createElement("div", "sort-groups");
    const actions = createElement("div", "actions");
    const checkButton = createCheckButton("Check groups",
      function checkByClick() {
        checkGroups(false);
      });
    checkButton.disabled = true;
    actions.appendChild(checkButton);

    question.groups.forEach(function addGroup(groupName, groupIndex) {
      const group = createElement("div", "sort-group");
      group.appendChild(createButton(groupName, "sort-group-head",
        function dropSelectedItemHere() {
          if (!isChecked && selectedItem) {
            selectedItem.placedIn = groupIndex;
            selectedItem = null;
            redraw();
          }
        }));
      group.appendChild(groupItemAreas[groupIndex]);
      groupsGrid.appendChild(group);
    });

    card.answerArea.appendChild(createElement("p", "note",
      "Tap an item, then tap the group it belongs to. " +
      "Tap a placed item to take it back."));
    card.answerArea.appendChild(pool);
    card.answerArea.appendChild(groupsGrid);
    card.answerArea.appendChild(actions);

    /**
     * Where an item is currently shown: the pool or its group.
     * @param {object} item
     * @returns {HTMLElement}
     */
    function areaFor(item) {
      return item.placedIn === null ? pool : groupItemAreas[item.placedIn];
    }

    /** Tapping an item selects it, or takes it back out of its group. */
    function tapItem(item) {
      if (isChecked) {
        return;
      }
      if (item.placedIn !== null) {
        item.placedIn = null;
        selectedItem = null;
      } else {
        selectedItem = selectedItem === item ? null : item;
      }
      redraw();
    }

    /** Draw every item in the pool or in its group. */
    function redraw() {
      clearAllAreas(pool, groupItemAreas);
      items.forEach(function drawItem(item) {
        const isSelected = selectedItem === item;
        areaFor(item).appendChild(createButton(item.text,
          "sort-chip" + (isSelected ? " is-selected" : ""),
          function onTap() {
            tapItem(item);
          }));
      });
      if (!pool.children.length) {
        pool.appendChild(createElement("div", "placeholder-hint",
          "All placed. Check your groups."));
      }
      checkButton.disabled = items.some(isNotPlaced);
    }

    /**
     * Mark the answer and show the result (once only).
     * @param {boolean} timedOut  the timer ran out
     */
    function checkGroups(timedOut) {
      if (isChecked) {
        return;
      }
      isChecked = true;
      actions.remove();
      const placedEverything = !items.some(isNotPlaced);
      const corrections = createElement("div", "correction");
      clearAllAreas(pool, groupItemAreas);
      let rightCount = 0;
      items.forEach(function drawMarkedItem(item) {
        const isRight = item.placedIn === item.rightGroup;
        if (isRight) {
          rightCount += 1;
        }
        areaFor(item).appendChild(createElement("div",
          "sort-chip " + (isRight ? "is-right" : "is-wrong"), item.text));
        if (!isRight) {
          corrections.appendChild(createElement("p", "correction-line",
            "“" + item.text + "” belongs under " +
            question.groups[item.rightGroup] + "."));
        }
      });
      let result = quiz.questionTypes.resultFromCount(rightCount,
        items.length);
      if (timedOut && !placedEverything) {
        result = "miss";
      }
      card.showResult(result, {
        timedOut,
        extraContent: corrections.children.length ? corrections : null,
      });
    }

    redraw();
    card.setKeyHint("Keys: Enter to check");
    card.setKeyHandler(function checkWithEnter(event) {
      if (event.key === "Enter" && !checkButton.disabled) {
        checkGroups(false);
      }
    });
    card.setTimeUpHandler(function checkWhatIsPlaced() {
      checkGroups(true);
    });
  }

  /**
   * True if the reader has not put this item in a group yet.
   * @param {object} item
   * @returns {boolean}
   */
  function isNotPlaced(item) {
    return item.placedIn === null;
  }

  /**
   * Empty the pool and every group.
   * @param {HTMLElement} pool
   * @param {HTMLElement[]} groupItemAreas
   */
  function clearAllAreas(pool, groupItemAreas) {
    pool.textContent = "";
    groupItemAreas.forEach(function clearArea(area) {
      area.textContent = "";
    });
  }

  quiz.questionTypes.register("sort", {
    label: "Sort into groups",
    show: showSortIntoGroups,
  });
})((window.RecallQuiz = window.RecallQuiz || {}));
