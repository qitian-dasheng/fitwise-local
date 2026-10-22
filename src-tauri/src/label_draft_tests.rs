fn label_form() -> Value {
    json!({"name":"离线酸奶","brand":"测试品牌","measurementBasis":"packaged","basisQuantity":"100","basisUnit":"g","energyUnit":"kJ","sodiumUnit":"g","nutrients":{"calories":"418.4","protein":"0","sodium":"0.12","fat":"","carbohydrates":"","fiber":"","sugar":""},"nrv":{},"conversions":[],"netQuantity":"1","netUnit":"kg","drainedQuantity":"800","drainedUnit":"g","sourceNote":"人工核对包装标签"})
}

#[test]
fn label_source_is_immutable_and_retained_after_confirmation() {
    let mut c = connection();
    crate::artifacts::receive(
        &mut c,
        "label-source-0001",
        "包装标签人工抄录",
        vec![],
        "desktop",
    )
    .unwrap();
    crate::artifacts::receive(&mut c, "label-source-0002", "另一个来源", vec![], "desktop")
        .unwrap();
    let saved = execute_with_connection(
        &mut c,
        request(
            "label-source-save",
            "save_label_draft",
            json!({"form":label_form(),"sourceReceiptId":"label-source-0001"}),
            Some(bootstrap()),
        ),
    )
    .unwrap();
    assert_eq!(
        c.query_row(
            "SELECT status FROM input_receipts WHERE id='label-source-0001'",
            [],
            |r| r.get::<_, String>(0)
        )
        .unwrap(),
        "drafted"
    );
    let changed = json!({"form":label_form(),"draftId":saved.result["draftId"],"expectedRevision":1,"sourceReceiptId":"label-source-0002"});
    assert!(execute_with_connection(
        &mut c,
        request("label-source-reassign", "save_label_draft", changed, None)
    )
    .is_err());
    let confirmed = execute_with_connection(
        &mut c,
        request(
            "label-source-confirm",
            "confirm_label_draft",
            label_confirm_payload(&saved),
            None,
        ),
    )
    .unwrap();
    assert_eq!(
        confirmed.state["foodDefinitionVersions"][0]["origin"]["sourceReceiptId"],
        "label-source-0001"
    );
    assert_eq!(
        crate::label_drafts::manifest(&c).unwrap()[0]["sourceReceiptId"],
        "label-source-0001"
    );
}

#[test]
fn label_list_is_bounded_and_corrupt_form_is_not_silently_lost() {
    let c = connection();
    for n in 0..52 {
        c.execute("INSERT INTO nutrition_label_drafts(id,revision,status,form_json,created_at,updated_at) VALUES(?1,1,'draft',?2,'now','now')",rusqlite::params![format!("draft-{n:03}"),label_form().to_string()]).unwrap();
    }
    let page = crate::label_drafts::list(&c, "draft", 0).unwrap();
    assert_eq!(page["items"].as_array().unwrap().len(), 50);
    assert_eq!(page["hasMore"], true);
    assert!(page["items"][0].get("form").is_none());
    assert_eq!(
        crate::label_drafts::list(&c, "draft", 50).unwrap()["items"]
            .as_array()
            .unwrap()
            .len(),
        2
    );
    c.execute(
        "UPDATE nutrition_label_drafts SET form_json='not json' WHERE id='draft-000'",
        [],
    )
    .unwrap();
    assert!(crate::label_drafts::manifest(&c)
        .unwrap_err()
        .contains("损坏"));
}
fn label_save(c: &mut Connection, command: &str, form: Value) -> DomainCommandResponse {
    execute_with_connection(
        c,
        request(
            command,
            "save_label_draft",
            json!({"form":form}),
            Some(bootstrap()),
        ),
    )
    .unwrap()
}
fn label_confirm_payload(saved: &DomainCommandResponse) -> Value {
    json!({"draftId":saved.result["draftId"],"expectedRevision":saved.result["draftRevision"],"review":{"energy":true,"basis":true,"packaging":true,"unknowns":true}})
}

