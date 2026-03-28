import type { ReactNode } from "react";

type Props = {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
  hideContext?: boolean;
};

export function PageHeader({ title, actions, hideContext = false }: Props) {
  return (
    <div className={`page-header ${hideContext ? "page-header--contextless" : ""}`.trim()}>
      {!hideContext ? (
        <div className="page-header__context">
          <span className="page-header__title">{title}</span>
        </div>
      ) : null}
      {actions ? <div className="page-header__actions">{actions}</div> : null}
    </div>
  );
}
