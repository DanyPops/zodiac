# Vendored zodiac sign glyphs

The 12 `.svg` files in this directory (`aries.svg` … `pisces.svg`) are vendored
verbatim, licensing comment header and all, from
[zodiacfonts/zodiacfonts](https://github.com/zodiacfonts/zodiacfonts) at commit
`08757adb2988c42b612b586d03d743ed63e45f77`, path `icons/signs/*.svg` --
the free tier of "Zodiac Fonts" (https://zodiacfonts.com), hand-crafted
`currentColor`-ready astrology SVG symbols.

## License

Licensed under the **SIL Open Font License, Version 1.1** (`OFL.txt`, copied
here unmodified from the same commit) -- "free for personal and commercial
use with attribution" per the source repository's own README. The license
explicitly permits bundling/embedding/redistributing the Font Software with
other software; this attribution notice is that requirement being met.

The OFL's copyright statement reserves the font name **"Zodiac"** itself
(`with Reserved Font Name "Zodiac"`) -- that clause restricts renaming *this
font/derivative* and redistributing it as if it were the original "Zodiac"
font. It has no bearing on this app's own, unrelated product name, which
happens to be the same word by coincidence -- noted here only so the
coincidence doesn't get mistaken for a license entanglement later.

## What actually ships in the app

These `.svg` files are the source of truth, kept here for attribution and so
a future re-vendor (a new upstream version, or picking up one of the Pro
symbols) has a real diff to compare against -- but nothing in the running app
`fetch`es or `<img>`s them directly. `../../icons/zodiac-signs.tsx` transcribes
each file's own `<path>`/`<line>`/`<circle>` elements (same coordinates, same
`viewBox="0 0 512 512"`) into a plain React component with the same
`size`/`className`/`aria-hidden` call shape every other icon in this app
already uses (lucide-react's), so a zodiac glyph drops into any call site
that already expects one without a new SVG-import build step. See that
file's own doc comment for what was (and wasn't) normalized in the
transcription.

## Updating

Re-fetch `icons/signs/*.svg` and `OFL.txt` from a newer upstream commit,
replace the files here, and re-run the transcription in
`../../icons/zodiac-signs.tsx` (by hand or via the small extraction script
this vendoring pass used -- not checked in, since it is a one-shot
transcription tool, not part of the app's own build).
