// 0.4.6-A 库存补录实重（correct_receipt_weight）领域测试。
// 只使用内存库或 %TEMP% 随机目录文件库，绝不触碰用户真实数据库。

fn weigh_order_payload() -> Value {
    json!({"name":"测试里脊","foodId":"tofu","platform":"duoduo","amount":1,"unit":"pack","packaging":{"count":2,"container":"bag","contentAmount":1000,"contentUnit":"g"},"packagingConfirmed":true,"priceCny":40,"status":"ordered","confidence":"high","paidCny":40})
}

fn received_weigh_lot(
    c: &mut Connection,
    prefix: &str,
    actual: Option<f64>,
    expires: Option<&str>,
) -> DomainCommandResponse {
    let order = execute_with_connection(
        c,
        request(
            &format!("{prefix}-order"),
            "add_purchase",
            weigh_order_payload(),
            Some(bootstrap()),
        ),
    )
    .unwrap();
    let purchase_id = order.state["purchases"][0]["id"].clone();
    let mut payload = json!({"purchaseId": purchase_id});
    if let Some(value) = actual {
        payload["actualAmount"] = json!(value);
    }
    if let Some(value) = expires {
        payload["expiresAt"] = json!(value);
    }
    execute_with_connection(
        c,
        request(&format!("{prefix}-receive"), "receive_purchase", payload, None),
    )
    .unwrap()
}

fn lot_of<'a>(state: &'a Value, lot_id: &str) -> &'a Value {
    state["inventory"]
        .as_array()
        .unwrap()
        .iter()
        .find(|lot| lot["id"] == lot_id)
        .unwrap()
}

fn correct_payload(lot_id: &str, actual: f64) -> Value {
    json!({"lotId":lot_id,"actualAmount":actual,"reason":"电子秤实称核对"})
}

#[test]
fn nominal_receipt_records_nominal_basis_and_correction_updates_three_quantities() {
    let mut c = connection();
    let received = received_weigh_lot(&mut c, "rw", None, None);
    let lot_id = received.result["lotId"].as_str().unwrap().to_owned();
    let receipt_id = received.state["purchases"][0]["receipts"][0]["id"]
        .as_str()
        .unwrap()
        .to_owned();
    // 未填实称的收货：标称=实收=2000，状态为标称估算，无称重时间
    let lot = lot_of(&received.state, &lot_id);
    assert_eq!(lot["nominalAmount"], 2000.0);
    assert_eq!(lot["purchasedAmount"], 2000.0);
    assert_eq!(lot["remainingAmount"], 2000.0);
    assert_eq!(lot["receiptBasis"], "nominal");
    assert!(matches!(lot.get("weighedAt"), None | Some(Value::Null)));
    assert_eq!(received.state["purchases"][0]["receipts"][0]["basis"], "nominal");

    let corrected = execute_with_connection(
        &mut c,
        request("rw-correct", "correct_receipt_weight", correct_payload(&lot_id, 1950.0), None),
    )
    .unwrap();
    // 标称不动；实收与余量更新；称重状态与时间落账
    let lot = lot_of(&corrected.state, &lot_id);
    assert_eq!(lot["nominalAmount"], 2000.0);
    assert_eq!(lot["purchasedAmount"], 1950.0);
    assert_eq!(lot["remainingAmount"], 1950.0);
    assert_eq!(lot["receiptBasis"], "weighed");
    assert!(lot["weighedAt"].is_string());
    let receipt = &corrected.state["purchases"][0]["receipts"][0];
    assert_eq!(receipt["id"], receipt_id);
    assert_eq!(receipt["actualAmount"], 1950.0);
    assert_eq!(receipt["basis"], "weighed");
    // 本批成本与订单支出不变，单位成本按新实收自动重算（40/1950）
    assert_eq!(lot["purchasePriceCny"], 40.0);
    assert_eq!(receipt["costCny"], 40.0);
    assert_eq!(corrected.state["purchases"][0]["paidCny"], 40.0);
    // 流水记录差额并回指收货；审计保留旧值
    let movement = corrected.state["inventoryMovements"]
        .as_array()
        .unwrap()
        .last()
        .unwrap();
    assert_eq!(movement["type"], "receipt_correction");
    assert_eq!(movement["amount"], -50.0);
    assert_eq!(movement["correctsReceiptId"], receipt_id);
    let audit = corrected.state["auditEvents"].as_array().unwrap().last().unwrap();
    assert_eq!(audit["eventType"], "correct_receipt_weight");
    assert_eq!(audit["payload"]["before"]["purchasedAmount"], 2000.0);
    assert_eq!(audit["payload"]["input"]["actualAmount"], 1950.0);
}

