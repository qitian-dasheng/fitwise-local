// 食物柜命令测试（0.9.4）：增量/单位/归档守卫、更新、删除、审计，
// 以及旧版信封（无 pantryItems）装载与重置保留语义。

use serde_json::json;

fn pantry_bootstrap() -> String {
    let mut state = Map::new();
    state.insert("profile".into(), json!({"name":"test"}));
    for collection in [
        "foodDefinitions",
        "foodDefinitionVersions",
        "meals",
        "checkIns",
        "measurements",
        "workouts",
        "recipes",
        "auditEvents",
    ] {
        state.insert(collection.into(), json!([]));
    }
    state.insert("pantryItems".into(), json!([]));
    state.insert(
        "foodDefinitions".into(),
        json!([
            {"id":"food-tofu","name":"北豆腐","archived":false},
            {"id":"food-egg","name":"鸡蛋","archived":false},
            {"id":"food-old","name":"旧食材","archived":true}
        ]),
    );
    serde_json::to_string(&json!({"state":state,"version":4})).unwrap()
}

fn pantry_request(id: &str, kind: &str, payload: Value) -> DomainCommandRequest {
    request(id, kind, payload, Some(pantry_bootstrap()))
}

fn pantry_items(state: &Value) -> &Vec<Value> {
    state["pantryItems"].as_array().unwrap()
}

#[test]
fn pantry_adjust_creates_increments_and_clamps() {
    let mut connection = connection();
    let first = execute_with_connection(
        &mut connection,
        pantry_request(
            "pantry-cmd-0001",
            "pantry_adjust",
            json!({"foodDefinitionId":"food-tofu","delta":500,"unit":"g","lowStockThreshold":200}),
        ),
    )
    .unwrap();
    assert!(first.applied);
    let items = pantry_items(&first.state);
    assert_eq!(items.len(), 1);
    assert_eq!(items[0]["foodDefinitionId"], "food-tofu");
    assert_eq!(items[0]["quantity"], 500.0);
    assert_eq!(items[0]["unit"], "g");
    assert_eq!(items[0]["lowStockThreshold"], 200.0);
    assert_eq!(items[0]["id"], "pantry-cmd-0001:pantry");

    let second = execute_with_connection(
        &mut connection,
        pantry_request(
            "pantry-cmd-0002",
            "pantry_adjust",
            json!({"foodDefinitionId":"food-tofu","delta":-150.5,"unit":"g"}),
        ),
    )
    .unwrap();
    assert_eq!(pantry_items(&second.state)[0]["quantity"], 349.5);

    // 取出超过存量：整条命令拒绝，数量保持不变。
    let over = execute_with_connection(
        &mut connection,
        pantry_request(
            "pantry-cmd-0003",
            "pantry_adjust",
            json!({"foodDefinitionId":"food-tofu","delta":-9999,"unit":"g"}),
        ),
    )
    .unwrap_err();
    assert!(over.contains("存量"));
    let replayed = execute_with_connection(
        &mut connection,
        pantry_request("pantry-cmd-0002", "pantry_adjust", json!({"foodDefinitionId":"food-tofu","delta":-150.5,"unit":"g"})),
    )
    .unwrap();
    assert!(replayed.replayed);
    assert_eq!(pantry_items(&replayed.state)[0]["quantity"], 349.5);
}

#[test]
fn pantry_adjust_guards_unit_food_and_archived() {
    let mut connection = connection();
    execute_with_connection(
        &mut connection,
        pantry_request(
            "pantry-guard-001",
            "pantry_adjust",
            json!({"foodDefinitionId":"food-egg","delta":10,"unit":"个"}),
        ),
    )
    .unwrap();
    // 单位不一致：拒绝，不做隐式换算。
    let mismatch = execute_with_connection(
        &mut connection,
        pantry_request(
            "pantry-guard-002",
            "pantry_adjust",
            json!({"foodDefinitionId":"food-egg","delta":1,"unit":"g"}),
        ),
    )
    .unwrap_err();
    assert!(mismatch.contains("不一致"));
    // 未知食材与归档食材都不能入柜。
    assert!(execute_with_connection(
        &mut connection,
        pantry_request("pantry-guard-003", "pantry_adjust", json!({"foodDefinitionId":"food-none","delta":1,"unit":"g"}))
    )
    .unwrap_err()
    .contains("建档"));
    assert!(execute_with_connection(
        &mut connection,
        pantry_request("pantry-guard-004", "pantry_adjust", json!({"foodDefinitionId":"food-old","delta":1,"unit":"g"}))
    )
    .unwrap_err()
    .contains("归档"));
    // 空柜不能直接取出；零增量无意义。
    assert!(execute_with_connection(
        &mut connection,
        pantry_request("pantry-guard-005", "pantry_adjust", json!({"foodDefinitionId":"food-tofu","delta":-1,"unit":"g"}))
    )
    .unwrap_err()
    .contains("先入库"));
    assert!(execute_with_connection(
        &mut connection,
        pantry_request("pantry-guard-006", "pantry_adjust", json!({"foodDefinitionId":"food-tofu","delta":0,"unit":"g"}))
    )
    .unwrap_err()
    .contains("不能为 0"));
}

