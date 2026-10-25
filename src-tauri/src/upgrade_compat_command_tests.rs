// 0.9.0 → 0.9.1 合成数据升级兼容验证。
// 只用临时文件库与手写合成信封（0.9.0 形态：食材无 archived 键），
// 绝不读取、复制或触碰用户真实数据库。由 `mod tests` include! 进来。

fn metric(key: &str, value: Option<f64>) -> Value {
    match value {
        Some(value) => json!({"state": if value == 0.0 { "zero" } else { "known" }, "value": value, "unit": if key == "calories" { "kcal" } else if key == "sodium" { "mg" } else { "g" }, "source": "label", "confidence": "high"}),
        None => json!({"state": "unknown", "unit": if key == "calories" { "kcal" } else if key == "sodium" { "mg" } else { "g" }, "source": "label", "confidence": "low"}),
    }
}

fn legacy_version(id: &str, food_id: &str, calories: f64) -> Value {
    json!({
        "id": id,
        "foodId": food_id,
        "version": 1,
        "basis": {"quantity": 100, "unit": "g"},
        "energyUnit": "kcal",
        "labelNutrients": {"calories": calories, "protein": 12.0},
        "conversions": [{"unit": "package", "quantity": 1, "basisQuantity": 200}],
        "nutrition": {
            "calories": metric("calories", Some(calories)),
            "protein": metric("protein", Some(12.0)),
            "carbohydrates": metric("carbohydrates", None),
            "fat": metric("fat", None),
            "fiber": metric("fiber", None),
            "sugar": metric("sugar", None),
            "sodium": metric("sodium", None),
        },
        "source": "label",
        "confirmedBy": "兼容验证",
        "confirmedAt": "2026-10-01T00:00:00+08:00",
    })
}

/// 0.9.0 形态的完整状态：8 个核心集合，食材定义没有 archived 键。
fn legacy_state() -> Map<String, Value> {
    let mut state = Map::new();
    state.insert("profile".into(), json!({
        "name": "兼容验证", "sex": "male", "age": 22, "heightCm": 172,
        "startWeightKg": 83.8, "targetWeightKg": 74, "timezone": "Asia/Shanghai",
        "dailyCalories": {"min": 1950, "target": 2000, "max": 2050},
        "proteinTargetG": 160, "fiberTargetG": 25, "equipment": ["电磁炉"],
    }));
    state.insert("foodDefinitions".into(), json!([
        {"id": "food-oats", "name": "燕麦", "brand": "example", "measurementBasis": "packaged", "activeVersionId": "food-version-oats", "favorite": true, "createdAt": "2026-10-01T00:00:00+08:00"},
        {"id": "food-tofu", "name": "北豆腐", "measurementBasis": "raw", "activeVersionId": "food-version-tofu", "favorite": false, "createdAt": "2026-10-01T00:00:00+08:00"},
        {"id": "food-spare", "name": "无人引用食材", "measurementBasis": "raw", "activeVersionId": "food-version-spare", "favorite": false, "createdAt": "2026-10-01T00:00:00+08:00"}
    ]));
    state.insert("foodDefinitionVersions".into(), json!([
        legacy_version("food-version-oats", "food-oats", 400.0),
        legacy_version("food-version-tofu", "food-tofu", 99.0),
        legacy_version("food-version-spare", "food-spare", 50.0),
    ]));
    state.insert("meals".into(), json!([{
        "id": "legacy-meal-1", "date": "2026-10-20", "type": "breakfast", "name": "燕麦",
        "amountLabel": "50克 · example",
        "nutrition": {"calories": metric("calories", Some(200.0)), "protein": metric("protein", Some(6.0)), "carbohydrates": metric("carbohydrates", None), "fat": metric("fat", None), "fiber": metric("fiber", None), "sugar": metric("sugar", None), "sodium": metric("sodium", None)},
        "consumedRatio": 1, "source": "label", "confidence": "high",
        "foodDefinitionId": "food-oats", "foodVersionId": "food-version-oats",
        "foodSnapshot": {
            "definition": {"id": "food-oats", "name": "燕麦", "brand": "example", "measurementBasis": "packaged", "activeVersionId": "food-version-oats", "favorite": true, "createdAt": "2026-10-01T00:00:00+08:00"},
            "version": legacy_version("food-version-oats", "food-oats", 400.0),
            "quantity": 50, "unit": "g", "factor": 0.5, "basisQuantity": 50,
        },
        "createdAt": "2026-10-20T08:00:00+08:00",
    }]));
    state.insert("checkIns".into(), json!([{"date": "2026-10-20", "complete": true, "completedAt": "2026-10-20T20:00:00+08:00"}]));
    state.insert("measurements".into(), json!([{"id": "legacy-weight-1", "date": "2026-10-20", "weightKg": 83.8, "status": "active", "createdAt": "2026-10-20T07:00:00+08:00"}]));
    state.insert("workouts".into(), json!([]));
    state.insert("recipes".into(), json!([{
        "id": "recipe-version-legacy", "recipeId": "recipe-legacy", "name": "燕麦餐", "version": 1,
        "ingredients": [{"foodId": "food-oats", "name": "燕麦", "amount": 200, "unit": "g", "measurementBasis": "package", "foodVersionId": "food-version-oats", "nutritionQuantity": 1, "nutritionUnit": "package", "foodSnapshot": {
            "definition": {"id": "food-oats", "name": "燕麦", "brand": "example", "measurementBasis": "packaged", "activeVersionId": "food-version-oats", "favorite": true, "createdAt": "2026-10-01T00:00:00+08:00"},
            "version": legacy_version("food-version-oats", "food-oats", 400.0),
            "quantity": 1, "unit": "package", "factor": 2, "basisQuantity": 200,
        }}],
        "nutrition": {"calories": metric("calories", Some(800.0)), "protein": metric("protein", Some(24.0)), "carbohydrates": metric("carbohydrates", None), "fat": metric("fat", None), "fiber": metric("fiber", None), "sugar": metric("sugar", None), "sodium": metric("sodium", None)},
        "totalMinutes": 5, "equipment": ["电磁炉"], "source": "personal",
        "confirmedBy": "兼容验证", "confirmedAt": "2026-10-01T00:00:00+08:00", "createdAt": "2026-10-01T00:00:00+08:00",
    }]));
    state.insert("auditEvents".into(), json!([]));
    state
}

