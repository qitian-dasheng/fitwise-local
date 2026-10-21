// 0.4.9 运动记录领域测试：更正、作废、投影过滤与逐日聚合。
// 只使用内存库或 %TEMP% 随机目录文件库，绝不触碰用户真实数据库。

fn workout_audit_count(state: &Value, event_type: &str) -> usize {
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

fn log_workout(
    c: &mut Connection,
    command_id: &str,
    payload: Value,
    bootstrap_state: Option<String>,
) -> DomainCommandResponse {
    execute_with_connection(c, request(command_id, "add_workout", payload, bootstrap_state))
        .unwrap()
}

fn workout_by_id<'a>(state: &'a Value, id: &str) -> &'a Value {
    state["workouts"]
        .as_array()
        .unwrap()
        .iter()
        .find(|item| item["id"].as_str() == Some(id))
        .expect("workout must exist")
}

fn active_workouts(state: &Value) -> Vec<Value> {
    state["workouts"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|item| matches!(item["status"].as_str(), None | Some("active")))
        .cloned()
        .collect()
}

const BASE_WORKOUT: &str = "2026-10-19";

#[test]
fn revise_workout_supersedes_old_row_and_keeps_evidence() {
    let mut connection = connection();
    let created = log_workout(
        &mut connection,
        "workout-add-01",
        json!({"date":BASE_WORKOUT,"name":"低冲击有氧","type":"有氧","durationMinutes":22,"caloriesKcal":169,"averageHeartRate":125}),
        Some(bootstrap()),
    );
    let old_id = created.state["workouts"][0]["id"].as_str().unwrap().to_string();

    let revised = execute_with_connection(
        &mut connection,
        request(
            "workout-revise-01",
            "revise_workout",
            json!({"workoutId":old_id,"date":BASE_WORKOUT,"name":"B4 全身进阶","type":"HIIT","durationMinutes":26,"caloriesKcal":210,"averageHeartRate":148,"reason":"课程记错了"}),
            None,
        ),
    )
    .unwrap();

    let workouts = revised.state["workouts"].as_array().unwrap();
    assert_eq!(workouts.len(), 2, "更正必须保留旧行");

    let old = workout_by_id(&revised.state, &old_id);
    assert_eq!(old["status"], "superseded");
    assert_eq!(old["correctionReason"], "课程记错了");
    assert_eq!(old["durationMinutes"].as_f64(), Some(22.0), "旧值不能被改写");
    assert_eq!(old["name"], "低冲击有氧");

    let active = active_workouts(&revised.state);
    assert_eq!(active.len(), 1);
    assert_eq!(active[0]["name"], "B4 全身进阶");
    assert_eq!(active[0]["durationMinutes"].as_f64(), Some(26.0));
    assert_eq!(active[0]["supersedesId"], old_id);
    assert_eq!(active[0]["status"], "active");

    assert_eq!(workout_audit_count(&revised.state, "workout_created"), 1);
    let revoked = revised.state["auditEvents"]
        .as_array()
        .unwrap()
        .iter()
        .find(|item| item["eventType"] == "workout_revised")
        .unwrap();
    assert_eq!(revoked["payload"]["details"]["before"]["name"], "低冲击有氧");
    assert_eq!(revoked["payload"]["details"]["after"]["name"], "B4 全身进阶");
    assert_eq!(revoked["payload"]["details"]["reason"], "课程记错了");
}

