// 0.4.13 照搬上次这一餐：复制规则、来源选择与边界。
// 只使用内存库或 %TEMP% 随机目录文件库，绝不触碰用户真实数据库。

fn copy_meal(
    c: &mut Connection,
    command_id: &str,
    payload: Value,
    bootstrap_state: Option<String>,
) -> Result<DomainCommandResponse, String> {
    execute_with_connection(
        c,
        request(command_id, "copy_meal", payload, bootstrap_state),
    )
}

fn meal_audit_count(state: &Value, event_type: &str) -> usize {
    state["auditEvents"]
        .as_array()
        .map(|items| items.iter().filter(|item| item["eventType"] == event_type).count())
        .unwrap_or(0)
}

fn meals_of(state: &Value, date: &str, meal_type: &str) -> Vec<Value> {
    state["meals"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|item| item["date"].as_str() == Some(date) && item["type"].as_str() == Some(meal_type))
        .cloned()
        .collect()
}

#[test]
fn copy_entry_keeps_snapshot_and_drops_the_old_pot() {
    let source = json!({
        "id":"meal-old","date":"2026-10-20","type":"lunch","name":"标准锅","amountLabel":"1 份",
        "nutrition":{"calories":{"state":"known","value":800,"unit":"kcal","source":"manual","confidence":"high"},
                     "protein":{"state":"known","value":60,"unit":"g","source":"manual","confidence":"high"}},
        "consumedRatio":0.5,"source":"manual","confidence":"high","createdAt":"2026-10-20T12:00:00+08:00",
        "preparedBatchId":"batch-1","consumptionEventId":"consume-1",
        "status":"superseded","supersedesId":"meal-x","supersededBy":"meal-y",
        "correctedAt":"2026-10-20T13:00:00+08:00","correctionReason":"份量记错了",
        "foodDefinitionId":"food-1","foodVersionId":"food-v1",
        "foodSnapshot":{"quantity":150,"unit":"g","factor":1.5,"basisQuantity":100,"definition":{"id":"food-1"},"version":{"id":"food-v1"}}
    });

    let copy = crate::record_commands::copy_entry(&source, "meal-new", "2026-10-22", "2026-10-22T08:00:00+08:00").unwrap();

    assert_eq!(copy["id"], "meal-new");
    assert_eq!(copy["date"], "2026-10-22");
    assert_eq!(copy["status"], "active");
    assert_eq!(copy["copiedFromId"], "meal-old");
    // 业务快照原样带过去：名称、份量、比例、营养、食材版本。
    assert_eq!(copy["name"], "标准锅");
    assert_eq!(copy["amountLabel"], "1 份");
    assert_eq!(copy["consumedRatio"].as_f64(), Some(0.5));
    assert_eq!(copy["nutrition"]["protein"]["value"].as_f64(), Some(60.0));
    assert_eq!(copy["foodVersionId"], "food-v1");
    assert_eq!(copy["foodSnapshot"]["quantity"].as_f64(), Some(150.0));
    // 属于来源那一天的证据与这口锅，一律不带。
    for key in [
        "preparedBatchId",
        "consumptionEventId",
        "supersedesId",
        "supersededBy",
        "correctedAt",
        "correctionReason",
    ] {
        assert!(copy.get(key).is_none(), "{key} 不应该被复制");
    }
}

#[test]
fn copy_entry_keeps_unknown_nutrition_unknown() {
    let source = json!({
        "id":"meal-unknown","date":"2026-10-20","type":"breakfast","name":"外食","amountLabel":"一份",
        "nutrition":{"calories":{"state":"unknown","unit":"kcal","source":"manual","confidence":"low"}},
        "consumedRatio":1,"source":"manual","confidence":"low","createdAt":"2026-10-20T08:00:00+08:00"
    });
    let copy = crate::record_commands::copy_entry(&source, "meal-new", "2026-10-22", "2026-10-22T08:00:00+08:00").unwrap();
    assert_eq!(copy["nutrition"]["calories"]["state"], "unknown");
    assert!(
        copy["nutrition"]["calories"].get("value").is_none(),
        "未知营养不能被复制成 0"
    );
}

