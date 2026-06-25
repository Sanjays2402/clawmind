// Shared navigation helper for the chat sources rail. A source card in
// the rail is rendered with the DOM id `cm-source-<id>`; both the inline
// citation pill (ChatStream) and the keyboard rail navigation drive the
// same "scroll the card into view and flash it" affordance through here
// so the behaviour stays identical no matter how the card was reached.

/** The DOM id a SourcesPane card carries for a given source id. */
export function sourceCardId(id: string): string {
  return 'cm-source-' + id;
}

const FLASH_CLASS = 'cm-source-flash';

/**
 * Scroll the rail card for `id` into view (nearest edge, smooth) and run
 * a one-shot flash so the eye lands on the card the answer just pointed
 * at. Safe to call repeatedly: re-targeting the same card restarts the
 * flash by removing and re-adding the class on the next frame. No-op when
 * the card is not mounted (e.g. filtered out of the rail).
 */
export function revealSourceCard(id: string): void {
  if (typeof document === 'undefined') return;
  const el = document.getElementById(sourceCardId(id));
  if (!el) return;
  el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  // Restart the animation cleanly even when the class is already present.
  el.classList.remove(FLASH_CLASS);
  // Force a reflow so the browser registers the class removal before we
  // re-add it; without this a back-to-back retarget would not re-trigger.
  void el.offsetWidth;
  el.classList.add(FLASH_CLASS);
  const onEnd = () => {
    el.classList.remove(FLASH_CLASS);
    el.removeEventListener('animationend', onEnd);
  };
  el.addEventListener('animationend', onEnd);
}
