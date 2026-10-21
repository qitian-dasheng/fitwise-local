use crate::domain_commands::{
    array, array_mut, now_and_date, payload_number, payload_str, CommandMutation,
};
use chrono::{DateTime, FixedOffset, NaiveDate, Utc};
use serde_json::{json, Map, Value};

fn number(value: &Value, key: &str, positive: bool) -> Result<f64, String> {
    let n = payload_number(value, key)?;
    if n < 0.0 || (positive && n == 0.0) {
        return Err(format!(
            "{key} 必须{}。",
            if positive { "大于 0" } else { "非负" }
        ));
    }
    Ok(n)
}
fn money(value: &Value, key: &str) -> Result<f64, String> {
    let n = number(value, key, false)?;
    if n > 100_000_000.0 || (n * 100.0 - (n * 100.0).round()).abs() > 0.00001 {
        return Err("金额最多保留两位小数。".into());
    }
    Ok(n)
}
fn day(value: &str) -> Result<&str, String> {
    if value.len() != 10 || NaiveDate::parse_from_str(value, "%Y-%m-%d").is_err() {
        return Err("日期无效，请填写 YYYY-MM-DD。".into());
    }
    Ok(value)
}
fn base_unit(unit: &str) -> Result<(&'static str, f64), String> {
    match unit {
        "g" => Ok(("g", 1.0)),
        "kg" => Ok(("g", 1000.0)),
        "ml" => Ok(("ml", 1.0)),
        "l" => Ok(("ml", 1000.0)),
        "piece" => Ok(("piece", 1.0)),
        _ => Err("请补充并确认包装内容规格。".into()),
    }
}
pub(crate) fn normalized(purchase: &Value, quantity: f64) -> Result<(f64, &'static str), String> {
    if !quantity.is_finite() || quantity <= 0.0 {
        return Err("数量必须大于 0。".into());
    }
    let unit = payload_str(purchase, "unit")?;
    let (amount, base) = if let Some(pack) = purchase.get("packaging").filter(|v| !v.is_null()) {
        if !["bag", "box", "bottle", "pack", "piece"].contains(&unit)
            || purchase["packagingConfirmed"] != true
        {
            return Err("请核对并确认包装规格。".into());
        }
        let count = number(pack, "count", true)?;
        if count.fract() != 0.0
            || !["bag", "box", "bottle", "piece"].contains(&payload_str(pack, "container")?)
        {
            return Err("包装内件数应为正整数，单位需明确。".into());
        }
        let content = number(pack, "contentAmount", true)?;
        let (base, scale) = base_unit(payload_str(pack, "contentUnit")?)?;
        (quantity * count * content * scale, base)
    } else {
        let (base, scale) = base_unit(unit)?;
        (quantity * scale, base)
    };
    if !amount.is_finite() || amount < 0.0001 || amount > 1_000_000_000.0 {
        return Err("换算数量超出有效范围，请核对规格。".into());
    }
    Ok(((amount * 10000.0).round() / 10000.0, base))
}
fn linked_food(
    state: &Map<String, Value>,
    input: &Value,
    unit: &str,
    fallback: &str,
) -> Result<String, String> {
    let Some(id) = input
        .get("foodId")
        .and_then(Value::as_str)
        .filter(|v| !v.is_empty())
    else {
        return Ok(format!("food-{fallback}"));
    };
    let inventory_match = array(state, "inventory")?
        .iter()
        .any(|v| v["foodId"] == id && v["unit"] == unit);
    let recipe_match = array(state, "recipes")?
        .iter()
        .flat_map(|v| v["ingredients"].as_array().into_iter().flatten())
        .any(|v| v["foodId"] == id && v["unit"] == unit);
    let library_match = array(state, "foodDefinitions")?
        .iter()
        .find(|v| v["id"] == id)
        .is_some_and(|food| {
            array(state, "foodDefinitionVersions").is_ok_and(|versions| {
                versions.iter().any(|v| {
                    v["id"] == food["activeVersionId"]
                        && (v["basis"]["unit"] == unit
                            || v["conversions"]
                                .as_array()
                                .is_some_and(|items| items.iter().any(|c| c["unit"] == unit)))
                })
            })
        });
    let existing_order = array(state, "purchases")?.iter().any(|p| {
        p["id"] == input["purchaseId"]
            && p["foodId"] == id
            && normalized(p, 1.0).is_ok_and(|(_, base)| base == unit)
    });
    if !inventory_match && !recipe_match && !library_match && !existing_order {
        return Err("关联食材不存在或基础计量单位不匹配；请检查品牌、生熟及规格。".into());
    }
    Ok(id.into())
}
fn receipt_quantity(purchase: &Value) -> f64 {
    purchase["receipts"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|r| r["quantity"].as_f64())
        .sum()
}
fn unit_label(unit: &str) -> &str {
    match unit {
        "g" => "克",
        "kg" => "千克",
        "ml" => "毫升",
        "l" => "升",
        "piece" => "个",
        "bag" => "袋",
        "box" => "盒",
        "bottle" => "瓶",
        "pack" => "组",
        _ => unit,
    }
}
fn specification(p: &Value) -> String {
    let unit = unit_label(p["unit"].as_str().unwrap_or(""));
    let amount = p["amount"].as_f64().unwrap_or(0.0);
    if let Some(pack) = p.get("packaging").filter(|v| !v.is_null()) {
        format!(
            "原订单 {amount} {unit} · {} {} × {} {}/{}",
            pack["contentAmount"],
            unit_label(pack["contentUnit"].as_str().unwrap_or("")),
            pack["count"],
            unit_label(pack["container"].as_str().unwrap_or("")),
            unit
        )
    } else {
        format!("原订单 {amount} {unit}")
    }
}
fn purchase_index(state: &Map<String, Value>, payload: &Value) -> Result<usize, String> {
    let id = payload_str(payload, "purchaseId")?;
    array(state, "purchases")?
        .iter()
        .position(|v| v["id"] == id)
        .ok_or("找不到采购记录。".into())
}
fn open_order(purchase: &Value) -> Result<(), String> {
    if !["ordered", "partially_received"].contains(&purchase["status"].as_str().unwrap_or("")) {
        return Err("这笔采购已结束、未下单或已取消，不能继续收货。".into());
    }
    Ok(())
}
fn create_order(state: &Map<String, Value>, payload: &Value, id: &str) -> Result<Value, String> {
    let name = payload_str(payload, "name")?.trim();
    if name.chars().count() > 160 {
        return Err("商品名称过长。".into());
    }
    let platform = payload_str(payload, "platform")?;
    if ![
        "duoduo",
        "pinduoduo",
        "taobao",
        "tmall",
        "jd",
        "douyin",
        "meituan",
        "online",
        "supermarket",
        "other",
    ]
    .contains(&platform)
    {
        return Err("采购平台无效。".into());
    }
    let amount = number(payload, "amount", true)?;
    let (_, unit) = normalized(payload, amount)?;
    let price = money(payload, "priceCny")?;
    if !["draft", "ordered"].contains(&payload_str(payload, "status")?) {
        return Err("新采购只能是草稿或已下单。".into());
    }
    let confidence = payload_str(payload, "confidence")?;
    if !["high", "medium", "low"].contains(&confidence) {
        return Err("置信度无效。".into());
    }
    let food_id = linked_food(state, payload, unit, id)?;
    let mut order = json!({"id":id,"foodId":food_id,"name":name,"platform":platform,"amount":amount,"unit":payload["unit"],"priceCny":price,"status":payload["status"],"confidence":confidence,"createdAt":Utc::now().to_rfc3339()});
    for key in ["platformName", "url", "expectedArrival", "orderedAt"] {
        if let Some(value) = payload
            .get(key)
            .and_then(Value::as_str)
            .filter(|v| !v.is_empty())
        {
            if value.len() > 2048 {
                return Err("采购文字字段过长。".into());
            }
            if key == "expectedArrival" {
                day(value)?;
            }
            if key == "url" && !value.starts_with("https://") && !value.starts_with("http://") {
                return Err("商品链接仅支持 http/https。".into());
            }
            if key == "orderedAt" {
                let timestamp =
                    DateTime::parse_from_rfc3339(value).map_err(|_| "下单时间必须带时区。")?;
                order["orderedAt"] = json!(timestamp.with_timezone(&Utc).to_rfc3339());
                order["timezone"] = json!("Asia/Shanghai");
                continue;
            }
            order[key] = json!(value);
        }
    }
    if let (Some(ordered), Some(expected)) = (
        order["orderedAt"].as_str(),
        order["expectedArrival"].as_str(),
    ) {
        let ordered = DateTime::parse_from_rfc3339(ordered)
            .map_err(|_| "下单时间无效。")?
            .with_timezone(&FixedOffset::east_opt(28800).unwrap())
            .date_naive()
            .to_string();
        if expected < ordered.as_str() {
            return Err("预计到货不能早于下单日期。".into());
        }
    }
    if payload.get("packaging").is_some_and(|v| !v.is_null()) {
        order["packaging"] = payload["packaging"].clone();
        order["packagingConfirmed"] = json!(true);
    }
    if payload.get("paidCny").is_some_and(|v| !v.is_null()) {
        let paid = money(payload, "paidCny")?;
        if paid > price + 0.00001 {
            return Err("已付款不能大于订单金额。".into());
        }
        order["paidCny"] = json!(paid);
        order["refundedCny"] = json!(0);
    }
    Ok(order)
}
pub(crate) fn apply(
    state: &mut Map<String, Value>,
    kind: &str,
    payload: &Value,
    command_id: &str,
) -> Result<CommandMutation, String> {
    let (now, today) = now_and_date();
    let mut result = json!({});
    let before;
    let entity_id;
    match kind {
        "add_purchase" | "revise_purchase" => {
            if kind == "add_purchase" {
                entity_id = format!("record-{command_id}");
                before = Value::Null;
                let order = create_order(state, payload, &entity_id)?;
                array_mut(state, "purchases")?.push(order);
            } else {
                let index = purchase_index(state, payload)?;
                before = state["purchases"][index].clone();
                open_order(&before)?;
                if receipt_quantity(&before) > 0.0 {
                    return Err("已有收货批次的订单不能重写规格；请关闭余单后新建替换采购。".into());
                }
                entity_id = payload_str(&before, "id")?.into();
                let mut order = create_order(state, payload, &entity_id)?;
                order["createdAt"] = before.get("createdAt").cloned().unwrap_or(json!(now));
                for key in ["paidCny", "refundedCny"] {
                    if let Some(value) = before.get(key) {
                        order[key] = value.clone();
                    } else {
                        order.as_object_mut().unwrap().remove(key);
                    }
                }
                array_mut(state, "purchases")?[index] = order;
            }
            result = json!({"purchaseId":entity_id});
        }
        "receive_purchase" => {
            let index = purchase_index(state, payload)?;
            before = state["purchases"][index].clone();
            open_order(&before)?;
            entity_id = payload_str(&before, "id")?.into();
            let ordered = number(&before, "amount", true)?;
            let outstanding = ordered - receipt_quantity(&before);
            let quantity = if payload.get("quantity").is_some() {
                number(payload, "quantity", true)?
            } else {
                outstanding
            };
            if quantity > outstanding + 0.00001 {
                return Err("本次收货数量超过未收货数量。".into());
            }
            let (planned, unit) = normalized(&before, quantity)?;
            let actual = if payload.get("actualAmount").is_some() {
                number(payload, "actualAmount", true)?
            } else {
                planned
            };
            if actual < 0.0001 || actual > 1_000_000_000.0 {
                return Err("实际入库数量超出有效范围。".into());
            }
            let basis = if payload.get("actualAmount").is_some() {
                "weighed"
            } else {
                "nominal"
            };
            let cost = if payload.get("costCny").is_some() {
                money(payload, "costCny")?
            } else {
                let previous: f64 = before["receipts"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .filter_map(|r| r["costCny"].as_f64())
                    .sum();
                let allocation = if quantity >= outstanding - 0.00001 {
                    (number(&before, "priceCny", false)? - previous).max(0.0)
                } else {
                    number(&before, "priceCny", false)? * quantity / ordered
                };
                (allocation * 100.0).round() / 100.0
            };
            let received = payload
                .get("receivedAt")
                .and_then(Value::as_str)
                .unwrap_or(&today);
            day(received)?;
            if received > today.as_str() {
                return Err("实际收货日不能是未来日期。".into());
            }
            if let Some(ordered_at) = before["orderedAt"].as_str() {
                let ordered_day = DateTime::parse_from_rfc3339(ordered_at)
                    .map_err(|_| "下单时间无效。")?
                    .with_timezone(&FixedOffset::east_opt(28800).unwrap())
                    .date_naive()
                    .to_string();
                if received < ordered_day.as_str() {
                    return Err("实际收货不能早于下单。".into());
                }
            }
            let expires = payload
                .get("expiresAt")
                .and_then(Value::as_str)
                .filter(|v| !v.is_empty());
            if let Some(value) = expires {
                day(value)?;
            }
            let reason = payload
                .get("reason")
                .and_then(Value::as_str)
                .unwrap_or("按订单确认收货");
            if reason.trim().is_empty() {
                return Err("请填写收货核对说明。".into());
            }
            let replacement = payload.get("replacement").filter(|v| !v.is_null());
            let name = if let Some(value) = replacement {
                payload_str(value, "name")?
            } else {
                payload_str(&before, "name")?
            };
            let food_id = if let Some(value) = replacement {
                linked_food(state, value, unit, command_id)?
            } else {
                payload_str(&before, "foodId")
                    .map(str::to_owned)
                    .unwrap_or_else(|_| format!("food-{entity_id}"))
            };
            let lot_id = format!("lot-{command_id}");
            let receipt_id = format!("receipt-{command_id}");
            let receipt = json!({"id":receipt_id,"lotId":lot_id,"quantity":quantity,"actualAmount":actual,"unit":unit,"costCny":cost,"name":name,"foodId":food_id,"receivedAt":received,"expiresAt":expires,"reason":reason,"replacement":replacement.is_some(),"basis":basis});
            let final_delivery = payload
                .get("final")
                .and_then(Value::as_bool)
                .unwrap_or(true);
            let order = &mut array_mut(state, "purchases")?[index];
            if !order["receipts"].is_array() {
                order["receipts"] = json!([]);
            }
            order["receipts"].as_array_mut().unwrap().push(receipt);
            let remaining = (outstanding - quantity).max(0.0);
            order["status"] = json!(if remaining < 0.00001 {
                "received"
            } else if final_delivery {
                "closed"
            } else {
                "partially_received"
            });
            if final_delivery && remaining >= 0.00001 {
                order["closedQuantity"] = json!(remaining);
                order["closedReason"] = json!(reason);
            }
            array_mut(state,"inventory")?.push(json!({"id":lot_id,"purchaseId":entity_id,"receiptId":receipt_id,"foodId":food_id,"name":name,"purchasedAmount":actual,"remainingAmount":actual,"unit":unit,"purchasePriceCny":cost,"purchasedAt":before["orderedAt"].as_str().map(|v|DateTime::parse_from_rfc3339(v).unwrap().with_timezone(&FixedOffset::east_opt(28800).unwrap()).date_naive().to_string()).unwrap_or_else(||received.into()),"receivedAt":received,"expiresAt":expires,"opened":false,"confidence":before["confidence"],"source":before["platform"],"specification":specification(&before),"nominalAmount":planned,"receiptBasis":basis}));
            if basis == "weighed" {
                array_mut(state, "inventory")?
                    .last_mut()
                    .ok_or("库存记录格式无效。")?["weighedAt"] = json!(now);
            }
            array_mut(state,"inventoryMovements")?.push(json!({"id":format!("{command_id}:movement"),"lotId":lot_id,"type":"purchase","amount":actual,"costCny":cost,"reason":reason,"createdAt":now}));
            result = json!({"lotId":lot_id});
        }
        "close_purchase" => {
            let index = purchase_index(state, payload)?;
            before = state["purchases"][index].clone();
            open_order(&before)?;
            entity_id = payload_str(&before, "id")?.into();
            let reason = payload_str(payload, "reason")?;
            let order = &mut array_mut(state, "purchases")?[index];
            order["closedQuantity"] =
                json!((number(&before, "amount", true)? - receipt_quantity(&before)).max(0.0));
            order["closedReason"] = json!(reason);
            order["status"] = json!(if receipt_quantity(&before) > 0.0 {
                "closed"
            } else {
                "cancelled"
            });
        }
        "update_purchase_payment" => {
            let index = purchase_index(state, payload)?;
            before = state["purchases"][index].clone();
            entity_id = payload_str(&before, "id")?.into();
            let paid = money(payload, "paidCny")?;
            let refunded = money(payload, "refundedCny")?;
            let actual_cost: f64 = before["receipts"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(|r| r["costCny"].as_f64())
                .sum();
            if refunded > paid
                || paid > number(&before, "priceCny", false)?.max(actual_cost) + 0.00001
            {
                return Err("请核对累计付款/退款，退款不能超过已付款。".into());
            }
            payload_str(payload, "reason")?;
            let order = &mut array_mut(state, "purchases")?[index];
            order["paidCny"] = json!(paid);
            order["refundedCny"] = json!(refunded);
        }
        "correct_receipt_weight" => {
            let lot_id = payload_str(payload, "lotId")?;
            let actual = number(payload, "actualAmount", true)?;
            if actual < 0.0001 || actual > 1_000_000_000.0 {
                return Err("补录实重数量超出有效范围。".into());
            }
            let reason = payload_str(payload, "reason")?;
            let index = array(state, "inventory")?
                .iter()
                .position(|v| v["id"] == lot_id)
                .ok_or("找不到库存批次。".to_string())?;
            before = state["inventory"][index].clone();
            entity_id = lot_id.to_owned();
            let guidance = "请使用盘点调整当前余量。";
            let purchase_id = before["purchaseId"]
                .as_str()
                .ok_or_else(|| format!("此批次未关联采购，不能补录实重；{guidance}"))?;
            let receipt_id = before["receiptId"]
                .as_str()
                .ok_or_else(|| format!("此批次未关联收货记录，不能补录实重；{guidance}"))?;
            let order_index = array(state, "purchases")?
                .iter()
                .position(|v| v["id"] == purchase_id)
                .ok_or_else(|| format!("找不到关联采购记录，不能补录实重；{guidance}"))?;
            let receipt_exists = array(state, "purchases")?[order_index]["receipts"]
                .as_array()
                .into_iter()
                .flatten()
                .any(|r| r["id"] == receipt_id);
            if !receipt_exists {
                return Err(format!("找不到关联收货记录，不能补录实重；{guidance}"));
            }
            for movement in array(state, "inventoryMovements")? {
                if movement["lotId"] != lot_id {
                    continue;
                }
                if !["purchase", "receipt_correction"]
                    .contains(&movement["type"].as_str().unwrap_or(""))
                {
                    return Err(format!(
                        "此批次已有制作、退货、损耗或盘点记录，不能补录实重；{guidance}"
                    ));
                }
            }
            if array(state, "inventoryMovements")?
                .iter()
                .filter(|m| m["lotId"] == lot_id && m["type"] == "purchase")
                .count()
                != 1
            {
                return Err(format!("此批次的入库流水不完整，不能补录实重；{guidance}"));
            }
            if before["returnedAmount"].as_f64().unwrap_or(0.0) > 0.0
                || before["wastedAmount"].as_f64().unwrap_or(0.0) > 0.0
            {
                return Err(format!(
                    "此批次已有退货或损耗记录，不能补录实重；{guidance}"
                ));
            }
            let purchased = number(&before, "purchasedAmount", true)?;
            let remaining = number(&before, "remainingAmount", false)?;
            if (remaining - purchased).abs() > 0.000_001 {
                return Err(format!("此批次余量与实收不一致，不能补录实重；{guidance}"));
            }
            let corrected = (actual * 10000.0).round() / 10000.0;
            for receipt in array_mut(state, "purchases")?[order_index]["receipts"]
                .as_array_mut()
                .ok_or("收货记录格式无效。".to_string())?
            {
                if receipt["id"] == receipt_id {
                    receipt["actualAmount"] = json!(corrected);
                    receipt["basis"] = json!("weighed");
                }
            }
            let lot = &mut array_mut(state, "inventory")?[index];
            lot["purchasedAmount"] = json!(corrected);
            lot["remainingAmount"] = json!(corrected);
            lot["receiptBasis"] = json!("weighed");
            lot["weighedAt"] = json!(now);
            array_mut(state,"inventoryMovements")?.push(json!({"id":format!("{command_id}:movement"),"lotId":lot_id,"type":"receipt_correction","amount":corrected-purchased,"correctsReceiptId":receipt_id,"reason":reason,"createdAt":now}));
            result = json!({"lotId":lot_id});
        }
        "adjust_inventory" | "dispose_inventory" => {
            entity_id = payload_str(payload, "lotId")?.into();
            let index = array(state, "inventory")?
                .iter()
                .position(|v| v["id"] == entity_id)
                .ok_or("找不到库存批次。")?;
            before = state["inventory"][index].clone();
            let reason = payload_str(payload, "reason")?;
            let current = number(&before, "remainingAmount", false)?;
            let mut movement_type = "adjustment";
            let remaining = if kind == "dispose_inventory" {
                let amount = number(payload, "amount", true)?;
                if amount > current + 0.00001 {
                    return Err("退货或损耗数量超过当前余量。".into());
                }
                movement_type = payload_str(payload, "kind")?;
                if !["return", "waste"].contains(&movement_type) {
                    return Err("损耗类型无效。".into());
                }
                let total_key = if movement_type == "return" {
                    "returnedAmount"
                } else {
                    "wastedAmount"
                };
                array_mut(state, "inventory")?[index][total_key] =
                    json!(before[total_key].as_f64().unwrap_or(0.0) + amount);
                if payload.get("refundCny").is_some_and(|v| !v.is_null()) {
                    if movement_type != "return" {
                        return Err("腐坏损耗不能自动记录退款。".into());
                    }
                    let refund = money(payload, "refundCny")?;
                    let order_index = array(state, "purchases")?
                        .iter()
                        .position(|v| v["id"] == before["purchaseId"])
                        .ok_or("此批次未关联采购，不能记录退款。")?;
                    let order = &mut array_mut(state, "purchases")?[order_index];
                    let paid = order["paidCny"]
                        .as_f64()
                        .ok_or("付款金额未知，请先核对订单付款。")?;
                    let refunded = order["refundedCny"].as_f64().unwrap_or(0.0) + refund;
                    if refunded > paid + 0.00001 {
                        return Err("累计退款不能大于累计付款。".into());
                    }
                    order["refundedCny"] = json!((refunded * 100.0).round() / 100.0);
                }
                (current - amount).max(0.0)
            } else {
                let amount = number(payload, "remainingAmount", false)?;
                let ceiling = (number(&before, "purchasedAmount", true)?
                    - before["returnedAmount"].as_f64().unwrap_or(0.0)
                    - before["wastedAmount"].as_f64().unwrap_or(0.0))
                .max(0.0);
                if amount > ceiling + 0.00001 {
                    return Err(
                        "盘点余量不能超过已收数量减去已退/损耗数量；新增到货请另建批次。".into(),
                    );
                }
                amount
            };
            let lot = &mut array_mut(state, "inventory")?[index];
            lot["remainingAmount"] = json!((remaining * 10000.0).round() / 10000.0);
            if kind == "adjust_inventory" {
                lot["lastCountedAt"] = json!(now);
                if let Some(value) = payload.get("opened") {
                    let opened = value.as_bool().ok_or("开封状态无效。")?;
                    lot["opened"] = json!(opened);
                    lot["openedAt"] = if opened {
                        before
                            .get("openedAt")
                            .filter(|v| !v.is_null())
                            .cloned()
                            .unwrap_or(json!(now))
                    } else {
                        Value::Null
                    };
                }
                if let Some(value) = payload.get("expiresAt") {
                    if value.is_null() {
                        lot.as_object_mut().unwrap().remove("expiresAt");
                    } else {
                        let value = value.as_str().ok_or("到期日无效。")?;
                        day(value)?;
                        lot["expiresAt"] = json!(value);
                    }
                }
            }
            array_mut(state,"inventoryMovements")?.push(json!({"id":format!("{command_id}:movement"),"lotId":entity_id,"type":movement_type,"amount":remaining-current,"reason":reason,"createdAt":now,"refundCny":payload.get("refundCny")}));
        }
        _ => return Err("未知库存命令。".into()),
    }
    array_mut(state,"auditEvents")?.push(json!({"id":format!("{command_id}:audit"),"eventType":kind,"entityType":"inventory_or_purchase","entityId":entity_id,"payload":{"commandId":command_id,"before":before,"input":payload},"createdAt":now}));
    Ok(CommandMutation {
        applied: true,
        result,
    })
}
