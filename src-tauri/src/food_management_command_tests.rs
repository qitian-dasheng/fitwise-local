// 食材管理命令测试：归档 / 未引用永久删除 / 未引用身份纠错。
// 复用 domain_commands 测试模块脚手架；由 `mod tests` include! 进来。

fn recipe_with(version_id: &str, quantity: f64) -> Value {
    json!({"name":"自制燕麦","totalMinutes":10,"equipment":["电磁炉"],"ingredients":[{"foodVersionId":version_id,"quantity":quantity,"unit":"package"}]})
}

#[test]
fn archive_hides_from_pickers_but_keeps_history_versions_and_favorite() {
    let mut c = connection();
    execute_with_connection(
        &mut c,
        request("mgmt-seed", "save_food_definition", food_payload(), Some(bootstrap())),
    )
    .unwrap();
    let recorded = execute_with_connection(
        &mut c,
        request("mgmt-meal", "record_food_meal", json!({"date": now_and_date().1, "type": "breakfast", "entries": [{"foodVersionId": "food-version-mgmt-seed", "quantity": 50, "unit": "g"}]}), None),
    )
    .unwrap();
    execute_with_connection(
        &mut c,
        request("mgmt-favorite", "set_food_favorite", json!({"foodId": "food-mgmt-seed", "favorite": true}), None),
    )
    .unwrap();
    let meal_before = last_meal(&recorded).clone();
    let before = load_envelope(&c).unwrap();

    execute_with_connection(
        &mut c,
        request("mgmt-archive", "set_food_archived", json!({"foodId": "food-mgmt-seed", "archived": true}), None),
    )
    .unwrap();

    let after = execute_with_connection(&mut c, request("mgmt-peek", "set_checkin", json!({"date": now_and_date().1}), None)).unwrap();
    // 日常挑选三个模式都看不到归档项，「已归档」模式才能看到。
    for mode in ["all", "recent", "favorites"] {
        assert!(crate::food_library::search_state(after.state.as_object().unwrap(), "", mode).unwrap().is_empty(), "归档后 {mode} 仍可见");
    }
    let archived = crate::food_library::search_state(after.state.as_object().unwrap(), "", "archived").unwrap();
    assert_eq!(archived.len(), 1);
    assert_eq!(archived[0]["definition"]["archived"], true);
    assert_eq!(archived[0]["definition"]["favorite"], true, "收藏状态不得被归档改动");
    // 历史餐食与营养版本原样保留。
    assert_eq!(last_meal(&after), &meal_before);
    assert_eq!(after.state["foodDefinitionVersions"].as_array().unwrap().len(), 1);
    assert_ne!(load_envelope(&c).unwrap(), before, "归档是真实写入");

    // 取消归档后恢复可见。
    execute_with_connection(
        &mut c,
        request("mgmt-unarchive", "set_food_archived", json!({"foodId": "food-mgmt-seed", "archived": false}), None),
    )
    .unwrap();
    let restored = execute_with_connection(&mut c, request("mgmt-peek-2", "set_checkin", json!({"date": now_and_date().1}), None)).unwrap();
    assert_eq!(crate::food_library::search_state(restored.state.as_object().unwrap(), "", "all").unwrap().len(), 1);
    assert!(crate::food_library::search_state(restored.state.as_object().unwrap(), "", "archived").unwrap().is_empty());
}

#[test]
fn archived_food_still_flows_through_recipe_snapshots() {
    let mut c = connection();
    execute_with_connection(
        &mut c,
        request("mgmt-recipe-food", "save_food_definition", food_payload(), Some(bootstrap())),
    )
    .unwrap();
    let saved = execute_with_connection(
        &mut c,
        request("mgmt-recipe-version", "save_recipe_version", recipe_with("food-version-mgmt-recipe-food", 1.0), None),
    )
    .unwrap();
    let recipe_id = saved_recipe_id(&saved);
    execute_with_connection(
        &mut c,
        request("mgmt-recipe-archive", "set_food_archived", json!({"foodId": "food-mgmt-recipe-food", "archived": true}), None),
    )
    .unwrap();

    // 归档不阻挡已保存菜谱按快照入餐。
    let recorded = execute_with_connection(
        &mut c,
        request("mgmt-recipe-meal", "record_recipe_meal", json!({"date": now_and_date().1, "type": "breakfast", "recipeVersionId": recipe_id, "entries": [{"foodVersionId": "food-version-mgmt-recipe-food", "quantity": 1, "unit": "package"}]}), None),
    )
    .unwrap();
    assert_eq!(last_meal(&recorded)["nutrition"]["calories"]["value"], 800.0);
    assert_eq!(last_meal(&recorded)["foodVersionId"], "food-version-mgmt-recipe-food");
}

