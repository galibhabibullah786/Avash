import { useRef, useState, type ChangeEvent, type InputHTMLAttributes } from 'react';

interface PasswordInputProps {
  id: string;
  name?: string;
  value: string;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
  autoComplete: InputHTMLAttributes<HTMLInputElement>['autoComplete'];
  required?: boolean;
  minLength?: number;
  'data-testid'?: string;
}

/**
 * The shared retrofit target for every hand-rolled `type="password"` field.
 * The toggle button carries `aria-pressed` (its own state, "is the reveal
 * on") and an `aria-label` that flips with it. Focus is restored to the
 * input synchronously after the type-attribute flip so a keyboard user's
 * cursor position is never lost mid-edit.
 */
export function PasswordInput({
  id,
  name,
  value,
  onChange,
  autoComplete,
  required,
  minLength,
  'data-testid': dataTestId,
}: PasswordInputProps) {
  const [revealed, setRevealed] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  function toggleReveal() {
    setRevealed((current) => !current);
    // Restore focus after the re-render swaps the `type` attribute —
    // browsers can drop focus/selection on a type change otherwise.
    requestAnimationFrame(() => inputRef.current?.focus?.());
  }

  return (
    <span className="password-input">
      <input
        ref={inputRef}
        id={id}
        name={name}
        type={revealed ? 'text' : 'password'}
        autoComplete={autoComplete}
        required={required}
        minLength={minLength}
        value={value}
        onChange={onChange}
        data-testid={dataTestId}
      />
      <button
        type="button"
        className="password-input__toggle"
        aria-pressed={revealed}
        aria-label={revealed ? 'Hide password' : 'Show password'}
        onClick={toggleReveal}
        data-testid={dataTestId ? `${dataTestId}-toggle` : undefined}
      >
        {revealed ? 'Hide' : 'Show'}
      </button>
    </span>
  );
}
