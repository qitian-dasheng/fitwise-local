//! AI 采集通道 v1（0.11.0）：本机 Ollama → 饮食描述 → 结构化营养草稿。
//!
//! 边界（与用户的隐私承诺一致）：
//! - 只连接用户配置的 Ollama 地址（默认 localhost:11434），**无任何外网请求**；
//! - 草稿是估算辅助（source=ai_estimate、confidence=low），必须人工确认修改后才入账，
//!   本模块只返回草稿数据，**不落信封、不写审计**；
//! - 通道默认关闭，显式开启才可调用。

use serde_json::{json, Value};

const OLLAMA_TIMEOUT_SECS: u64 = 120;
const LIST_TIMEOUT_SECS: u64 = 10;
const DRAFT_MAX_ITEMS: usize = 30;

/// Ollama HTTP 客户端抽象：测试可注入 mock（避免真实网络）。
pub(crate) trait OllamaClient {
    /// POST {base}/api/chat（JSON 约束输出），返回模型消息文本。
    fn chat(&self, base: &str, model: &str, prompt: &str) -> Result<String, String>;
}

pub(crate) struct HttpOllamaClient;

impl HttpOllamaClient {
    /// 发一次 /api/chat。`send_think_flag` 控制是否带 `"think": false`。
    fn post(
        &self,
        client: &reqwest::blocking::Client,
        base: &str,
        model: &str,
        prompt: &str,
        send_think_flag: bool,
    ) -> Result<reqwest::blocking::Response, String> {
        let mut payload = json!({
            "model": model,
            "messages": [{"role": "user", "content": prompt}],
            "stream": false,
            "format": "json",
            // temperature 0：结构化抽取要确定性；num_predict 防止跑飞；
            // keep_alive 让模型驻留 30 分钟，避免每次重试都重新加载。
            "options": {"temperature": 0, "num_predict": 2048},
            "keep_alive": "30m"
        });
        if send_think_flag {
            // qwen3.x 等思考型模型默认先生成上千字 thinking：既慢，又会吃掉 num_predict
            // 预算导致正文为空/被截断（实测 qwen3.5-4b-32k：开思考 28.7 秒且正文空，
            // 关思考 0.4 秒、thinking 0 字符、三条全部输出）。结构化抽取不需要思考过程。
            payload["think"] = json!(false);
        }
        client
            .post(format!("{base}/api/chat"))
            .json(&payload)
            .send()
            .map_err(|error| format!("Ollama 请求失败（{base}）：{error}"))
    }
}

impl OllamaClient for HttpOllamaClient {
    fn chat(&self, base: &str, model: &str, prompt: &str) -> Result<String, String> {
        let base = base.trim_end_matches('/');
        let client = reqwest::blocking::Client::builder()
            .timeout(std::time::Duration::from_secs(OLLAMA_TIMEOUT_SECS))
            .build()
            .map_err(|error| format!("无法创建 HTTP 客户端：{error}"))?;
        let first = self.post(&client, base, model, prompt, true)?;
        let response = if first.status().is_success() {
            first
        } else if first.status() == reqwest::StatusCode::BAD_REQUEST {
            // 只有 400 才意味着「参数不被接受」（个别模型不认识 think），去掉后重试一次。
            // 5xx 是服务端故障（例如模型加载失败），重试无意义，直接报错。
            let retry = self.post(&client, base, model, prompt, false)?;
            if !retry.status().is_success() {
                return Err(format!("Ollama 返回错误状态 {}", retry.status()));
            }
            retry
        } else {
            return Err(format!(
                "Ollama 返回错误状态 {}（模型可能未能加载：内存不足或量化不兼容，可换更小的模型重试）",
                first.status()
            ));
        };
        let body: Value = response
            .json()
            .map_err(|error| format!("Ollama 响应不是 JSON：{error}"))?;
        body["message"]["content"]
            .as_str()
            .map(str::to_owned)
            .ok_or_else(|| "Ollama 响应缺少 message.content。".into())
    }
}

const DRAFT_PROMPT: &str = "\
你是营养记录助手。用户会用一句话描述一餐吃了什么，你要把描述拆成**逐项**的食物列表。\
规则：\
1. 每一种**不同**的食物单独一条，**绝不合并、绝不遗漏**；数量词（一个/一杯/半个/一碗）写进 amountLabel。\
2. 示例：「早上一个鸡蛋一杯豆浆半个馒头」必须输出 **3 条**：鸡蛋、豆浆、馒头（而不是 1 条）。\
3. 营养值按**该份量**估算；不确定填 null，不要编造。\
4. 只输出 JSON，不要任何解释文字。\
格式：{\"items\":[{\"name\":\"食物名\",\"amountLabel\":\"份量\",\"nutrition\":{\"calories\":数字|null,\"protein\":数字|null,\"carbohydrates\":数字|null,\"fat\":数字|null,\"fiber\":数字|null,\"sugar\":数字|null,\"sodium\":数字|null}}]}\
营养单位固定：千卡/克/克/克/克/克/毫克。\n\n用户描述：";

