use crate::domain_commands::{
    array, array_mut, now_and_date, payload_number, payload_str, CommandMutation,
};
use serde_json::{json, Map, Value};

fn round(n: f64) -> f64 {
    (n * 10000.0).round() / 10000.0
}
fn active(v: &Value) -> bool {
    v["status"].as_str().is_none_or(|s| s == "active")
}

// Check all effective events, not just the row being edited. Never repair corrupt ledgers by guessing.
pub(crate) fn validate_balance(state: &Map<String, Value>, batch: &Value) -> Result<(), String> {
    if !["open", "closed"].contains(&batch["status"].as_str().unwrap_or("")) {
        return Err("批次已作废或状态无效，不能继续分餐或纠错。".into());
    }
    let c = payload_number(batch, "consumedRatio")?;
    let w = payload_number(batch, "wastedRatio")?;
    let r = payload_number(batch, "remainingRatio")?;
    if [c, w, r].iter().any(|n| *n < 0.0 || *n > 1.0) || (c + w + r - 1.0).abs() > 1e-6 {
        return Err("熟食比例不守恒，请先核对。".into());
    }
    for (collection, expected) in [("consumptionEvents", c), ("wasteEvents", w)] {
        let mut sum = 0.0;
        for event in array(state, collection)?
            .iter()
            .filter(|e| e["batchId"] == batch["id"] && active(e))
        {
            let ratio = payload_number(event, "ratio")?;
            if ratio <= 0.0 || ratio > 1.0 {
                return Err("事件比例无效。".into());
            }
            sum += ratio;
        }
        if (sum - expected).abs() > 1e-6 {
            return Err("批次与有效进食／浪费事件不一致，请先核对。".into());
        }
    }
    Ok(())
}

