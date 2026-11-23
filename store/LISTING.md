# Chrome Web Store listing — Gytakusub

Last updated for 3.0.0 (the core, measured).

Copy each block into the matching field of the Developer Dashboard. Keep the wording: it is written to match what the extension actually does (reviewers compare listing claims against behaviour) and to stay generic about content sources.

## Store listing tab

**Name**: comes from `extension/manifest.json`, "Gytakusub". Keep "Claude" out of the name: the name is the brand, and a third party's mark there can read as endorsement (the store's policy against implying endorsement, and Anthropic's trademark guidelines). Saying it works with your own Claude API key, in the summary and description next to the "not made by or affiliated with Anthropic" note, is the safer way to say it.

**Summary** (≤132 chars)
```
Translate manga and comic pages in place, right on the page, using your own Claude API key. No account, no server, no tracking.
```

**Description**
```
Gytakusub re-letters comic and manga pages in your browser. Hover a page and click Translate, press Alt+T to translate everything on screen, or turn on auto-translate for a site you read regularly. Speech bubbles are detected on your device, the original lettering is erased, and the translation is lettered into the bubble's shape at the original's size. Sound effects stay as drawn.

HOW IT WORKS
• Text and speech bubbles are found locally by open-source models (PaddleOCR's text detector and a speech-bubble segmentation model) and OpenCV, all running in your browser, on the graphics card when available. No page content is read except the images you translate.
• The original lettering is erased on your device: bubbles keep their own white, screentone is continued, and other surfaces are filled by inpainting models trained on manga.
• The translation is drawn at your screen's own resolution, and drawn again when you zoom or resize.
• The image is sent directly from your browser to Anthropic's Claude API using YOUR API key. Gytakusub has no server and never sees your data.
• Names and recent dialogue are carried from page to page so translations stay consistent through a chapter.
• Japanese (including vertical text), Korean, Chinese, Spanish, Italian and most other languages → the language you pick: English, Vietnamese, Spanish, Portuguese, Indonesian, French, German, Chinese, Japanese, Korean, Thai and more, or any other you type, lettered in a font that has all its letters.
• The extension's own pages follow your language too: English, Tiếng Việt, Español, Português, Bahasa Indonesia, Français, Deutsch, 简体中文, 日本語, 한국어.

YOU STAY IN CONTROL
• Before anything is sent, a setup page shows exactly what is sent and where, and asks you to agree. You can withdraw any time.
• Access to websites is asked when you first use it, not at install, and you can remove it any time.
• Runs only on sites you enable; dormant everywhere else until you click the toolbar button or press the shortcut.
• Master switch, per-site enable, per-site auto-translate.
• Glossary for names and terms; custom instructions; model choice (Haiku for speed, Sonnet/Opus for difficult pages).
• Results are cached for the browser session so re-reading costs nothing.
• See what it costs: your real cost per page for each model, and today's and this month's spend, counted from Claude's own answers to this browser (Settings → What translating costs). To cap spending on every device, it points you to the Console's spend limit.
• Double-click a translated line (or press Enter on it) to correct it or add a term to the glossary; an option lets you peek at the original by hovering.

REQUIREMENTS
You need a Claude API key from platform.claude.com (pay-per-use, billed by Anthropic to your account). The key is stored only in your browser.

PRIVACY
No analytics, no telemetry, no account. The page images you translate (with your glossary and the chapter's names, for consistency) go to api.anthropic.com only, with your key. Full policy: https://gywreb.github.io/gytakusub/privacy.html

HELP
Report problems or ask on GitHub: https://github.com/gywreb/gytakusub/issues

Gytakusub is an independent, open-source reading aid (GNU AGPL v3, source on GitHub: https://github.com/gywreb/gytakusub). It is not made by or affiliated with Anthropic, or with any publisher, reader or translation service. Use it with content you have the right to read.
```

