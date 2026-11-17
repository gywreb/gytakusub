# ADR 0009: Agreement first, site access at first use

Status: accepted (2.7.0). Date: 2026-11-17.

## Context

Until 2.6.x, Gytakusub was Unlisted: installable by link, used by its developer. 2.7.0 goes Public, so strangers install it without reading the README. Three things had to change for that.

**What Chrome Web Store policy asks** (from the developer program policies and the user data FAQ, read on 2026-11-16):
- Ask for the narrowest permissions that work. Broad host permissions (`<all_urls>`) make review take longer.
- "Website content and resources" counts as user data. The page images we send to Anthropic are that.
- When user data is sent, the extension must show a prominent disclosure and get affirmative consent **inside its own interface**, before collecting it. A privacy policy alone isn't enough.
- Limited Use: data may go to a third party only when that's needed for the single purpose. Sending the image to Claude is the purpose; nothing else goes anywhere.

**What an audit of 2.6.1 found:**
- `<all_urls>` was granted at install, with no explanation in the extension.
- Nothing asked for consent; the first anyone heard of Anthropic was the Options page.
- The worker answered the content script's `GET_SETTINGS` with the API key in it. The content script never used it, but it runs inside other people's pages, and Chrome's guidance is to treat it as less trustworthy.
- The worker's image downloader (`FETCH_IMAGE`, also used for every translation) fetched any http(s) address a content script handed it and returned the bytes, whatever they were. With host access to every site, that is a proxy past the page's own security. It also read the whole answer before checking the 25 MB cap.

## Decision

**Agreement (`access.js`, `welcome.html`):**
- On install, the worker opens a setup page. Step 1 says what is read (only pages you translate, and when), what is sent (the image in slices, glossary and custom instructions, the chapter's names, recent lines with Chapter context on), to whom (Anthropic's Claude API, with your key), and what never happens (no server, no account, no analytics). "I agree" stores `{ consent: { version, at } }` in local storage.
- Until then the worker refuses to translate, with an error that says how to set up. The popup shows only "Set up". A shortcut opens the setup page instead of reading the page.
- `CONSENT_VERSION` goes up when what is sent changes. An update that finds the agreement missing or older opens the setup page again ("Gytakusub now asks before it reads any page…").
- Options → About shows when you agreed and has Withdraw. Withdrawing deletes the record; nothing more is sent.

**Site access (`optional_host_permissions`):**
- `<all_urls>` moves from `host_permissions` to `optional_host_permissions`. Nothing is granted at install.
- It is asked for in a click: step 3 of the setup page, or the first time you turn on Enable here, Auto-translate, or press Translate in the popup. Chrome only shows the prompt during a click, so `requestAccess()` is the first call in those handlers.
- Content scripts are registered for your enabled sites only while access is granted. The worker re-registers when access is added or removed (`permissions.onAdded` / `onRemoved`), so it works even if the popup closes while the prompt is open.
- Without access, a download fails with "Gytakusub needs your permission to read images from *host*. Open the Gytakusub popup and choose Allow access." The popup shows an Allow access note. Options → About can remove access.

**Worker boundaries:**
- `GET_SETTINGS` returns the settings without `apiKey`, plus `hasKey`.
- Every download goes through `imagecheck.js`: a `Content-Length` over 25 MB stops before reading, a stream stops as soon as it passes 25 MB, and the bytes must start like JPEG, PNG, GIF, WebP, AVIF/HEIF or BMP. The blob's type comes from those bytes, not the server's header. Anything else (a login page, JSON, SVG, video) is refused: "That address did not return an image."

## Alternatives considered

- **Keep `<all_urls>` at install, add only the consent page.** Policy-compliant, but every new user sees "Read and change all your data on all websites" before knowing why. Asking at first use comes with the explanation.
- **Ask per site.** Narrowest, but the image servers differ from the page's site, change over time, and some chapters use two. Each new site would need one or more prompts, and a missed one looks like a broken translation. Not now; noted in the release checklist as the next step if a reviewer insists.
- **Consent inside the popup.** Too small for the disclosure Google asks for, and closes when you click elsewhere.

## Consequences

- One more step for new users (agree, then allow access when first used). The setup page shows all three steps with their state.
- Browser tests run with access granted at install in a test copy of the extension (`tests/browser/ext-copy.mjs`), because a headless browser can't click a permission prompt. `tests/browser/setup.mjs` covers the path without access.
- Unknown: whether people who installed 2.6.x keep their granted `<all_urls>` after the update moves it to optional. I couldn't find a documented answer. Either way works: the popup and setup page check access at run time and ask when it's missing.
- Rolling back to 2.6.x from the dashboard would bring back install-time access that 2.7 users never granted; the browser may disable the extension for them until they approve. Prefer fixing forward (see the release checklist).