#[test]
fn label_normalization_keeps_unknown_zero_and_rejects_unit_errors() {
    let mut f = label_form();
    let p = crate::label_drafts::preview_form(&f).unwrap();
    assert!(
        (p["preview"]["nutrition"]["calories"]["value"]
            .as_f64()
            .unwrap()
            - 100.0)
            .abs()
            < 0.00001
    );
    assert_eq!(p["input"]["nutrients"]["calories"], 418.4);
    assert_eq!(p["preview"]["nutrition"]["sodium"]["value"], 120.0);
    assert_eq!(p["preview"]["nutrition"]["protein"]["state"], "zero");
    assert_eq!(p["preview"]["nutrition"]["fiber"]["state"], "unknown");
    f["energyUnit"] = json!("kcal");
    f["nutrients"]["calories"] = json!("1600");
    assert!(crate::label_drafts::preview_form(&f)
        .unwrap_err()
        .contains("千焦"));
    f = label_form();
    f["netUnit"] = json!("ml");
    assert!(crate::label_drafts::preview_form(&f)
        .unwrap_err()
        .contains("密度"));
    f = label_form();
    f["drainedQuantity"] = json!("1001");
    assert!(crate::label_drafts::preview_form(&f).is_err());
    for bad in ["1,000", "1e2", "NaN", "10-20", "-1"] {
        f = label_form();
        f["nutrients"]["calories"] = json!(bad);
        assert!(crate::label_drafts::preview_form(&f).is_err());
    }
}

#[test]
fn label_package_net_quantity_never_invents_mass_conversion() {
    let mut f = label_form();
    f["basisQuantity"] = json!("1");
    f["basisUnit"] = json!("package");
    let p = crate::label_drafts::preview_form(&f).unwrap();
    assert!(p["preview"].get("per100g").is_none());
    f["conversions"] = json!([{"unit":"g","quantity":"200","basisQuantity":"1"}]);
    assert!(
        (crate::label_drafts::preview_form(&f).unwrap()["preview"]["per100g"]["calories"]["value"]
            .as_f64()
            .unwrap()
            - 50.0)
            .abs()
            < 0.00001
    );
}

#[test]
fn label_incomplete_save_and_revision_conflict_do_not_touch_meals_or_inventory() {
    let mut c = connection();
    let mut f = label_form();
    f["name"] = json!("");
    f["basisQuantity"] = json!("");
    f["nutrients"] = json!({});
    let saved = label_save(&mut c, "label-incomplete-1", f.clone());
    assert_eq!(
        crate::label_drafts::manifest(&c).unwrap()[0]["form"]["nutrients"]
            .as_object()
            .unwrap()
            .len(),
        7
    );
    assert!(saved.state["foodDefinitions"]
        .as_array()
        .unwrap()
        .is_empty());
    let before = saved.state.clone();
    assert!(execute_with_connection(
        &mut c,
        request(
            "label-confirm-empty",
            "confirm_label_draft",
            label_confirm_payload(&saved),
            None
        )
    )
    .is_err());
    f["name"] = json!("待补完");
    let payload = json!({"draftId":saved.result["draftId"],"expectedRevision":1,"form":f});
    let edited = execute_with_connection(
        &mut c,
        request("label-edit-1", "save_label_draft", payload.clone(), None),
    )
    .unwrap();
    assert_eq!(edited.result["draftRevision"], 2);
    assert!(execute_with_connection(
        &mut c,
        request("label-stale-edit", "save_label_draft", payload, None)
    )
    .unwrap_err()
    .contains("已变更"));
    for key in ["meals", "inventory", "inventoryMovements", "recipes"] {
        assert_eq!(edited.state[key], before[key]);
    }
    assert_eq!(
        crate::label_drafts::manifest(&c).unwrap()[0]["form"]["name"],
        "待补完"
    );
}

#[test]
fn label_confirmation_is_atomic_idempotent_and_keeps_food_origin_in_meal_snapshot() {
    let mut c = connection();
    let saved = label_save(&mut c, "label-ready-1", label_form());
    let payload = label_confirm_payload(&saved);
    let mut unchecked = payload.clone();
    unchecked["review"]["basis"] = json!(false);
    assert!(execute_with_connection(
        &mut c,
        request("label-unchecked", "confirm_label_draft", unchecked, None)
    )
    .is_err());
    c.execute_batch("CREATE TRIGGER label_fail BEFORE INSERT ON domain_command_receipts BEGIN SELECT RAISE(FAIL,'simulated disk failure'); END;").unwrap();
    assert!(execute_with_connection(
        &mut c,
        request(
            "label-confirm-1",
            "confirm_label_draft",
            payload.clone(),
            None
        )
    )
    .is_err());
    assert_eq!(
        crate::label_drafts::manifest(&c).unwrap()[0]["status"],
        "draft"
    );
    assert_eq!(
        c.query_row(
            "SELECT COUNT(*) FROM domain_entities WHERE collection='foodDefinitions'",
            [],
            |r| r.get::<_, i64>(0)
        )
        .unwrap(),
        0
    );
    c.execute_batch("DROP TRIGGER label_fail;").unwrap();
    let confirmed = execute_with_connection(
        &mut c,
        request(
            "label-confirm-1",
            "confirm_label_draft",
            payload.clone(),
            None,
        ),
    )
    .unwrap();
    let replay = execute_with_connection(
        &mut c,
        request(
            "label-confirm-1",
            "confirm_label_draft",
            payload.clone(),
            None,
        ),
    )
    .unwrap();
    assert!(replay.replayed);
    assert_eq!(confirmed.revision, replay.revision);
    assert!(execute_with_connection(
        &mut c,
        request("label-confirm-twice", "confirm_label_draft", payload, None)
    )
    .is_err());
    assert_eq!(
        confirmed.state["foodDefinitions"].as_array().unwrap().len(),
        1
    );
    assert_eq!(confirmed.state["meals"], saved.state["meals"]);
    assert_eq!(confirmed.state["inventory"], saved.state["inventory"]);
    let v = &confirmed.state["foodDefinitionVersions"][0];
    assert_eq!(v["origin"]["labelDraftId"], saved.result["draftId"]);
    let meal=execute_with_connection(&mut c,request("label-eat-1","record_food_meal",json!({"date":"2026-10-21","type":"breakfast","entries":[{"foodVersionId":confirmed.result["foodVersionId"],"quantity":50,"unit":"g"}]}),None)).unwrap();
    assert_eq!(
        meal.state["meals"][0]["foodSnapshot"]["version"]["origin"],
        v["origin"]
    );
    assert_eq!(
        meal.state["meals"][0]["nutrition"]["calories"]["value"],
        50.0
    );
}