#[test]
fn weighed_receipt_marks_basis_and_repeated_corrections_append_movements() {
    let mut c = connection();
    let received = received_weigh_lot(&mut c, "rr", Some(1900.0), None);
    let lot_id = received.result["lotId"].as_str().unwrap().to_owned();
    let lot = lot_of(&received.state, &lot_id);
    assert_eq!(lot["nominalAmount"], 2000.0);
    assert_eq!(lot["purchasedAmount"], 1900.0);
    assert_eq!(lot["receiptBasis"], "weighed");
    assert!(lot["weighedAt"].is_string());
    assert_eq!(received.state["purchases"][0]["receipts"][0]["basis"], "weighed");

    let first = execute_with_connection(
        &mut c,
        request("rr-correct-1", "correct_receipt_weight", correct_payload(&lot_id, 1950.0), None),
    )
    .unwrap();
    assert_eq!(lot_of(&first.state, &lot_id)["purchasedAmount"], 1950.0);
    let second = execute_with_connection(
        &mut c,
        request("rr-correct-2", "correct_receipt_weight", correct_payload(&lot_id, 1960.0), None),
    )
    .unwrap();
    let lot = lot_of(&second.state, &lot_id);
    assert_eq!(lot["purchasedAmount"], 1960.0);
    assert_eq!(lot["remainingAmount"], 1960.0);
    assert_eq!(lot["nominalAmount"], 2000.0);
    let corrections: Vec<&Value> = second.state["inventoryMovements"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|m| m["type"] == "receipt_correction")
        .collect();
    assert_eq!(corrections.len(), 2);
    assert_eq!(corrections[0]["amount"], 50.0);
    assert_eq!(corrections[1]["amount"], 10.0);

    // 幂等：同 commandId 同内容重放，状态不变
    let replay = execute_with_connection(
        &mut c,
        request("rr-correct-2", "correct_receipt_weight", correct_payload(&lot_id, 1960.0), None),
    )
    .unwrap();
    assert!(replay.replayed);
    assert_eq!(replay.state, second.state);
    // 指纹冲突：同 commandId 不同内容拒绝
    assert!(execute_with_connection(
        &mut c,
        request("rr-correct-2", "correct_receipt_weight", correct_payload(&lot_id, 1970.0), None)
    )
    .is_err());
}

