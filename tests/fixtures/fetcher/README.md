Chapter pages for `tests/fetcher.test.mjs`: the markup of the reader themes most
manga sites run on, written from the open-source Mihon/Tachiyomi source parsers
(keiyoushi/extensions-source, `lib-multisrc`) — where each theme puts its page
images — with the noise those pages carry (site logo, avatars, related-series
thumbnails, ads). Series names and hosts are invented. Each file's first line
names the theme and what it checks; `expect.json` lists the pages and links the
fetcher must return.