#[test]
fn void_workout_keeps_row_but_leaves_summary() {
    let mut connection = connection();
    let created = log_workout(
        &mut connection,
        "workout-add-02",
        json!({"date":BASE_WORKOUT,"name":"无效记录","type":"有氧","durationMinutes":30,"caloriesKcal":200}),
        Some(bootstrap()),
    );
    let id = created.state["workouts"][0]["id"].as_str().unwrap().to_string();

    let before = crate::domain_queries::period_summary(&connection, BASE_WORKOUT, BASE_WORKOUT).unwrap();
    assert_eq!(before["workoutMinutes"].as_f64(), Some(30.0));
    assert_eq!(before["days"][0]["workoutMinutes"].as_f64(), Some(30.0));
    assert_eq!(before["days"][0]["workoutCount"].as_i64(), Some(1));

    let voided = execute_with_connection(
        &mut connection,
        request(
            "workout-void-02",
            "void_workout",
            json!({"workoutId":id,"reason":"重复录入"}),
            None,
        ),
    )
    .unwrap();

    let row = workout_by_id(&voided.state, &id);
    assert_eq!(row["status"], "void");
    assert_eq!(row["correctionReason"], "重复录入");
    assert_eq!(workout_audit_count(&voided.state, "workout_voided"), 1);

    let after = crate::domain_queries::period_summary(&connection, BASE_WORKOUT, BASE_WORKOUT).unwrap();
    assert_eq!(
        after["workoutMinutes"].as_f64(),
        Some(0.0),
        "作废后不得再计入区间运动"
    );
    assert_eq!(after["days"][0]["workoutMinutes"].as_f64(), Some(0.0));
    assert_eq!(after["days"][0]["workoutCount"].as_i64(), Some(0));
}

#[test]
fn revised_workout_counts_once_with_new_value() {
    let mut connection = connection();
    let created = log_workout(
        &mut connection,
        "workout-add-03",
        json!({"date":BASE_WORKOUT,"name":"原课程","type":"有氧","durationMinutes":22}),
        Some(bootstrap()),
    );
    let id = created.state["workouts"][0]["id"].as_str().unwrap().to_string();

    execute_with_connection(
        &mut connection,
        request(
            "workout-revise-03",
            "revise_workout",
            json!({"workoutId":id,"date":BASE_WORKOUT,"name":"改后课程","type":"HIIT","durationMinutes":26,"reason":"时长记错了"}),
            None,
        ),
    )
    .unwrap();

    let summary = crate::domain_queries::period_summary(&connection, BASE_WORKOUT, BASE_WORKOUT).unwrap();
    assert_eq!(
        summary["workoutMinutes"].as_f64(),
        Some(26.0),
        "同一段运动更正后只能算一次，且用新值"
    );
    assert_eq!(
        summary["days"][0]["workoutCount"].as_i64(),
        Some(1),
        "作废的旧行不能算作第二次训练"
    );
}

#[test]
fn workouts_aggregate_per_day() {
    let mut connection = connection();
    log_workout(
        &mut connection,
        "workout-day-a",
        json!({"date":"2026-10-18","name":"第一天","type":"有氧","durationMinutes":22}),
        Some(bootstrap()),
    );
    log_workout(
        &mut connection,
        "workout-day-b1",
        json!({"date":BASE_WORKOUT,"name":"第二天上午","type":"HIIT","durationMinutes":18}),
        None,
    );
    log_workout(
        &mut connection,
        "workout-day-b2",
        json!({"date":BASE_WORKOUT,"name":"第二天晚上","type":"拉伸","durationMinutes":12}),
        None,
    );

    let summary =
        crate::domain_queries::period_summary(&connection, "2026-10-18", BASE_WORKOUT).unwrap();
    assert_eq!(summary["workoutMinutes"].as_f64(), Some(52.0), "区间总和保持原口径");
    let days = summary["days"].as_array().unwrap();
    assert_eq!(days.len(), 2);
    assert_eq!(days[0]["date"], "2026-10-18");
    assert_eq!(days[0]["workoutMinutes"].as_f64(), Some(22.0));
    assert_eq!(days[0]["workoutCount"].as_i64(), Some(1));
    assert_eq!(days[1]["date"], BASE_WORKOUT);
    assert_eq!(days[1]["workoutMinutes"].as_f64(), Some(30.0));
    assert_eq!(days[1]["workoutCount"].as_i64(), Some(2));
}

