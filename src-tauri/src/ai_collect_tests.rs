// AI 采集通道测试：mock 客户端注入，绝不真实联网。

use serde_json::json;

struct MockClient {
    response: Result<String, String>,
}

impl OllamaClient for MockClient {
    fn chat(&self, _base: &str, _model: &str, _prompt: &str) -> Result<String, String> {
        self.response.clone()
    }
}

fn draft_response(items: Value) -> String {
    json!({"items": items}).to_string()
}

#[test]
fn generate_draft_sanitizes_and_defaults() {
    let client = MockClient {
        response: Ok(draft_response(json!([
            {"name":"鸡蛋","amountLabel":"2 个","nutrition":{"calories":140,"protein":12,"carbohydrates":null,"fat":9,"fiber":null,"sugar":null,"sodium":null}},
            {"name":"  ","nutrition":{"calories":-5}},
            {"name":"牛奶","amountLabel":"","nutrition":{"calories":"大量","protein":"ok"}}
        ]))),
    };
    let result = generate_draft_with(&client, "http://localhost:11434", "qwen3.5:9b", "早上吃了两个鸡蛋一杯牛奶").unwrap();
    let items = result["items"].as_array().unwrap();
    // 空名条目被剔除；非法数值一律置 unknown（ai_estimate + low）。
    assert_eq!(items.len(), 2);
    assert_eq!(items[0]["name"], "鸡蛋");
    assert_eq!(items[0]["nutrition"]["calories"]["value"], 140.0);
    assert_eq!(items[0]["nutrition"]["calories"]["source"], "ai_estimate");
    assert_eq!(items[0]["nutrition"]["calories"]["confidence"], "low");
    assert_eq!(items[0]["nutrition"]["carbohydrates"]["state"], "unknown");
    assert_eq!(items[1]["nutrition"]["calories"]["state"], "unknown");
    assert_eq!(items[1]["amountLabel"], "AI 估计");
}

#[test]
fn generate_draft_strips_code_fence_and_reports_errors() {
    // 围栏 JSON 剥壳
    let fenced = MockClient { response: Ok(format!("```json\n{}\n```", draft_response(json!([{"name":"豆腐"}])))) };
    let result = generate_draft_with(&fenced, "http://localhost:11434", "qwen3.5:9b", "一块豆腐").unwrap();
    assert_eq!(result["items"][0]["name"], "豆腐");

    // 空 items：明确报错
    let empty = MockClient { response: Ok(draft_response(json!([]))) };
    assert!(generate_draft_with(&empty, "b", "m", "描述").unwrap_err().contains("没有提取到食物"));

    // 坏 JSON：错误里带原始输出
    let bad = MockClient { response: Ok("这不是JSON".into()) };
    let error = generate_draft_with(&bad, "b", "m", "描述").unwrap_err();
    assert!(error.contains("无法解析") && error.contains("这不是JSON"));

    // 超限条目
    let many = MockClient { response: Ok(draft_response(json!((0..31).map(|index| json!({"name": format!("食物{index}")})).collect::<Vec<_>>()))) };
    assert!(generate_draft_with(&many, "b", "m", "描述").unwrap_err().contains("30 条"));

    // 空描述
    assert!(generate_draft_with(&MockClient { response: Ok("{}".into()) }, "b", "m", "  ").is_err());
}

#[test]
fn generate_draft_rejects_too_long_description() {
    let client = MockClient { response: Ok(draft_response(json!([{"name":"测试"}]))) };
    let long = "长".repeat(2001);
    assert!(generate_draft_with(&client, "b", "m", &long).unwrap_err().contains("2000 字"));
}
