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

// ===== 0.4.11 撤销更正 / 恢复作废 =====

/// 更正一条运动。目标 id 仍由 payload 携带，这里的 `_target_id` 只为调用处读起来对称。
fn corrected(
    c: &mut Connection,
    command_id: &str,
    _target_id: &str,
    payload: Value,
) -> DomainCommandResponse {
    execute_with_connection(c, request(command_id, "revise_workout", payload, None)).unwrap()
}

fn undo_correction(
    c: &mut Connection,
    command_id: &str,
    target_id: &str,
    reason: Option<&str>,
) -> Result<DomainCommandResponse, String> {
    let mut payload = json!({"workoutId": target_id});
    if let Some(reason) = reason {
        payload["reason"] = json!(reason);
    }
    execute_with_connection(c, request(command_id, "undo_workout_correction", payload, None))
}

fn restore_voided(
    c: &mut Connection,
    command_id: &str,
    target_id: &str,
    reason: &str,
) -> Result<DomainCommandResponse, String> {
    execute_with_connection(
        c,
        request(
            command_id,
            "restore_voided_workout",
            json!({"workoutId": target_id, "reason": reason}),
            None,
        ),
    )
}

fn active_workout_id(state: &Value) -> String {
    let active = active_workouts(state);
    assert_eq!(active.len(), 1, "应当恰好一条有效记录");
    active[0]["id"].as_str().unwrap().to_string()
}

#[test]
fn undo_correction_restores_parent_and_reverts_child() {
    let mut connection = connection();
    let created = log_workout(
        &mut connection,
        "workout-add-undo-01",
        json!({"date":BASE_WORKOUT,"name":"低冲击有氧","type":"有氧","durationMinutes":22}),
        Some(bootstrap()),
    );
    let parent_id = created.state["workouts"][0]["id"].as_str().unwrap().to_string();
    let revised = corrected(
        &mut connection,
        "workout-revise-undo-01",
        &parent_id,
        json!({"workoutId":parent_id,"date":BASE_WORKOUT,"name":"B4 全身进阶","type":"HIIT","durationMinutes":26,"reason":"课程记错了"}),
    );
    let head_id = active_workout_id(&revised.state);

    let undone = undo_correction(
        &mut connection,
        "workout-undo-01",
        &head_id,
        Some("刚才改错了"),
    )
    .unwrap();

    let parent = workout_by_id(&undone.state, &parent_id);
    assert_eq!(parent["status"], "active");
    assert!(
        parent.get("supersededBy").is_none(),
        "失效指针必须清掉，否则父行看起来仍被替换"
    );
    assert!(parent.get("correctedAt").is_none());
    assert_eq!(parent["correctionReason"], "课程记错了", "当初为什么改要留着");
    assert_eq!(parent["restoredCorrectionId"], head_id);
    assert!(parent["restoredAt"].as_str().is_some());
    assert_eq!(parent["restoredReason"], "刚才改错了");

    let head = workout_by_id(&undone.state, &head_id);
    assert_eq!(head["status"], "reverted");
    assert_eq!(head["supersedesId"], parent_id, "必须仍能证明它曾是谁的更正");
    // 更正原因写在被更正的父行上，新行本身不带；撤销不能凭空给它造一个。
    assert!(head.get("correctionReason").is_none());
    assert!(head["revertedAt"].as_str().is_some());
    assert_eq!(head["revertedReason"], "刚才改错了");

    assert_eq!(workout_audit_count(&undone.state, "workout_correction_undone"), 1);
    let event = undone.state["auditEvents"]
        .as_array()
        .unwrap()
        .iter()
        .find(|item| item["eventType"] == "workout_correction_undone")
        .unwrap();
    assert_eq!(event["payload"]["details"]["before"]["parent"]["name"], "低冲击有氧");
    assert_eq!(event["payload"]["details"]["before"]["head"]["name"], "B4 全身进阶");
    assert_eq!(event["payload"]["details"]["after"]["parent"]["name"], "低冲击有氧");
    assert_eq!(event["payload"]["details"]["after"]["head"]["status"], "reverted");
    assert_eq!(event["payload"]["details"]["reason"], "刚才改错了");
}

