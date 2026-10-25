import { invoke } from "@tauri-apps/api/core";
import { Bot, Loader2 } from "lucide-react";
import { useState } from "react";
import { Modal } from "./Modal";
import { useAppStore } from "../store/appStore";
import type { NutritionFacts } from "../domain/types";

/** AI 采集设置（0.11.0）：Ollama 地址/模型/开关。默认关闭。 */
export interface AiCollectSettings {
  enabled: boolean;
  base: string;
  model: string;
}

const AI_SETTINGS_KEY = "qingheng.ai-collect.settings";
const DEFAULT_SETTINGS: AiCollectSettings = { enabled: false, base: "http://localhost:11434", model: "" };

export function readAiCollectSettings(): AiCollectSettings {
  try {
    const raw = localStorage.getItem(AI_SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw);
    return {
      enabled: parsed.enabled === true,
      base: typeof parsed.base === "string" && parsed.base.trim() ? parsed.base.trim() : DEFAULT_SETTINGS.base,
      model: typeof parsed.model === "string" ? parsed.model : "",
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function writeAiCollectSettings(settings: AiCollectSettings): void {
  localStorage.setItem(AI_SETTINGS_KEY, JSON.stringify(settings));
}

export interface AiDraftItem {
  name: string;
  amountLabel: string;
  nutrition: NutritionFacts;
}

/** 生成草稿（桌面端调用 Rust；浏览器预览不支持 AI）。 */
export async function generateAiDraft(description: string): Promise<{ model: string; items: AiDraftItem[] }> {
  const settings = readAiCollectSettings();
  const result = await invoke<{ model: string; items: { name: string; amountLabel: string; nutrition: NutritionFacts }[] }>("ollama_draft", {
    base: settings.base,
    model: settings.model,
    description,
  });
  return {
    model: result.model,
    items: result.items.map((item) => ({ name: item.name, amountLabel: item.amountLabel, nutrition: item.nutrition })),
  };
}

/** 设置弹窗：连接测试 + 模型选择 + 总开关。 */
export function AiSettingsModal({ onClose }: { onClose: () => void }) {
  const [settings, setSettings] = useState(readAiCollectSettings);
  const [testing, setTesting] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  const [testError, setTestError] = useState("");
  const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

  function update(patch: Partial<AiCollectSettings>) {
    const next = { ...settings, ...patch };
    setSettings(next);
    writeAiCollectSettings(next);
  }

  async function testConnection() {
    setTesting(true);
    setTestError("");
    try {
      const found = await invoke<string[]>("ollama_list_models", { base: settings.base });
      setModels(found);
      if (!found.length) setTestError("连接成功，但 Ollama 里还没有模型。请先拉取一个模型（如 qwen3.5:9b）。");
      else if (!found.includes(settings.model)) update({ model: found[0] });
    } catch (cause) {
      setTestError(String(cause));
    } finally {
      setTesting(false);
    }
  }

  return (
    <Modal title="AI 采集" onClose={onClose}>
      <p className="form-hint">用自然语言描述吃了什么，AI 生成草稿供你核对——营养为模型估算（仅供参考），确认后才进入饮食记录。AI 只连接本机 Ollama，无任何外网请求。</p>
      <label className="checkbox-label">
        <input type="checkbox" checked={settings.enabled} onChange={(event) => update({ enabled: event.target.checked })}/>
        <span>启用 AI 采集（在饮食页显示入口）</span>
      </label>
      <div className="form-grid">
        <label><span>Ollama 地址</span><input value={settings.base} onChange={(event) => { setModels([]); update({ base: event.target.value }); }} placeholder="http://localhost:11434"/></label>
        <label><span>模型</span>
          {models.length ? (
            <select value={settings.model} onChange={(event) => update({ model: event.target.value })}>
              {models.map((model) => <option key={model} value={model}>{model}</option>)}
            </select>
          ) : (
            <input value={settings.model} onChange={(event) => update({ model: event.target.value })} placeholder="先点「测试连接」选择，或手动填写"/>
          )}
        </label>
      </div>
      <div className="button-row">
        <button className="button secondary small" disabled={!isTauri || testing || !settings.base.trim()} onClick={() => void testConnection()}>
          {testing ? <Loader2 size={15} className="animate-spin"/> : <Bot size={15}/>} 测试连接并列出模型
        </button>
      </div>
      {!isTauri && <p className="form-hint">浏览器预览不支持 AI 采集（需要桌面版调用本机 Ollama）。</p>}
      {testError && <p className="form-error" role="alert">{testError}</p>}
      {models.length > 0 && <p className="form-hint">已连接。找到 {models.length} 个模型，当前选择 {settings.model || "（未选择）"}。</p>}
      <div className="button-row"><button className="button primary small" onClick={onClose}>完成</button></div>
      <p className="form-hint">隐私口径：AI 采集只连接本机 Ollama；外网仍仅更新检查。</p>
    </Modal>
  );
}
