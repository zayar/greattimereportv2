import type { ReactNode } from "react";

type Props = {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
  hideContext?: boolean;
};

export function PageHeader({ eyebrow, title, description, actions, hideContext = false }: Props) {
  return (
    <div className={`page-header ${hideContext ? "page-header--contextless" : ""}`.trim()}>
      {!hideContext ? (
        <div className="page-header__context">
          {eyebrow ? <span className="page-header__eyebrow">{eyebrow}</span> : null}
          <span className="page-header__title">{title}</span>
          {description ? <p className="page-header__description">{description}</p> : null}
        </div>
      ) : null}
      {actions ? <div className="page-header__actions">{actions}</div> : null}
    </div>
  );
}