#[test]
fn undo_correction_returns_statistics_to_parent_values() {
    let mut connection = connection();
    let created = log_workout(
        &mut connection,
        "workout-add-undo-02",
        json!({"date":BASE_WORKOUT,"name":"低冲击有氧","type":"有氧","durationMinutes":22}),
        Some(bootstrap()),
    );
    let parent_id = created.state["workouts"][0]["id"].as_str().unwrap().to_string();
    let revised = corrected(
        &mut connection,
        "workout-revise-undo-02",
        &parent_id,
        json!({"workoutId":parent_id,"date":BASE_WORKOUT,"name":"B4 全身进阶","type":"HIIT","durationMinutes":26,"reason":"课程记错了"}),
    );
    let head_id = active_workout_id(&revised.state);
    let before = crate::domain_queries::period_summary(&connection, BASE_WORKOUT, BASE_WORKOUT).unwrap();
    assert_eq!(before["workoutMinutes"].as_f64(), Some(26.0));

    undo_correction(&mut connection, "workout-undo-02", &head_id, None).unwrap();

    let after = crate::domain_queries::period_summary(&connection, BASE_WORKOUT, BASE_WORKOUT).unwrap();
    assert_eq!(after["workoutMinutes"].as_f64(), Some(22.0), "统计回到父行的值");
    assert_eq!(
        after["days"][0]["workoutCount"].as_i64(),
        Some(1),
        "被撤销的更正行不能算作第二次训练"
    );
}

#[test]
fn undo_correction_reverts_a_date_change() {
    let mut connection = connection();
    let created = log_workout(
        &mut connection,
        "workout-add-undo-03",
        json!({"date":BASE_WORKOUT,"name":"原课程","type":"有氧","durationMinutes":22}),
        Some(bootstrap()),
    );
    let parent_id = created.state["workouts"][0]["id"].as_str().unwrap().to_string();
    let revised = corrected(
        &mut connection,
        "workout-revise-undo-03",
        &parent_id,
        json!({"workoutId":parent_id,"date":"2026-10-20","name":"原课程","type":"有氧","durationMinutes":26,"reason":"日期也记错了"}),
    );
    let head_id = active_workout_id(&revised.state);

    let moved = crate::domain_queries::period_summary(&connection, "2026-10-19", "2026-10-20").unwrap();
    assert_eq!(
        moved["days"][0]["workoutMinutes"].as_f64(),
        Some(0.0),
        "改过日期后原日期应当空出来"
    );
    assert_eq!(moved["days"][1]["workoutMinutes"].as_f64(), Some(26.0));

    undo_correction(&mut connection, "workout-undo-03", &head_id, None).unwrap();

    let restored = crate::domain_queries::period_summary(&connection, "2026-10-19", "2026-10-20").unwrap();
    assert_eq!(
        restored["days"][0]["workoutMinutes"].as_f64(),
        Some(22.0),
        "撤销后记录必须退回原日期"
    );
    assert_eq!(restored["days"][1]["workoutMinutes"].as_f64(), Some(0.0));
}

