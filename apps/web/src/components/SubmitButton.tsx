import type { ReactNode } from 'react';

interface SubmitButtonProps {
  pending: boolean;
  disabled?: boolean;
  pendingLabel?: string;
  children: ReactNode;
  className?: string;
  'data-testid'?: string;
}

/**
 * The shared retrofit target for every hand-rolled submit button in the
 * app (feature 7). `aria-busy` plus a visible spinner communicate the
 * pending state to both assistive tech and sighted users; `disabled` is
 * the union of the caller's own disabled condition and `pending` so a
 * form can never be double-submitted.
 */
export function SubmitButton({
  pending,
  disabled = false,
  pendingLabel,
  children,
  className,
  'data-testid': dataTestId,
}: SubmitButtonProps) {
  return (
    <button
      type="submit"
      className={className ? `button ${className}` : 'button'}
      disabled={pending || disabled}
      aria-busy={pending}
      data-testid={dataTestId}
    >
      {pending ? (
        <>
          {/* Decorative only — aria-busy on the button already carries the
              pending state to assistive tech, so the spinner's own status
              role would just duplicate the announcement. */}
          <span className="spinner button__spinner" aria-hidden="true">
            <span className="spinner__visual" />
          </span>
          {pendingLabel ?? children}
        </>
      ) : (
        children
      )}
    </button>
  );
}