#[test]
fn receipt_weight_correction_rejects_after_any_downstream_operation() {
    // 制作消耗后：拦截并引导盘点，且不留下半笔状态
    let mut c = connection();
    let received = received_weigh_lot(&mut c, "g-cook", None, Some("2026-10-25"));
    let lot_id = received.result["lotId"].as_str().unwrap().to_owned();
    for lot in ["lot-late-open", "lot-early"] {
        execute_with_connection(
            &mut c,
            request(
                &format!("g-cook-zero-{lot}"),
                "adjust_inventory",
                json!({"lotId":lot,"remainingAmount":0,"reason":"隔离旧批次"}),
                None,
            ),
        )
        .unwrap();
    }
    execute_with_connection(
        &mut c,
        request("g-cook-prepare", "prepare_recipe", json!({"recipeVersionId":"recipe-1"}), None),
    )
    .unwrap();
    let after_cook: Value =
        serde_json::from_str(&crate::domain_store::load_envelope(&c).unwrap().unwrap()).unwrap();
    assert!(
        lot_of(&after_cook["state"], &lot_id)["remainingAmount"]
            .as_f64()
            .unwrap()
            < 2000.0,
        "制作应扣减新批次"
    );
    let before = crate::domain_store::load_envelope(&c).unwrap();
    let err = execute_with_connection(
        &mut c,
        request("g-cook-correct", "correct_receipt_weight", correct_payload(&lot_id, 1950.0), None),
    )
    .unwrap_err();
    assert!(err.contains("制作"), "制作后应拦截并引导盘点：{err}");
    assert_eq!(crate::domain_store::load_envelope(&c).unwrap(), before);

    // 退货、损耗、盘点后分别拦截
    for (prefix, kind, extra) in [
        ("g-return", "dispose_inventory", json!({"amount":100,"kind":"return"})),
        ("g-waste", "dispose_inventory", json!({"amount":100,"kind":"waste"})),
        ("g-count", "adjust_inventory", json!({"remainingAmount":1900})),
    ] {
        let mut c = connection();
        let received = received_weigh_lot(&mut c, prefix, None, None);
        let lot_id = received.result["lotId"].as_str().unwrap().to_owned();
        let mut payload = extra;
        payload["lotId"] = json!(lot_id);
        payload["reason"] = json!("后续操作");
        execute_with_connection(&mut c, request(&format!("{prefix}-op"), kind, payload, None)).unwrap();
        let err = execute_with_connection(
            &mut c,
            request(&format!("{prefix}-correct"), "correct_receipt_weight", correct_payload(&lot_id, 1950.0), None),
        )
        .unwrap_err();
        assert!(err.contains("盘点"), "{prefix} 后应拦截并引导盘点：{err}");
    }

    // 旧批次（无关联收货记录）拒绝
    let mut c = connection();
    let err = execute_with_connection(
        &mut c,
        request("g-old-correct", "correct_receipt_weight", correct_payload("lot-early", 1950.0), Some(bootstrap())),
    )
    .unwrap_err();
    assert!(err.contains("未关联采购"), "旧批次应被拒绝：{err}");
}

#[test]
fn receipt_weight_correction_validates_amounts_and_references() {
    let mut c = connection();
    let received = received_weigh_lot(&mut c, "g-input", None, None);
    let lot_id = received.result["lotId"].as_str().unwrap().to_owned();
    for (id, payload, expect) in [
        ("g-input-zero", json!({"lotId":lot_id,"actualAmount":0,"reason":"x"}), "大于 0"),
        ("g-input-neg", json!({"lotId":lot_id,"actualAmount":-5,"reason":"x"}), "大于 0"),
        ("g-input-huge", json!({"lotId":lot_id,"actualAmount":2000000000,"reason":"x"}), "有效范围"),
        ("g-input-reason", json!({"lotId":lot_id,"actualAmount":1950,"reason":"   "}), "reason"),
        ("g-input-lot", json!({"lotId":"lot-missing","actualAmount":1950,"reason":"x"}), "找不到库存批次"),
    ] {
        let err = execute_with_connection(&mut c, request(id, "correct_receipt_weight", payload, None))
            .unwrap_err();
        assert!(err.contains(expect), "期望错误包含 {expect}，实际：{err}");
    }
}

