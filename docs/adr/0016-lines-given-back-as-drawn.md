# ADR 0016: Claude gives each line's original; a line given back as drawn stays as drawn

Status: accepted (2.14.0). Date: 2026-11-21. Part of the 3.0 plan's 2.14 step.

## Context

Two readings of the same Kamen Rider chapter (a Spanish scanlation) with Haiku 5.5, 2.13.0 and 2.13.1:

- Page 5's "No hay nada que no pueda crear!" came back in Spanish both times, as its "translation". The prompt already said "Never leave text untranslated".
- The credits page ("TRANSLATOR Sebasdgd", …), already in English, was labelled "bubble" rather than "logo", so it was erased and lettered again with the same words.

Nothing in the answer told the two apart from a translation: Claude's original text was only asked for when an option ("Also transcribe the original text", off by default) was on.

## Decision

1. **Every line's original is asked for** (`prompt.js`, `"source"` in the answer's schema), and the option is gone. `PROMPT_VERSION` 8.
2. **A line whose "translation" is its original, word for word** (`wordsOf`: letters and digits, lower case, accents dropped) is not drawn as given (`prompt.js checkCopies`, in `callClaude`, so both apps):
   - one word ("Luke...", "Ah!"): marked `same` at once. Asking about each would add a call to many pages, and such a word reads the same drawn as it is.
   - a longer line: asked again with the page's other such lines, as text, in one call. One that comes back translated takes the translation; one that comes back the same is already in the target language, and is marked `same`. A failed call changes nothing.
3. **A line marked `same` stays as drawn** (`layout.js tells`): like a line of only punctuation ([ADR 0015](0015-what-claude-reads-is-erased.md), decision 1), it keeps the lettering its box lies on, and a region given nothing else is not erased.

## Consequences

- Each answer is longer by the originals' text. Not measured; Options → What translating costs shows it per page.
- A page with a line given back as drawn makes a second, text-only call (a few hundred tokens), and waits for it.
- A single word left untranslated ("¡Basta!") stays as drawn rather than lettered again the same; it was not translated before either.
