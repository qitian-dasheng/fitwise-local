export function NutritionRing({ value, max, label, color = "var(--green)", rangeLabel }: { value: number; max: number; label: string; color?: string; rangeLabel?: string }) {
  const ratio = Math.min(1, Math.max(0, value / max));
  return (
    <div className="nutrition-ring-wrap">
      <div
        className="nutrition-ring"
        style={{
          background: `conic-gradient(${color} ${ratio * 360}deg, var(--line-soft) 0deg)`,
        }}
      >
        <div className="nutrition-ring-inner">
          <strong>{Math.round(value)}</strong>
          <span>/ {rangeLabel ?? max}</span>
        </div>
      </div>
      <span className="ring-label">{label}</span>
    </div>
  );
}
