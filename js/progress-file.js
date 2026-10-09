/*
 * progress-file.js
 * The "Your progress file" panel: download a backup, load one (for
 * example on another device), or erase everything.
 */
(function setUpProgressFile(quiz) {
  "use strict";

  const { findElement } = quiz.helpers;

  /** Save the progress as a .json file the reader can keep. */
  function downloadProgress() {
    const text = JSON.stringify(quiz.progress.saved);
    const file = new Blob([text], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(file);
    link.download = quiz.book.bookId() + "-progress.json";
    link.click();
  }

  /** Ask the reader to pick a backup file. */
  function chooseBackupFile() {
    findElement("progress-file-input").click();
  }

  /**
   * Read the picked backup and use it, if it is one of ours.
   * @param {Event} event  the file input's change event
   */
  function loadBackupFile(event) {
    const input = event.target;
    const file = input.files[0];
    if (!file) {
      return;
    }
    const reader = new FileReader();
    reader.onload = function useBackup() {
      try {
        const backup = JSON.parse(reader.result);
        if (!quiz.progress.looksLikeProgress(backup)) {
          throw new Error("not a progress backup");
        }
        // Stamped like a reset, so with cloud sync the backup replaces
        // the account copy instead of being merged into it.
        backup.resetAt = Date.now();
        quiz.progress.replaceProgress(backup);
        quiz.homeScreen.refresh();
        alert("Progress loaded.");
      } catch (problem) {
        alert("That file is not a progress backup from this quiz.");
      }
      input.value = "";   // so the same file can be picked again
    };
    reader.readAsText(file);
  }

  /** Erase all progress for this book, after asking. */
  function resetProgress() {
    if (confirm("Erase all progress for this book?")) {
      quiz.progress.eraseProgress();
      quiz.homeScreen.refresh();
    }
  }

  findElement("download-progress-button")
    .addEventListener("click", downloadProgress);
  findElement("load-progress-button")
    .addEventListener("click", chooseBackupFile);
  findElement("progress-file-input")
    .addEventListener("change", loadBackupFile);
  findElement("reset-progress-button")
    .addEventListener("click", resetProgress);
})((window.RecallQuiz = window.RecallQuiz || {}));
