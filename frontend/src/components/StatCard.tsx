import { formatPercent } from "../utils/format";

type Props = {
  label: string;
  value: string;
  change: number;
};

export function StatCard({ label, value, change }: Props) {
  const tone = change >= 0 ? "positive" : "negative";

  return (
    <article className="stat-card">
      <span className="stat-card__label">{label}</span>
      <strong className="stat-card__value">{value}</strong>
      <span className={`stat-card__change stat-card__change--${tone}`}>{formatPercent(change)}</span>
    </article>
  );
}