#[test]
fn copy_meal_copies_the_whole_meal_to_the_target_day() {
    let mut connection = connection();
    let first = execute_with_connection(
        &mut connection,
        request(
            "meal-seed-01",
            "add_meal",
            json!({"name":"燕麦","date":"2026-10-21","type":"breakfast","amountLabel":"50 g","calories":200,"protein":7}),
            Some(bootstrap()),
        ),
    )
    .unwrap();
    let second = execute_with_connection(
        &mut connection,
        request(
            "meal-seed-02",
            "add_meal",
            json!({"name":"酸奶","date":"2026-10-21","type":"breakfast","amountLabel":"150 g","calories":93,"protein":4}),
            None,
        ),
    )
    .unwrap();
    // 第一条命令返回的是它那一刻的状态快照，要断言两条都在，得看第二条的返回。
    assert_eq!(meals_of(&second.state, "2026-10-21", "breakfast").len(), 2);
    assert_eq!(meals_of(&first.state, "2026-10-21", "breakfast").len(), 1);

    let copied = copy_meal(
        &mut connection,
        "meal-copy-01",
        json!({"date":"2026-10-22","type":"breakfast"}),
        None,
    )
    .unwrap();

    let day = meals_of(&copied.state, "2026-10-22", "breakfast");
    assert_eq!(day.len(), 2, "整组复制，不是只抄第一条");
    assert_eq!(day[0]["name"], "燕麦");
    assert!(day[0]["copiedFromId"].as_str().is_some(), "复制要留溯源指针");
    assert_eq!(day[0]["nutrition"]["calories"]["value"].as_f64(), Some(200.0));
    // 来源那天原样保留。
    assert_eq!(meals_of(&copied.state, "2026-10-21", "breakfast").len(), 2);
    assert_eq!(meal_audit_count(&copied.state, "meals_copied"), 1);
    assert_eq!(copied.result["count"].as_i64(), Some(2));
    assert_eq!(copied.result["sourceDate"], "2026-10-21");
}

#[test]
fn copy_meal_picks_the_latest_day_before_the_target() {
    let mut connection = connection();
    execute_with_connection(
        &mut connection,
        request(
            "meal-seed-03",
            "add_meal",
            json!({"name":"旧早餐","date":"2026-10-18","type":"breakfast","amountLabel":"一份","calories":300,"protein":10}),
            Some(bootstrap()),
        ),
    )
    .unwrap();
    execute_with_connection(
        &mut connection,
        request(
            "meal-seed-04",
            "add_meal",
            json!({"name":"新早餐","date":"2026-10-20","type":"breakfast","amountLabel":"一份","calories":400,"protein":20}),
            None,
        ),
    )
    .unwrap();

    let copied = copy_meal(
        &mut connection,
        "meal-copy-02",
        json!({"date":"2026-10-22","type":"breakfast"}),
        None,
    )
    .unwrap();
    assert_eq!(copied.result["sourceDate"], "2026-10-20", "取最近的一天");
    assert_eq!(meals_of(&copied.state, "2026-10-22", "breakfast")[0]["name"], "新早餐");
}

#[test]
fn copy_meal_skips_voided_entries_and_voided_days() {
    let mut connection = connection();
    let seeded = execute_with_connection(
        &mut connection,
        request(
            "meal-seed-05",
            "add_meal",
            json!({"name":"有效早餐","date":"2026-10-19","type":"breakfast","amountLabel":"一份","calories":300,"protein":10}),
            Some(bootstrap()),
        ),
    )
    .unwrap();
    let old_id = seeded.state["meals"][0]["id"].as_str().unwrap().to_string();
    let voided = execute_with_connection(
        &mut connection,
        request(
            "meal-void-seed",
            "void_meal",
            json!({"mealId":old_id,"reason":"记错了"}),
            None,
        ),
    )
    .unwrap();
    assert_eq!(meals_of(&voided.state, "2026-10-19", "breakfast").len(), 1);

    // 最近一天只有作废记录 → 继续往前找，这次没得找，直接说明白。
    let error = copy_meal(
        &mut connection,
        "meal-copy-03",
        json!({"date":"2026-10-22","type":"breakfast"}),
        None,
    )
    .unwrap_err();
    assert!(error.contains("之前还没有早餐记录"), "实际是：{error}");
}