pub(crate) fn apply(
    state: &mut Map<String, Value>,
    kind: &str,
    payload: &Value,
    command_id: &str,
) -> Result<CommandMutation, String> {
    let reason = payload_str(payload, "reason")?.trim();
    if reason.chars().count() > 500 {
        return Err("原因最多 500 字。".into());
    }
    let (now, _) = now_and_date();
    let batch_id = if kind == "void_prepared_batch" {
        payload_str(payload, "batchId")?.to_owned()
    } else {
        let id = payload_str(payload, "wasteId")?;
        let event = array(state, "wasteEvents")?
            .iter()
            .find(|e| e["id"] == id)
            .ok_or("浪费记录不存在。")?;
        payload_str(event, "batchId")?.to_owned()
    };
    let index = array(state, "batches")?
        .iter()
        .position(|b| b["id"] == batch_id)
        .ok_or("熟食批次不存在。")?;
    let before = state["batches"][index].clone();
    validate_balance(state, &before)?;
    let mut source_before = Value::Null;
    let mut source_after = Value::Null;
    if kind == "void_prepared_batch" {
        // Even voided events are downstream evidence; reversing several operations is not one undo.
        if array(state, "consumptionEvents")?
            .iter()
            .chain(array(state, "wasteEvents")?)
            .any(|e| e["batchId"] == batch_id)
            || array(state, "meals")?
                .iter()
                .any(|m| m["preparedBatchId"] == batch_id)
        {
            return Err("已有分餐或浪费历史，不能一键撤回制作；请保留实际消耗并逐项核对。".into());
        }
        let deductions = before["inventoryDeductions"]
            .as_array()
            .filter(|d| !d.is_empty())
            .ok_or("旧批次缺少原料扣减前后快照，不能安全退回库存；请人工盘点并保留原因。")?;
        if before["inventoryDeducted"] != true {
            return Err("批次没有可冲正的原料扣减。".into());
        }
        let mut restorations = Vec::new();
        let mut seen = std::collections::HashSet::new();
        for d in deductions {
            let movement_id = payload_str(d, "movementId")?;
            let lot_id = payload_str(&d["lotBefore"], "id")?;
            if !seen.insert(lot_id.to_owned()) {
                return Err("扣减快照重复，不能安全冲正。".into());
            }
            let movements = array(state, "inventoryMovements")?;
            let mi = movements
                .iter()
                .position(|m| m["id"] == movement_id)
                .ok_or("原料扣减流水缺失。")?;
            let movement = &movements[mi];
            let li = array(state, "inventory")?
                .iter()
                .position(|l| l["id"] == lot_id)
                .ok_or("原库存批次缺失。")?;
            let original = payload_number(&d["lotBefore"], "remainingAmount")?;
            let after = payload_number(&d["lotAfter"], "remainingAmount")?;
            let amount = payload_number(movement, "amount")?;
            if movement["type"] != "cooking"
                || movement["batchId"] != batch_id
                || movement["lotId"] != lot_id
                || amount >= 0.0
                || (original - after + amount).abs() > 1e-6
                || state["inventory"][li] != d["lotAfter"]
                || movements.iter().skip(mi + 1).any(|m| m["lotId"] == lot_id)
            {
                return Err("原库存已有后续制作、盘点、退货或资料变化，不能安全一键冲正。".into());
            }
            let mut expected = d["lotBefore"].clone();
            expected["remainingAmount"] = json!(after);
            if expected != d["lotAfter"]
                || original < 0.0
                || original > payload_number(&d["lotBefore"], "purchasedAmount")?
            {
                return Err("原料扣减快照不一致，不能制造库存。".into());
            }
            restorations.push((
                li,
                lot_id.to_owned(),
                d["lotBefore"]["remainingAmount"].clone(),
                -amount,
                movement_id.to_owned(),
            ));
        }
        for (n, (li, lot, original, amount, source)) in restorations.into_iter().enumerate() {
            array_mut(state, "inventory")?[li]["remainingAmount"] = original;
            array_mut(state,"inventoryMovements")?.push(json!({"id":format!("{command_id}:reversal:{n}"),"lotId":lot,"type":"adjustment","amount":amount,"reason":reason,"batchId":batch_id,"reversesMovementId":source,"createdAt":now}));
        }
        let batch = &mut array_mut(state, "batches")?[index];
        batch["status"] = json!("void");
        batch["voidedAt"] = json!(now);
        batch["correctionReason"] = json!(reason);
        // Original ratios and deduction evidence remain; void batches are never spendable.
    } else {
        let id = payload_str(payload, "wasteId")?;
        let wi = array(state, "wasteEvents")?
            .iter()
            .position(|e| e["id"] == id && active(e))
            .ok_or("浪费记录已修订或作废，请操作最新记录。")?;
        source_before = state["wasteEvents"][wi].clone();
        let old_ratio = payload_number(&source_before, "ratio")?;
        let voided = kind == "void_waste";
        let ratio = if voided {
            0.0
        } else {
            payload_number(payload, "ratio")?
        };
        if !voided && (ratio <= 0.0 || ratio > 1.0 || (round(ratio) - ratio).abs() > 1e-8) {
            return Err("比例须大于 0、不超过 100%，最多百分比两位小数。".into());
        }
        let remaining = round(payload_number(&before, "remainingRatio")? + old_ratio - ratio);
        if remaining < 0.0 {
            return Err("浪费比例不能占用已经吃掉或其他浪费记录的部分。".into());
        }
        let b = &mut array_mut(state, "batches")?[index];
        b["wastedRatio"] = json!(round(
            payload_number(&before, "wastedRatio")? - old_ratio + ratio
        ));
        b["remainingRatio"] = json!(remaining);
        b["status"] = json!(if remaining > 0.0 { "open" } else { "closed" });
        if remaining > 0.0 {
            b.as_object_mut()
                .ok_or("批次格式无效。")?
                .remove("closedAt");
        } else {
            b["closedAt"] = json!(now);
        }
        let new_id = format!("{command_id}:waste");
        let old = &mut array_mut(state, "wasteEvents")?[wi];
        old["status"] = json!(if voided { "void" } else { "superseded" });
        old["correctedAt"] = json!(now);
        old["correctionReason"] = json!(reason);
        if !voided {
            old["supersededBy"] = json!(new_id);
            source_after = source_before.clone();
            source_after["id"] = json!(new_id);
            source_after["ratio"] = json!(ratio);
            source_after["status"] = json!("active");
            source_after["supersedesId"] = json!(id);
            source_after["correctionReason"] = json!(reason);
            source_after["correctedAt"] = json!(now);
            source_after["createdAt"] = json!(now);
            source_after.as_object_mut().unwrap().remove("supersededBy");
            array_mut(state, "wasteEvents")?.push(source_after.clone());
        }
        // No meal, check-in or raw inventory changes: this correction is not food intake.
    }
    let after = state["batches"][index].clone();
    array_mut(state,"auditEvents")?.push(json!({"id":format!("{command_id}:audit"),"eventType":kind,"entityType":"prepared_batch","entityId":batch_id,"createdAt":now,"payload":{"commandId":command_id,"reason":reason,"before":before,"after":after,"wasteBefore":source_before,"wasteAfter":source_after}}));
    Ok(CommandMutation {
        applied: true,
        result: json!({"batchId":batch_id}),
    })
}