#[test]
fn revise_workout_rejects_invalid_input() {
    let mut connection = connection();
    let created = log_workout(
        &mut connection,
        "workout-add-04",
        json!({"date":BASE_WORKOUT,"name":"基线","type":"有氧","durationMinutes":22}),
        Some(bootstrap()),
    );
    let id = created.state["workouts"][0]["id"].as_str().unwrap().to_string();

    let cases = [
        (
            json!({"workoutId":id,"date":BASE_WORKOUT,"name":"X","type":"有氧","durationMinutes":0,"reason":"改"}),
            "运动时长需在 1–1440 分钟之间。",
        ),
        (
            json!({"workoutId":id,"date":BASE_WORKOUT,"name":"X","type":"有氧","durationMinutes":1441,"reason":"改"}),
            "运动时长需在 1–1440 分钟之间。",
        ),
        (
            json!({"workoutId":id,"date":BASE_WORKOUT,"name":"X","type":"有氧","durationMinutes":22,"averageHeartRate":300,"reason":"改"}),
            "平均心率需在 30–250 次/分之间；没有测量请留空。",
        ),
        (
            json!({"workoutId":id,"date":BASE_WORKOUT,"name":"   ","type":"有氧","durationMinutes":22,"reason":"改"}),
            "请填写课程或训练名称。",
        ),
        (
            json!({"workoutId":id,"date":BASE_WORKOUT,"name":"X","type":"有氧","durationMinutes":22}),
            "请填写修改原因。",
        ),
        (
            json!({"workoutId":id,"date":"2099-01-01","name":"X","type":"有氧","durationMinutes":22,"reason":"改"}),
            "运动日期不能晚于今天。",
        ),
    ];
    for (index, (payload, expected)) in cases.into_iter().enumerate() {
        let error = execute_with_connection(
            &mut connection,
            request(
                &format!("workout-bad-{index:02}"),
                "revise_workout",
                payload,
                None,
            ),
        )
        .unwrap_err();
        assert_eq!(error, expected);
    }
}

#[test]
fn average_heart_rate_cannot_exceed_maximum() {
    let mut connection = connection();
    let created = log_workout(
        &mut connection,
        "workout-add-05",
        json!({"date":BASE_WORKOUT,"name":"基线","type":"有氧","durationMinutes":22}),
        Some(bootstrap()),
    );
    let id = created.state["workouts"][0]["id"].as_str().unwrap().to_string();

    let error = execute_with_connection(
        &mut connection,
        request(
            "workout-heart-05",
            "revise_workout",
            json!({"workoutId":id,"date":BASE_WORKOUT,"name":"X","type":"有氧","durationMinutes":22,"averageHeartRate":180,"maxHeartRate":150,"reason":"改"}),
            None,
        ),
    )
    .unwrap_err();
    assert_eq!(error, "平均心率不能高于最高心率。");
}

#[test]
fn cannot_correct_an_inactive_workout() {
    let mut connection = connection();
    let created = log_workout(
        &mut connection,
        "workout-add-06",
        json!({"date":BASE_WORKOUT,"name":"基线","type":"有氧","durationMinutes":22}),
        Some(bootstrap()),
    );
    let id = created.state["workouts"][0]["id"].as_str().unwrap().to_string();

    execute_with_connection(
        &mut connection,
        request(
            "workout-void-06",
            "void_workout",
            json!({"workoutId":id,"reason":"录错了"}),
            None,
        ),
    )
    .unwrap();

    for kind in ["void_workout", "revise_workout"] {
        let error = execute_with_connection(
            &mut connection,
            request(
                &format!("workout-again-{kind}"),
                kind,
                json!({"workoutId":id,"date":BASE_WORKOUT,"name":"X","type":"有氧","durationMinutes":22,"reason":"再改"}),
                None,
            ),
        )
        .unwrap_err();
        assert_eq!(error, "这条运动已修订或作废，请刷新后操作最新记录。");
    }
}

