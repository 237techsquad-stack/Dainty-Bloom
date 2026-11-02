export default function FaqLoading() {
  return (
    <div className="commerce-page faq-page" role="status" aria-live="polite">
      <span className="sr-only">Loading frequently asked questions…</span>
      <div className="faq-page__loading" aria-hidden="true">
        <div className="commerce-skeleton__block" />
        <div className="commerce-skeleton__block" />
        <div className="commerce-skeleton__block" />
      </div>
    </div>
  );
}
