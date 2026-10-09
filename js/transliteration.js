/*
 * transliteration.js
 * Turns Devanagari and Sanskrit (IAST) spellings into one plain
 * lower-case Roman form, so typed answers can be compared fairly:
 * "धर्म", "dharma", "Dharma" and "dharmā" all become "dharma".
 *
 * Used by the fill-in-the-blank type. Text that has no Devanagari or
 * diacritics passes through unchanged (apart from lower-casing).
 */
(function setUpTransliteration(quiz) {
  "use strict";

  const CONSONANTS = {
    "क": "k", "ख": "kh", "ग": "g", "घ": "gh", "ङ": "n",
    "च": "c", "छ": "ch", "ज": "j", "झ": "jh", "ञ": "n",
    "ट": "t", "ठ": "th", "ड": "d", "ढ": "dh", "ण": "n",
    "त": "t", "थ": "th", "द": "d", "ध": "dh", "न": "n",
    "प": "p", "फ": "ph", "ब": "b", "भ": "bh", "म": "m",
    "य": "y", "र": "r", "ल": "l", "व": "v",
    "श": "sh", "ष": "sh", "स": "s", "ह": "h",
    "ळ": "l", "क्ष": "ksh", "ज्ञ": "gy",
  };
  const INDEPENDENT_VOWELS = {
    "अ": "a", "आ": "a", "इ": "i", "ई": "i", "उ": "u", "ऊ": "u",
    "ऋ": "ri", "ॠ": "ri", "ऌ": "li", "ए": "e", "ऐ": "ai",
    "ओ": "o", "औ": "au", "ऑ": "o", "ऍ": "e",
  };
  const VOWEL_SIGNS = {
    "ा": "a", "ि": "i", "ी": "i", "ु": "u", "ू": "u",
    "ृ": "ri", "ॄ": "ri", "ॢ": "li", "े": "e", "ै": "ai",
    "ो": "o", "ौ": "au", "ॉ": "o", "ॅ": "e",
  };
  const VIRAMA = "्";
  const NUKTA = "़";
  const ENDINGS = { "ं": "m", "ँ": "m", "ः": "h" };
  const IGNORED = /[ऽ।॥॰]/g;
  const DIGIT_ZERO = 0x966;

  /** Latin letters with dots or marks, mapped to plain spellings. */
  const LATIN_FOLDS = [
    [/[śṣ]/g, "sh"], [/ṛ|ṝ/g, "ri"], [/ḷ|ḹ/g, "li"],
    [/[ṃṁ]/g, "m"], [/ḥ/g, "h"],
    [/ṅ|ñ|ṇ/g, "n"], [/ṭ/g, "t"], [/ḍ/g, "d"],
  ];

  /**
   * Convert any Devanagari in the text to Roman letters.
   * @param {string} text
   * @returns {string}
   */
  function devanagariToRoman(text) {
    const letters = Array.from(text.normalize("NFC"));
    let result = "";
    for (let index = 0; index < letters.length; index++) {
      const letter = letters[index];
      const code = letter.codePointAt(0);
      if (letter === NUKTA || letter === VIRAMA) {
        continue;
      }
      if (code >= DIGIT_ZERO && code < DIGIT_ZERO + 10) {
        result += String(code - DIGIT_ZERO);
      } else if (CONSONANTS[letter]) {
        result += CONSONANTS[letter];
        result += inherentVowel(letters, index);
      } else if (INDEPENDENT_VOWELS[letter]) {
        result += INDEPENDENT_VOWELS[letter];
      } else if (VOWEL_SIGNS[letter]) {
        result += VOWEL_SIGNS[letter];
      } else if (ENDINGS[letter]) {
        result += ENDINGS[letter];
      } else {
        result += letter;
      }
    }
    return result.replace(IGNORED, " ");
  }

  /**
   * The "a" a consonant carries unless a vowel sign or a virama
   * (the mark that cancels it) follows. Skips a nukta in between.
   * @param {string[]} letters
   * @param {number} index  position of the consonant
   * @returns {string}
   */
  function inherentVowel(letters, index) {
    let next = letters[index + 1];
    if (next === NUKTA) {
      next = letters[index + 2];
    }
    if (next === VIRAMA || VOWEL_SIGNS[next]) {
      return "";
    }
    return "a";
  }

  /**
   * One plain, lower-case Roman form of Devanagari or IAST text.
   * @param {string} text
   * @returns {string}
   */
  function toLooseRoman(text) {
    let roman = devanagariToRoman(String(text)).toLowerCase();
    LATIN_FOLDS.forEach(function fold(pair) {
      roman = roman.replace(pair[0], pair[1]);
    });
    return roman
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/aa/g, "a").replace(/ii/g, "i").replace(/uu/g, "u");
  }

  quiz.transliteration = { toLooseRoman };
})((window.RecallQuiz = window.RecallQuiz || {}));