#[test]
fn void_workout_requires_existing_record() {
    let mut connection = connection();
    let mut payload = json!({"workoutId":"not-exist","reason":"录错了"});
    let _ = &mut payload;
    let error = execute_with_connection(
        &mut connection,
        request("workout-missing-07", "void_workout", payload, Some(bootstrap())),
    )
    .unwrap_err();
    assert_eq!(error, "找不到这条运动记录。");
}

#[test]
fn revise_workout_replay_is_idempotent() {
    let mut connection = connection();
    let created = log_workout(
        &mut connection,
        "workout-add-08",
        json!({"date":BASE_WORKOUT,"name":"基线","type":"有氧","durationMinutes":22}),
        Some(bootstrap()),
    );
    let id = created.state["workouts"][0]["id"].as_str().unwrap().to_string();
    let payload = json!({"workoutId":id,"date":BASE_WORKOUT,"name":"改后","type":"HIIT","durationMinutes":26,"reason":"时长记错了"});

    let first = execute_with_connection(
        &mut connection,
        request("workout-replay-08", "revise_workout", payload.clone(), None),
    )
    .unwrap();
    assert!(first.applied);
    let second = execute_with_connection(
        &mut connection,
        request("workout-replay-08", "revise_workout", payload, None),
    )
    .unwrap();
    assert!(second.replayed, "同一 commandId 重放不应再写一条");
    assert_eq!(second.state["workouts"].as_array().unwrap().len(), 2);
    assert_eq!(
        workout_audit_count(&second.state, "workout_revised"),
        1,
        "重放不能重复写审计"
    );
}

#[test]
fn reused_command_id_with_different_payload_is_rejected() {
    let mut connection = connection();
    let created = log_workout(
        &mut connection,
        "workout-add-09",
        json!({"date":BASE_WORKOUT,"name":"基线","type":"有氧","durationMinutes":22}),
        Some(bootstrap()),
    );
    let id = created.state["workouts"][0]["id"].as_str().unwrap().to_string();

    execute_with_connection(
        &mut connection,
        request(
            "workout-fingerprint-09",
            "revise_workout",
            json!({"workoutId":id,"date":BASE_WORKOUT,"name":"改后","type":"HIIT","durationMinutes":26,"reason":"时长记错了"}),
            None,
        ),
    )
    .unwrap();
    let error = execute_with_connection(
        &mut connection,
        request(
            "workout-fingerprint-09",
            "revise_workout",
            json!({"workoutId":id,"date":BASE_WORKOUT,"name":"另改","type":"HIIT","durationMinutes":40,"reason":"又改了"}),
            None,
        ),
    )
    .unwrap_err();
    assert!(
        error.contains("指纹") || error.contains("命令"),
        "同一 commandId 换内容必须拒绝，实际：{error}"
    );
}

#[test]
fn legacy_workout_without_status_still_counts() {
    // 0.4.8 及更早写入的运动 payload 没有 status 字段；
    // 0012 的 COALESCE 必须把它们继续当作有效记录，否则升级等于丢数据。
    let mut connection = connection();
    log_workout(
        &mut connection,
        "workout-legacy-10",
        json!({"date":BASE_WORKOUT,"name":"旧格式","type":"有氧","durationMinutes":22}),
        Some(bootstrap()),
    );

    let stored = &connection
        .query_row(
            "SELECT payload_json FROM domain_entities WHERE collection='workouts'",
            [],
            |row| row.get::<_, String>(0),
        )
        .unwrap();
    let parsed: Value = serde_json::from_str(stored).unwrap();
    assert!(
        parsed.get("status").is_none(),
        "add_workout 不写 status，正好覆盖旧格式兼容路径"
    );

    let summary = crate::domain_queries::period_summary(&connection, BASE_WORKOUT, BASE_WORKOUT).unwrap();
    assert_eq!(summary["workoutMinutes"].as_f64(), Some(22.0));
    assert_eq!(summary["days"][0]["workoutCount"].as_i64(), Some(1));
}
