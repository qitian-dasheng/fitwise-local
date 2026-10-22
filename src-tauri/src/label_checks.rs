//! 标签草稿的三项交叉校验：Atwater 能量自洽、NRV% 反推、每份/每 100 克规格守卫。
//!
//! 这三项都只是「可疑就拦下让人核对」，不替用户改数字。标签识别最容易错的两处是
//! 把千焦当千卡、把一个包装当一份；两处都会让整份营养数据成倍失真，且事后极难发现。
//! 所以宁可让用户在确认前多看一眼，也不要默默写进食材库。

use serde_json::Value;

/// Atwater 系数：碳水 4、蛋白 4、脂肪 9 kcal/g；能量换算 1 kcal = 4.184 kJ。
pub(crate) const KCAL_PER_KJ: f64 = 4.184;
const KCAL_PER_G_CARB: f64 = 4.0;
const KCAL_PER_G_PROTEIN: f64 = 4.0;
const KCAL_PER_G_FAT: f64 = 9.0;

/// 把标签上的能量统一折成 kcal。kJ 只在折算时 ÷4.184，原始标注值不动。
pub(crate) fn energy_to_kcal(declared: f64, energy_unit: &str) -> f64 {
    if energy_unit == "kJ" {
        declared / KCAL_PER_KJ
    } else {
        declared
    }
}

/// 用户填的原始能量值，折成 kcal 后用于与营养素交叉核对。
///
/// `preview_input` 已经做过一次 ÷4.184，但那条路径把「原始标注」和「折算结果」一起返回，
/// 两边的口径必须由同一个函数守住，否则以后改系数就会出现一处改一处漏。
pub(crate) fn declared_kcal(raw_calories: Option<f64>, energy_unit: &str) -> Option<f64> {
    raw_calories.map(|value| energy_to_kcal(value, energy_unit))
}

/// 允许 25% 偏差：膳食纤维、糖醇、有机酸都会让实测能量偏离 Atwater 估算，
/// 而且国内标签普遍按修约后的一位小数标注，卡太紧会把正常标签全拦下来。
const ATWATER_TOLERANCE: f64 = 0.25;
/// NRV% 反推允许 35% 偏差：标签上的 NRV% 多为整数百分比，小分量食物的取整误差很大。
const NRV_TOLERANCE: f64 = 0.35;

/// 每 100 克（或 100 毫升）能量的可信上限。纯油脂约 900 kcal/100g，留出余量。
const ENERGY_PER_100G_MAX_KCAL: f64 = 950.0;

/// 中国营养素参考值（GB 28050）。只收能量与营养成分表常见项目。
pub(crate) const NRV_TABLE: [(&str, f64, &str); 7] = [
    ("calories", 8400.0, "kcal"),
    ("protein", 60.0, "g"),
    ("fat", 60.0, "g"),
    ("carbohydrates", 300.0, "g"),
    ("fiber", 25.0, "g"),
    ("sodium", 2000.0, "mg"),
    ("sugar", 50.0, "g"),
];

fn metric_value(preview: &Value, scope: &str, key: &str) -> Option<f64> {
    preview
        .get(scope)?
        .get(key)?
        .get("value")
        .and_then(Value::as_f64)
}

/// 从预览结果里取每 100 克/毫升的能量；没有质量参考时返回 None（不猜密度）。
fn per_hundred_energy(preview: &Value, unit: &str) -> Option<(f64, String)> {
    let scope = if unit == "ml" { "per100ml" } else { "per100g" };
    let value = metric_value(preview, scope, "calories")?;
    Some((value, scope.to_string()))
}

