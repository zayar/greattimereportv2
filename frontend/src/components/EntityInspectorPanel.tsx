import { useEffect, type PropsWithChildren, type ReactNode } from "react";

type Props = PropsWithChildren<{
  title: string;
  subtitle?: string;
  badge?: ReactNode;
  isPinned: boolean;
  canPin?: boolean;
  onClose: () => void;
  onTogglePin?: () => void;
  className?: string;
}>;

export function EntityInspectorPanel({
  title,
  subtitle,
  badge,
  isPinned,
  canPin = true,
  onClose,
  onTogglePin,
  className,
  children,
}: Props) {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  const panelMarkup = (
    <aside
      className={`entity-inspector ${isPinned ? "entity-inspector--pinned" : "entity-inspector--overlay"} ${
        className ?? ""
      }`.trim()}
      aria-label={title}
    >
      <header className="entity-inspector__header">
        <div className="entity-inspector__header-copy">
          <span className="entity-inspector__eyebrow">Quick detail</span>
          <div className="entity-inspector__title-row">
            <h3>{title}</h3>
            {badge ? <div className="entity-inspector__badge">{badge}</div> : null}
          </div>
          {subtitle ? <p>{subtitle}</p> : null}
        </div>

        <div className="entity-inspector__actions">
          {canPin && onTogglePin ? (
            <button type="button" className="button button--ghost entity-inspector__action-button" onClick={onTogglePin}>
              {isPinned ? "Unpin" : "Pin"}
            </button>
          ) : null}
          <button type="button" className="button button--secondary entity-inspector__action-button" onClick={onClose}>
            Close
          </button>
        </div>
      </header>

      <div className="entity-inspector__body">{children}</div>
    </aside>
  );

  if (isPinned) {
    return panelMarkup;
  }

  return (
    <>
      <button
        type="button"
        className="entity-inspector__scrim"
        aria-label="Close quick detail panel"
        onClick={onClose}
      />
      {panelMarkup}
    </>
  );
}