#[test]
fn delete_refuses_every_reference_kind_and_leaves_no_trace() {
    let mut c = connection();
    execute_with_connection(
        &mut c,
        request("del-seed", "save_food_definition", food_payload(), Some(bootstrap())),
    )
    .unwrap();
    let today = now_and_date().1;
    // 引用一：当天餐食。
    execute_with_connection(
        &mut c,
        request("del-meal-today", "record_food_meal", json!({"date": today, "type": "breakfast", "entries": [{"foodVersionId": "food-version-del-seed", "quantity": 50, "unit": "g"}]}), None),
    )
    .unwrap();
    // 引用二：历史餐食（随后作废，作废条目同样算引用）。
    let old = execute_with_connection(
        &mut c,
        request("del-meal-old", "record_food_meal", json!({"date": "2026-10-01", "type": "lunch", "entries": [{"foodVersionId": "food-version-del-seed", "quantity": 50, "unit": "g"}]}), None),
    )
    .unwrap();
    let old_meal_id = old.result["mealIds"][0].as_str().unwrap().to_owned();
    execute_with_connection(
        &mut c,
        request("del-void", "void_meal", json!({"mealId": old_meal_id, "reason": "误记"}), None),
    )
    .unwrap();
    // 引用三：菜谱当前版本（建一个新菜谱直接引用该食材）。
    execute_with_connection(
        &mut c,
        request("del-recipe", "save_recipe_version", recipe_with("food-version-del-seed", 1.0), None),
    )
    .unwrap();
    // 引用四：被修订食材的旧菜谱版本——先修订食材，再把旧版本另存为新菜谱。
    let mut revision = food_payload();
    revision["foodId"] = json!("food-del-seed");
    revision["expectedVersionId"] = json!("food-version-del-seed");
    revision["input"]["nutrients"]["calories"] = json!(800);
    execute_with_connection(&mut c, request("del-revise", "revise_food_definition", revision, None)).unwrap();
    let old_recipe = execute_with_connection(
        &mut c,
        request("del-recipe-old", "save_recipe_version", recipe_with("food-version-del-seed", 2.0), None),
    )
    .unwrap();
    assert!(!saved_recipe_id(&old_recipe).is_empty());

    let before = load_envelope(&c).unwrap();
    let error = execute_with_connection(
        &mut c,
        request("del-attempt", "delete_food", json!({"foodId": "food-del-seed"}), None),
    )
    .unwrap_err();
    assert!(error.contains("引用"), "实际是：{error}");
    assert!(error.contains("归档"), "拒绝时要指向归档替代方案");
    assert_eq!(load_envelope(&c).unwrap(), before, "拒绝不得留下任何写入");
}

#[test]
fn delete_removes_definition_and_versions_and_keeps_them_recoverable_in_audit() {
    let mut c = connection();
    execute_with_connection(
        &mut c,
        request("delete-ok-seed", "save_food_definition", food_payload(), Some(bootstrap())),
    )
    .unwrap();
    // 先归档再删除同样允许（归档与删除正交）。
    execute_with_connection(
        &mut c,
        request("delete-ok-archive", "set_food_archived", json!({"foodId": "food-delete-ok-seed", "archived": true}), None),
    )
    .unwrap();

    let deleted = execute_with_connection(
        &mut c,
        request("delete-ok", "delete_food", json!({"foodId": "food-delete-ok-seed"}), None),
    )
    .unwrap();
    assert!(deleted.state["foodDefinitions"].as_array().unwrap().is_empty());
    assert!(deleted.state["foodDefinitionVersions"]
        .as_array()
        .unwrap()
        .iter()
        .all(|version| version["foodId"] != "food-delete-ok-seed"));
    // 被删完整内容进审计/回执：可经导出 JSON 手工恢复，但没有一键恢复 UI。
    let audit = deleted.state["auditEvents"].as_array().unwrap().last().unwrap();
    assert_eq!(audit["eventType"], "delete_food");
    assert_eq!(audit["payload"]["result"]["deletedDefinition"]["name"], "燕麦");
    assert_eq!(audit["payload"]["result"]["deletedVersions"].as_array().unwrap().len(), 1);

    let replay = execute_with_connection(
        &mut c,
        request("delete-ok", "delete_food", json!({"foodId": "food-delete-ok-seed"}), None),
    )
    .unwrap();
    assert!(replay.replayed);
    assert_eq!(replay.state, deleted.state);
    // 新 commandId 再删同一食材 → 明确报错，不产生悬空 ID。
    let again = execute_with_connection(
        &mut c,
        request("delete-ok-again", "delete_food", json!({"foodId": "food-delete-ok-seed"}), None),
    );
    assert!(again.is_err());
}