#[test]
fn copy_meal_rejects_when_the_target_meal_is_not_empty() {
    let mut connection = connection();
    execute_with_connection(
        &mut connection,
        request(
            "meal-seed-06",
            "add_meal",
            json!({"name":"昨天的早餐","date":"2026-10-21","type":"breakfast","amountLabel":"一份","calories":300,"protein":10}),
            Some(bootstrap()),
        ),
    )
    .unwrap();
    execute_with_connection(
        &mut connection,
        request(
            "meal-seed-07",
            "add_meal",
            json!({"name":"今天已经吃过","date":"2026-10-22","type":"breakfast","amountLabel":"一份","calories":300,"protein":10}),
            None,
        ),
    )
    .unwrap();
    let before = connection
        .query_row("SELECT COUNT(*) FROM domain_entities", [], |row| row.get::<_, i64>(0))
        .unwrap();

    let error = copy_meal(
        &mut connection,
        "meal-copy-04",
        json!({"date":"2026-10-22","type":"breakfast"}),
        None,
    )
    .unwrap_err();
    assert!(error.contains("早餐已有记录"), "实际是：{error}");
    let after = connection
        .query_row("SELECT COUNT(*) FROM domain_entities", [], |row| row.get::<_, i64>(0))
        .unwrap();
    assert_eq!(before, after, "拒绝时不能留下半条记录");
}

#[test]
fn copy_meal_rejects_a_future_date_and_a_bad_source_date() {
    let mut connection = connection();
    execute_with_connection(
        &mut connection,
        request(
            "meal-seed-08",
            "add_meal",
            json!({"name":"早餐","date":"2026-10-21","type":"breakfast","amountLabel":"一份","calories":300,"protein":10}),
            Some(bootstrap()),
        ),
    )
    .unwrap();

    let future = copy_meal(
        &mut connection,
        "meal-copy-05",
        json!({"date":"2099-01-01","type":"breakfast"}),
        None,
    )
    .unwrap_err();
    assert!(future.contains("不能照搬到未来的日期"), "实际是：{future}");

    let bad_source = copy_meal(
        &mut connection,
        "meal-copy-06",
        json!({"date":"2026-10-22","type":"breakfast","sourceDate":"10-21"}),
        None,
    )
    .unwrap_err();
    assert!(bad_source.contains("来源日期必须为有效的 YYYY-MM-DD"), "实际是：{bad_source}");
}

#[test]
fn copy_meal_from_an_explicit_source_without_entries_is_reported() {
    let mut connection = connection();
    execute_with_connection(
        &mut connection,
        request(
            "meal-seed-09",
            "add_meal",
            json!({"name":"早餐","date":"2026-10-21","type":"breakfast","amountLabel":"一份","calories":300,"protein":10}),
            Some(bootstrap()),
        ),
    )
    .unwrap();

    let error = copy_meal(
        &mut connection,
        "meal-copy-07",
        json!({"date":"2026-10-22","type":"breakfast","sourceDate":"2026-10-01"}),
        None,
    )
    .unwrap_err();
    assert!(error.contains("2026-10-01 没有早餐记录"), "实际是：{error}");
}