#[test]
fn undo_only_steps_back_one_link_in_a_chain() {
    let mut connection = connection();
    let created = log_workout(
        &mut connection,
        "workout-add-undo-04",
        json!({"date":BASE_WORKOUT,"name":"第一版","type":"有氧","durationMinutes":22}),
        Some(bootstrap()),
    );
    let first_id = created.state["workouts"][0]["id"].as_str().unwrap().to_string();
    let second = corrected(
        &mut connection,
        "workout-revise-undo-04a",
        &first_id,
        json!({"workoutId":first_id,"date":BASE_WORKOUT,"name":"第二版","type":"有氧","durationMinutes":26,"reason":"第一处改错"}),
    );
    let second_id = active_workout_id(&second.state);
    let third = corrected(
        &mut connection,
        "workout-revise-undo-04b",
        &second_id,
        json!({"workoutId":second_id,"date":BASE_WORKOUT,"name":"第三版","type":"HIIT","durationMinutes":30,"reason":"第二处改错"}),
    );
    let third_id = active_workout_id(&third.state);

    let step_one = undo_correction(&mut connection, "workout-undo-04a", &third_id, None).unwrap();
    assert_eq!(workout_by_id(&step_one.state, &second_id)["status"], "active");
    assert_eq!(workout_by_id(&step_one.state, &third_id)["status"], "reverted");
    assert_eq!(
        workout_by_id(&step_one.state, &first_id)["status"],
        "superseded",
        "只退一步，更早的版本仍是被更正的旧值"
    );
    let summary_one =
        crate::domain_queries::period_summary(&connection, BASE_WORKOUT, BASE_WORKOUT).unwrap();
    assert_eq!(summary_one["workoutMinutes"].as_f64(), Some(26.0));

    let step_two = undo_correction(&mut connection, "workout-undo-04b", &second_id, None).unwrap();
    assert_eq!(workout_by_id(&step_two.state, &first_id)["status"], "active");
    assert_eq!(workout_by_id(&step_two.state, &second_id)["status"], "reverted");
    let summary_two =
        crate::domain_queries::period_summary(&connection, BASE_WORKOUT, BASE_WORKOUT).unwrap();
    assert_eq!(summary_two["workoutMinutes"].as_f64(), Some(22.0));
    assert_eq!(summary_two["days"][0]["workoutCount"].as_i64(), Some(1));
}

#[test]
fn undo_rejects_a_voided_head() {
    let mut connection = connection();
    let created = log_workout(
        &mut connection,
        "workout-add-undo-05",
        json!({"date":BASE_WORKOUT,"name":"原课程","type":"有氧","durationMinutes":22}),
        Some(bootstrap()),
    );
    let parent_id = created.state["workouts"][0]["id"].as_str().unwrap().to_string();
    let revised = corrected(
        &mut connection,
        "workout-revise-undo-05",
        &parent_id,
        json!({"workoutId":parent_id,"date":BASE_WORKOUT,"name":"改后课程","type":"HIIT","durationMinutes":26,"reason":"改错了"}),
    );
    let head_id = active_workout_id(&revised.state);
    execute_with_connection(
        &mut connection,
        request(
            "workout-void-undo-05",
            "void_workout",
            json!({"workoutId":head_id,"reason":"整条不要了"}),
            None,
        ),
    )
    .unwrap();

    let error = undo_correction(&mut connection, "workout-undo-05", &head_id, None).unwrap_err();
    assert!(
        error.contains("当前不是有效记录，无法撤销更正"),
        "作废行不能走撤销更正，实际是：{error}"
    );
}

#[test]
fn undo_rejects_a_record_that_was_never_corrected() {
    let mut connection = connection();
    let created = log_workout(
        &mut connection,
        "workout-add-undo-06",
        json!({"date":BASE_WORKOUT,"name":"直接录入","type":"有氧","durationMinutes":22}),
        Some(bootstrap()),
    );
    let id = created.state["workouts"][0]["id"].as_str().unwrap().to_string();

    let error = undo_correction(&mut connection, "workout-undo-06", &id, None).unwrap_err();
    assert!(
        error.contains("不是更正产生的"),
        "原生记录没有可撤销的更正，实际是：{error}"
    );
}