/// 列出 Ollama 已装模型（连接测试共用）。
pub(crate) fn list_ollama_models(base: &str) -> Result<Vec<String>, String> {
    let base = base.trim_end_matches('/');
    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(LIST_TIMEOUT_SECS))
        .build()
        .map_err(|error| format!("无法创建 HTTP 客户端：{error}"))?;
    let response = client
        .get(format!("{base}/api/tags"))
        .send()
        .map_err(|error| format!("无法连接 Ollama（{base}）：{error}"))?;
    if !response.status().is_success() {
        return Err(format!("Ollama 返回错误状态 {}", response.status()));
    }
    let body: Value = response
        .json()
        .map_err(|error| format!("Ollama 响应不是 JSON：{error}"))?;
    Ok(body["models"]
        .as_array()
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item["name"].as_str().map(str::to_owned))
                .collect()
        })
        .unwrap_or_default())
}

/// 草稿条目校验：name 缺失/空白 → None（跳过该条）；营养值未知/非法一律置 unknown（ai_estimate + low）。
fn sanitize_draft(raw: &Value) -> Option<Value> {
    let name = raw["name"]
        .as_str()
        .map(str::trim)
        .filter(|value| !value.is_empty())?;
    if name.chars().count() > 120 {
        return None;
    }
    if name.chars().count() > 120 {
        return None; // 超长名跳过（AI 噪声，非用户输入）。
    }
    let nutrient = |key: &str, unit: &str| match raw["nutrition"][key].as_f64() {
        Some(number) if number.is_finite() && number >= 0.0 => {
            json!({"state": "known", "value": number, "unit": unit, "source": "ai_estimate", "confidence": "low"})
        }
        _ => {
            json!({"state": "unknown", "unit": unit, "source": "ai_estimate", "confidence": "low"})
        }
    };
    let amount_label = raw["amountLabel"]
        .as_str()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    Some(json!({
        "name": name,
        "amountLabel": amount_label.unwrap_or("AI 估计"),
        "nutrition": {
            "calories": nutrient("calories", "kcal"),
            "protein": nutrient("protein", "g"),
            "carbohydrates": nutrient("carbohydrates", "g"),
            "fat": nutrient("fat", "g"),
            "fiber": nutrient("fiber", "g"),
            "sugar": nutrient("sugar", "g"),
            "sodium": nutrient("sodium", "mg"),
        },
    }))
}

/// 采集主体：描述 → Ollama → 校验后的草稿列表。client 参数化以便测试注入。
pub(crate) fn generate_draft_with(
    client: &dyn OllamaClient,
    base: &str,
    model: &str,
    description: &str,
) -> Result<Value, String> {
    let description = description.trim();
    if description.is_empty() {
        return Err("描述不能为空。".into());
    }
    if description.chars().count() > 2000 {
        return Err("描述不能超过 2000 字。".into());
    }
    let raw = client.chat(base, model, &format!("{DRAFT_PROMPT}{description}"))?;
    // 模型可能把 JSON 包在 ```json 围栏里：剥壳后解析。
    let stripped = raw
        .trim()
        .trim_start_matches("```json")
        .trim_start_matches("```")
        .trim_end_matches("```")
        .trim();
    let parsed: Value = serde_json::from_str(stripped).map_err(|error| {
        format!(
            "AI 输出无法解析为 JSON（{error}）。原始输出已保留，可人工参考：{}",
            raw.chars().take(400).collect::<String>()
        )
    })?;
    let raw_items = parsed["items"]
        .as_array()
        .ok_or("AI 输出缺少 items 数组。原始输出已保留，可人工参考。")?;
    if raw_items.len() > DRAFT_MAX_ITEMS {
        return Err(format!("AI 草稿超过 {DRAFT_MAX_ITEMS} 条，请拆分描述。"));
    }
    let items: Vec<Value> = raw_items.iter().filter_map(sanitize_draft).collect();
    if items.is_empty() {
        return Err("AI 没有提取到食物。请补充描述后重试，或人工记录。".into());
    }
    Ok(json!({"model": model, "items": items}))
}

pub(crate) fn generate_draft(base: &str, model: &str, description: &str) -> Result<Value, String> {
    generate_draft_with(&HttpOllamaClient, base, model, description)
}

// ── Tauri 命令 ──────────────────────────────────────────────

// Tauri 的**同步**命令跑在主线程，而这里用的是 `reqwest::blocking`（最长 120 秒）。
// 同步命令会直接把窗口卡成「未响应」——实测在 35B 模型上必现。
// 因此两条命令都改成 async，并把阻塞调用丢进 spawn_blocking，主线程只等结果。
#[tauri::command]
pub async fn ollama_list_models(base: String) -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(move || list_ollama_models(&base))
        .await
        .map_err(|error| format!("Ollama 请求线程异常：{error}"))?
}

#[tauri::command]
pub async fn ollama_draft(base: String, model: String, description: String) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || generate_draft(&base, &model, &description))
        .await
        .map_err(|error| format!("Ollama 请求线程异常：{error}"))?
}

#[cfg(test)]
mod tests {
    use super::*;
    include!("ai_collect_tests.rs");
}
