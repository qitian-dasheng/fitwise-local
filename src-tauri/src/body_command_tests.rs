// 0.4.8 体重记录领域测试：同日多次、更正、作废、当日代表值。
// 只使用内存库或 %TEMP% 随机目录文件库，绝不触碰用户真实数据库。

fn weight_audit_count(state: &Value, event_type: &str) -> usize {
    state["auditEvents"]
        .as_array()
        .map(|items| {
            items
                .iter()
                .filter(|item| item["eventType"] == event_type)
                .count()
        })
        .unwrap_or(0)
}

fn weigh(
    c: &mut Connection,
    command_id: &str,
    payload: Value,
    bootstrap_state: Option<String>,
) -> DomainCommandResponse {
    execute_with_connection(c, request(command_id, "add_weight", payload, bootstrap_state)).unwrap()
}

fn first_measurement_id(state: &Value) -> String {
    state["measurements"][0]["id"].as_str().unwrap().to_string()
}

fn measurement_by_id<'a>(state: &'a Value, id: &str) -> &'a Value {
    state["measurements"]
        .as_array()
        .unwrap()
        .iter()
        .find(|item| item["id"].as_str() == Some(id))
        .expect("measurement must exist")
}

#[test]
fn same_day_weigh_ins_stay_active_and_keep_full_history() {
    let mut connection = connection();
    let first = weigh(
        &mut connection,
        "weight-same-01",
        json!({"weightKg":83.0,"date":"2026-10-19","measuredAt":"2026-10-19T06:30:00+08:00","condition":"morning"}),
        Some(bootstrap()),
    );
    let first_id = first_measurement_id(&first.state);
    let second = weigh(
        &mut connection,
        "weight-same-02",
        json!({"weightKg":82.6,"date":"2026-10-19","measuredAt":"2026-10-19T21:10:00+08:00","condition":"other","note":"晚饭前"}),
        None,
    );

    let measurements = second.state["measurements"].as_array().unwrap();
    assert_eq!(measurements.len(), 2, "同日两次称重必须都保留");
    assert_eq!(measurements[0]["status"], "active");
    assert_eq!(measurements[1]["status"], "active");
    assert!(
        measurements[0].get("supersedesId").is_none(),
        "同日追加不再自动作废旧值"
    );
    assert_eq!(measurements[1]["measuredAt"], "2026-10-19T21:10:00+08:00");
    assert_eq!(measurements[1]["condition"], "other");
    assert_eq!(measurements[1]["note"], "晚饭前");
    assert_eq!(
        measurement_by_id(&second.state, &first_id)["weightKg"],
        83.0,
        "旧值不能被改写"
    );
    assert_eq!(weight_audit_count(&second.state, "body_measurement_created"), 2);
    assert_eq!(
        weight_audit_count(&second.state, "body_measurement_superseded"),
        0
    );
}

#[test]
fn add_weight_rejects_invalid_amounts_and_foreign_timestamps() {
    let mut connection = connection();
    weigh(
        &mut connection,
        "weight-guard-01",
        json!({"weightKg":83.0,"date":"2026-10-19"}),
        Some(bootstrap()),
    );

    for (command_id, payload, expected) in [
        (
            "weight-guard-02",
            json!({"weightKg":19.99,"date":"2026-10-19"}),
            "20",
        ),
        (
            "weight-guard-03",
            json!({"weightKg":400.01,"date":"2026-10-19"}),
            "400",
        ),
        (
            "weight-guard-04",
            json!({"weightKg":82.555,"date":"2026-10-19"}),
            "两位小数",
        ),
        (
            "weight-guard-05",
            json!({"weightKg":82.5,"date":"2026-10-19","measuredAt":"2026-10-18T06:30:00+08:00"}),
            "同一天",
        ),
        (
            "weight-guard-06",
            json!({"weightKg":82.5,"date":"2026-10-19","measuredAt":"2026-10-19 06:30"}),
            "格式",
        ),
        (
            "weight-guard-07",
            json!({"weightKg":82.5,"date":"2026-10-19","condition":"noon"}),
            "晨起",
        ),
        (
            "weight-guard-08",
            json!({"weightKg":82.5,"date":"2099-01-01"}),
            "不能晚于今天",
        ),
    ] {
        let error = execute_with_connection(
            &mut connection,
            request(command_id, "add_weight", payload, None),
        )
        .unwrap_err();
        assert!(
            error.contains(expected),
            "{command_id} 应包含「{expected}」，实际：{error}"
        );
    }
    let raw = load_envelope(&connection).unwrap().unwrap();
    let envelope: Value = serde_json::from_str(&raw).unwrap();
    assert_eq!(
        envelope["state"]["measurements"].as_array().unwrap().len(),
        1,
        "被拒绝的提交不能落库"
    );
}