**Homepage URL**
```
https://github.com/gywreb/gytakusub
```

**Support URL**
```
https://github.com/gywreb/gytakusub/issues
```

**Category:** Productivity (alternative: Accessibility)
**Language:** English

**Graphic assets** (in `store/assets/`)
- Icon 128×128: `extension/icons/icon128.png`
- Screenshots 1280×800, in this order: `screenshot-1-before-after.png`, `screenshot-2-closeup.png`, `screenshot-3-how-it-works.png`, `screenshot-4-japanese.png`, `screenshot-5-controls.png` (made by `npm run assets` in `tests/`: 1–4 render test pages through the engine, erased with the learned fill the extension runs on the CPU; 5 is the real popup and Options page with demo data). Made again for 3.0.0: replace all five in the dashboard.
- Small promo tile 440×280: `promo-small-440x280.png`
- Marquee 1400×560: optional, not provided

**What's new in 3.0.0** (paste into the version notes if the dashboard asks)
```
A cleaner, sharper page. The original lettering is erased by inpainting models trained on manga, so screentone and art continue under it; sound effects and logos stay as drawn. Translations are set to each bubble's shape at the original lettering's size, keep clear of its outline, and are drawn at your screen's own resolution. The same page now comes out the same with or without a graphics card. Long chapters no longer fail partway, and keyboard and screen-reader users can reach and edit every translated line.
```

**What's new in 2.9.0** (paste into the version notes if the dashboard asks)
```
Translated pages letter properly in every listed language: Vietnamese, Thai, Polish, Turkish, Russian and Ukrainian get comic fonts with all their letters; Chinese and Japanese now break lines between words at a readable size (they were drawn tiny); Chinese, Japanese and Korean use your system's font for that language. Hyphenation follows the language (German, French, Spanish, Portuguese, Italian, Dutch, Polish, Ukrainian). Thai is now in the language list.
```

**What's new in 2.8.0** (paste into the version notes if the dashboard asks)
```
Pick the language to translate into from a list instead of typing it ("Other…" still takes any language). Gytakusub's own pages, the toolbar popup and the buttons on a page now switch to that language: English, Vietnamese, Spanish, Portuguese (Brazil), Indonesian, French, German, Chinese (Simplified), Japanese and Korean. New installs start with your browser's language. Translations were written with AI; corrections welcome on GitHub Issues.
```

**What's new in 2.7.0** (paste into the version notes if the dashboard asks)
```
A setup page now opens on install: it shows what is sent to Claude and where, and asks you to agree before anything is sent. Access to websites is asked the first time you use it instead of at install, and both can be withdrawn in Settings → About. Safer image downloads (only real images, size-capped); the API key is no longer readable by the page-side script; auto-translate pauses after 100 pages in 10 minutes until you choose Continue, so a page that keeps swapping images can't run up your bill. Help link: GitHub Issues. "What translating costs" now shows your real cost per page for each model and points to the Console's spend limit; the monthly-credit meter is gone (no app can read your balance, so it could only guess).
```

**What's new in 2.6.0**
```
When you scroll fast with auto-translate on, the page you stop at is translated first, and pages you flew past are skipped (no tokens spent on them) until you come back.
```

**What's new in 2.5.0**
```
Redesigned popup and Options page, in light and dark. New Claude usage panel: today's and this month's estimated cost per model, how much of your plan's monthly API credit is left and when it renews, and the rate limit in plain words. Clearer Claude error messages (spend limit, rate limit, credit balance).
```

**What's new in 2.0.0**
```
New page engine. Text and speech bubbles are found by open-source models running locally in your browser (on the graphics card when available), original lettering is removed by inpainting with artwork and outlines untouched, and translations are placed over the lettering they replace. Japanese raw manga is supported: vertical text and furigana are erased and the English is set at a readable size. Double-click a bubble to edit a line or teach the glossary. Now open source under the GNU AGPL v3.
```

