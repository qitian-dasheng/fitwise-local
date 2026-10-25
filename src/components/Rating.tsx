/** 主观状态打分（1–5）：今日页「这一天感觉怎么样」用；纯展示与回调，不落库。 */
export function Rating({ label, value, onChange, disabled }: { label: string; value?: number; onChange: (value: number) => void; disabled?: boolean }) {
  return (
    <div className="rating">
      <span>{label}</span>
      <div>{[1, 2, 3, 4, 5].map((item) => <button disabled={disabled} className={value === item ? "active" : ""} onClick={() => onChange(item)} key={item}>{item}</button>)}</div>
    </div>
  );
}