#[test]
fn revise_weight_supersedes_target_and_keeps_before_after_audit() {
    let mut connection = connection();
    let created = weigh(
        &mut connection,
        "weight-revise-01",
        json!({"weightKg":83.4,"date":"2026-10-19","measuredAt":"2026-10-19T06:30:00+08:00"}),
        Some(bootstrap()),
    );
    let target_id = first_measurement_id(&created.state);

    let revised = execute_with_connection(
        &mut connection,
        request(
            "weight-revise-02",
            "revise_weight",
            json!({
                "measurementId":target_id,
                "weightKg":82.9,
                "date":"2026-10-19",
                "measuredAt":"2026-10-19T06:30:00+08:00",
                "condition":"morning",
                "reason":"秤没归零，重新称了",
            }),
            None,
        ),
    )
    .unwrap();

    let old = measurement_by_id(&revised.state, &target_id);
    assert_eq!(old["status"], "superseded");
    assert_eq!(old["correctionReason"], "秤没归零，重新称了");
    assert!(old["supersededBy"].as_str().is_some());

    let new_id = old["supersededBy"].as_str().unwrap().to_string();
    let fresh = measurement_by_id(&revised.state, &new_id);
    assert_eq!(fresh["status"], "active");
    assert_eq!(fresh["weightKg"], 82.9);
    assert_eq!(fresh["supersedesId"], target_id);
    assert_eq!(revised.state["measurements"].as_array().unwrap().len(), 2);

    let audit = revised.state["auditEvents"]
        .as_array()
        .unwrap()
        .iter()
        .find(|item| item["eventType"] == "body_measurement_revised")
        .expect("必须写修订审计");
    assert_eq!(
        audit["payload"]["details"]["before"]["weightKg"],
        83.4,
        "审计要能还原改前值"
    );
    assert_eq!(audit["payload"]["details"]["after"]["weightKg"], 82.9);
    assert_eq!(audit["payload"]["details"]["reason"], "秤没归零，重新称了");
}

#[test]
fn revise_and_void_reject_non_active_targets() {
    let mut connection = connection();
    let created = weigh(
        &mut connection,
        "weight-inactive-01",
        json!({"weightKg":83.0,"date":"2026-10-19"}),
        Some(bootstrap()),
    );
    let target_id = first_measurement_id(&created.state);

    execute_with_connection(
        &mut connection,
        request(
            "weight-inactive-02",
            "void_weight",
            json!({"measurementId":target_id,"reason":"重复录入"}),
            None,
        ),
    )
    .unwrap();

    for (command_id, kind, payload) in [
        (
            "weight-inactive-03",
            "revise_weight",
            json!({"measurementId":target_id,"weightKg":82.0,"date":"2026-10-19","reason":"再改一次"}),
        ),
        (
            "weight-inactive-04",
            "void_weight",
            json!({"measurementId":target_id,"reason":"再删一次"}),
        ),
        (
            "weight-inactive-05",
            "set_weight_representative",
            json!({"measurementId":target_id}),
        ),
    ] {
        let error =
            execute_with_connection(&mut connection, request(command_id, kind, payload, None))
                .unwrap_err();
        assert!(
            error.contains("已修订或作废"),
            "{kind} 对已作废记录必须拒绝，实际：{error}"
        );
    }

    let raw = load_envelope(&connection).unwrap().unwrap();
    let envelope: Value = serde_json::from_str(&raw).unwrap();
    assert_eq!(envelope["state"]["measurements"].as_array().unwrap().len(), 1);
}

