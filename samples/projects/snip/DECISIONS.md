# Decisions

- Use Swift Concurrency, not Combine. Less ceremony for this workload.
- Keep OCR on-device only. No cloud round trip.
- Ship as a notarized app, not a Mac App Store binary, for shortcut hooks.
