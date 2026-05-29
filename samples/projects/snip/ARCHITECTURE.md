# Architecture

Three actors: Capture, OCR, Share. They communicate via Swift Concurrency channels.

- Capture renders the overlay, hands off a CGImage.
- OCR runs Vision and emits a transcript stream.
- Share writes to the active app or pasteboard depending on the user's intent.