## Privacy practices tab

**Single purpose description**
```
Translates the text inside comic and manga page images that the user is viewing, by sending the selected image to the Claude API with the user's own API key and drawing the translation over the image in the browser.
```

**Permission justifications**

| Permission | Justification to paste |
|---|---|
| `storage` | Stores the user's settings, glossary, list of enabled sites, (locally) their API key, and a local log of the token counts Claude reports for each translation, used to show the user what translating costs. No data is sent to the developer. |
| `activeTab` | Lets the user invoke the translator on the current tab from the toolbar button or keyboard shortcut without the extension running on every page. |
| `scripting` | Injects the translator only into the current tab on user request, and registers it for the specific sites the user has enabled in the popup/options. |
| Optional host permission `<all_urls>` (`optional_host_permissions`; not granted at install) | Requested at runtime, in a click, the first time the user enables a site, starts auto-translate or translates, after a setup page explains why. Comic pages are served from many image CDNs that differ from the page's own domain and block cross-origin reads, so the background worker needs host access to fetch the image the user asked to translate so its pixels can be analysed. It downloads only images (checked by their bytes, capped at 25 MB). The extension does not read or modify any other page content and does not run on sites the user has not enabled or explicitly invoked it on. The user can remove the access in Settings → About. |
| Remote code | Not used. All code and models are packaged in the extension: OpenCV and ONNX Runtime (WebAssembly), the text-detection model, the speech-bubble model and the two inpainting models (ONNX files), all loaded from the extension package. The CSP allows `wasm-unsafe-eval`, not `unsafe-eval`. The only network calls are to api.anthropic.com (user's key) and to fetch the image being translated. |

**Data usage disclosures** — tick these, and only these:
- [x] **Authentication information** — the user's Claude API key, stored locally, transmitted only to api.anthropic.com.
- [x] **Website content** — the image the user chooses to translate is transmitted to api.anthropic.com for translation, with the names and (if Chapter context is on) recent translated lines from the same chapter. Disclosed on the setup page, which asks for agreement before anything is sent.
- [ ] Personally identifiable information — no
- [ ] Health, financial, location, web history, user activity, personal communications — no

Certifications (all three must be true, and they are):
- [x] I do not sell or transfer user data to third parties, outside of the approved use cases
- [x] I do not use or transfer user data for purposes unrelated to the item's single purpose
- [x] I do not use or transfer user data to determine creditworthiness or for lending purposes

**Privacy policy URL**
```
https://gywreb.github.io/gytakusub/privacy.html
```

## Distribution tab
- Visibility: **Public** from 2.7.0 (it was Unlisted until then). See "Going public" in RELEASE-CHECKLIST.md.
- Regions: all.
- Pricing: free. Everything is free: each user pays Anthropic for their own key, and nothing costs the developer per user.

## Test instructions tab (private to reviewers)
The dashboard's *Test instructions* tab is for items that need a paid account or credentials. Translating needs a Claude API key, which costs money, so give the reviewers one there:
1. In the Claude Console, create a **separate** API key named e.g. "CWS review", in a workspace with a low spend limit (a few dollars is plenty).
2. Paste it in the Test instructions tab with the steps below. Never put it in the repo, the listing or an issue.
3. Revoke the key once the review is done (approved or not).

## Notes for the reviewer (optional field)
```
Bring-your-own-key tool. To test: a setup page opens on install. 1) Read the disclosure and click "I agree" (nothing is sent before that). 2) "Open settings" and paste any Claude API key (the reviewer may use their own; keys are created at platform.claude.com, and requests are billed to that account). 3) "Allow access" (optional host permission, explained on the page). Then open any web page with a comic/manga image, click the toolbar icon, turn on "Enable here", hover the image and click "Translate". Without a key the extension shows a clear error and makes no network requests at all. Host access is used only to fetch the image the user selected; the content script is registered only for sites the user enables.
```