#[test]
fn pantry_update_and_delete_write_audit_trail() {
    let mut connection = connection();
    execute_with_connection(
        &mut connection,
        pantry_request(
            "pantry-updt-0001",
            "pantry_adjust",
            json!({"foodDefinitionId":"food-tofu","delta":500,"unit":"g"}),
        ),
    )
    .unwrap();
    let updated = execute_with_connection(
        &mut connection,
        pantry_request(
            "pantry-updt-0002",
            "pantry_update_item",
            json!({"id":"pantry-updt-0001:pantry","lowStockThreshold":300,"expiresAt":"2026-12-01","note":"冰箱冷藏"}),
        ),
    )
    .unwrap();
    let item = &pantry_items(&updated.state)[0];
    assert_eq!(item["lowStockThreshold"], 300.0);
    assert_eq!(item["expiresAt"], "2026-12-01");
    assert_eq!(item["note"], "冰箱冷藏");
    // 空更新与非法日期拒绝。
    assert!(execute_with_connection(
        &mut connection,
        pantry_request("pantry-updt-0003", "pantry_update_item", json!({"id":"pantry-updt-0001:pantry"}))
    )
    .unwrap_err()
    .contains("没有要更新"));
    assert!(execute_with_connection(
        &mut connection,
        pantry_request("pantry-updt-0004", "pantry_update_item", json!({"id":"pantry-updt-0001:pantry","expiresAt":"2026/12/01"}))
    )
    .unwrap_err()
    .contains("YYYY-MM-DD"));

    let deleted = execute_with_connection(
        &mut connection,
        pantry_request("pantry-updt-0005", "pantry_delete_item", json!({"id":"pantry-updt-0001:pantry"})),
    )
    .unwrap();
    assert!(pantry_items(&deleted.state).is_empty());
    let events = deleted.state["auditEvents"].as_array().unwrap();
    let types: Vec<&str> = events.iter().filter_map(|item| item["eventType"].as_str()).collect();
    assert!(types.contains(&"pantry_created"));
    assert!(types.contains(&"pantry_item_updated"));
    assert!(types.contains(&"pantry_item_deleted"));
}

#[test]
fn legacy_state_without_pantry_collection_loads_and_backfills() {
    // 0.9.3 旧启动状态没有 pantryItems：装载要补空数组，命令照常可用。
    let mut state = Map::new();
    state.insert("profile".into(), json!({"name":"legacy"}));
    for collection in [
        "foodDefinitions", "foodDefinitionVersions", "meals", "checkIns",
        "measurements", "workouts", "recipes", "auditEvents",
    ] {
        state.insert(collection.into(), json!([]));
    }
    state.insert("foodDefinitions".into(), json!([{"id":"food-tofu","name":"北豆腐"}]));
    let legacy = serde_json::to_string(&json!({"state":state,"version":4})).unwrap();
    let mut connection = connection();
    let response = execute_with_connection(
        &mut connection,
        request(
            "pantry-legacy-001",
            "pantry_adjust",
            json!({"foodDefinitionId":"food-tofu","delta":250,"unit":"g"}),
            Some(legacy),
        ),
    )
    .unwrap();
    assert!(response.applied);
    assert_eq!(pantry_items(&response.state).len(), 1);
}

#[test]
fn reset_keeps_pantry_items_with_food_library() {
    let mut connection = connection();
    execute_with_connection(
        &mut connection,
        pantry_request(
            "pantry-rst--001",
            "pantry_adjust",
            json!({"foodDefinitionId":"food-tofu","delta":500,"unit":"g"}),
        ),
    )
    .unwrap();
    execute_with_connection(
        &mut connection,
        pantry_request("pantry-rst--002", "add_meal", json!({"date":"2026-10-20","type":"lunch","name":"测试","amountLabel":"1 份","calories":500,"protein":30})),
    )
    .unwrap();
    let result = crate::domain_store::reset_domain_records_with_connection(&mut connection).unwrap();
    assert_eq!(result.summary.kept_pantry_items, 1);
    assert_eq!(result.summary.cleared_meals, 1);
    assert_eq!(pantry_items(&result.state).len(), 1);
}