#[test]
fn void_weight_keeps_the_row_for_later_review() {
    let mut connection = connection();
    let created = weigh(
        &mut connection,
        "weight-void-01",
        json!({"weightKg":83.0,"date":"2026-10-19","measuredAt":"2026-10-19T06:30:00+08:00"}),
        Some(bootstrap()),
    );
    let target_id = first_measurement_id(&created.state);

    let voided = execute_with_connection(
        &mut connection,
        request(
            "weight-void-02",
            "void_weight",
            json!({"measurementId":target_id,"reason":"称重时穿了鞋"}),
            None,
        ),
    )
    .unwrap();

    let row = measurement_by_id(&voided.state, &target_id);
    assert_eq!(row["status"], "void");
    assert_eq!(row["correctionReason"], "称重时穿了鞋");
    assert!(row["voidedAt"].as_str().is_some());
    assert_eq!(row["weightKg"], 83.0, "作废不删行，原始值保留");
    assert_eq!(weight_audit_count(&voided.state, "body_measurement_voided"), 1);

    let error = execute_with_connection(
        &mut connection,
        request(
            "weight-void-03",
            "void_weight",
            json!({"measurementId":target_id}),
            None,
        ),
    )
    .unwrap_err();
    assert!(error.contains("请填写修改原因"), "原因必填，实际：{error}");
}

#[test]
fn representative_is_unique_per_day_and_idempotent() {
    let mut connection = connection();
    let morning = weigh(
        &mut connection,
        "weight-rep-01",
        json!({"weightKg":83.4,"date":"2026-10-19","measuredAt":"2026-10-19T06:30:00+08:00"}),
        Some(bootstrap()),
    );
    let morning_id = first_measurement_id(&morning.state);
    let evening = weigh(
        &mut connection,
        "weight-rep-02",
        json!({"weightKg":82.9,"date":"2026-10-19","measuredAt":"2026-10-19T21:10:00+08:00"}),
        None,
    );
    let evening_id = evening.state["measurements"][1]["id"]
        .as_str()
        .unwrap()
        .to_string();

    let picked = execute_with_connection(
        &mut connection,
        request(
            "weight-rep-03",
            "set_weight_representative",
            json!({"measurementId":morning_id}),
            None,
        ),
    )
    .unwrap();
    assert!(picked.applied);
    assert_eq!(measurement_by_id(&picked.state, &morning_id)["dayRepresentative"], true);
    assert!(
        measurement_by_id(&picked.state, &evening_id)
            .get("dayRepresentative")
            .is_none(),
        "同一天只能有一条代表值"
    );

    let repeat = execute_with_connection(
        &mut connection,
        request(
            "weight-rep-04",
            "set_weight_representative",
            json!({"measurementId":morning_id}),
            None,
        ),
    )
    .unwrap();
    assert!(!repeat.applied, "重复指定同一条不应再写审计");
    assert_eq!(
        weight_audit_count(&repeat.state, "body_measurement_representative_changed"),
        1
    );
}