/// Atwater 交叉校验：三大产能营养素折算出的能量，应与标签标注能量对得上。
///
/// 只报可疑不报「无法判断」：三大营养素缺任意一项就没有可比基准，直接放行。
pub(crate) fn atwater_check(preview: &Value) -> Result<(), String> {
    let scope = if preview.get("per100g").is_some() {
        "per100g"
    } else if preview.get("per100ml").is_some() {
        "per100ml"
    } else {
        return Ok(());
    };
    let (Some(carbs), Some(protein), Some(fat), Some(declared)) = (
        metric_value(preview, scope, "carbohydrates"),
        metric_value(preview, scope, "protein"),
        metric_value(preview, scope, "fat"),
        metric_value(preview, scope, "calories"),
    ) else {
        return Ok(());
    };
    if declared <= 0.0 {
        return Ok(());
    }
    let computed = carbs * KCAL_PER_G_CARB + protein * KCAL_PER_G_PROTEIN + fat * KCAL_PER_G_FAT;
    let deviation = (computed - declared).abs() / declared;
    if deviation > ATWATER_TOLERANCE {
        let scope_label = if scope == "per100g" {
            "每 100 克"
        } else {
            "每 100 毫升"
        };
        return Err(format!(
            "{scope_label}按碳水 {carbs:.1}g、蛋白 {protein:.1}g、脂肪 {fat:.1}g 折算约 {computed:.0} 千卡，与标注 {declared:.0} 千卡相差 {:.0}%。请核对营养素是否录错、或标注能量是否用了千焦；系统不会自动改数。",
            deviation * 100.0
        ));
    }
    Ok(())
}

/// 每 100 克能量上限守卫：超过 950 千卡基本只能是单位或规格错了。
pub(crate) fn energy_ceiling_check(preview: &Value, unit: &str) -> Result<(), String> {
    let Some((value, scope)) = per_hundred_energy(preview, unit) else {
        return Ok(());
    };
    if value > ENERGY_PER_100G_MAX_KCAL {
        let scope_label = if scope == "per100ml" {
            "每 100 毫升"
        } else {
            "每 100 克"
        };
        return Err(format!(
            "{scope_label}能量 {value:.0} 千卡超过可信上限 {ENERGY_PER_100G_MAX_KCAL:.0} 千卡，请核对是否把千焦 kJ 当成千卡 kcal，或参考规格录错。"
        ));
    }
    Ok(())
}

/// NRV% 反推：标签给了 NRV%，就能反算出该营养素的含量，与录入值对不上就是录错了行。
///
/// 只对标签明确给了 NRV% 的项目做校验；没给的项一律跳过，不按 0 处理。
pub(crate) fn nrv_check(preview: &Value, nrv_percents: &Value) -> Result<(), String> {
    let Some(map) = nrv_percents.as_object() else {
        return Ok(());
    };
    if map.is_empty() {
        return Ok(());
    }
    // NRV% 一般标注在「每份」上，所以优先用整体营养值（一份）而不是每 100 克。
    let scope = "nutrition";
    let mut problems = Vec::new();
    for (key, reference, unit) in NRV_TABLE {
        let Some(percent) = map.get(key).and_then(Value::as_f64) else {
            continue;
        };
        let Some(actual) = metric_value(preview, scope, key) else {
            continue;
        };
        let expected = percent / 100.0 * reference;
        // 0% 与「未检出」互为印证，只要实际值也很小就算通过。
        let tolerance = (expected * NRV_TOLERANCE).max(NRV_TOLERANCE * reference * 0.02);
        if (actual - expected).abs() > tolerance {
            problems.push(format!(
                "{key} 标注 {percent:.0}% NRV 约合 {expected:.1}{unit}，实际录得 {actual:.1}{unit}"
            ));
        }
    }
    if problems.is_empty() {
        return Ok(());
    }
    Err(format!(
        "NRV% 反推对不上：{}。请核对是否录错行或单位；系统不会自动改数。",
        problems.join("；")
    ))
}

