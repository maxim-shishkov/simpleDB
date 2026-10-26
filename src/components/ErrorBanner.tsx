export function ErrorBanner({ message, onClose }: { message: string; onClose: () => void }) {
  return (
    <div className="error-banner">
      <span className="error-banner-text">{message}</span>
      <button className="error-banner-close" onClick={onClose}>
        ×
      </button>
    </div>
  );
}
