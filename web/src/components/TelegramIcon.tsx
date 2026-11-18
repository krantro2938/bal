/** Telegram's paper plane in its brand circle (sources point to the official channel). */
export function TelegramIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 240 240" className={className} aria-hidden="true">
      <circle cx="120" cy="120" r="120" fill="#29a9eb" />
      <path
        fill="#fff"
        d="M54 117c35-15 58-25 70-30 33-14 40-16 45-16 1 0 3 0 5 2 1 1 2 3 2 4v6c-2 22-11 75-16 99-2 10-6 14-10 14-9 1-15-6-24-12l-33-22c-14-10-5-15 3-24 2-2 39-36 40-39v-2c-1-1-2-1-3-1-1 0-21 14-60 40-6 4-11 6-15 6-5 0-14-3-21-5-8-3-15-4-14-9 0-2 4-5 11-8z"
      />
    </svg>
  );
}
