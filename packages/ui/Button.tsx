import { type ButtonHTMLAttributes, type ReactNode } from 'react';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children?: ReactNode;
  variant?: 'primary' | 'secondary' | 'danger';
}

export function Button({
  children,
  variant = 'primary',
  className,
  ...props
}: ButtonProps) {
  const variantClass =
    variant === 'secondary'
      ? 'button button--secondary'
      : variant === 'danger'
        ? 'button button--danger'
        : 'button';

  return (
    <button
      className={className ? `${variantClass} ${className}` : variantClass}
      {...props}
    >
      {children}
    </button>
  );
}