#[test]
fn undo_rejects_a_broken_chain() {
    let mut connection = connection();
    let created = log_workout(
        &mut connection,
        "workout-add-undo-07",
        json!({"date":BASE_WORKOUT,"name":"原课程","type":"有氧","durationMinutes":22}),
        Some(bootstrap()),
    );
    let parent_id = created.state["workouts"][0]["id"].as_str().unwrap().to_string();
    let revised = corrected(
        &mut connection,
        "workout-revise-undo-07",
        &parent_id,
        json!({"workoutId":parent_id,"date":BASE_WORKOUT,"name":"改后课程","type":"HIIT","durationMinutes":26,"reason":"改错了"}),
    );
    let head_id = active_workout_id(&revised.state);
    undo_correction(&mut connection, "workout-undo-07a", &head_id, None).unwrap();

    let error = undo_correction(&mut connection, "workout-undo-07b", &head_id, None).unwrap_err();
    assert!(
        error.contains("当前不是有效记录，无法撤销更正"),
        "同一条不能撤两次，实际是：{error}"
    );
}

#[test]
fn undo_reports_missing_target() {
    let mut connection = connection();
    log_workout(
        &mut connection,
        "workout-add-undo-08",
        json!({"date":BASE_WORKOUT,"name":"原课程","type":"有氧","durationMinutes":22}),
        Some(bootstrap()),
    );
    let error = undo_correction(&mut connection, "workout-undo-08", "not-a-workout", None).unwrap_err();
    assert!(error.contains("找不到这条运动记录。"), "实际是：{error}");
}

#[test]
fn undo_accepts_an_empty_reason_and_rejects_overlong() {
    let mut connection = connection();
    let created = log_workout(
        &mut connection,
        "workout-add-undo-09",
        json!({"date":BASE_WORKOUT,"name":"原课程","type":"有氧","durationMinutes":22}),
        Some(bootstrap()),
    );
    let parent_id = created.state["workouts"][0]["id"].as_str().unwrap().to_string();
    let revised = corrected(
        &mut connection,
        "workout-revise-undo-09",
        &parent_id,
        json!({"workoutId":parent_id,"date":BASE_WORKOUT,"name":"改后课程","type":"HIIT","durationMinutes":26,"reason":"改错了"}),
    );
    let head_id = active_workout_id(&revised.state);

    let done = undo_correction(&mut connection, "workout-undo-09a", &head_id, None).unwrap();
    let event = done.state["auditEvents"]
        .as_array()
        .unwrap()
        .iter()
        .find(|item| item["eventType"] == "workout_correction_undone")
        .unwrap();
    assert!(
        event["payload"]["details"]["reason"].is_null(),
        "没写原因就留空，不能替用户编一个"
    );

    let long_reason = "长".repeat(201);
    let error = undo_correction(&mut connection, "workout-undo-09b", &head_id, Some(&long_reason)).unwrap_err();
    assert!(error.contains("原因不能超过 200 字。"), "实际是：{error}");
}

#[test]
fn restore_voided_workout_brings_it_back_into_statistics() {
    let mut connection = connection();
    let created = log_workout(
        &mut connection,
        "workout-add-restore-01",
        json!({"date":BASE_WORKOUT,"name":"有效记录","type":"有氧","durationMinutes":30}),
        Some(bootstrap()),
    );
    let id = created.state["workouts"][0]["id"].as_str().unwrap().to_string();
    execute_with_connection(
        &mut connection,
        request(
            "workout-void-restore-01",
            "void_workout",
            json!({"workoutId":id,"reason":"以为重复录入了"}),
            None,
        ),
    )
    .unwrap();
    let voided = crate::domain_queries::period_summary(&connection, BASE_WORKOUT, BASE_WORKOUT).unwrap();
    assert_eq!(voided["workoutMinutes"].as_f64(), Some(0.0));

    let restored = restore_voided(&mut connection, "workout-restore-01", &id, "其实是误点").unwrap();
    let row = workout_by_id(&restored.state, &id);
    assert_eq!(row["status"], "active");
    assert!(row.get("voidedAt").is_none(), "恢复后不能再带着作废时刻");
    assert_eq!(row["correctionReason"], "以为重复录入了", "作废原因要留证");
    assert!(row["restoredAt"].as_str().is_some());
    assert_eq!(row["restoredReason"], "其实是误点");

    let summary = crate::domain_queries::period_summary(&connection, BASE_WORKOUT, BASE_WORKOUT).unwrap();
    assert_eq!(summary["workoutMinutes"].as_f64(), Some(30.0));
    assert_eq!(summary["days"][0]["workoutCount"].as_i64(), Some(1));

    assert_eq!(workout_audit_count(&restored.state, "workout_void_restored"), 1);
    let event = restored.state["auditEvents"]
        .as_array()
        .unwrap()
        .iter()
        .find(|item| item["eventType"] == "workout_void_restored")
        .unwrap();
    assert_eq!(event["payload"]["details"]["before"]["status"], "void");
    assert_eq!(event["payload"]["details"]["after"]["status"], "active");
}

