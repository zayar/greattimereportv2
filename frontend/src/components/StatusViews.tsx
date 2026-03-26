type ViewProps = {
  label: string;
  detail?: string | null;
};

export function ScreenLoader({ label, detail }: ViewProps) {
  return (
    <div className="status-screen">
      <div className="status-card">
        <div className="spinner" />
        <h2>{label}</h2>
        {detail ? <p>{detail}</p> : null}
      </div>
    </div>
  );
}

export function EmptyState({ label, detail }: ViewProps) {
  return (
    <div className="empty-state">
      <div className="empty-state__icon">+</div>
      <div>
        <h3>{label}</h3>
        {detail ? <p>{detail}</p> : null}
      </div>
    </div>
  );
}

export function ErrorState({ label, detail }: ViewProps) {
  return (
    <div className="empty-state empty-state--danger">
      <div className="empty-state__icon">!</div>
      <div>
        <h3>{label}</h3>
        {detail ? <p>{detail}</p> : null}
      </div>
    </div>
  );
}