#[test]
fn weight_commands_replay_once_and_reject_changed_payloads() {
    let mut connection = connection();
    let first = weigh(
        &mut connection,
        "weight-replay-01",
        json!({"weightKg":83.0,"date":"2026-10-19"}),
        Some(bootstrap()),
    );
    let replay = weigh(
        &mut connection,
        "weight-replay-01",
        json!({"weightKg":83.0,"date":"2026-10-19"}),
        None,
    );
    assert!(first.applied);
    assert!(replay.replayed);
    assert_eq!(replay.revision, first.revision);
    assert_eq!(replay.state["measurements"].as_array().unwrap().len(), 1);

    let changed = execute_with_connection(
        &mut connection,
        request(
            "weight-replay-01",
            "add_weight",
            json!({"weightKg":82.0,"date":"2026-10-19"}),
            None,
        ),
    );
    assert!(changed.unwrap_err().contains("命令内容"));
}

#[test]
fn measurement_projection_excludes_void_and_superseded() {
    let mut connection = connection();
    let first = weigh(
        &mut connection,
        "weight-proj-01",
        json!({"weightKg":83.0,"date":"2026-10-18","measuredAt":"2026-10-18T06:30:00+08:00"}),
        Some(bootstrap()),
    );
    let kept_id = first_measurement_id(&first.state);
    let second = weigh(
        &mut connection,
        "weight-proj-02",
        json!({"weightKg":82.4,"date":"2026-10-18","measuredAt":"2026-10-18T21:10:00+08:00"}),
        None,
    );
    let void_id = second.state["measurements"][1]["id"]
        .as_str()
        .unwrap()
        .to_string();
    execute_with_connection(
        &mut connection,
        request(
            "weight-proj-03",
            "void_weight",
            json!({"measurementId":void_id,"reason":"重复录入"}),
            None,
        ),
    )
    .unwrap();

    let rows: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM domain_measurement_projection",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(rows, 1, "作废记录必须从投影里消失");
    let kept: String = connection
        .query_row(
            "SELECT id FROM domain_measurement_projection",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(kept, kept_id);

    // 新视图要暴露趋势需要的列，否则「当日代表」无法在 SQL 层折叠。
    for column in ["measured_at", "condition", "day_representative"] {
        let exists: bool = connection
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM pragma_table_info('domain_measurement_projection') WHERE name = ?1)",
                [column],
                |row| row.get(0),
            )
            .unwrap();
        assert!(exists, "投影缺少列 {column}");
    }
}

#[test]
fn period_summary_folds_same_day_weigh_ins_into_one_point() {
    let mut connection = connection();
    for (command_id, day, weight, stamp) in [
        ("weight-fold-01", "2026-10-17", 84.0, "2026-10-17T06:30:00+08:00"),
        ("weight-fold-02", "2026-10-18", 83.6, "2026-10-18T06:30:00+08:00"),
        ("weight-fold-03", "2026-10-18", 83.1, "2026-10-18T21:10:00+08:00"),
        ("weight-fold-04", "2026-10-19", 83.0, "2026-10-19T06:30:00+08:00"),
    ] {
        weigh(
            &mut connection,
            command_id,
            json!({"weightKg":weight,"date":day,"measuredAt":stamp}),
            Some(bootstrap()),
        );
    }

    let summary = crate::domain_queries::period_summary(&connection, "2026-10-17", "2026-10-19")
        .unwrap();
    let points = summary["measurements"].as_array().unwrap();
    assert_eq!(points.len(), 3, "同一天多个点必须折叠成一个");
    let oct18 = points
        .iter()
        .find(|point| point["date"] == "2026-10-18")
        .expect("10-18 必须有点位");
    assert_eq!(oct18["weightKg"], 83.1, "同日取时刻最新的一条");
    assert_eq!(summary["latestWeightKg"], 83.0);
    // 同日多条不能进均线窗口：10-19 的窗口是 84.0 / 83.1 / 83.0 三个「每日代表」。
    let oct19 = points
        .iter()
        .find(|point| point["date"] == "2026-10-19")
        .expect("10-19 必须有点位");
    let average = oct19["average"].as_f64().unwrap();
    assert!(
        (average - (84.0 + 83.1 + 83.0) / 3.0).abs() < 1e-6,
        "7 日均线应按每日代表值计算，实际 {average}"
    );
}
