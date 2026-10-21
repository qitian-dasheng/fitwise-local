import { Activity } from "lucide-react";

/**
 * 周降幅刻度条：把「滚动 7 天均值 − 前 7 天均值」画在一条轴上，
 * 安全区间由当前体重推导，红线就是区间右端，不再另写一个魔数。
 */
export function WeeklyDeltaGauge({
  delta,
  minRate,
  maxRate,
}: {
  delta: number | null;
  minRate: number;
  maxRate: number;
}) {
  const drop = delta === null ? null : Math.round(-delta * 100) / 100;
  // 轴的上限留出超出红线的空间，否则「降太快」的指针会贴在边缘看不出超了多少。
  const scaleMax = Math.max(maxRate * 1.8, 0.2);
  const position = (value: number) => `${Math.max(0, Math.min(1, value / scaleMax)) * 100}%`;

  const tone =
    drop === null
      ? "muted"
      : drop > maxRate
        ? "warn"
        : drop >= minRate
          ? "ok"
          : "muted";

  const reading =
    drop === null
      ? "待记录"
      : drop > 0
        ? `−${drop.toFixed(2)} kg`
        : drop < 0
          ? `+${Math.abs(drop).toFixed(2)} kg`
          : "持平";

  return (
    <section className="card review-gauge">
      <div className="gauge-head">
        <div className="gauge-title">
          <span className="gauge-icon"><Activity size={18} /></span>
          <div>
            <p className="eyebrow">滚动 7 天 vs 前 7 天</p>
            <h2>周降幅</h2>
          </div>
        </div>
        <strong className={`gauge-value gauge-${tone}`}>{reading}</strong>
      </div>

      <div className="gauge-track" role="img" aria-label={`周降幅 ${reading}`}>
        <div
          className="gauge-safe"
          style={{ left: position(minRate), width: `${(Math.min(maxRate, scaleMax) - Math.min(minRate, scaleMax)) / scaleMax * 100}%` }}
        />
        {drop !== null && <i className={`gauge-pin gauge-pin-${tone}`} style={{ left: position(Math.max(0, drop)) }} />}
      </div>
      <div className="gauge-scale">
        <span>0</span>
        <span>安全 {minRate.toFixed(2)}</span>
        <span>上限 {maxRate.toFixed(2)} kg/周</span>
      </div>
      <p className="gauge-note">
        {drop === null
          ? "本周与前一周各自需要至少 3 天体重记录才能比较，先连续称几天。"
          : "安全区间按当前体重的 0.5%–1.0% 推导；这条轴只反映体重均值变化，不评估体成分。"}
      </p>
    </section>
  );
}
