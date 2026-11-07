import { useTheme } from './ThemeContext';

export interface ThemeToggleProps {
  className?: string;
}

export function ThemeToggle({ className = '' }: ThemeToggleProps) {
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === 'dark';

  return (
    <button
      type="button"
      onClick={toggleTheme}
      className={`theme-toggle ${className}`}
      aria-label={isDark ? 'লাইট মোড চালু করুন' : 'ডার্ক মোড চালু করুন'}
      title={isDark ? 'লাইট মোড' : 'ডার্ক মোড'}
      data-testid="theme-toggle-btn"
    >
      <span className="theme-toggle__icon" aria-hidden="true">
        {isDark ? '☀️' : '🌙'}
      </span>
      <span className="theme-toggle__label sr-only">
        {isDark ? 'লাইট মোড চালু করুন' : 'ডার্ক মোড চালু করুন'}
      </span>
    </button>
  );
}
