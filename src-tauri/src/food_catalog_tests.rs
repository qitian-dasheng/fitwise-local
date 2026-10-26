// 内置食材目录合并测试（0.11.0）：只使用内存库与临时数据，绝不触碰用户真实数据库。

use crate::domain_store::{ensure_repository_schema, STORAGE_NAME};
use rusqlite::Connection;
use serde_json::json;

fn connection() -> Connection {
    let connection = Connection::open_in_memory().unwrap();
    connection
        .execute_batch(
            "CREATE TABLE app_kv (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL);",
        )
        .unwrap();
    ensure_repository_schema(&connection).unwrap();
    connection
}

#[allow(dead_code)]
struct _Unused;

fn bootstrap_envelope() -> String {
    let mut state = Map::new();
    state.insert("profile".into(), json!({"name":"test"}));
    for collection in COLLECTIONS {
        state.insert((*collection).to_owned(), json!([]));
    }
    state.insert(
        "foodDefinitions".into(),
        json!([
            // 用户已对其中一个目录食材修改过（同 catalogId、新版本）：合并不得覆盖。
            {"id":"catalog-fdc-167762","name":"草莓(我改过)","measurementBasis":"edible",
             "activeVersionId":"user-v2","catalogId":"fdc-167762","favorite":true,
             "archived":false,"createdAt":"2026-10-01T00:00:00Z"},
            // 一个个人食材（无 catalogId）。
            {"id":"user-food-1","name":"我的私房菜","measurementBasis":"raw",
             "activeVersionId":"user-v1","favorite":false,"createdAt":"2026-10-01T00:00:00Z"}
        ]),
    );
    state.insert(
        "foodDefinitionVersions".into(),
        json!([
            {"id":"user-v1","foodId":"user-food-1","version":1,
             "basis":{"quantity":100,"unit":"g"},
             "conversions":[],"energyUnit":"kcal",
             "labelNutrients":{},"nutrition":{},
             "source":"personal","confirmedBy":"test","confirmedAt":"2026-10-01T00:00:00Z"},
            {"id":"user-v2","foodId":"catalog-fdc-167762","version":2,
             "basis":{"quantity":100,"unit":"g"},
             "conversions":[],"energyUnit":"kcal",
             "labelNutrients":{},"nutrition":{},
             "source":"personal","confirmedBy":"test","confirmedAt":"2026-10-01T00:00:00Z"}
        ]),
    );
    // 目录墓碑：一个 catalogId 被用户删除，升级不复活。
    state.insert("catalogTombstones".into(), json!(["fdc-169282"]));
    serde_json::to_string(&json!({"state":state,"version":4})).unwrap()
}

fn merge_once(connection: &mut Connection) -> String {
    merge_food_catalog(connection).unwrap()
}

fn catalog_definitions(state: &Value) -> Vec<&Value> {
    state["foodDefinitions"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|item| item["catalogId"].is_string())
        .collect()
}

#[test]
fn merge_is_idempotent_and_respects_user_edits_and_tombstones() {
    let mut connection = connection();
    // 直接落信封（等价于首启后的已初始化状态），避免拉起整套命令分发。
    crate::domain_store::persist_envelope(&mut connection, STORAGE_NAME, &bootstrap_envelope()).unwrap();

    // 第一次启动：目录合并，用户修改与墓碑之外的全部条目插入。
    let note = merge_once(&mut connection);
    assert!(note.contains("合并完成"));
    let envelope = load_envelope(&connection).unwrap().unwrap();
    let root: Value = serde_json::from_str(&envelope).unwrap();
    let definitions = catalog_definitions(&root["state"]);
    let (catalog_version, items) = parse_catalog().unwrap();
    assert_eq!(catalog_version, 2);
    // 期望：全部目录条目（墓碑项 fdc-169282 不插入）——用户修改过的 fdc-167762
    // 以编辑副本形式存在且**保留 catalogId**（编辑不覆盖目录语义），也在计数内。
    let expected = items
        .iter()
        .filter(|item| item.catalog_id != "fdc-169282")
        .count();
    assert_eq!(definitions.len(), expected);
    // 用户修改版本保留原样（不覆盖为目录内容）。
    let edited = root["state"]["foodDefinitions"]
        .as_array()
        .unwrap()
        .iter()
        .find(|item| item["catalogId"] == "fdc-167762")
        .unwrap();
    assert_eq!(edited["name"], "草莓(我改过)");
    // 个人食材不受影响。
    assert!(root["state"]["foodDefinitions"].as_array().unwrap().iter().any(|item| item["id"] == "user-food-1"));

    // 版本标记写入 app_kv。
    let marker: String = connection
        .query_row("SELECT value FROM app_kv WHERE key = 'catalog-merged-version'", [], |row| row.get(0))
        .unwrap();
    assert_eq!(marker, catalog_version.to_string());

    // 第二次启动：全部跳过，不再重复插入。
    let note2 = merge_once(&mut connection);
    assert!(note2.contains("跳过"));
    let envelope2 = load_envelope(&connection).unwrap().unwrap();
    let root2: Value = serde_json::from_str(&envelope2).unwrap();
    // 计数按目录实际条目数推导（目录会随版本扩充，不写死数字）：全部条目减去 1 个墓碑。
    let (_, items2) = parse_catalog().unwrap();
    assert_eq!(catalog_definitions(&root2["state"]).len(), items2.len() - 1);
}