/// 规格守卫：每份大小与「参考数量」不能矛盾。
///
/// 例：参考数量写「每 100 克」，却把一份记成 1 克；或参考数量写「每 1 份」，
/// 又说一份是 500 克——两种都会让后面的份量换算整体偏移。
pub(crate) fn serving_spec_check(
    basis_unit: &str,
    basis_quantity: f64,
    serving_size: Option<f64>,
) -> Result<(), String> {
    if !matches!(basis_unit, "g" | "ml" | "piece" | "serving" | "package") {
        return Err("参考规格单位无效。".into());
    }
    // 参考数量本身的量级检查不能因为「没填每份」就跳过：写错参考数量同样会让换算整体偏移。
    if matches!(basis_unit, "g" | "ml") && basis_quantity > 5000.0 {
        return Err(format!(
            "参考数量 {basis_quantity:.0}{basis_unit} 过大：标签上「每 100 {basis_unit}」或每份才合理。"
        ));
    }
    let Some(serving) = serving_size else {
        return Ok(());
    };
    if !serving.is_finite() || serving <= 0.0 {
        return Err("每份大小须为正数；没有每份信息请留空，不要填 0。".into());
    }
    // 以克/毫升为参考时，一份不可能小到离谱，也不可能大到 5 千克以上。
    if matches!(basis_unit, "g" | "ml") {
        if serving > 5000.0 {
            return Err(format!(
                "一份 {serving:.0}{basis_unit} 超出常识范围，请核对是否把整箱净含量当成了一份。"
            ));
        }
        if serving < basis_quantity / 100.0 {
            return Err(format!(
                "一份 {serving:.0}{basis_unit} 与参考数量 {basis_quantity:.0}{basis_unit} 相差过大，请核对参考规格是否录错。"
            ));
        }
    }
    Ok(())
}

