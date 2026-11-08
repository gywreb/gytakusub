# Changelog

All notable changes to Gytakusub are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- Bundled lettering font (Comic Neue Bold, SIL Open Font License) so translations look the same on every machine; the Options "Font family" field still overrides it.

### Fixed
- Translations could spill into a neighbouring bubble, or be sized inconsistently across one page. Text is now placed in the largest rectangle inside the detected bubble shape, joined bubbles are split at their waist, and lettering size is a page-wide median.
- Erasing original lettering could wipe line art on banner/credits pages and could leave part of the lettering standing when the model's box was too small. The eraser now removes only glyph-sized ink, protects strokes/outlines/logos, and follows the lettering beyond the box.

## [1.0.0] — 2026-11-08

First release: Brave/Chrome extension and web app. Local bubble detection with set-of-mark prompting, in-place typesetting, per-site enable and auto-translate, chapter context, bring-your-own Claude API key.