#[test]
fn receipt_weight_correction_survives_file_database_restart() {
    let directory = std::env::temp_dir().join(format!("fitwise-weigh-{}", rand::random::<u64>()));
    std::fs::create_dir(&directory).unwrap();
    let path = directory.join("test.db");
    let lot_id;
    let final_state;
    {
        let mut c = Connection::open(&path).unwrap();
        c.execute_batch("CREATE TABLE app_kv(key TEXT PRIMARY KEY,value TEXT NOT NULL,updated_at TEXT NOT NULL);").unwrap();
        ensure_repository_schema(&c).unwrap();
        let received = received_weigh_lot(&mut c, "fr", None, None);
        lot_id = received.result["lotId"].as_str().unwrap().to_owned();
        let corrected = execute_with_connection(
            &mut c,
            request("fr-correct", "correct_receipt_weight", correct_payload(&lot_id, 1950.0), None),
        )
        .unwrap();
        final_state = corrected.state.clone();
    }
    {
        let c = Connection::open(&path).unwrap();
        let loaded: Value =
            serde_json::from_str(&crate::domain_store::load_envelope(&c).unwrap().unwrap()).unwrap();
        assert_eq!(loaded["state"], final_state);
        assert_eq!(
            c.query_row("PRAGMA quick_check", [], |r| r.get::<_, String>(0)).unwrap(),
            "ok"
        );
    }
    std::fs::remove_dir_all(directory).unwrap();
}

#[test]
fn full_chain_nominal_receipt_weigh_cook_consume_count_and_return_stays_consistent() {
    let mut c = connection();
    let received = received_weigh_lot(&mut c, "chain", None, Some("2026-10-25"));
    let lot_id = received.result["lotId"].as_str().unwrap().to_owned();
    // 标称 2000 入库 → 电子秤实称 1950 补录
    let corrected = execute_with_connection(
        &mut c,
        request("chain-weigh", "correct_receipt_weight", correct_payload(&lot_id, 1950.0), None),
    )
    .unwrap();
    assert_eq!(lot_of(&corrected.state, &lot_id)["purchasedAmount"], 1950.0);
    // 隔离旧批次，确保制作只扣新批次
    for lot in ["lot-late-open", "lot-early"] {
        execute_with_connection(
            &mut c,
            request(&format!("chain-zero-{lot}"), "adjust_inventory", json!({"lotId":lot,"remainingAmount":0,"reason":"隔离旧批次"}), None),
        )
        .unwrap();
    }
    let cooked = execute_with_connection(
        &mut c,
        request("chain-cook", "prepare_recipe", json!({"recipeVersionId":"recipe-1"}), None),
    )
    .unwrap();
    let batch_id = cooked.result["batchId"].as_str().unwrap().to_owned();
    assert_eq!(lot_of(&cooked.state, &lot_id)["remainingAmount"], 1650.0);
    let (_, today) = now_and_date();
    execute_with_connection(
        &mut c,
        request("chain-lunch", "consume_batch", json!({"batchId":batch_id,"mealType":"lunch","ratio":0.5,"date":today}), None),
    )
    .unwrap();
    // 盘点当前余量：不回改历史制作扣减
    execute_with_connection(
        &mut c,
        request("chain-count", "adjust_inventory", json!({"lotId":lot_id,"remainingAmount":1600,"reason":"盘点"}), None),
    )
    .unwrap();
    // 退货 100：余量与退货累计分开
    execute_with_connection(
        &mut c,
        request("chain-return", "dispose_inventory", json!({"lotId":lot_id,"amount":100,"kind":"return","reason":"退货"}), None),
    )
    .unwrap();
    let final_state: Value =
        serde_json::from_str(&crate::domain_store::load_envelope(&c).unwrap().unwrap()).unwrap();
    let lot = lot_of(&final_state["state"], &lot_id);
    assert_eq!(lot["purchasedAmount"], 1950.0);
    assert_eq!(lot["nominalAmount"], 2000.0);
    assert_eq!(lot["remainingAmount"], 1500.0);
    assert_eq!(lot["returnedAmount"], 100.0);
    let cooking = final_state["state"]["inventoryMovements"]
        .as_array()
        .unwrap()
        .iter()
        .find(|m| m["type"] == "cooking")
        .unwrap();
    assert_eq!(cooking["amount"], -300.0);
    // 已有制作/盘点/退货后，补录实重被拒绝并引导盘点
    let err = execute_with_connection(
        &mut c,
        request("chain-weigh-again", "correct_receipt_weight", correct_payload(&lot_id, 1900.0), None),
    )
    .unwrap_err();
    assert!(err.contains("盘点"), "链路末态应阻断补录：{err}");
}