fn legacy_database() -> (Connection, std::path::PathBuf) {
    let directory = std::env::temp_dir().join(format!("fitwise-upgrade-compat-{}", rand::random::<u64>()));
    std::fs::create_dir_all(&directory).unwrap();
    let path = directory.join("fitwise.db");
    let mut connection = Connection::open(&path).unwrap();
    // 0.9.0 的库本身就是 v14：首启 ensure_repository_schema 必须是 no-op。
    crate::domain_store::ensure_repository_schema(&connection).unwrap();
    let transaction = connection.transaction().unwrap();
    crate::domain_store::write_transaction(&transaction, &legacy_state(), 4, "synthetic-legacy-hash", "2026-10-20T00:00:00+08:00").unwrap();
    transaction.commit().unwrap();
    (connection, path)
}

#[test]
fn legacy_database_opens_under_0_9_1_without_any_migration_or_data_change() {
    let (connection, path) = legacy_database();
    let envelope_before = load_envelope(&connection).unwrap().unwrap();

    // 0.9.1 代码首次打开：schema 无操作，信封一字节不变。
    crate::domain_store::ensure_repository_schema(&connection).unwrap();
    let version: i64 = connection.query_row("PRAGMA user_version", [], |row| row.get(0)).unwrap();
    assert_eq!(version, 14, "零迁移：user_version 不得变化");
    assert_eq!(load_envelope(&connection).unwrap().unwrap(), envelope_before, "升级兼容：信封字节级不变");
    // SQL 对象清单与 0.9.0 一致（守卫测试已冻结，这里再确认一次真实库形态）。
    let objects: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert!(objects > 0);

    drop(connection);
    std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
}