#[test]
fn label_duplicate_requires_explicit_choice_and_discard_keeps_evidence() {
    let mut c = connection();
    let first = label_save(&mut c, "label-first", label_form());
    execute_with_connection(
        &mut c,
        request(
            "label-first-confirm",
            "confirm_label_draft",
            label_confirm_payload(&first),
            None,
        ),
    )
    .unwrap();
    let second = label_save(&mut c, "label-second", label_form());
    let mut p = label_confirm_payload(&second);
    assert!(execute_with_connection(
        &mut c,
        request("label-duplicate", "confirm_label_draft", p.clone(), None)
    )
    .unwrap_err()
    .contains("同名"));
    p["allowDuplicate"] = json!(true);
    let r = execute_with_connection(
        &mut c,
        request("label-explicit-duplicate", "confirm_label_draft", p, None),
    )
    .unwrap();
    assert_eq!(r.state["foodDefinitions"].as_array().unwrap().len(), 2);
    let third = label_save(&mut c, "label-third", label_form());
    assert!(execute_with_connection(
        &mut c,
        request(
            "label-no-reason",
            "discard_label_draft",
            json!({"draftId":third.result["draftId"],"expectedRevision":1,"reason":" "}),
            None
        )
    )
    .is_err());
    execute_with_connection(
        &mut c,
        request(
            "label-ignore",
            "discard_label_draft",
            json!({"draftId":third.result["draftId"],"expectedRevision":1,"reason":"重复素材"}),
            None,
        ),
    )
    .unwrap();
    let all = crate::label_drafts::manifest(&c).unwrap();
    assert_eq!(all.as_array().unwrap().len(), 3);
    assert_eq!(
        crate::label_drafts::list(&c, "discarded", 0).unwrap()["items"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
}

#[test]
fn label_draft_file_restart_and_old_schema_upgrade_preserve_data() {
    let directory = std::env::temp_dir().join(format!("fitwise-label-{}", rand::random::<u64>()));
    std::fs::create_dir(&directory).unwrap();
    let path = directory.join("test.db");
    let old_state;
    {
        let mut c = Connection::open(&path).unwrap();
        c.execute_batch("CREATE TABLE app_kv(key TEXT PRIMARY KEY,value TEXT NOT NULL,updated_at TEXT NOT NULL);").unwrap();
        ensure_repository_schema(&c).unwrap();
        let saved = label_save(&mut c, "label-restart", label_form());
        old_state = saved.state.clone();
        c.execute_batch("DROP TABLE nutrition_label_drafts;DELETE FROM domain_upgrade_reports WHERE version=12;").unwrap();
        crate::domain_upgrade::upgrade(&mut c, &path).unwrap();
        assert_eq!(
            serde_json::from_str::<Value>(
                &crate::domain_store::load_envelope(&c).unwrap().unwrap()
            )
            .unwrap()["state"],
            old_state
        );
        label_save(&mut c, "label-restart-after", label_form());
    }
    {
        let c = Connection::open(&path).unwrap();
        let all = crate::label_drafts::manifest(&c).unwrap();
        assert_eq!(all.as_array().unwrap().len(), 1);
        assert_eq!(all[0]["form"], label_form());
        assert_eq!(
            c.query_row("PRAGMA quick_check", [], |r| r.get::<_, String>(0))
                .unwrap(),
            "ok"
        );
    }
    std::fs::remove_dir_all(directory).unwrap();
}
