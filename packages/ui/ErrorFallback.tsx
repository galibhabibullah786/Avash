
export function ErrorFallback() {
  return (
    <main className="page" role="alert">
      <h1 className="page__title">কিছু ভুল হয়েছে</h1>
      <p className="page__description">
        Something went wrong. Please refresh the page and try again.
      </p>
    </main>
  );
}
