interface SpinnerProps {
  /** Announced to assistive tech; visually hidden by default. */
  label?: string;
  className?: string;
}

/**
 * `role="status"` plus a visually-hidden label so a screen reader announces
 * progress without a sighted user seeing redundant text next to the spin
 * animation. `prefers-reduced-motion` stops the animation rather than
 * removing the element — the status semantics must survive either way.
 */
export function Spinner({ label = 'Loading…', className }: SpinnerProps) {
  return (
    <span
      className={className ? `spinner ${className}` : 'spinner'}
      role="status"
      data-testid="spinner"
    >
      <span className="spinner__visual" aria-hidden="true" />
      <span className="visually-hidden">{label}</span>
    </span>
  );
}
