import { invoke } from "@tauri-apps/api/core";
import { Loader2, Sparkles } from "lucide-react";
import { useState } from "react";
import { Modal } from "./Modal";
import { useFoodPicker } from "../store/foodPicker";
import { nutrientText } from "../domain/nutritionDisplay";
import type { NutritionFacts } from "../domain/types";
import { generateAiDraft, type AiDraftItem } from "./AiSettingsModal";

const nutrientUnits: Record<string, string> = { calories: "kcal", protein: "g", carbohydrates: "g", fat: "g", fiber: "g", sugar: "g", sodium: "mg" };

/**
 * AI 描述采集弹窗（0.11.0）：自然语言 → Ollama 草稿（可编辑）→ 加入待确认篮子。
 * 草稿营养为模型估算（ai_estimate/low），确认走 BasketBar 人工核对；弹窗关闭即弃，不落库。
 */
export function AiDraftModal({ date, onClose }: { date: string; onClose: () => void }) {
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [model, setModel] = useState("");
  const [drafts, setDrafts] = useState<AiDraftItem[] | null>(null);
  const setBasket = useFoodPicker((picker) => picker.setBasket);

  function editDraft(index: number, patch: Partial<AiDraftItem>) {
    setDrafts((current) => current?.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item)) ?? null);
  }

  function addToBasket() {
    if (!drafts?.length) return;
    setBasket((items) => [
      ...items,
      ...drafts.map((item) => ({ foodVersionId: `ai-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, quantity: 100, unit: "g" as const, name: item.name, facts: item.nutrition })),
    ]);
  }

  async function generate() {
    setBusy(true);
    setError("");
    try {
      const result = await generateAiDraft(description);
      setModel(result.model);
      setDrafts(result.items);
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
    }
  }

  const factsOf = (item: AiDraftItem): NutritionFacts => item.nutrition;

  return (
    <Modal title="AI 描述记餐" onClose={() => { if (!busy) onClose(); }}>
      <p className="form-hint">用一句话描述这餐吃了什么，AI 生成营养草稿。草稿是模型估算（仅供参考），核对修改并确认后才写入记录。</p>
      <label><span>这餐吃了什么？</span>
        <textarea required maxLength={2000} rows={3} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="例如：早上吃了一个鸡蛋、一杯豆浆和半个馒头"/>
      </label>
      <div className="button-row">
        <button className="button primary" disabled={busy || !description.trim()} onClick={() => void generate()}>
          {busy ? <Loader2 size={15} className="animate-spin"/> : <Sparkles size={15}/>} {busy ? "生成中…" : "生成草稿"}
        </button>
        {model && <span className="form-hint">模型 {model}</span>}
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}

      {drafts && (
        <div className="ai-draft-list">
          <h3>营养草稿 · {drafts.length} 项（估算，需人工核对）</h3>
          {drafts.map((item, index) => (
            <div className="ai-draft-item" key={index}>
              <div className="ai-draft-name">
                <input aria-label={`食物名 ${index + 1}`} value={item.name} onChange={(event) => editDraft(index, { name: event.target.value })}/>
                <span className="status-pill neutral">AI 估算</span>
              </div>
              <div className="ai-draft-nutrients">
                {(["calories", "protein", "carbohydrates", "fat", "fiber", "sugar", "sodium"] as const).map((key) => (
                  <label key={key}>
                    <span>{key === "calories" ? "热量" : key === "protein" ? "蛋白" : key === "carbohydrates" ? "碳水" : key === "fat" ? "脂肪" : key === "fiber" ? "纤维" : key === "sugar" ? "糖" : "钠"} ({nutrientUnits[key]})</span>
                    <input type="number" min="0" step="any" aria-label={`${key} 数值`} value={item.nutrition[key]?.state === "known" ? String(item.nutrition[key].value ?? "") : ""} onChange={(event) => {
                      const raw = event.target.value;
                      const number = Number(raw);
                      const base = factsOf(item);
                      const known = raw !== "" && Number.isFinite(number) && number >= 0;
                      const nutrition: NutritionFacts = { ...base, [key]: known ? { state: "known", value: number, unit: nutrientUnits[key], source: "ai_estimate", confidence: "low" } : { state: "unknown", unit: nutrientUnits[key], source: "ai_estimate", confidence: "low" } };
                      editDraft(index, { nutrition });
                    }}/>
                  </label>
                ))}
              </div>
              <button className="text-button" onClick={() => setDrafts((current) => current?.filter((_, itemIndex) => itemIndex !== index) ?? null)}>移除</button>
            </div>
          ))}
          <div className="button-row">
            <button className="button primary" disabled={!drafts.length} onClick={() => { addToBasket(); onClose(); }}>
              <Sparkles size={15}/> 全部加入待确认篮子
            </button>
          </div>
          <p className="form-hint">加入后回饮食页的「待确认篮子」核对并确认写入；关闭本弹窗草稿即弃。</p>
        </div>
      )}
      <p className="form-hint">AI 只连接本机 Ollama，无任何外网请求；营养为模型估算，不是权威数据。</p>
    </Modal>
  );
}