#[test]
fn restore_rejects_active_superseded_and_reverted_rows() {
    let mut connection = connection();
    let created = log_workout(
        &mut connection,
        "workout-add-restore-02",
        json!({"date":BASE_WORKOUT,"name":"原课程","type":"有氧","durationMinutes":22}),
        Some(bootstrap()),
    );
    let parent_id = created.state["workouts"][0]["id"].as_str().unwrap().to_string();
    let revised = corrected(
        &mut connection,
        "workout-revise-restore-02",
        &parent_id,
        json!({"workoutId":parent_id,"date":BASE_WORKOUT,"name":"改后课程","type":"HIIT","durationMinutes":26,"reason":"改错了"}),
    );
    let head_id = active_workout_id(&revised.state);

    let on_active = restore_voided(&mut connection, "workout-restore-02a", &head_id, "想恢复").unwrap_err();
    assert!(on_active.contains("只有已作废的记录可以恢复。"), "实际是：{on_active}");
    let on_superseded = restore_voided(&mut connection, "workout-restore-02b", &parent_id, "想恢复").unwrap_err();
    assert!(on_superseded.contains("只有已作废的记录可以恢复。"), "实际是：{on_superseded}");

    undo_correction(&mut connection, "workout-undo-restore-02", &head_id, None).unwrap();
    let on_reverted = restore_voided(&mut connection, "workout-restore-02c", &head_id, "想恢复").unwrap_err();
    assert!(on_reverted.contains("只有已作废的记录可以恢复。"), "实际是：{on_reverted}");
}

#[test]
fn restore_requires_a_reason() {
    let mut connection = connection();
    let created = log_workout(
        &mut connection,
        "workout-add-restore-03",
        json!({"date":BASE_WORKOUT,"name":"有效记录","type":"有氧","durationMinutes":30}),
        Some(bootstrap()),
    );
    let id = created.state["workouts"][0]["id"].as_str().unwrap().to_string();
    execute_with_connection(
        &mut connection,
        request(
            "workout-void-restore-03",
            "void_workout",
            json!({"workoutId":id,"reason":"重复录入"}),
            None,
        ),
    )
    .unwrap();

    let error = restore_voided(&mut connection, "workout-restore-03", &id, "   ").unwrap_err();
    assert!(
        error.contains("请填写修改原因。"),
        "恢复必须写原因，与撤销的可选形成对照；实际是：{error}"
    );
}