#[test]
fn copy_meal_pins_the_original_food_version_after_a_library_revision() {
    let mut connection = connection();
    execute_with_connection(
        &mut connection,
        request(
            "copy-food-seed",
            "save_food_definition",
            food_payload(),
            Some(bootstrap()),
        ),
    )
    .unwrap();
    let recorded = execute_with_connection(
        &mut connection,
        request(
            "copy-food-meal",
            "record_food_meal",
            json!({"date":"2026-10-21","type":"breakfast","entries":[{"foodVersionId":"food-version-copy-food-seed","quantity":50,"unit":"g"}]}),
            None,
        ),
    )
    .unwrap();
    let original = meals_of(&recorded.state, "2026-10-21", "breakfast")[0].clone();
    // 食材修订：active 版本热量翻倍，但已记录餐食的口径不得被改写。
    let mut revision = food_payload();
    revision["foodId"] = json!("food-copy-food-seed");
    revision["expectedVersionId"] = json!("food-version-copy-food-seed");
    revision["input"]["nutrients"]["calories"] = json!(800);
    execute_with_connection(
        &mut connection,
        request("copy-food-revise", "revise_food_definition", revision, None),
    )
    .unwrap();

    // 显式来源日期照搬：整条快照（含食材版本与营养）原样带过去。
    let copied = copy_meal(
        &mut connection,
        "copy-food-copy",
        json!({"date":"2026-10-22","type":"breakfast","sourceDate":"2026-10-21"}),
        None,
    )
    .unwrap();
    assert_eq!(copied.result["sourceDate"], "2026-10-21");
    let copy = meals_of(&copied.state, "2026-10-22", "breakfast")[0].clone();
    assert_eq!(copy["foodVersionId"], "food-version-copy-food-seed");
    assert_eq!(copy["nutrition"], original["nutrition"]);
    assert_eq!(copy["foodSnapshot"], original["foodSnapshot"]);
    assert_eq!(copy["nutrition"]["calories"]["value"].as_f64(), Some(200.0));
}

#[test]
fn copy_meal_replay_is_idempotent() {
    let mut connection = connection();
    execute_with_connection(
        &mut connection,
        request(
            "meal-seed-10",
            "add_meal",
            json!({"name":"早餐","date":"2026-10-21","type":"breakfast","amountLabel":"一份","calories":300,"protein":10}),
            Some(bootstrap()),
        ),
    )
    .unwrap();

    let first = copy_meal(
        &mut connection,
        "meal-copy-08",
        json!({"date":"2026-10-22","type":"breakfast"}),
        None,
    )
    .unwrap();
    let replay = copy_meal(
        &mut connection,
        "meal-copy-08",
        json!({"date":"2026-10-22","type":"breakfast"}),
        None,
    )
    .unwrap();

    assert!(first.applied);
    assert!(replay.replayed, "同 commandId 同内容必须走回执");
    assert_eq!(meals_of(&replay.state, "2026-10-22", "breakfast").len(), 1);
    assert_eq!(meal_audit_count(&replay.state, "meals_copied"), 1);
}

#[test]
fn copy_meal_reopens_a_completed_day() {
    let mut connection = connection();
    execute_with_connection(
        &mut connection,
        request(
            "meal-seed-11",
            "add_meal",
            json!({"name":"早餐","date":"2026-10-21","type":"breakfast","amountLabel":"一份","calories":300,"protein":10}),
            Some(bootstrap()),
        ),
    )
    .unwrap();
    execute_with_connection(
        &mut connection,
        request(
            "meal-complete-11",
            "set_day_complete",
            json!({"date":"2026-10-22","complete":true}),
            None,
        ),
    )
    .unwrap();

    let copied = copy_meal(
        &mut connection,
        "meal-copy-09",
        json!({"date":"2026-10-22","type":"breakfast"}),
        None,
    )
    .unwrap();

    let check_in = copied.state["checkIns"]
        .as_array()
        .unwrap()
        .iter()
        .find(|item| item["date"] == "2026-10-22")
        .unwrap();
    assert_eq!(check_in["complete"], false, "加了新记录，完成日必须重开");
    assert!(
        copied
            .state["auditEvents"]
            .as_array()
            .unwrap()
            .iter()
            .any(|item| item["eventType"] == "diet_day_reopened"),
        "重开完成日要留审计"
    );
}
