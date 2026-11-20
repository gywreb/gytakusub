# Changelog

All notable changes to Gytakusub are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [2.13.1] — 2026-11-20

Fixes from the first two chapters read with 2.13 (a romance chapter and Kamen Rider W).

### Pages
- **Hand-drawn capitals are measured right.** Where their ink sits in a few heavy rows (thick bars at the foot of the letters, an "S" beside a dash), letters about 18 px tall were measured at 4–7 px. Their lettering was then taken for art and partly left on the page ("QUE", "SEI DE", "EU" under the English), and the translation came out tiny. The letters' own height now sets the size when the old measure is under 40% of it. Whether a line is lettering at all, and which lines group together, is still decided on the old measure, so a face's eyes don't become a bubble and furigana stays with its line.
- **Huge sound effects no longer set the size of a bubble's text.** On a page whose only lettering found was its sound effects, their size (125 px) was used for a bubble whose own lettering measured small: "There you are!" came out in 64 px letters, broken as "e / you / ar- / e!" and spilling out of the bubble. Such a bubble's size is now held to a quarter of the bubble across.
- **A word is never cut letter by letter while a smaller size would fit.** The smallest size a line may take (a share of the original lettering's size) now gives way first when even that doesn't fit the box.
- **Not fixed: that page's 36 s wait.** While Claude answers, the engine fills a page's textured areas ahead; once the answer is in, it finishes the fill under way and stops. On that page the two areas filled ahead took 33.7 s together (the bubble's, sized from the 125 px letters, and the sound effects' block, most of the page), where your graphics card normally takes 0.2 s a fill. Why is not known, so nothing about it changes here: the debug report below now records what is needed to find out. (The bubble's area is its usual size again, from the fix above.)

Measured on 13 of your debug reports (the 11 from 2.13 and the two read with it, replayed with their saved answers; they stay local): lettering left under translations 45 → 38 of 1,401 lines; translations drawn over unerased lettering 28 → 24; words cut letter by letter gone from the 5 pages that had them. All 188 areas whose render changed were compared by eye with 2.13.0. I found none worse; a few only changed size.

### Debug report
- **A timeline of each page.** When it started (`timing.start`), Claude's own time (`timing.claude`; "model" is that plus any wait for a fill under way), and each textured area's fill (`fill.runs`, and `fill.preRuns` for the fills done ahead): how, how big, when it started, its whole time and the model's own run in it. On that page the report gave only the 33.7 s total: not which fill, nor whether the model or something around it was slow, nor what else ran meanwhile.

### Web app
- All of the above (same engine and text fitting).
- Housekeeping: an unused constant removed (`FETCHER_VERSION`).

### Development
- `tests/letter-size.test.mjs`: the letter measure on drawn capitals, an "S" beside a dash, a lowercase line and a stray outline; a bubble's size bound; the fit's floor giving way. `inpaint.test.mjs`: the model's run time is reported.

## [2.13.0] — 2026-11-20

Clean art, first part. Third step of the 3.0 plan: what Claude reads is erased, or left exactly as drawn.

### Pages
- **"…" and "!" stay as drawn.** A line whose translation has no letters (only dots, marks or "♪") reads the same in any language. It was erased and drawn again, and dots too small to find came out doubled. In a bubble with other lines it keeps its lettering, and the other lines' text keeps off it.
- **Sound effects and logos are left alone.** Claude was told to leave sound effects out but returned them anyway (at least 16 lines in 7 of 11 reports), and they were drawn over the unerased original. It now labels them, with series logos, magazine marks, scan credits and page numbers, and those are dropped. Chapter titles, blurbs and captions are still translated. Pages translated before are asked again once (the cache key changed).
- **Lettering the detector missed is looked for again.** When nothing was found under a translated line, the detector looks at just Claude's box, zoomed in, and what it finds is erased like any other lettering. Big shouts beside a bubble and small print are found this way. The debug report records it (`timing.look`).
- **Two lines given one bubble's number are sorted by their boxes.** The line lying on another bubble's lettering goes to that bubble, and a shout boxed outside the bubble takes the lettering under its box, instead of both translations crowding one bubble while the other's original stayed.
- **No more white flecks around bubbles.** Lettering found by its colour in a bubble is now taken only when it lies wholly inside the bubble; tone and art just past the outline were painted with the bubble's white.
- **Art and screentone are filled by LaMa on a graphics card.** A LaMa model finetuned on manga continues screentone under removed lettering where the previous model (AOT) left a blurred ghost of the letters. On a black-and-white chapter, with lettering drawn over real stretches of its pages, its fill came out closer to what was there in 10 of 12 areas (SSIM 0.47 → 0.59); on a colour chapter the two were about even. It sees the 512 px of page around each area. Without a graphics card AOT stays (LaMa costs several times as much). The debug report shows which one ran, with its load and first runs (`fill.model`).
- The extension is about 103 MB larger (the LaMa model).
- On 11 of the owner's chapters (they stay local), replayed with their saved answers: translations drawn over unerased lettering 29 → 16, and lines whose lettering is left 31 → 24 of 1,095 (not counting 10 that only the replay of old reports gets wrong). Most of what remains is what the new labels drop (drawn over: 6 sound effects and 5 logos, marks or page numbers; left: 11 logos and 2 sound effects), which shows only on a chapter read with them. Every changed area was compared by eye with 2.12.0.

### Web app
Everything above reaches the web app too (it runs the same engine), and it catches up with 2.12.1:
- **LaMa on a graphics card**, iPhone included. Downloaded the first time a page needs it (103 MB, once; the browser keeps it). If the tab dies twice while it loads or first runs (a phone out of memory), the app keeps to AOT on that device; the debug report says which.
- **The translation is text too.** It was only a picture: now it lies invisibly over the drawing, so screen readers read it, Find in page finds it and it can be selected and copied. Selecting it doesn't flip the page to its original.
- **A page survives the engine dying.** When the engine stops with an error (a phone short of memory), the next page starts a fresh one; the page it was working on is done again on it, with Claude's answer kept rather than asked for (and paid) again. Pages failed until Redo before.
- The Originals toggle is announced as a switch.
- The models are no longer copied into the app's offline cache on every visit (the browser's own cache keeps them, once).
- Changes to the shared strings and the version now redeploy the web app (2.12.1 changed only those, and was not deployed).

### Development
- `npm run audit`: overlapping bubbles are matched by overlap (the centre rule matched a neighbour), lines drawn without erasing are listed, and lines left as drawn are not counted.
- `scripts/lama-static.py` makes `vendor/lama.onnx` from the pinned upstream export (`node scripts/vendor-inpaint.mjs lama`): fixed at 512 px, it loads in under 2 s instead of ~16 s. The GPU test runs it on WebGPU against the CPU.
- ADR 0015.

## [2.12.1] — 2026-11-20

The overlay without a mouse, and pages that survive the extension's background restarting.

### Extension
- **Pages ask again when the extension's background restarts.** Chrome stopped the background in the middle of a chapter (a report: the last two pages failed with "message channel closed", and worked when you pressed Translate). A page it had in progress is now asked again by itself, twice at most; one Claude had already answered comes from the cache.
- **The translations are text the browser can read.** They're drawn on a canvas, which screen readers, find in page and the browser's own translation can't see. Each line is now also a transparent button over the drawn one, grouped per image ("Translated text"); the canvas is hidden from screen readers so nothing is read twice.
- **Keyboard:** Tab reaches an image's lines (one stop per image), the arrow keys move between them without turning the page, Enter opens the editor.
- **The editor is a real dialog** (a modal `<dialog>`): the keyboard stays in it, Esc or a click outside closes it, and the focus goes back to where it was. Ctrl+Enter saves; Enter in the glossary fields adds the term instead of saving the line.
- **The readable view** (a small line shown at a readable size) also appears for the line the keyboard is on, and on a long press (touch) for any line, with an Edit button. It stays while the pointer moves onto it, and Esc puts it away until the pointer goes to another line (WCAG 1.4.13).
- **The popup's and Options' toggles are switches** for screen readers (`role="switch"`), not checkboxes.

### Development
- `tests/browser/a11y.mjs` (21 checks): the accessibility tree, the keyboard, the editor, the readable view (focus, hover, Esc, long press) and the switches.
- `tests/browser/startup.mjs` part 4: the worker is stopped while three pages are with Claude; all three finish on their own. 2.12.0 leaves all three failed.

## [2.12.0] — 2026-11-18

Clean bubbles. Second step of the 3.0 plan: a robust core before new features.

### Extension
- **Auto-translate starts on the first load.** A page asked the extension for its settings once; when that answer failed or came too late (the extension's background still starting), the page kept its defaults until reloaded: no auto-translate, and the button's raw label ("content_btn_translate"). It now asks again until it has them, and the background reloads its own words when reading them failed.
- **A reload doesn't pay for its pages twice.** When a page goes away (reload, next chapter), its pictures not yet sent to Claude are dropped; one already on its way is waited for by the reloaded page instead of asked again.
- **On the graphics card, pages ask Claude side by side.** Pages off screen were held back while the page on screen was in progress, so a chapter's questions went out one at a time, up to 20 s apart. The hold is for the CPU, where the models block everything else, and now applies only there.
- **Only pages are translated.** An image counted by the size of its file, so a site's logo (shown 182×50), a cover thumbnail and reaction emoji (42×42) were translated, paid for and counted as pages. The logo, first on the page, also took the slow first fill below ahead of the chapter. Images now count by the size they're shown at (280 px each way, as before).
- **A tall image goes part by part.** A chapter served as one image (800×17055 px in a report) was analysed, sent and drawn whole: about a minute before anything showed, and all of it paid for at once. Each of the slices the engine already reads it in is now a part with its own place in the queue, its own question and its own drawing, the part on screen first; auto-translate takes the parts near the screen as you scroll, as it does pages. The count, the button and the debug report treat the image as one page.
- **The button follows its image.** It was placed only when the pointer entered an image: on a tall image it stayed behind as the page scrolled, and a wider label ran past the image's edge.
- **The inpainting model's trial run is at full size.** In three reports from Windows, the first learned fill of 128 px or more took 14–20 s after each start of the extension's background, though the model loaded in 0.3–0.4 s and the 72 px trial run took under 0.1 s. Counted on Dawn here, the model makes 3 of its 33 GPU programs only from 128 px up; whether those are the 14–20 s on Windows isn't known yet. The trial run is now at 768 px, beside the queue, once a page has an area that needs the model and the pages near the screen are analysed; only pages that need it wait for it. The report records the load, the trial run and a second one (`fill.model`: a long first and short second run means the cost was the first run) and a page's wait (`timing.modelWait`).
- **The background stays up while you read.** Chrome stops an extension's background after 30 s without an event, and the models went with it: reports 12 minutes apart each paid the load and the slow first fill again. While auto-translate is on and the tab is in front, the page sends a word every 20 s, for 10 minutes after its last translated page.
- **Screentone fills at full size are about 2× faster overall, 5–9× on the slowest areas** (2 areas of a mangadex page: 1.6 s and 3.7 s, now 0.3 s and 0.4 s), with the same result to the pixel on 42 areas of two reports. The fill skips copies that can't land on known pixels.

### Pages
- **Pages appear as soon as the translation arrives.** The texture fills below now run while Claude is answering, not after. On an M4 MacBook they had added up to 1.7 s to each page (0.65 s on average on a black-and-white chapter); a page now waits for nothing but the answer. The page comes out exactly the same.
- **Free text the detector missed or cut short is erased.** When Claude translates a line outside a bubble whose box holds lettering the analysis had set aside (a title too big for dialogue, small print, a line it dropped), that lettering is erased and the translation gets its room. A long caption's box no longer takes the credits beside it. Logos read as a stack of lines and lettering far above dialogue size are left alone. Lettering that can't be erased cleanly (outlined display letters) stays as it was rather than half-erased.
- **Coloured lettering is erased whole.** Blue, orange and pink letters, in bubbles and on plain backgrounds, were found by their dark parts only, so most of each letter stayed. They are now read by colour against the plain surround. Screentone and art still use the old masks.
- **A loose box no longer pulls a line out of its own region.** A line moves to another region only when its box lies mostly on that region and little on its own.
- On seven chapters (they stay local), lines whose Japanese an independent detector still finds after erasing: 66 → 33 of 780; on a colour chapter 18 → 2. Marks left in bubbles: 16 → 6. Every erased area was compared with 2.12.0: none worse, 19 better, 13 newly erased (each checked by eye).
- **No more white clouds on toned bubbles.** The eraser now covers the white outline round lettering, which it used to leave behind and smear over the tone.
- **Screentone is continued dot for dot.** Where a bubble or a panel is screentone, the eraser measures its pattern and copies it into the hole in step with the dots around it. It only does this when the pattern really predicts the surrounding tone; otherwise the next fill takes over.
- **Art and irregular tone are filled by a manga-trained inpainting model** (AOT-GAN), on the graphics card when there is one. On 150 stretches of real pages with lettering drawn over them, the fill came out closer to what was really there in 142 (SSIM 0.45 → 0.62).
- **Narration over art no longer takes the art with it.** Free text is erased line by line. On a cover page where lines of text and strokes of the drawing were read as one block, the faces under it used to be erased too.
- White bubbles are filled with their own white, as before.
- Without a graphics card the inpainting model works at a smaller size (it costs seconds per area on a CPU). The model is loaded only when an area needs it.
- The extension is about 23 MB larger (the inpainting model).

### Web app
- The same eraser, with the same fills ahead of the answer. The model is downloaded the first time a page needs it (white bubbles and screentone don't), then cached; as in the extension, it loads beside the pages' work.
- **Export debug report** (Settings → App): one .zip of the translated pages, with the original images, Claude's answers, the regions, the timings and a render of each. It's the extension's format, so a problem seen on a phone can be replayed. On a phone it opens the share sheet (Save to Files); it holds the page images, so share it privately.

### Development
- `tests/browser/strip.mjs` (in `test:browser:extension`): a reader page with a logo, a cover, emoji and a chapter as one tall image. 2.12.0 as first built fails 7 of its 9 checks.
- `tests/browser/startup.mjs` (in `test:browser:extension`): auto-translate when the first settings reads are turned away, pages left in the worker when the reader leaves (never sent), and a reload while a page is with Claude (asked once). 2.12.0 as first built fails the first and the last.
- `npm run audit -- <report> <out> --rtdetr detector.onnx`: lines whose lettering survives erasing, by comic-translate's text detector as an independent witness; also translations drawn far from their text or shrunk for want of room, and every erased area's marks (`marks.json`) to compare two builds area by area.
- `tests/freetext.test.mjs`: adopting set-aside lettering, which box gets it, the logo and bubble guards, the stamp rule, and blue and orange lettering erased whole. Added to `test:extension`.
- `tests/tone.test.mjs` checks that a page filled ahead of the answer comes out identical, also when the inpainting model isn't loaded yet; the real-browser test checks the fills are done before the answer.
- The debug report's timing adds `wait` (time waiting for the engine), `fill.ready` (areas filled ahead) and `fill.pre`.
- ADR 0014.
- `tests/fill-truth.mjs`: the eraser's fill against known backgrounds on real pages (they stay local).
- `tests/lattice.test.mjs` (the screentone fill), `tests/inpaint.test.mjs` (the learned fill), `tests/tone.test.mjs` (a synthetic page with toned and gradient bubbles and narration on screentone, 2.11 vs 2.12). Added to `test:extension` with a check of the vendored model against its record.
- `tests/residue.mjs`, the marks-left measure behind `npm run audit`: four faults fixed, and areas on a textured surround counted apart, since there it misjudges both ways. See ADR 0013.
- The debug report's timing has `fill`: areas by how they were filled, and the time the texture fills took.
- README rewritten for visitors; how it works moved to `docs/ARCHITECTURE.md`, development to `CONTRIBUTING.md`.
- ADR 0013.

## [2.11.1] — 2026-11-17

### Pages
- **Auto-translate no longer leaves a page untranslated while you're looking at it.** If you scrolled far past a page before Claude was asked, and came back before that cancellation reached the page, the page stayed untranslated until you pressed Translate. Auto-translate now re-checks every page near the screen once scrolling settles, after each page finishes and after a page is put back, instead of only reacting when a page comes into view.

### Development
- `tests/browser/autostall.mjs` plays that race three times: 0/3 pages translated before the fix, 3/3 after. Added to `test:browser:extension`.

## [2.11.0] — 2026-11-17

Sharp on every screen. First step of the 3.0 plan: a robust core before new features.

### Pages
- **The translation is drawn at your screen's own pixels.** It used to be drawn once at the engine's working size (at most 1600 px) and stretched: 2.4× on a 2× laptop screen, 3.6× on a 3× one, so the text looked soft. Now the overlay has one pixel per screen pixel, measured from 390 to 2560 px wide on 1×, 2× and 3× screens.
- **It is drawn again when the window, the zoom or the screen changes**, once the resize settles.
- **The erased areas have the page's own resolution.** Pages bigger than 1600 px used to get softer patches cut from the smaller working copy.
- **Lines too small to read can be read.** In a narrow window, a line drawn under 9 px shows at a readable size beside its bubble while the pointer rests on it.
- Pages far from the screen give their memory back and are drawn again when you scroll back.
- The erasing itself is unchanged: white smudges on toned bubbles and art are still there, just sharper. That is 2.12.0.

### Web app
- **Translated pages are drawn with the original's pixels or the screen's, whichever is more.** They used to be 1600 px at most. A saved page, or one you zoom into, is as sharp as the source, and on a tablet or an unfolded foldable the text is as sharp as the screen. Very long strips are capped at 16 million pixels, iOS Safari's canvas limit.
- **Unfolding a foldable, turning the phone or widening the window redraws pages** that now need more pixels.
- The translation is part of the page image, so it stays exactly where the original lettering was at every size. Checked on a folded phone, a phone sideways, an open foldable and an iPad in both orientations.

### Development
- `tests/browser/screens.mjs`: every size and density in the real extension (47 checks: the overlay's pixels, that it sits exactly on the picture, that each line keeps its size relative to the page, the readable view, releasing far pages); it also takes `--page` (any image), `--ext` (another build) and `--measure-only`.
- `tests/browser/web-screens.mjs`: the web app on phone, foldable and tablet screens (26 checks, unfolding included).
- `tests/fullsize.test.mjs`: full-size erasing lines up with the original and leaves everything outside the mask alone.
- `npm run audit -- report.zip outdir`: the core audit used for the 3.0 plan (erased bubbles with marks left, lines drawn over unerased text, renders and a crop sheet of the worst bubbles).
- The debug report records the overlay's pixel ratio, its pixels and each line's size on screen.
- ADR 0012.

## [2.10.0] — 2026-11-17

The web app's own screens in the reader's language.

### Web app
- **The web app follows the target language**, like the extension, in the same ten languages: the install steps, screenshot mode, the chapter-link setup, the fetcher page, Settings, and its messages and errors. Other target languages keep it in English.
  - Saving another target language in Settings switches it at once, without a reload.
  - On a first visit it guesses from the phone's language, as before.
- GitHub's and Cloudflare's button names stay in English in the setup steps, with a note saying so, because those sites are what the reader has to find them on.
- iPhone and Android menu names are written as the system shows them in each language, as far as I know (not checked on real devices).
- The model menu shows just the names, with what the chosen one is good for underneath, as in the extension's popup.
- Japanese wraps between phrases and Korean between words, as in the extension.
- Two fetcher messages pointed at the wrong setup step ("step 4" for the key, "step 1" to generate it). They now say steps 5 and 2.

### Development
- `web/locales/<locale>/messages.json`: the web app's 181 messages, checked by `scripts/check-i18n.mjs` (now also part of the web test suite).
- `tests/browser/web-i18n.mjs` (83 checks).
- ADR 0010 has a 2.10.0 section.

## [2.9.0] — 2026-11-17

Lettering that works in every listed language, in the extension and the web app.

### Pages
- **Every listed language has its own letters.** Comic Neue had 3 of the 52 Vietnamese letters I tested, and none of the Cyrillic ones. The browser filled the gaps from another font, so a word like "người" came out in two fonts. Two more open-licence comic fonts are bundled:
  - **Comic Relief Bold**: Polish, Turkish, Russian, Ukrainian and other Latin and Cyrillic languages.
  - **Mali Bold**: Vietnamese and Thai.
  
  A page is lettered in the first font that has all its letters, so a word never mixes two fonts. English and the Western European languages keep Comic Neue, at the same sizes as before.
- **Chinese and Japanese translations were drawn at the minimum size** (before 2.8.0 too, for anyone who typed them in). Lines broke only at spaces, and these languages have none. They now break between words (the browser's `Intl.Segmenter`), with the line-start rules readers expect: no line starts with 。、」！？ or a small kana, and none ends with 「 or （. In a test bubble Chinese went from 8 px to 23 px, Japanese to 19 px.
- **Chinese, Japanese and Korean use the system's font for that language** (Hiragino / Yu Gothic / Meiryo, PingFang / Microsoft YaHei, Apple SD Gothic Neo / Malgun Gothic, Noto CJK), so shared Han characters take the right forms.
- **Hyphenation in the target language**: German, French, Spanish, Portuguese, Italian, Dutch, Polish and Ukrainian, as well as English. It only kicks in when a line doesn't fit whole. Vietnamese and other languages without patterns are no longer split by English rules. Russian, Turkish and Indonesian patterns aren't bundled because of their licences (LPPL, GPL-2.0), so those break at spaces only.
- UPPERCASE lettering follows the language (Turkish i → İ, German ß → SS).
- **Thai** joins the target list. Its interface stays English.

### Debugging
- Debug reports say which font a page was lettered in, and whether it was hyphenated.

### Web app
- The same fonts and rules. Its offline cache now includes the language files 2.8.0 added.

### Development
- `scripts/vendor-fonts.mjs` writes each font's characters and cap height into `vendor/lettering-fonts.js`; `scripts/vendor-hyphen.mjs` also writes `vendor/hyphen/*.json`. CI regenerates both.
- `tests/lettering.test.mjs` (24 checks) and `tests/browser/lettering.mjs` (37 checks: seven languages through the real extension).
- ADR 0011: `docs/adr/0011-lettering-per-language.md`.

## [2.8.0] — 2026-11-17

Languages: pick the target from a list, and Gytakusub's own pages speak it.

### Extension
- **Target language is a dropdown** of 19 languages, each shown in its own name ("Tiếng Việt · Vietnamese"), in Settings and on the setup page. "Other…" keeps a box for any other language. Languages typed before 2.8.0 are kept and matched ("vietnamese", "Portuguese", "Chinese"). Thai and right-to-left languages aren't listed, because pages can't be lettered well in them yet; they can still be typed under Other.
- **The interface follows the target language**, for ten languages: English, Vietnamese, Spanish, Portuguese (Brazil), Indonesian, French, German, Chinese (Simplified), Japanese and Korean. That covers the setup page, Settings, the toolbar popup, the buttons and messages on a manga page, and the worker's errors. Other target languages keep the interface in English.
  - It switches at once, in every open page, including the buttons on a page you're reading.
  - Pages declare their language (`<html lang>`), so screen readers read them right. Japanese wraps between phrases and Korean between words.
  - Dates, times and plural forms follow the language.
- **New installs start with the browser's own language** when it's on the list.
- **The popup's model menu shows just the names** (Haiku 5.5, Sonnet 5.5, Opus 5.5), with what the chosen one is good for underneath. The longer labels didn't fit a 340 px popup in every language and font.
- The extension's description and shortcut names are translated too (the browser shows them in its own language).
- The translations were written with AI (Claude) and checked by machine, not yet by native speakers. A **Translation fix** issue form takes corrections.

### Web app
- The target language is the same dropdown, with Other…. Until you save settings, it guesses from the phone's language. The web app's own interface stays English for now (translated in 2.10.0).

### Development
- `scripts/check-i18n.mjs` (in CI): every language has every English message, with the same placeholders, markup and links, no stray `$`, and a description within the manifest's 132 characters.
- `tests/browser/i18n.mjs`: every page in every language (labels right, no keys or English leftovers, nothing clipped or spilling sideways, no console errors), live switching, the worker's and the page overlay's language, the "Other" path and the first-install default. It found two bugs before release: the setup page didn't follow a change made in Settings, and the popup's model menu cut its descriptions off (on CI's wider Linux fonts, in seven of the ten languages, English included).
- ADR 0010 records the choices: `docs/adr/0010-interface-language.md`.

## [2.7.0] — 2026-11-17

Ready for the public Chrome Web Store listing. Everything stays free: each person uses their own Claude key, and nothing costs the developer per user.

### Extension
- **A setup page opens on install.** It says what is read (only pages you translate), what is sent (the page image in slices, your glossary and custom instructions, the chapter's names, and recent lines with Chapter context on), and where (Anthropic's Claude API, with your key, nothing else). Then: "I agree", add your key, allow access.
  - Nothing is translated until you agree; the popup shows only "Set up", and the shortcut opens the setup page.
  - Settings → About shows when you agreed, and Withdraw. After withdrawing, nothing more is sent.
- **Access to websites is asked when you first use it, not at install.** The setup page asks, and so does the popup the first time you turn on Enable here or Auto-translate, or press Translate. You can remove it in Settings → About.
  - Without it, nothing runs on sites, and the popup and any error say how to allow it.
- **Safer image downloads.** Only real images are used (checked by their first bytes: JPEG, PNG, GIF, WebP, AVIF/HEIF, BMP); a login page or anything else is refused. Downloads stop as soon as they pass 25 MB instead of after reading the whole thing.
- **The script that runs inside web pages can no longer get the API key.** It never used it, but it could read it from extension storage, which Chrome opens to it by default. Extension storage is now limited to the extension's own pages and worker, and the page script gets its settings, without the key, from the worker.
- **Auto-translate's spending guard.** On a site with auto-translate on, a page's own scripts (ads included) can add or swap images, and each new one is a Claude request. After 100 pages Claude answered in 10 minutes on one tab, auto-translate pauses with a Continue button that only a real click releases. Pages you ask for yourself are never held. Reading a chapter doesn't get near it.
- **The debug report** downloads the original images only with the debug overlay on, only for a tab, and only when they decode as images, and the page can no longer read the report while it downloads.
- **Fixed: with auto-translate on, the first screen of a chapter stayed untranslated until you scrolled** (2.6.0–2.6.1). Chrome fires a scroll event while a page loads; the pages found right after it waited for scrolling to settle, and nothing checked again until the next scroll. Found while testing the spending guard; `tests/browser/budget.mjs` now waits at the top of a chapter without scrolling.
- Translate visible (and the button on an image) now starts a page auto-translate is holding, instead of skipping it as already queued.
- Without site access, an image the page itself can read (same site) is still translated, through the page.
- The setup page opens on an update only for someone who never saw it (coming from before 2.7.0) or agreed to an older version, not after a deliberate Withdraw. Asking for it again brings the open one forward instead of opening another tab.
- **Settings → About**: version, help (GitHub Issues), privacy policy, setup guide, and "not made by or affiliated with Anthropic". Allow access there waits for the agreement, as on the setup page.
- The popup shows one notice at a time (key first, then access), so it stays within the browser's 600 px popup height.
- **"What translating costs"** (was "Claude usage"), in Settings and in the web app. Only numbers that are measured: what Claude's answers to this browser said they used, at Anthropic's prices.
  - Leads with **your cost per page for each model**. A long page can be several requests (one per slice); a page now counts once all its slices are answered, with their exact cost. Older history has no pages, so no per-page figure is guessed for it.
  - Today and this month show pages; requests, tokens and the rate-limit headroom moved under Details.
  - Points to the Console's monthly spend limit (Billing → Spend limits), the one cap that covers every device.
- **The web app's fetcher allowance** shows a meter against the 100,000 free requests only with Cloudflare's own count. Without it, it shows the requests this device sent, counted as they're sent. It used to add the browser's permission checks by guessing and set this device's number against the whole account's allowance, which other devices also use.
- **Removed: the monthly API credit meter** (plan, amount, renewal date), here and in the web app. It subtracted only this browser's spending from an amount you typed, so with the web app or another browser in use, "left" was always too high, and nothing can correct it: Anthropic has no way for apps to read a balance or a plan's credit. Claude usage still shows this browser's exact tokens and their cost, and now links the Console's Billing page for the balance. Old values are cleaned up.

### Store and support
- Listing text for the public release: setup and access in the description, Homepage and Support URLs, the optional-access justification, what's new, reviewer notes for the setup page (`store/LISTING.md`).
- "Going public" in `store/RELEASE-CHECKLIST.md`: trader status, visibility, rollback, watching issues, policy emails.
- Issue forms: a bug report that warns not to attach manga pages, debug reports or keys (issues are public), and an idea form.
- Privacy policy: the agreement, optional site access, and everything sent with an image.

### Web app
- The chapter-link setup guide was checked against Cloudflare's limits page, which changed on 13 November 2026: still 100,000 requests a day (reset at midnight UTC) and 10 ms CPU on the free plan. No change to the guide (#18).

### Tests
- `tests/browser/setup.mjs`: a new install without access, from the setup page through "I agree" and Withdraw, plus the worker's limits (no key in `GET_SETTINGS`, images only, the no-access message).
- `tests/imagecheck.test.mjs`: image types by their bytes, and the size cap.
- `tests/browser/budget.mjs`: the spending guard (a budget of 3 in the test copy), that a page script can't release it, that Translate visible still works while paused, and that the content script can't read the key from storage.
- The other browser tests use a test copy with access granted at install (`tests/browser/ext-copy.mjs`): a headless browser can't click a permission prompt.

## [2.6.1] — 2026-11-16

### Releases
- **`node scripts/release.mjs` no longer runs the test suite on your computer.** The full suite needs tools only CI installs (Python with numpy, onnx and Pillow for a stand-in model, a software GPU, downloaded models), so releasing 2.6.0 on a Mac stopped at the first test that needed them.
  - It now asks GitHub whether the tests passed for this exact commit on main, and tags only then. If they're still running, it says so; if they failed, it stops.
  - Its quick checks stay: on main, up to date, clean, version and changelog, shared files, syntax.
  - CI still tests the tag again before building the release.
  - The check reads the public check-runs API (no login; `GH_TOKEN` is used when set) in `scripts/ci-status.mjs`, with a test.

## [2.6.0] — 2026-11-16

### Extension
- **The page you're looking at is translated first.** When you scroll fast through a chapter with auto-translate on, the page you stop at no longer waits behind pages you flung past.
  - Auto-translate starts pages once scrolling settles, nearest to the middle of the screen first. A page on screen starts even when all three slots are busy.
  - The worker analyses one page at a time, most wanted first, from distances the page reports while you scroll (`extension/lane.js`). A page's analysis pauses between its model runs when a more urgent page is waiting.
  - While a page on screen is in progress, pages off screen wait (at most 20 s), because their model runs would block the worker's one thread while the page on screen waits for Claude's reply.
  - Pages you scroll far past before Claude is asked are put back and done when you return, so **they cost no tokens**. A page Claude was already asked about finishes and is cached. Pages you ask for yourself (Translate visible, the button on an image) are never put back.
  - Measured with a new browser test (14 pages, fast scroll to the end, a model taking 2.5 s per answer, CPU only): the page on screen was ready about **12 s** after the stop instead of 30 s, and Claude was asked about **3** pages instead of 8.
- **Options: the side nav stays on screen** while the page scrolls, and marks the section you're reading (or the one you picked in it). It was meant to stick already, but as a grid item it stretched to the full page height, so it scrolled away. The browser test now checks both.

### Store listing
- **Five screenshots instead of three** (`store/assets/`, upload them in the dashboard):
  - 1–3 re-rendered with the current engine;
  - 4 is new: a Japanese page with vertical and horizontal lettering, a dark bubble and screentone, before and after;
  - 5 is new: the real popup and the Claude usage panel (`tests/browser/store-shot.mjs`, demo data, a site named `reader.example`).
- **Screenshot 3 said something no longer true:** "found by pixels, not by a model". Since 2.0.0, bubbles and text are found by open-source models running in the browser. Its top line now says no other server sees your pages, instead of "nothing is stored". Screenshot 1 no longer says the artwork is untouched: narration on screentone can be smudged where it was erased.
- **The screenshot script tags each line with the bubble around its original text,** as Claude does, not by matching the bubble's outline. Two overlapping bubbles had been left untranslated in screenshot 1.
- **Screenshot 4 uses real translations of its Japanese text.** The generated test page pairs Japanese and English lines at random, which the tests don't mind.
- The close-up no longer has an empty strip at its right edge.

### Releases
- **Store uploads use the Chrome Web Store API V2.** Google planned to support the old v1.1 API, which `scripts/cws-publish.mjs` used, only until 15 October 2026. The script now uploads, waits while the store processes the package, checks its version, and submits for review, with V2's endpoints and fields. A test runs it against a fake API.
- **No stored key for the upload.** The release workflow signs in to Google with Workload Identity Federation: GitHub vouches for the release run, and Google gives a 15-minute token to a service account that only this repo's release workflow (from `main` or a version tag) may use. One-time setup: `scripts/cws-google-setup.sh` in Google Cloud Shell, then three GitHub variables (store/RELEASE-CHECKLIST.md § Automating updates). The refresh-token way remains as a fallback.
- Fixed in the checklist: it said to leave the Google app in "Testing", where Google expires refresh tokens after 7 days. The fallback now says to publish it ("In production").

## [2.5.0] — 2026-11-10

### Extension and web app
- **Claude usage monitor.** See what translating costs, in the extension and in the web app:
  - **Extension:** the popup shows "≈$… today" next to the model, and Options has a new **Claude usage** section.
  - **Web app:** Settings has a **Claude usage** group, and the toolbar shows today's cost while you translate.
  - **What it shows:** today and this month, one row per model (requests, tokens in and out, estimated cost), and the rate-limit headroom from Claude's last answer when the browser can read it.
  - **Where the numbers come from:** the token counts in Claude's own answers, so they're exact for what that browser sent. The cost is an estimate from Anthropic's published prices, checked weekly against the pricing page. The panels say so and point to the Claude Console for the exact bill.
  - Usage stays on the device for 62 days and is never sent anywhere. **Clear usage history** removes it. Each browser, and the installed app on iPhone, keeps its own records.
  - Exact account-wide numbers need Anthropic's Admin API, which isn't available for individual accounts. See ADR 0007.
- **Monthly API credit at a glance.** Claude Max and Team plans include API credit each month. Pick your plan (or type an amount) and the date it renews, and the usage panels show:
  - "≈$0.41 of $100 used", with a bar;
  - "≈$99.59 left · renews Dec 2 (in 23 days)";
  - the pace: "At this pace (≈$0.06 a day) you'll use ≈$1.70 of it by then", or the day it runs out if that comes first;
  - a badge when it's almost used, will run out early, or is used up.
  
  The popup and the web app's toolbar show "≈$… left" too. Anthropic has no API for the credit balance, so the renewal date comes from the Console's Billing page (Promotional credits). Without a date, the panels assume the 1st of next month and say "probably renews".
- **Speed limit in plain words.** The rate limit now reads like "Speed limit (a minute's worth, refilling as you go): 47 of 50 requests, 36k of 40k input tokens left at 1:22 AM", instead of raw header values.
- **Clearer Claude errors:**
  - the monthly spend cap (with when it resets), a self-set spend limit, a low credit balance, a refused key and an overloaded API are each explained;
  - the extension no longer retries a request the spend cap refused.
- The weekly check now also compares the Claude prices with Anthropic's pricing page and opens an issue when one changed.

## [2.4.0] — 2026-11-10

### Web app and fetcher
- **Live count from Cloudflare.** Optional: add a read-only analytics token and your account ID to the fetcher as two Secrets. The chip and **Your fetcher** then show Cloudflare's own request count for your whole account today. It's the same number in every browser and in the installed app, refreshed every minute while the Chapter link tab is open. Cloudflare adds requests to it a few minutes late, and the panel says so.
  - The fetcher reads the count with Cloudflare's GraphQL Analytics API (`/usage`) and reuses an answer for 30 s. The token never leaves the Worker.
  - When there's more than one Worker on the account, the count is split by Worker.
  - Without the token, the app keeps its own count, now marked as an estimate (≈ and "This device"). It also offers the setup in four steps.
  - **The estimate now counts what Cloudflare counts.** Before each new address the browser asks the fetcher for permission (a CORS preflight), and Cloudflare counts that as a request. The app counted only the page itself, so it showed about half of Cloudflare's number. It now counts both, and errs high rather than low; a browser test checks it against every request the fetcher receives.
  - A fetcher older than 2.4.0 still works; the panel says to Sync fork for the live count. The app's minimum fetcher stays 2.1.0, so nobody is forced to update.
- `wrangler.toml` keeps variables set in the dashboard when Workers Builds redeploys (`keep_vars = true`).
- The weekly guide check also watches the three Cloudflare pages the live-count setup relies on.

## [2.3.1] — 2026-11-10 (the first GitHub Release since 2.0.0: it carries 2.2.0, 2.2.1 and 2.3.0, which were not released on their own)

### Project
- **Fixed: the release build's zip step**:
  - The 2.2.0 release failed with "zip error: Could not create output file (dist/…)". The release workflow kept the package's path in an environment variable named `ZIP`, added in 2.0.0's release fixes. Info-ZIP's `zip` reads `$ZIP` as extra command-line options, so it took that relative path as the archive name while working in a temporary folder.
  - The variable is now `PACKAGE`, and `scripts/build-zip.sh` clears `ZIP` and `ZIPOPT` and uses absolute paths.
  - Pull requests that need the extension suite also build the store package the same way, on the same runner image, so a broken package shows up before a tag.

## [2.3.0] — 2026-11-10

### Web app
- **Fetcher allowance at a glance:**
  - A status chip under the chapter form shows today's requests against Cloudflare's free 100,000 a day. It turns red with *almost used up* from 80 %, and says when it starts again once it runs out.
  - Tapping the chip opens **Your fetcher**. There a meter shows the count, with the chapters opened and the reset time in your own time zone. Three short facts follow: it's free (when it runs out, the fetcher just stops until the reset), it's shared with your other devices and anyone you gave the link, and where to see the exact count in Cloudflare.
  - The count is what *this device* sent. A Worker can't read its account's usage without an extra Cloudflare API token, which would add setup steps for everyone.
- **Clearer failures:**
  - When Cloudflare answers with its daily-limit page (1027) or its "exceeded resource limits" page (1102), the message says so.
  - When a connected fetcher doesn't answer at all, the message names both likely causes: the allowance is used up (with the reset time), or the page needed more than 10 ms of work.
- **Your fetcher** is laid out like Settings: a back button, sections with dividers, and *Disconnect* marked as destructive.
- Small buttons are 44 px tall on touch screens.
- Fixed: an element hidden with the `hidden` attribute could still show when its class set a display style.

## [2.2.1] — 2026-11-10

### Project
- **Pull request rules**, checked in seconds by a new workflow (`pr-checks.yml`) and written down in `CONTRIBUTING.md` with a pull request template:
  - **Every pull request carries a version.** It raises `extension/manifest.json` and adds its dated section here (`scripts/check-version.mjs`).
  - **A pull request that changes UI has screenshots in its description** (`scripts/check-screenshots.mjs`, which lists the files that count). The check runs again when the description is edited.
  - The checks use the base branch's copy of the scripts, so a pull request can't change the rules it is checked against.
- `scripts/release.mjs` no longer bumps the version. It checks and tests, then tags the version main is at.
- **CI runs only the tests a change needs:**
  - **Pull requests:** tested once, as pull requests. Before, each push to a pull request branch ran the full 20-minute suite twice, once as a push and once as a pull request.
  - **Cancelling:** a newer push cancels the older run.
  - **Choosing suites:** `scripts/ci-changes.mjs` picks from the changed files. Documentation alone runs none. Web app or fetcher changes run the web suite (about 4 min). Anything else runs both, including the extension suite (about 18 min). A raised version number alone doesn't count.
  - **Full runs:** every push to `main` and every release still run everything.
  - **One check:** a single `test` check sums up the suites that ran, so it can be required on `main`. This follows GitHub's advice to skip jobs rather than whole workflows for required checks.

## [2.2.0] — 2026-11-09 (tagged, but its release build failed at the zip step, so 2.2.0 has no GitHub Release: 2.3.1 is the first release with these changes. There is no extension 2.1.0. Web app live on GitHub Pages)

### Web app
- **UI overhaul after an audit** against the Web Interface Guidelines, checked at iPhone size (390 px) and desktop (1280 px), dark and light:
  - **Header:** the mode switch gets its own full-width row on phones; on wider screens it's centred in the header.
  - **Tap targets:** at least 44 px everywhere.
  - **Reading width:** pages stay within a 760 px column; two-page spreads only from 1,100 px.
  - **Page actions** (Original, Redo, Save) and the status moved into a bar under each page instead of floating over the art.
  - **Modes:** each keeps its own pages. Once pages are on screen, the screenshot drop zone shrinks to its buttons.
  - **Settings:** a full-screen sheet on phones and a centred panel on wider screens, with a Close button, grouped sections and Save pinned at the bottom.
  - **Setup wizard:** a numbered vertical stepper, with Back/Next under the open step.
  - **Install guide:** in-app, per platform (iPhone/iPad steps, the install button where the browser offers one, a QR code on computers). On a phone that hasn't installed the app, it comes before the key prompt.
  - **Accessibility:** visible keyboard focus, the tablist pattern with arrow keys, toasts and progress announced to screen readers, key fields without autocorrect, a theme colour for light and dark, and reduced motion respected.
- Fixed in the fetcher setup guide: Cloudflare's create screen calls the root directory **Path**, under *Advanced settings*; the guide said *Root directory*, the name the docs and the Worker's Settings → Build use.

### Extension
- **Popup and Options page redesigned** with the same look as the web app (`extension/ui.css`), checked in dark and light and in narrow windows:
  - **Popup:** the master switch says On/Off; when off, the popup shows a short note instead of greyed-out buttons. *Translate visible images* shows your actual shortcut (it can be changed at `chrome://extensions/shortcuts`), and hide/show is an eye button. The site switches sit under *On \<site\>*, and the model and chapter context under *Translation*. The missing-key notice has an *Add key* button.
  - **Options:** sections for Claude API, Translation, Sites, Lettering & speed and Troubleshooting, listed at the side on wide windows. Every toggle is a switch with a short description. *Save* is pinned at the bottom with its message beside it, and the page shows *Unsaved changes*, saves on Ctrl/Cmd+S and asks before you leave unsaved edits. Settings changed in the popup appear here when nothing is unsaved.
  - *Clear cache* asks first, because it also drops your edited lines.
- Fixed: the debug-overlay option's label broke into columns on the Options page, and the popup's *Options* button was disabled while Gytakusub was off.

## [2.1.0] — 2026-11-09 (web app and chapter fetcher, live on GitHub Pages; the browser extension is unchanged and stays 2.0.0, so there is no store package or GitHub Release for 2.1.0)

### Added
- **Chapter links from any site that needs no login** in the web app, through a **chapter fetcher** you run on your own free Cloudflare account (`fetcher/worker.js`, set up in the browser in about 10 minutes: `fetcher/README.md`). A web page may not read other sites, so chapter mode cannot work without a server; MangaDex's own API documentation requires one. The fetcher:
  - opens the chapter page;
  - finds its page images by reading the reader themes most sites use (MangaThemesia including `ts_reader`, Madara including its encrypted "chapter protector", MangaBox, FoOlSlide, Blogger), other sites' HTML and scripts, and MangaDex through its API;
  - relays the images with the chapter site as referrer.

  It needs an access key (24+ characters) and stores nothing. It refuses IP addresses, local names, odd ports and unchecked redirects, and relays only JPEG, PNG, GIF, WebP and AVIF images up to 40 MB. Your Claude key never passes through it. An independent security review found no critical issue; its medium findings are fixed. `docs/adr/0006-chapter-fetcher.md`.
- **Next chapter / Previous chapter** buttons, kept from the site's own links; the chapter context (names, recent lines) carries over to the next chapter.
- **Deep links:** `?chapter=<link>` fills in a chapter, and a bookmarklet in the fetcher guide sends the chapter you are reading to Gytakusub. It opens on a tap of **Load**, so a link from someone else can't use your fetcher or Claude credits by itself.
- Clear messages when a site can't be read that way: a "checking your browser" wall, a login, pages built by a script, a wrong key, an unreachable fetcher. Each says to use screenshot mode or the extension instead.

- **Guided setup inside the Chapter link tab.** Until a fetcher is connected, the tab shows the setup steps instead of the chapter form, and it unlocks only after the fetcher answers with the user's key and is new enough. The steps:
  1. The app generates a 32-character key.
  2. Fork the repository on GitHub.
  3. On Cloudflare, Create application → GitHub → the fork, with the name `gytakusub` and root directory `fetcher`.
  4. Add the key as the Secret `GYT_KEY`.

  The steps open one at a time: "Step N of 6", Back and Next, and the place is remembered while you're away on GitHub or Cloudflare. They start with the two accounts to create, and every value to type is a tap-to-copy chip. Step 4 says what to check if the build fails. (The first version of this guide used Cloudflare's "Deploy to Cloudflare" button. When the owner tried it, that screen required choosing an existing repository, which a new user doesn't have, so the guide was rewritten around forking.) People given a **connection link** paste it in the box at the top and skip the setup.
  5. **Connect**.

  Each failure is explained: a wrong key, a key not set yet, an outdated fetcher, nothing at that address. A **connection link** sets up another device (the key travels in the `#fragment`, never to a server); someone given a shared address and key starts at step 3.
- **Keeping the guide current:** step 2 names the Cloudflare pages it follows and the date it was checked against them (`fetcher/guide-sources.json`). A weekly workflow (`guide-check.yml`) re-reads those pages, the Deploy link and MangaDex's API, and opens an issue when one changed. Tests tie the in-app links to that list.

### Changed
- The Chapter link tab is always shown. Settings no longer has *Image proxy* or the Advanced chapter-mode switch; the fetcher is set up and managed in the tab.

### Removed
- `web/sources.js` (MangaDex-only adapter, blocked by MangaDex's CORS rule) and `web/worker.js` (image-only proxy), both replaced by the fetcher.

## [2.0.0] — 2026-11-09

A new page engine built on open-source models that run in the browser, and a new licence. 1.0 found bubbles, erased lettering and fitted text with hand-written heuristics that were tuned one reported page at a time; each fix risked the last one. 2.0 finds text and bubbles with learned models (on the graphics card when there is one), does the geometry with [OpenCV](https://opencv.org/) (WebAssembly, bundled), and ships only what passes a test corpus and a measurement on real pages. Nothing leaves the browser except the call to Claude with your own key. Decisions and measurements: `docs/adr/0001`–`0005`. (Developed as 1.1.0 and 1.1.1; never released under those numbers.)

### Added
- **Learned text detection** with PaddleOCR's **PP-OCRv6** detector (Apache-2.0, 9.9 MB), on ONNX Runtime; OpenCV geometry then snaps each box to the ink, merges lines into paragraphs and finds the shape around them. It reads vertical Japanese as well as Latin rows (see "Japanese raw manga" below); `docs/adr/0002`, `0005`.
- **Learned bubble segmentation.** A YOLOv8-seg speech-bubble model (from `kitsumed/yolov8m_seg-speech-bubble`, quantized to int8, 43 MB) returns bubble masks; the engine uses them as bubble interiors and assigns the detected lettering to them. The light-region rules remain for lettering the model leaves outside any mask (it misses some heavily toned bubbles), and a model bubble with no lettering inside is ignored (never stamped, never erased). A bubble the model finds with no detected text gets a second, higher-resolution text pass on its crop before it is dropped. `docs/adr/0004`.
- **Japanese raw manga.** Vertical columns are found, erased and replaced, furigana included: ruby is treated as part of the column it reads (erased with it, never the size reference); a column's letter size is its glyph width; a bubble holding only "……" or "！？" takes the page's letter size; narration set in columns over the art gets a placement wide enough for English rows. On the owner's two raw chapters: original lettering left after erasing 35% → 22%, translations under 12 px 13% → 2%, dialogue recognised as a bubble 94% → 98% (`docs/adr/0005`). A dark bubble whose small white lettering the page-wide pass misses gets a second, closer look.
- **ONNX Runtime Web** (Microsoft, MIT) runs both models; OpenCV's dnn stays as the fallback for the text detector.
- **GPU (WebGPU).** Both models run on the graphics card when the browser offers WebGPU (Chrome/Brave/Edge 124+ in the extension's service worker; Safari 26 for the web app), and on the CPU otherwise or if the GPU fails to start. The bubble model ships in two variants chosen at load time: weight-only int8 for the GPU (no int8 activations, which ORT's WebGPU backend would send back to the CPU node by node) and int8 QDQ for the CPU. Verified in CI on a software GPU: same lines and bubbles as the CPU path on every fixture page. Options → "Use the graphics card" turns it off. Debug reports show where the models ran (`timing.backend`). Every call into the runtime is serialised: the WebGPU build suspends a call while the GPU works, and a second page entering it meanwhile (auto-translate while scrolling) corrupted its memory — "memory access out of bounds" on every page after. If the runtime ever does trap, the worker switches to the OpenCV text detector without the bubble model instead of failing every page.
- **Inpainting instead of painting.** Original lettering is removed with Telea inpainting inside the bubble (outlines untouched) and in a small region for free text, so the bubble's own surface and simple art behind loose text are reconstructed.
- **Hover to peek** (off by default). With Options → "Peek at the original" on, resting the pointer on a translated bubble for a moment shows the original lettering; moving away brings the translation back.
- **Edit a line.** Double-click a translated bubble to correct the text; the correction stays for that page until you Redo. The same dialog can teach the glossary ("original term = translation") for later pages.
- **Bundled lettering font** (Comic Neue Bold, SIL Open Font License) so pages look the same on every machine; Options → "Font family" still overrides it.
- **Hyphenation** at syllable boundaries using Franklin Liang's algorithm (the `hyphen` package, vendored), tried only when an un-hyphenated layout does not fit.
- **Debug overlay** (Options) drawing detected regions and text areas, plus **Export debug report** in the popup: one `.zip` with the original image, the debug render and the JSON for every translated page on the tab (the hover bar's **Report** does one page). `tests/replay-report.mjs` replays such a zip through the engine offline.
- **Real-browser tests.** The actual extension and the web app run in headless Chromium against a mock Claude API on every push; detection, layout and erase are asserted against ground truth on fourteen synthetic pages (Spanish, Italian, Japanese, including vertical Japanese with furigana); the GPU path runs on a software GPU. A release is built only after this whole suite passes on the tagged commit.

### Changed
- **Licence: GNU AGPL v3** (1.0.x was MIT). The bubble model is GPL-3.0 per its card and AGPL-3.0 under Ultralytics' terms; publishing the whole extension under the AGPL keeps the store build compliant. The licence text and `THIRD_PARTY.md` ship inside the package, and Options links to the source.
- A numbered stamp (tag) returned by the model is authoritative for where a line goes. 1.0 only trusted a tag if the model's pixel box also fell inside the bubble, so a drifted box silently moved the text into the wrong panel until a Redo got luckier. The one exception: when the model's box sits squarely inside a *different* detected shape, the number was misread (a corner stamp can land beside a neighbour's text) and the box decides — measured as 9 of 437 tagged lines in the user's exports, all of them wrong tags.
- **Anchored layout.** Each translation takes the largest rectangle of its bubble around the lettering it replaces — never another speaker's line, a smaller region inside the shape, or the far side of a joined bubble's waist — and stays centred on that lettering. Previously a shared bubble was cut into horizontal lobes and a single translation took the roomiest rectangle anywhere in the shape, so text drifted away from where the original was and, when a light background passed as a bubble, landed over other bubbles. One invariant holds whatever the shape analysis does: a translation never gets less room than the lettering it replaces (that area is erased and inside the bubble by definition), so text cannot come out smaller than the original for lack of space. Measured on 230 real pages from the user's exports: translations rendered below 0.7× the original letter size 15.3% → 9.5%, words broken letter by letter 68 → 37, lines over their own lettering 86% → 96% (`docs/adr/0003-anchored-layout.md`).
- **Toned bubbles.** A bubble shaded with screentone or a gradient used to offer only its flat light fragment as text area, so the translation came out tiny. The usable interior is now what the outline encloses (grown from the light region over tone dots, mid-greys and lettering, bounded by structural ink); hairline gaps are sealed, open tail tips are cut off, and a leak through a wide opening keeps the old interior. Dark bubbles are unchanged.
- Text fitting keeps words whole and lets a line run slightly past its box before it ever breaks a word letter by letter; the smallest size it will go to is 35% of the original (was 45%).
- Erasing reaches most of a letter beyond each detected line along its direction, catching the last glyph the detector sometimes stops short of.
- An image the site refuses to serve to the extension (hotlink protection, "Could not fetch image (403)") is fetched again by the page itself when it may (same-origin or CORS); an image that still fails is not retried on every scroll, and the same error is not toasted again within a minute. Failed images are listed in the debug report (`summary.failed`).
- The service worker now returns a cleaned page plus text placements; the content script only draws text. Content scripts no longer carry the engine (a few KB instead of hundreds).
- Text fitting tries every size without hyphens first and hyphenates only when nothing else fits, instead of hyphenating eagerly at line ends.
- Minimum Chrome version stays 116; the extension's CSP now allows `wasm-unsafe-eval` (WebAssembly; no remote code, no `eval`).
- **The model answers in a fixed JSON schema** (the API's structured output, `output_config.format`): its reply is constrained to valid JSON of the expected shape, so a page can no longer fail on malformed JSON (one did on the owner's One Piece chapter: "Expected ',' or ']' … at position 1998"). An answer that cannot be used now says why — refused, cut off at the token limit, empty — with the API's stop reason, instead of "Empty model response". If the API rejects structured output, the extension falls back to the plain request for the session.
- The popup and the Options page read and write the settings themselves instead of asking the service worker, and Options' Save stays off until the settings are loaded.

### Fixed
- Translations displaced from, or oversized for, a correctly detected bubble on the first render (the tag/box issue above).
- Text spilling into a neighbouring bubble; inconsistent sizes across a page; erased line art on banner pages; partially erased lettering when the model's box was too small (all made moot by the new engine, and covered by the corpus tests).
- Text boxes were mapped back to the page with one scale for both axes although the detector's input is rounded to multiples of 32 on each: boxes sat up to ~2% of the page width to the right of the text. Invisible on most Latin rows (the snapping to the ink absorbed it), it put boxes between the columns of vertical Japanese.
- "memory access out of bounds" on every page after a while with auto-translate (concurrent calls into the WebGPU runtime; see GPU above).
- The popup opened with default settings (master switch off, the first model, site toggles off) and lagged while pages were being translated. It asked the service worker for the settings, and the worker runs the page engine on its one thread: measured in the browser test, one such request waited 10.4 s during a page's analysis. The popup now shows the stored settings in about 0.25 s whatever the worker is doing; the Options page could even save its empty form over the settings if Save was clicked before they arrived.
- Two translations that share one paragraph of the original (a narration column and its parenthesis, merged by the detector) no longer leave the second with a sliver of the bubble and tiny text: the paragraph is cut between them.
- A panel's light background with loose lettering on it is no longer taken for a speech bubble the size of the panel (with the bubble model running, the rule-based fallback now stops at 8% of the page): the lettering becomes loose text, placed where it is.

### Validated on real pages
The rule-based detector (now the fallback) was first reworked against the real exports (850 px JPEG pages with 8 px Latin capitals; Japanese pages): line grouping from glyph components only, width-aware letter counts, evidence rules for lettering (alignment, letters per row, height clustering, density). Scored with the model's own answer as witness (`tests/score-reports.mjs`), tuned on one export and validated on two untouched ones: dialogue recognised as a bubble rose from 49% to 83% (hold-outs 64→88%, 49→84%) with coverage and false regions unchanged. The eraser now ships only the inpainted patches (≈10% of the bytes of a full page), and every result carries per-stage timings.

The learned bubble model, on 270 pages of the owner's exports at the time (`docs/adr/0004`): dialogue recognised as a bubble 92.4% → 98.0%. The PP-OCRv6 detector and the vertical-text work on top of it (`docs/adr/0005`): on 242 Spanish/English pages coverage 95.6% → 97.0% and dialogue as a bubble 98.1% → 98.4%, with words broken letter by letter 40 → 10; on 28 Japanese raw pages dialogue as a bubble 94.3% → 98.4%, lettering left after erasing 35% → 22%, translations under 12 px 13% → 2%.

### Known limitations
- Package size: about 117 MB unpacked, a 78 MB download (runtime 29 MB, bubble model 43 MB CPU + 28 MB GPU variant, text detector 9.9 MB, OpenCV 6 MB). The web app downloads one bubble-model variant, about 75–90 MB on first use.
- On the CPU (no WebGPU) a page takes about 3 s to analyse before the model call; pages translated while scrolling fast queue behind each other.
- The text detector reports sound effects and signs that the model then leaves untranslated: more numbered stamps per page (≈1.2 unused regions per page on Latin-script pages, 2.2 on Japanese raws), which costs prompt tokens.
- Telea inpainting smooths screentone and hatching behind narration set on the art (a visible smudge where the letters were). Bubbles are unaffected.

## [1.0.0] — 2026-11-08

First release: Brave/Chrome extension and web app. Local bubble detection with set-of-mark prompting, in-place typesetting, per-site enable and auto-translate, chapter context, bring-your-own Claude API key.