#[test]
fn new_commands_work_on_legacy_data_and_old_records_stay_untouched() {
    let (mut connection, path) = legacy_database();

    // 0.9.0 形态食材（无 archived 键）照常可搜、默认未归档。
    let peek = execute_with_connection(&mut connection, request("upgrade-peek", "set_checkin", json!({"date": "2026-10-20"}), None)).unwrap();
    let all = crate::food_library::search_state(peek.state.as_object().unwrap(), "", "all").unwrap();
    assert_eq!(all.len(), 3);
    assert!(all.iter().all(|item| item["definition"]["archived"] == false));
    assert!(crate::food_library::search_state(peek.state.as_object().unwrap(), "", "archived").unwrap().is_empty());

    // 旧菜谱在新命令下按快照入餐，口径与 0.9.0 手动记录一致。
    execute_with_connection(
        &mut connection,
        request("upgrade-complete", "set_day_complete", json!({"date": "2026-10-21", "complete": true}), None),
    )
    .unwrap();
    let recorded = execute_with_connection(
        &mut connection,
        request("upgrade-recipe-meal", "record_recipe_meal", json!({"date": "2026-10-21", "type": "breakfast", "recipeVersionId": "recipe-version-legacy", "entries": [{"foodVersionId": "food-version-oats", "quantity": 1, "unit": "package"}]}), None),
    )
    .unwrap();
    assert_eq!(last_meal(&recorded)["nutrition"]["calories"]["value"], 800.0);
    assert_eq!(last_meal(&recorded)["recipeVersionId"], "recipe-version-legacy");
    // 新记录把当天的完成日重开；旧完成日（10-20）不受影响。
    let checkins = recorded.state["checkIns"].as_array().unwrap();
    assert!(checkins.iter().any(|item| item["date"] == "2026-10-21" && item["complete"] == false));
    assert!(checkins.iter().any(|item| item["date"] == "2026-10-20" && item["complete"] == true));

    // 归档旧食材：日常挑选隐藏，历史餐食与快照不受影响。
    let archived = execute_with_connection(
        &mut connection,
        request("upgrade-archive", "set_food_archived", json!({"foodId": "food-tofu", "archived": true}), None),
    )
    .unwrap();
    assert!(crate::food_library::search_state(archived.state.as_object().unwrap(), "", "all").unwrap().iter().all(|item| item["definition"]["id"] != "food-tofu"));
    assert_eq!(crate::food_library::search_state(archived.state.as_object().unwrap(), "", "archived").unwrap().len(), 1);
    let legacy_meal = archived.state["meals"].as_array().unwrap().iter().find(|item| item["id"] == "legacy-meal-1").unwrap();
    assert_eq!(legacy_meal["foodDefinitionId"], "food-oats");
    assert_eq!(legacy_meal["nutrition"]["calories"]["value"], 200.0);

    // 被引用的旧食材删除一律拒绝（餐食 + 菜谱双引用）。
    assert!(execute_with_connection(&mut connection, request("upgrade-delete-oats", "delete_food", json!({"foodId": "food-oats"}), None)).is_err());
    // 已归档但无引用的旧食材可以删除（归档与删除正交）。
    let deleted_tofu = execute_with_connection(
        &mut connection,
        request("upgrade-delete-tofu", "delete_food", json!({"foodId": "food-tofu"}), None),
    )
    .unwrap();
    assert!(deleted_tofu.state["foodDefinitions"].as_array().unwrap().iter().all(|item| item["id"] != "food-tofu"));
    // 真正无引用的旧食材同样可以安全删除，级联版本。
    let deleted = execute_with_connection(
        &mut connection,
        request("upgrade-delete-spare", "delete_food", json!({"foodId": "food-spare"}), None),
    )
    .unwrap();
    assert!(deleted.state["foodDefinitions"].as_array().unwrap().iter().all(|item| item["id"] != "food-spare"));
    assert!(deleted.state["foodDefinitionVersions"].as_array().unwrap().iter().all(|item| item["foodId"] != "food-spare"));
    // 其余旧数据一条不少；被引用而拒绝删除的燕麦原样保留。
    let remaining: Vec<&Value> = deleted.state["foodDefinitions"].as_array().unwrap().iter().collect();
    assert_eq!(remaining.len(), 1);
    assert_eq!(remaining[0]["id"], "food-oats");
    assert_eq!(deleted.state["meals"].as_array().unwrap().len(), 2);
    assert_eq!(deleted.state["recipes"].as_array().unwrap().len(), 1);
    assert_eq!(deleted.state["measurements"].as_array().unwrap().len(), 1);
    assert_eq!(deleted.state["profile"]["name"], "兼容验证");
    // 旧完成日原样保留，不被删除/归档动作触碰。
    assert!(deleted.state["checkIns"].as_array().unwrap().iter().any(|item| item["date"] == "2026-10-20" && item["complete"] == true));

    drop(connection);
    std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
}