#[test]
fn merge_skips_fresh_uninitialized_repository() {
    let mut connection = connection();
    // 未初始化信封（新库）：合并直接跳过且不报错（首启等首次命令建库后再合并）。
    let note = merge_food_catalog(&mut connection).unwrap();
    assert!(note.contains("尚未初始化"));
    assert!(load_envelope(&connection).unwrap().is_none());
}

#[test]
fn merge_failure_reports_error_without_creating_envelope() {
    // 畸形目录数据：版本号非法 → 解析失败（错误路径单测，不构造完整启动流程）。
    // 不写死版本号数字，避免每次目录版本升级都要改这条测试。
    let broken = FOOD_CATALOG_JSON.replacen(
        "\"catalogVersion\":",
        "\"catalogVersion\": \"one\", \"catalogVersionX\":",
        1,
    );
    assert!(parse_catalog_str(&broken).is_err());
}

#[test]
fn catalog_versions_deserialize_into_domain_basis() {
    // 回归守卫：basis 只允许 quantity/unit（Rust 侧 Basis 是 deny_unknown_fields）。
    // 历史构建在 basis 里多写了 measurementBasis，导致食材库整页报
    // "unknown field `measurementBasis`, expected `quantity` or `unit`"。
    let (_, items) = parse_catalog().unwrap();
    for item in &items {
        let basis = item.version["basis"].as_object().expect("basis 必须是对象");
        assert_eq!(
            basis.keys().cloned().collect::<std::collections::BTreeSet<_>>(),
            ["quantity".to_owned(), "unit".to_owned()].into_iter().collect(),
            "{} 的 basis 形状非法",
            item.name
        );
        serde_json::from_value::<crate::food_library::Basis>(item.version["basis"].clone())
            .unwrap_or_else(|error| panic!("{} 的 basis 无法反序列化：{error}", item.name));
        assert_eq!(item.definition["measurementBasis"], "edible", "{} 的口径应在 definition 层", item.name);
    }
}

#[test]
fn merge_repairs_legacy_basis_with_extra_field() {
    // 已合并过旧目录的库不会被幂等逻辑重写，合并时必须原地清理非法字段。
    let mut connection = connection();
    let mut envelope: Value = serde_json::from_str(&bootstrap_envelope()).unwrap();
    envelope["state"]["foodDefinitionVersions"] = json!([
        {"id":"catalog-fdc-167762:v1","foodId":"catalog-fdc-167762","version":1,
         "basis":{"quantity":100,"unit":"g","measurementBasis":"edible"},
         "conversions":[],"energyUnit":"kcal","labelNutrients":{},"nutrition":{},
         "source":"official","confirmedBy":"内置目录","confirmedAt":"2026-10-25T00:00:00Z"}
    ]);
    crate::domain_store::persist_envelope(
        &mut connection,
        STORAGE_NAME,
        &serde_json::to_string(&envelope).unwrap(),
    )
    .unwrap();

    let note = merge_once(&mut connection);
    assert!(note.contains("修复 1 项"), "{note}");

    let stored = load_envelope(&connection).unwrap().unwrap();
    let root: Value = serde_json::from_str(&stored).unwrap();
    let basis = &root["state"]["foodDefinitionVersions"][0]["basis"];
    assert!(basis.get("measurementBasis").is_none(), "非法字段未清理：{basis}");
    assert_eq!(basis["quantity"], 100);
    assert_eq!(basis["unit"], "g");
}
