// 0.9.2 目标可编辑（OBS-001/002）：更新 profile 单例、审计留痕、边界拒绝与幂等回放。
// 本文件由 domain_commands::tests 经 include! 接入，共享 connection()/request()/bootstrap()。

fn target_payload(min: f64, target: f64, max: f64, protein: f64, fiber: f64, weight: f64) -> Value {
    json!({"dailyCalories":{"min":min,"target":target,"max":max},"proteinTargetG":protein,"fiberTargetG":fiber,"targetWeightKg":weight})
}

fn target_events(state: &Value) -> Vec<&Value> {
    state["auditEvents"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|item| item["eventType"] == "target_profile_updated")
        .collect()
}

#[test]
fn set_target_profile_updates_goals_and_audits_previous_values() {
    let mut c = connection();
    let response = execute_with_connection(
        &mut c,
        request(
            "target-update-001",
            "set_target_profile",
            target_payload(1600.0, 1750.0, 1900.0, 120.0, 30.0, 75.5),
            Some(bootstrap()),
        ),
    )
    .unwrap();
    assert!(response.applied);
    assert_eq!(response.state["profile"]["dailyCalories"]["target"].as_f64(), Some(1750.0));
    assert_eq!(response.state["profile"]["proteinTargetG"].as_f64(), Some(120.0));
    assert_eq!(response.state["profile"]["fiberTargetG"].as_f64(), Some(30.0));
    assert_eq!(response.state["profile"]["targetWeightKg"].as_f64(), Some(75.5));

    let events = target_events(&response.state);
    assert_eq!(events.len(), 1);
    assert_eq!(events[0]["entityType"], "profile");
    // bootstrap 的 profile 没有旧目标：before 相应字段为空，不伪造数值。
    assert!(events[0]["payload"]["details"]["before"]["proteinTargetG"].is_null());
    assert_eq!(events[0]["payload"]["details"]["after"]["proteinTargetG"].as_f64(), Some(120.0));

    // 第二次修改：before 必须捕获上一轮的值，构成完整的目标变更链。
    let second = execute_with_connection(
        &mut c,
        request(
            "target-update-002",
            "set_target_profile",
            target_payload(1700.0, 1800.0, 1900.0, 100.0, 25.0, 78.0),
            None,
        ),
    )
    .unwrap();
    let events = target_events(&second.state);
    assert_eq!(events.len(), 2);
    assert_eq!(events[1]["payload"]["details"]["before"]["proteinTargetG"].as_f64(), Some(120.0));
    assert_eq!(events[1]["payload"]["details"]["after"]["proteinTargetG"].as_f64(), Some(100.0));
    assert_eq!(second.state["profile"]["dailyCalories"]["min"].as_f64(), Some(1700.0));
}

#[test]
fn set_target_profile_rejects_out_of_range_and_disordered_inputs() {
    let mut c = connection();
    let cases: [(Value, &str); 5] = [
        (target_payload(1900.0, 1800.0, 1700.0, 100.0, 25.0, 78.0), "下限 ≤ 目标 ≤ 上限"),
        (target_payload(100.0, 1800.0, 1900.0, 100.0, 25.0, 78.0), "500–8000"),
        (target_payload(1700.0, 1800.0, 1900.0, 0.0, 25.0, 78.0), "蛋白质目标"),
        (target_payload(1700.0, 1800.0, 1900.0, 100.0, 300.0, 78.0), "纤维目标"),
        (target_payload(1700.0, 1800.0, 1900.0, 100.0, 25.0, 78.555), "两位小数"),
    ];
    for (index, (payload, needle)) in cases.iter().enumerate() {
        let error = execute_with_connection(
            &mut c,
            request(
                &format!("target-reject-{index}"),
                "set_target_profile",
                payload.clone(),
                Some(bootstrap()),
            ),
        )
        .unwrap_err();
        assert!(error.contains(needle), "case {index}: {error}");
    }
    // 全部被拒后没有落库：首次成功写入前信封不存在（bootstrap 只在命令成功时持久化）。
    assert!(load_envelope(&c).unwrap().is_none());
}

#[test]
fn set_target_profile_replays_once_and_rejects_changed_payloads() {
    let mut c = connection();
    let payload = target_payload(1600.0, 1750.0, 1900.0, 110.0, 30.0, 77.5);
    let first = execute_with_connection(
        &mut c,
        request("target-replay-001", "set_target_profile", payload.clone(), Some(bootstrap())),
    )
    .unwrap();
    assert!(first.applied);
    let replay = execute_with_connection(
        &mut c,
        request("target-replay-001", "set_target_profile", payload, None),
    )
    .unwrap();
    assert!(replay.replayed);
    assert_eq!(
        first.state["auditEvents"].as_array().unwrap().len(),
        replay.state["auditEvents"].as_array().unwrap().len(),
        "回放不得追加审计事件"
    );
    let changed = target_payload(1650.0, 1750.0, 1900.0, 110.0, 30.0, 77.5);
    let error = execute_with_connection(
        &mut c,
        request("target-replay-001", "set_target_profile", changed, None),
    )
    .unwrap_err();
    assert!(error.contains("命令内容"));
}
