import { useState } from "react";
import { Modal } from "./Modal";
import { useConfirmedAction } from "./useConfirmedAction";
import { useAppStore } from "../store/appStore";
import {
  MEASUREMENT_CONDITION_OPTIONS,
  MEASUREMENT_NOTE_LIMIT,
  formatWeight,
  measurementConditionLabel,
  measurementTime,
  validateWeightInput,
} from "../domain/body";
import { diaryToday } from "../domain/diary";
import type { BodyMeasurement, MeasurementCondition } from "../domain/types";

const fieldFor = (measurement: BodyMeasurement) => ({
  date: measurement.date,
  time: measurement.measuredAt ? measurement.measuredAt.slice(11, 16) : "",
  condition: measurement.condition ?? ("" as MeasurementCondition | ""),
  weight: String(measurement.weightKg),
  note: measurement.note ?? "",
});

export function WeightCorrectionModal({
  measurement,
  mode = "edit",
  onClose,
}: {
  measurement: BodyMeasurement;
  mode?: "edit" | "void";
  onClose: () => void;
}) {
  const action = useConfirmedAction();
  const reviseWeight = useAppStore((state) => state.reviseWeight);
  const voidWeight = useAppStore((state) => state.voidWeight);
  const [voided, setVoided] = useState(mode === "void");
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const initial = fieldFor(measurement);
  const [date, setDate] = useState(initial.date);
  const [time, setTime] = useState(initial.time);
  const [condition, setCondition] = useState<MeasurementCondition | "">(initial.condition);
  const [weight, setWeight] = useState(initial.weight);
  const [note, setNote] = useState(initial.note);
  const parsed = validateWeightInput(weight);
  const parsedError = weight.trim() ? parsed.error : undefined;

  const diffRows: { label: string; from: string; to: string }[] = [];
  if (!voided) {
    diffRows.push({ label: "称重日期", from: measurement.date, to: date });
    diffRows.push({ label: "称重时刻", from: measurementTime(measurement), to: time || "未标注" });
    diffRows.push({
      label: "称重条件",
      from: measurementConditionLabel(measurement),
      to: condition ? measurementConditionLabel({ ...measurement, condition }) : "未标注",
    });
    diffRows.push({
      label: "体重",
      from: `${formatWeight(measurement.weightKg)} kg`,
      to: `${parsed.value !== undefined ? formatWeight(parsed.value) : weight} kg`,
    });
    diffRows.push({ label: "备注", from: measurement.note || "—", to: note.trim() || "—" });
  }

  return (
    <Modal title={voided ? "作废体重记录" : "更正体重记录"} onClose={() => { if (!action.busy) onClose(); }}>
      <form
        className="form"
        onSubmit={async (event) => {
          event.preventDefault();
          if (!voided && parsed.error) return;
          const trimmedReason = reason.trim();
          const result = voided
            ? await action.run(JSON.stringify({ voided, id: measurement.id, trimmedReason }), (id) =>
                voidWeight({ measurementId: measurement.id, reason: trimmedReason }, id),
              )
            : await action.run(JSON.stringify({ voided, id: measurement.id, trimmedReason, date, time, condition, weight }), (id) =>
                reviseWeight(
                  {
                    measurementId: measurement.id,
                    weightKg: parsed.value ?? measurement.weightKg,
                    date,
                    ...(time ? { time } : {}),
                    ...(condition ? { condition } : {}),
                    ...(note.trim() ? { note: note.trim() } : {}),
                    reason: trimmedReason,
                  },
                  id,
                ),
              );
          if (!result.error) onClose();
        }}
      >
        <fieldset className="library-fields" disabled={action.busy}>
          <div className="ratio-summary">
            <div>
              <strong>{formatWeight(measurement.weightKg)} kg</strong>
              <span>
                原记录：{measurement.date} · {measurementTime(measurement)} · {measurementConditionLabel(measurement)}
              </span>
            </div>
          </div>
          <p className="form-hint">更正会保留旧值（标为「已更正」）并新增一条记录；作废只把这条移出汇总，两者都要留下原因。</p>
          <label className="checkbox-label">
            <input type="checkbox" checked={voided} onChange={(event) => { setVoided(event.target.checked); setConfirmed(false); }} />
            <span>作废这次称重（不计入趋势与变化值，不可一键恢复）</span>
          </label>
          {voided && (
            <p className="library-notice">作废不会删除这一行：日期、体重与原因仍可在历史里查到，只是不再参与趋势计算，也不能一键撤销。</p>
          )}
          {!voided && (
            <dl className="correction-diff">
              {diffRows.map((row) => (
                <div key={row.label} className={row.from !== row.to ? "changed" : ""}>
                  <dt>{row.label}</dt>
                  <dd>
                    <s>{row.from}</s> → <b>{row.to}</b>
                  </dd>
                </div>
              ))}
            </dl>
          )}
          {!voided && (
            <>
              <div className="form-grid">
                <label>
                  <span>称重日期</span>
                  <input type="date" required max={diaryToday()} value={date} onChange={(event) => setDate(event.target.value)} />
                </label>
                <label>
                  <span>称重时刻（可留空＝未标注）</span>
                  <input type="time" value={time} onChange={(event) => setTime(event.target.value)} />
                </label>
              </div>
              <div className="form-grid">
                <label>
                  <span>体重（kg，两位小数）</span>
                  <input
                    type="number"
                    inputMode="decimal"
                    required
                    min={20}
                    max={400}
                    step="0.01"
                    value={weight}
                    onChange={(event) => setWeight(event.target.value)}
                  />
                </label>
                <label>
                  <span>称重条件</span>
                  <select value={condition} onChange={(event) => setCondition(event.target.value as MeasurementCondition | "")}>
                    <option value="">未标注</option>
                    {MEASUREMENT_CONDITION_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </label>
              </div>
              {parsedError && <p className="form-error" role="alert">{parsedError}</p>}
              <label>
                <span>备注（可选）</span>
                <input
                  maxLength={MEASUREMENT_NOTE_LIMIT}
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  placeholder="例如 起床后未进食"
                />
              </label>
            </>
          )}
          <label>
            <span>修改／作废原因</span>
            <textarea
              required
              maxLength={200}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="例如 秤没归零，重新称了一次"
            />
          </label>
          <label className="checkbox-label">
            <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
            <span>我已核对修改内容及其对趋势与变化值的影响</span>
          </label>
          {action.message && <p className="form-error" role="alert">{action.message}</p>}
          <button
            className={`button ${voided ? "danger" : "primary"} wide`}
            disabled={action.busy || !confirmed || !reason.trim() || (!voided && !!parsed.error)}
          >
            {action.busy ? "正在保存…" : voided ? "确认作废并保留原记录" : "确认更正并保留旧版本"}
          </button>
        </fieldset>
      </form>
    </Modal>
  );
}