#[test]
fn restore_keeps_the_correction_chain_consistent() {
    let mut connection = connection();
    let created = log_workout(
        &mut connection,
        "workout-add-restore-04",
        json!({"date":BASE_WORKOUT,"name":"原课程","type":"有氧","durationMinutes":22}),
        Some(bootstrap()),
    );
    let parent_id = created.state["workouts"][0]["id"].as_str().unwrap().to_string();
    let revised = corrected(
        &mut connection,
        "workout-revise-restore-04",
        &parent_id,
        json!({"workoutId":parent_id,"date":BASE_WORKOUT,"name":"改后课程","type":"HIIT","durationMinutes":26,"reason":"改错了"}),
    );
    let head_id = active_workout_id(&revised.state);
    execute_with_connection(
        &mut connection,
        request(
            "workout-void-restore-04",
            "void_workout",
            json!({"workoutId":head_id,"reason":"先整条作废"}),
            None,
        ),
    )
    .unwrap();

    let restored = restore_voided(&mut connection, "workout-restore-04", &head_id, "其实只想去掉时长").unwrap();
    let head = workout_by_id(&restored.state, &head_id);
    assert_eq!(head["status"], "active");
    assert_eq!(head["supersedesId"], parent_id, "恢复后仍要指向它更正的父行");
    let parent = workout_by_id(&restored.state, &parent_id);
    assert_eq!(parent["status"], "superseded");
    assert_eq!(parent["supersededBy"], head_id);

    let undone = undo_correction(&mut connection, "workout-undo-restore-04", &head_id, None).unwrap();
    assert_eq!(workout_by_id(&undone.state, &parent_id)["status"], "active");
    assert_eq!(workout_by_id(&undone.state, &head_id)["status"], "reverted");
}

#[test]
fn undo_and_restore_replay_without_duplicate_audit() {
    let mut connection = connection();
    let created = log_workout(
        &mut connection,
        "workout-add-replay-11",
        json!({"date":BASE_WORKOUT,"name":"原课程","type":"有氧","durationMinutes":22}),
        Some(bootstrap()),
    );
    let parent_id = created.state["workouts"][0]["id"].as_str().unwrap().to_string();
    let revised = corrected(
        &mut connection,
        "workout-revise-replay-11",
        &parent_id,
        json!({"workoutId":parent_id,"date":BASE_WORKOUT,"name":"改后课程","type":"HIIT","durationMinutes":26,"reason":"改错了"}),
    );
    let head_id = active_workout_id(&revised.state);

    let first = undo_correction(&mut connection, "workout-undo-replay-11", &head_id, Some("撤回")).unwrap();
    let replay = undo_correction(&mut connection, "workout-undo-replay-11", &head_id, Some("撤回")).unwrap();
    assert!(first.applied);
    assert!(replay.replayed, "同 commandId 同内容必须走回执");
    assert_eq!(replay.revision, first.revision);
    assert_eq!(workout_audit_count(&replay.state, "workout_correction_undone"), 1);
    assert_eq!(replay.state["workouts"].as_array().unwrap().len(), 2);

    execute_with_connection(
        &mut connection,
        request(
            "workout-void-replay-11",
            "void_workout",
            json!({"workoutId":parent_id,"reason":"现在不需要了"}),
            None,
        ),
    )
    .unwrap();
    let restored = restore_voided(&mut connection, "workout-restore-replay-11", &parent_id, "误点作废").unwrap();
    let replay_restore = restore_voided(&mut connection, "workout-restore-replay-11", &parent_id, "误点作废").unwrap();
    assert!(restored.applied);
    assert!(replay_restore.replayed);
    assert_eq!(workout_audit_count(&replay_restore.state, "workout_void_restored"), 1);
}

#[test]
fn new_kinds_are_accepted_by_the_command_whitelist() {
    let mut connection = connection();
    log_workout(
        &mut connection,
        "workout-add-whitelist",
        json!({"date":BASE_WORKOUT,"name":"原课程","type":"有氧","durationMinutes":22}),
        Some(bootstrap()),
    );

    let undo_error = undo_correction(&mut connection, "workout-undo-whitelist", "missing", None).unwrap_err();
    assert!(
        !undo_error.contains("未知的领域命令"),
        "新 kind 必须先过白名单，否则前端只会看到一句莫名报错；实际是：{undo_error}"
    );
    let restore_error =
        restore_voided(&mut connection, "workout-restore-whitelist", "missing", "恢复").unwrap_err();
    assert!(
        !restore_error.contains("未知的领域命令"),
        "实际是：{restore_error}"
    );
}
