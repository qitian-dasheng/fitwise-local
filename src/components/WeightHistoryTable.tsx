import { Ruler } from "lucide-react";
import {
  formatCm,
  formatPercent,
  formatWeight,
  measurementConditionLabel,
  measurementRows,
  measurementTime,
} from "../domain/body";
import type { BodyMeasurement } from "../domain/types";

export function WeightHistoryTable({
  measurements,
  onEdit,
  onVoid,
  onSetRepresentative,
}: {
  measurements: BodyMeasurement[];
  onEdit: (measurement: BodyMeasurement) => void;
  onVoid: (measurement: BodyMeasurement) => void;
  onSetRepresentative: (measurement: BodyMeasurement) => void;
}) {
  const rows = measurementRows(measurements);

  return (
    <section className="ui-card body-history">
      <div className="ui-card-heading compact">
        <div>
          <p className="eyebrow">含已更正与已作废，可随时回查</p>
          <h2>全部记录</h2>
        </div>
        <span className="status-pill neutral">{rows.length} 条</span>
      </div>

      {rows.length === 0 ? (
        <div className="body-empty">
          <Ruler size={26} />
          <strong>还没有体重记录</strong>
          <p>记录第一次称重后，这里会出现完整历史、每次的变化值，以及同一天的第几次称重。</p>
        </div>
      ) : (
        <div className="body-table-scroll">
          <div className="body-table">
            <div className="body-row body-head">
              <span>日期</span>
              <span>时刻</span>
              <span>体重 kg</span>
              <span>变化</span>
              <span>腰围 cm</span>
              <span>体脂 %</span>
              <span>条件</span>
              <span>备注</span>
              <span>操作</span>
            </div>
            {rows.map(({ measurement, delta, deltaTitle, dayIndex, dayTotal, isRepresentative }) => {
              const inactive = measurement.status === "superseded" || measurement.status === "void";
              return (
                <div
                  className={`body-row${inactive ? " body-row-inactive" : ""}`}
                  key={measurement.id}
                  data-status={measurement.status ?? "active"}
                >
                  <div className="body-cell-main">
                    <strong>{measurement.date}</strong>
                    <div className="body-row-tags">
                      {dayIndex !== null && dayIndex > 1 && <span className="status-pill neutral">当日第 {dayIndex} 次</span>}
                      {isRepresentative && <span className="status-pill success">当日代表</span>}
                      {measurement.status === "superseded" && <span className="status-pill warning">已更正</span>}
                      {measurement.status === "void" && <span className="status-pill neutral">已作废</span>}
                    </div>
                  </div>
                  <span className="body-cell-num">{measurementTime(measurement)}</span>
                  <strong className="body-cell-num">{formatWeight(measurement.weightKg)}</strong>
                  <span className={`body-cell-num${delta === "持平" ? " body-delta-flat" : delta.startsWith("-") ? " body-delta-down" : delta.startsWith("+") ? " body-delta-up" : ""}`} title={deltaTitle}>
                    {delta}
                  </span>
                  <span className="body-cell-num">{measurement.waistCm !== undefined ? formatCm(measurement.waistCm) : "—"}</span>
                  <span className="body-cell-num">{measurement.bodyFatPercent !== undefined ? formatPercent(measurement.bodyFatPercent) : "—"}</span>
                  <span className="body-cell-muted">{measurementConditionLabel(measurement)}</span>
                  <span className="body-cell-note">{measurement.note || "—"}</span>
                  <div className="body-cell-actions">
                    {inactive ? (
                      <span className="body-cell-reason">{measurement.correctionReason ?? "已失效"}</span>
                    ) : (
                      <>
                        {dayTotal > 1 && !isRepresentative && (
                          <button className="text-button" onClick={() => onSetRepresentative(measurement)}>设为代表</button>
                        )}
                        <button className="text-button" onClick={() => onEdit(measurement)}>编辑</button>
                        <button className="text-button warning-text" onClick={() => onVoid(measurement)}>作废</button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
