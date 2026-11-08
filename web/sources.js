// Gytakusub Web – reader adapters for "chapter link" mode.
// An adapter turns a chapter URL into a list of page-image URLs using the
// reader's own public API. Add one by pushing to ADAPTERS.

const ADAPTERS = [
  {
    id: "mangadex",
    match: (url) => /(^|\.)mangadex\.org$/i.test(url.hostname) && /\/chapter\/[0-9a-f-]{36}/i.test(url.pathname),
    async pages(url) {
      const id = url.pathname.match(/\/chapter\/([0-9a-f-]{36})/i)[1];
      const r = await fetch(`https://api.mangadex.org/at-home/server/${id}?forcePort443=true`);
      if (!r.ok) throw new Error(`Reader API ${r.status}`);
      const j = await r.json();
      return j.chapter.data.map((f) => `${j.baseUrl}/data/${j.chapter.hash}/${f}`);
    },
  },
];

export function findAdapter(input) {
  let url;
  try { url = new URL(String(input).trim()); } catch { return null; }
  return ADAPTERS.find((a) => a.match(url)) ? { adapter: ADAPTERS.find((a) => a.match(url)), url } : null;
}

export async function chapterPages(input) {
  const hit = findAdapter(input);
  if (!hit) throw new Error("This link isn't from a supported reader. Use screenshot mode for any other site.");
  return hit.adapter.pages(hit.url);
}
