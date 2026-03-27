type Item = {
  label: string;
  value: number;
  valueDisplay?: string;
};

type Props = {
  items: Item[];
  valuePrefix?: string;
  emptyHint?: string;
};

export function HorizontalBarList({ items, valuePrefix = "", emptyHint }: Props) {
  if (items.length === 0) {
    return emptyHint ? <p className="inline-note">{emptyHint}</p> : null;
  }

  const max = Math.max(...items.map((item) => item.value), 1);

  return (
    <div className="h-bar-list">
      {items.map((item) => {
        const pct = Math.max(4, (item.value / max) * 100);
        const text = item.valueDisplay ?? `${valuePrefix}${item.value.toLocaleString("en-US")}`;
        return (
          <div className="h-bar-list__row" key={item.label}>
            <div className="h-bar-list__label">
              <span className="h-bar-list__name">{item.label}</span>
              <span className="h-bar-list__value">{text}</span>
            </div>
            <div className="h-bar-list__track">
              <div className="h-bar-list__fill" style={{ width: `${pct}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
