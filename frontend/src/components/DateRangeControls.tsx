type Props = {
  fromDate: string;
  toDate: string;
  onChange: (next: { fromDate: string; toDate: string }) => void;
};

export function DateRangeControls({ fromDate, toDate, onChange }: Props) {
  return (
    <div className="filter-group">
      <label className="field">
        <span>From</span>
        <input
          type="date"
          value={fromDate}
          onChange={(event) => onChange({ fromDate: event.target.value, toDate })}
        />
      </label>
      <label className="field">
        <span>To</span>
        <input
          type="date"
          value={toDate}
          onChange={(event) => onChange({ fromDate, toDate: event.target.value })}
        />
      </label>
    </div>
  );
}
