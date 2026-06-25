'use client';
import { IconWarning, IconRefresh, IconPencil } from '@clawmind/ui';

/**
 * Recoverable error panel for the chat surface. A stream failure used to
 * render a bare red block with the message and no way forward — the user
 * had to manually re-click Ask. This panel keeps the failed question in
 * context and offers two first-class recoveries:
 *   - Retry: re-submit the SAME question verbatim (transient failures,
 *     dropped connections, a 503 from the model).
 *   - Edit and try again: return focus to the composer with the question
 *     preserved, for when the phrasing itself needs a tweak.
 */
export function ChatError({
  message,
  onRetry,
  onEdit,
}: {
  message: string;
  onRetry: () => void;
  onEdit: () => void;
}) {
  return (
    <div
      role="alert"
      className="rounded-md border border-cm-border bg-cm-paper p-4"
      style={{ boxShadow: '0 1px 0 var(--cm-border)' }}
    >
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 shrink-0 text-cm-danger" aria-hidden="true">
          <IconWarning size={17} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[13.5px] font-medium text-cm-fg">
            That question didn&rsquo;t go through
          </div>
          <div className="mt-1 text-[13px] leading-relaxed text-cm-fg-soft break-words">
            {message}
          </div>
          <div className="mt-3.5 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={onRetry}
              className="inline-flex items-center gap-1.5 rounded-md border border-cm-border bg-cm-accent px-2.5 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90"
            >
              <IconRefresh size={14} />
              Retry
            </button>
            <button
              type="button"
              onClick={onEdit}
              className="inline-flex items-center gap-1.5 rounded-md border border-cm-border px-2.5 py-1.5 text-xs text-cm-fg-soft transition-colors hover:bg-cm-accent-soft hover:text-cm-fg"
            >
              <IconPencil size={14} />
              Edit and try again
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
