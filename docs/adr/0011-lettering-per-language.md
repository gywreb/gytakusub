# ADR 0011: Lettering in every listed language

Status: accepted (2.9.0). Date: 2026-11-17.

## Context

2.8.0 put 19 target languages in a list. The page renderer (`text.js`) had been built for English. Measured on 2.8.0:

- **Fonts.** The only bundled font, Comic Neue Bold, has 220 characters. I tested 52 Vietnamese letters against it and it had 3; it had none of Russian's or Ukrainian's, and lacked Polish ą ć ę ł ń ś ź ż and Turkish ğ ş İ (checked against the font's own character map). The browser fills each missing character from another font, so a word like "người" was drawn in two fonts.
- **Chinese and Japanese.** Lines broke only at spaces. A Chinese or Japanese sentence has none, so it counted as one word too wide for the bubble, and the fitter shrank it to the minimum size (8 px in a test bubble where English got 20 px) before cutting it character by character. Found while testing; the 2.8.0 notes said these were broken between characters, which was wrong.
- **Hyphenation.** English patterns only, applied to any Latin word. German compounds stayed whole (smaller text), and Vietnamese words of 6+ letters ("nghiêng") could be split by English rules, which is never right in Vietnamese.

## Decision

**Fonts: one per page, chosen by its letters** (`text.js`, `vendor/lettering-fonts.js`).
- Bundled, in this order:
  1. Comic Neue Bold (as before).
  2. Comic Relief Bold: Latin Extended, Cyrillic, Greek. A Comic Sans-style font, close to Comic Neue.
  3. Mali Bold: Vietnamese and Thai.
  
  Both new fonts are SIL OFL, from the Google Fonts repository; 207 KB together.
- A page is lettered in the first font that has every letter of all its translations. So no word mixes fonts, and the same page never switches font while one line is hidden (peeking).
- `scripts/vendor-fonts.mjs` reads each font's character map and cap height into `vendor/lettering-fonts.js`. CI regenerates it and fails if it differs.
- Sizes follow each font's cap height, so capitals come out as tall as the original lettering in every font. Comic Neue's sizes are unchanged.
- **Chinese, Japanese and Korean use the system's font for that language** (Hiragino / Yu Gothic / Meiryo; PingFang / Microsoft YaHei; Apple SD Gothic Neo / Malgun Gothic; Noto CJK where installed). Bundling CJK fonts would add several MB per language. Naming the language's font matters because the same Han character is drawn differently in Japanese, Simplified and Traditional Chinese. The canvas's `lang` is set too where the browser has it.
- A font set in Settings still comes first.

**Line breaking** (`tokens()` in `text.js`).
- Scripts written without spaces (Chinese, Japanese, Thai, Lao, Khmer, Burmese) are cut into words with `Intl.Segmenter`, built into Chrome.
- The Japanese line-start rules (kinsoku), also used for Chinese, are applied: closing marks (。、」！？ー, small kana) stay with the word before, opening marks (「『（) with the word after.
- A word still wider than the line is cut between characters, with no hyphen.
- Korean keeps breaking at spaces, as it is written.

**Hyphenation per language** (`vendor/hyphen/*.json`, `languages.js` → `hyphen`).
- The `hyphen` library already bundled has patterns for many languages. The patterns are data, so they're vendored as JSON and loaded only for the target language:
  - in the extension, by the worker on the page script's request (`GET_HYPHENATION`, only names `languages.js` lists);
  - in the web app, by fetch.
- Bundled: German, Spanish, French, Italian, Dutch, Polish, Portuguese and Ukrainian, about 700 KB in all.
- **Not bundled because of their licences:** Russian and Turkish (LPPL), Indonesian (GPL-2.0, which is incompatible with AGPL-3.0). I read each file's licence in the hyph-utf8 sources (`vendor/hyphen/LICENSE-patterns.txt` keeps their headers). Those languages, and every language without patterns (Vietnamese, Filipino, CJK, Thai, anything typed under Other), are never hyphenated. Upper case follows the language too (Turkish i → İ, German ß → SS).

**Thai becomes a listed target.** With Mali's Thai and word breaking, its pages letter correctly. Its interface stays English.

## Alternatives considered

- **One bigger font for everything (Pangolin covers Latin Extended, Cyrillic and Vietnamese).** Simpler, but it only has a regular weight and looked too light next to Comic Neue Bold in a side-by-side render. Comic Relief and Mali both have real bold weights.
- **Let the browser fall back per character (no table).** That is what produced the two-font words.
- **Bundle Noto Sans CJK.** Consistent everywhere, but about 16 MB per language. Every desktop and phone the extension and the web app run on already ships a CJK font.
- **Hyphenate in the worker, sending soft hyphens with the text.** It would need every language's patterns in the worker at once (no dynamic import in an MV3 service worker), and the page script already does the fitting.

## Consequences

- Package: +207 KB of fonts and +700 KB of patterns (uncompressed). The page script gets one more small file (`vendor/lettering-fonts.js`, 3 KB) and loads the three fonts once per page.
- `tests/lettering.test.mjs` (font choice, line breaking and its rules, hyphenation per language, upper case, the font table) and `tests/browser/lettering.mjs` (seven languages through the real extension: the font each page was drawn in, the hyphenation the worker served, the fonts loaded). Debug reports now say which font a page used.
- Still open: vertical typesetting for Japanese and Chinese targets, right-to-left languages, and hyphenation for Russian, Turkish and Indonesian.

## Sources

- Each font's coverage and cap height: read from the font files (`scripts/vendor-fonts.mjs`, cross-checked with fontTools).
- Font licences and origin: the Google Fonts repository, `ofl/comicrelief/OFL.txt`, `ofl/mali/OFL.txt` and `METADATA.pb` (retrieved 2026-11-17).
- Pattern licences: the headers of `hyph-*.tex` in github.com/hyphenation/tex-hyphen (retrieved 2026-11-17).
- `Intl.Segmenter`: in Chrome since 87 and Safari since 14.1, so also on iPhones running the web app (web.dev, "The Intl.Segmenter object is now part of Baseline", https://web.dev/blog/intl-segmenter).