/// 三项校验的入口：任一不过就拦下，全部通过才返回 Ok。
pub(crate) fn run_all(
    preview: &Value,
    basis_unit: &str,
    basis_quantity: f64,
    nrv: &Value,
    serving: Option<f64>,
) -> Result<(), String> {
    energy_ceiling_check(preview, basis_unit)?;
    atwater_check(preview)?;
    nrv_check(preview, nrv)?;
    serving_spec_check(basis_unit, basis_quantity, serving)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn metric(value: Option<f64>) -> Value {
        match value {
            Some(n) => json!({"state": if n == 0.0 { "zero" } else { "known" }, "value": n}),
            None => json!({"state": "unknown"}),
        }
    }

    /// 一键构造预览结果：按每 100 克口径给值。
    fn preview_g(carb: f64, protein: f64, fat: f64, kcal: f64) -> Value {
        json!({"nutrition":{
            "carbohydrates": metric(Some(carb)),"protein": metric(Some(protein)),
            "fat": metric(Some(fat)),"calories": metric(Some(kcal)),
            "fiber": metric(None),"sodium": metric(None),"sugar": metric(None)},
          "per100g":{
            "carbohydrates": metric(Some(carb)),"protein": metric(Some(protein)),
            "fat": metric(Some(fat)),"calories": metric(Some(kcal)),
            "fiber": metric(None),"sodium": metric(None),"sugar": metric(None)}})
    }

    #[test]
    fn atwater_passes_on_a_consistent_label() {
        // 碳水 73.1 + 蛋白 11.8 + 脂肪 6.5 → 约 400 kcal，与燕麦标签一致。
        assert!(atwater_check(&preview_g(73.1, 11.8, 6.5, 400.0)).is_ok());
    }

    #[test]
    fn atwater_catches_kj_transcribed_as_kcal() {
        // 同一份燕麦把 1674 kJ 直接当 kcal 录进来：折算值只有标注的 1/4。
        let err = atwater_check(&preview_g(73.1, 11.8, 6.5, 1674.0)).unwrap_err();
        assert!(err.contains("相差"), "{err}");
        assert!(err.contains("千焦"), "{err}");
    }

    #[test]
    fn atwater_is_skipped_when_a_macro_is_unknown() {
        let mut preview = preview_g(73.1, 11.8, 6.5, 1674.0);
        preview["per100g"]["fat"] = metric(None);
        // 脂肪未知就没有可比基准，宁可放过也不误报。
        assert!(atwater_check(&preview).is_ok());
    }

    #[test]
    fn atwater_is_skipped_without_a_mass_reference() {
        let preview = json!({"nutrition":{
            "carbohydrates": metric(Some(10.0)),"protein": metric(Some(1.0)),
            "fat": metric(Some(30.0)),"calories": metric(Some(120.0))}});
        // 没有每 100 克/毫升参考时不做判断，不猜密度也不猜重量。
        assert!(atwater_check(&preview).is_ok());
    }

    #[test]
    fn energy_ceiling_catches_an_impossible_label() {
        let err = energy_ceiling_check(&preview_g(10.0, 10.0, 10.0, 1200.0), "g").unwrap_err();
        assert!(err.contains("可信上限"), "{err}");
        // 纯油脂 900 kcal/100g 属于正常范围，不该被拦。
        assert!(energy_ceiling_check(&preview_g(0.0, 0.0, 100.0, 900.0), "g").is_ok());
    }

    #[test]
    fn nrv_check_reverses_the_percentage_into_a_quantity() {
        let preview = json!({"nutrition":{
            "protein": metric(Some(6.0)),"sodium": metric(Some(400.0)),
            "calories": metric(Some(300.0))}});
        // 蛋白 6g / NRV 60g = 10%；钠 400mg / 2000mg = 20%。
        assert!(nrv_check(&preview, &json!({"protein":10,"sodium":20})).is_ok());
        let err = nrv_check(&preview, &json!({"protein":30})).unwrap_err();
        assert!(err.contains("NRV"), "{err}");
        assert!(err.contains("protein"), "{err}");
    }

    #[test]
    fn nrv_check_skips_absent_states_instead_of_treating_them_as_zero() {
        let preview = json!({"nutrition":{"protein": metric(None)}});
        // 未知项不参与反推，否则会被当成 0 而误报。
        assert!(nrv_check(&preview, &json!({"protein":25})).is_ok());
        // 完全没给 NRV% 时整体跳过。
        assert!(nrv_check(&preview, &json!({})).is_ok());
        assert!(nrv_check(&preview, &Value::Null).is_ok());
    }

    #[test]
    fn serving_spec_rejects_an_implausible_package() {
        assert!(serving_spec_check("g", 100.0, Some(30.0)).is_ok());
        // 整箱净含量当成一份。
        let err = serving_spec_check("g", 100.0, Some(8000.0)).unwrap_err();
        assert!(err.contains("整箱"), "{err}");
        // 参考数量本身录错：把 100 克写成 12000。
        assert!(serving_spec_check("g", 12000.0, None).is_err());
        // 一份几乎为零，说明把「每 100 克」错当「每 1 克」的量级。
        assert!(serving_spec_check("g", 100.0, Some(0.5)).is_err());
    }

    #[test]
    fn serving_spec_accepts_missing_serving_and_non_mass_basis() {
        assert!(serving_spec_check("g", 100.0, None).is_ok());
        // 按「份」「片」「包」计量时没有可比的质量基准，不做量级判断。
        assert!(serving_spec_check("serving", 1.0, Some(400.0)).is_ok());
        assert!(serving_spec_check("piece", 1.0, None).is_ok());
        // 每份大小非正数一律拒绝。
        assert!(serving_spec_check("g", 100.0, Some(0.0)).is_err());
    }

    #[test]
    fn run_all_reports_the_first_failing_check() {
        let good = preview_g(73.1, 11.8, 6.5, 400.0);
        assert!(run_all(&good, "g", 100.0, &json!({}), Some(50.0)).is_ok());
        let bad = preview_g(73.1, 11.8, 6.5, 1674.0);
        let err = run_all(&bad, "g", 100.0, &json!({}), Some(50.0)).unwrap_err();
        assert!(err.contains("千焦"), "{err}");
    }

    #[test]
    fn kj_conversion_matches_the_food_library_constant() {
        // 与 food_library.rs 的 ÷4.184 保持同一口径，避免两处实现悄悄分叉。
        assert!((energy_to_kcal(1674.0, "kJ") - 400.1).abs() < 0.2);
        assert_eq!(energy_to_kcal(400.0, "kcal"), 400.0);
    }
}
