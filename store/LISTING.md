# Chrome Web Store listing — Gytakusub 1.0.0

Copy each block into the matching field of the Developer Dashboard. Keep the wording: it is written to match what the extension actually does (reviewers compare listing claims against behaviour) and to stay generic about content sources.

## Store listing tab

**Name** (≤45 chars)
```
Gytakusub – Manga translator (your Claude key)
```

**Summary** (≤132 chars)
```
Translate manga and comic pages in place, right on the page, using your own Claude API key. No account, no server, no tracking.
```

**Description**
```
Gytakusub re-letters comic and manga pages in your browser. Hover a page and click Translate, press Alt+T to translate everything on screen, or turn on auto-translate for a site you read regularly. Speech bubbles are detected on your device, the original lettering is replaced inside the bubble, and the translation is typeset to fit — artwork stays untouched.

HOW IT WORKS
• Bubbles are found locally by analysing the image; no page content is read except the images you translate.
• The image is sent directly from your browser to Anthropic's Claude API using YOUR API key. Gytakusub has no server and never sees your data.
• Names and recent dialogue are carried from page to page so translations stay consistent through a chapter.
• Japanese (including vertical text), Korean, Chinese, Spanish, Italian and most other languages → English or any target language you set.

YOU STAY IN CONTROL
• Runs only on sites you enable; dormant everywhere else until you click the toolbar button or press the shortcut.
• Master switch, per-site enable, per-site auto-translate.
• Glossary for names and terms; custom instructions; model choice (Haiku for speed, Sonnet/Opus for difficult pages).
• Results are cached for the browser session so re-reading costs nothing.

REQUIREMENTS
You need a Claude API key from platform.claude.com (pay-per-use; Claude Max and Team subscriptions include monthly API credit). The key is stored only in your browser.

PRIVACY
No analytics, no telemetry, no account. Images go to api.anthropic.com only, with your key. Full policy: https://gywreb.github.io/gytakusub/privacy.html

Gytakusub is an independent, open-source reading aid (MIT licence, source on GitHub). It is not affiliated with any publisher, reader or translation service. Use it with content you have the right to read.
```

**Category:** Productivity (alternative: Accessibility)
**Language:** English

**Graphic assets** (in `store/assets/`)
- Icon 128×128: `extension/icons/icon128.png`
- Screenshots 1280×800: `screenshot-1-before-after.png`, `screenshot-2-closeup.png`, `screenshot-3-how-it-works.png`
- Small promo tile 440×280: `promo-small-440x280.png`
- Marquee 1400×560: optional, not provided

## Privacy practices tab

**Single purpose description**
```
Translates the text inside comic and manga page images that the user is viewing, by sending the selected image to the Claude API with the user's own API key and drawing the translation over the image in the browser.
```

**Permission justifications**

| Permission | Justification to paste |
|---|---|
| `storage` | Stores the user's settings, glossary, list of enabled sites and (locally) their API key. No data is sent to the developer. |
| `activeTab` | Lets the user invoke the translator on the current tab from the toolbar button or keyboard shortcut without the extension running on every page. |
| `scripting` | Injects the translator only into the current tab on user request, and registers it for the specific sites the user has enabled in the popup/options. |
| Host permission `<all_urls>` | Comic pages are served from many image CDNs that differ from the page's own domain and block cross-origin reads. The background worker needs host access to fetch the image the user asked to translate so its pixels can be analysed. The extension does not read or modify any other page content and does not run on sites the user has not enabled or explicitly invoked it on. |
| Remote code | Not used. All code is packaged; the only network calls are to api.anthropic.com (user's key) and to fetch the image being translated. |

**Data usage disclosures** — tick these, and only these:
- [x] **Authentication information** — the user's Claude API key, stored locally, transmitted only to api.anthropic.com.
- [x] **Website content** — the image the user chooses to translate is transmitted to api.anthropic.com for translation.
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
- Visibility: **Unlisted** for the first release (installable via link, not searchable); switch to Public after a week of real use.
- Regions: all.
- Pricing: free.

## Notes for the reviewer (optional field)
```
Bring-your-own-key tool. To test: open Options, paste any Claude API key (the reviewer may use their own; a test key can be created free at platform.claude.com), open any web page with a comic/manga image, hover it and click "Translate". Without a key the extension shows a clear error and makes no network requests at all. Host permission is needed only to fetch the image the user selected; the content script is registered only for sites the user enables.
```
