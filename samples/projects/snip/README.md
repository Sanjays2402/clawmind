# Snip

A native macOS screenshot tool with OCR built in. Capture, annotate, send.

## Design goals
- Faster than the system screenshot tool for the 80% case.
- OCR using Apple Vision so it works offline.
- Share via drag, paste, or shortcut to the active app.

## Status
- v2.1.0 shipped on 2026-04-12.
- Tuesday's commit moved OCR to a background actor and fixed the language autodetection bug.