#[test]
fn corrects_name_and_brand_only_when_unreferenced_and_never_touches_versions() {
    let mut c = connection();
    execute_with_connection(
        &mut c,
        request("fix-seed", "save_food_definition", food_payload(), Some(bootstrap())),
    )
    .unwrap();
    let versions_before = execute_with_connection(&mut c, request("fix-peek", "set_checkin", json!({"date": now_and_date().1}), None)).unwrap().state["foodDefinitionVersions"].clone();

    let fixed = execute_with_connection(
        &mut c,
        request("fix-identity", "correct_food_identity", json!({"foodId": "food-fix-seed", "input": {"name": "原味燕麦片", "brand": "张垣大地", "measurementBasis": "packaged"}}), None),
    )
    .unwrap();
    let definition = &fixed.state["foodDefinitions"][0];
    assert_eq!(definition["name"], "原味燕麦片");
    assert_eq!(definition["brand"], "张垣大地");
    assert_eq!(fixed.state["foodDefinitionVersions"], versions_before, "纠错不动营养版本");
    assert_eq!(fixed.result["name"], "原味燕麦片");

    // 生熟状态变更一律拒绝并引导替代流程（历史版本口径不可静默改写）。
    let basis_error = execute_with_connection(
        &mut c,
        request("fix-basis", "correct_food_identity", json!({"foodId": "food-fix-seed", "input": {"name": "原味燕麦片", "measurementBasis": "raw"}}), None),
    )
    .unwrap_err();
    assert!(basis_error.contains("新建正确食材并归档旧项"), "实际是：{basis_error}");

    // 被餐食引用后纠错同样拒绝。
    execute_with_connection(
        &mut c,
        request("fix-meal", "record_food_meal", json!({"date": now_and_date().1, "type": "breakfast", "entries": [{"foodVersionId": "food-version-fix-seed", "quantity": 50, "unit": "g"}]}), None),
    )
    .unwrap();
    let referenced = execute_with_connection(
        &mut c,
        request("fix-again", "correct_food_identity", json!({"foodId": "food-fix-seed", "input": {"name": "又改名", "measurementBasis": "packaged"}}), None),
    );
    assert!(referenced.is_err());
}

#[test]
fn legacy_definition_without_archived_flag_defaults_to_active() {
    // 0.9.0 形态的数据（没有 archived 键）必须照常读取，且默认不进归档视图。
    let mut state = Map::new();
    state.insert("profile".into(), json!({"name": "test"}));
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
    let unknown_metric = |unit: &str| json!({"state": "unknown", "unit": unit, "source": "manual", "confidence": "low"});
    state.insert(
        "foodDefinitions".into(),
        json!([{"id": "food-legacy", "name": "旧食材", "measurementBasis": "raw", "activeVersionId": "food-version-legacy", "favorite": false, "createdAt": "2026-10-01T00:00:00Z"}]),
    );
    state.insert(
        "foodDefinitionVersions".into(),
        json!([{
            "id": "food-version-legacy",
            "foodId": "food-legacy",
            "version": 1,
            "basis": {"quantity": 100, "unit": "g"},
            "energyUnit": "kcal",
            "labelNutrients": {"calories": 100},
            "conversions": [],
            "nutrition": {
                "calories": {"state": "known", "value": 100, "unit": "kcal", "source": "manual", "confidence": "high"},
                "protein": unknown_metric("g"),
                "carbohydrates": unknown_metric("g"),
                "fat": unknown_metric("g"),
                "fiber": unknown_metric("g"),
                "sugar": unknown_metric("g"),
                "sodium": unknown_metric("mg"),
            },
            "source": "manual",
            "confirmedBy": "test",
            "confirmedAt": "2026-10-01T00:00:00Z",
        }]),
    );
    let items = crate::food_library::search_state(&state, "", "all").unwrap();
    assert_eq!(items.len(), 1);
    assert_eq!(items[0]["definition"]["archived"], false);
    assert!(crate::food_library::search_state(&state, "", "archived").unwrap().is_empty());
}
