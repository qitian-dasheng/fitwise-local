mod artifacts;
mod backup;
mod batch_corrections;
mod body_commands;
mod credentials;
mod data_diagnostics;
mod domain_commands;
mod domain_queries;
mod domain_store;
mod domain_upgrade;
mod food_library;
mod inventory_ops;
mod label_checks;
mod label_drafts;
mod meal_corrections;
mod menu_drafts;
mod recipes;
mod record_commands;
mod upload;
mod workout_commands;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    backup::apply_pending_restore_before_start();
    tauri::Builder::default()
        .manage(upload::UploadServerControl::default())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            data_diagnostics::get_runtime_diagnostics,
            data_diagnostics::write_json_export,
            label_drafts::list_label_drafts,
            label_drafts::get_label_draft,
            menu_drafts::list_menu_drafts,
            menu_drafts::get_menu_draft,
            artifacts::import_local_input,
            artifacts::list_input_receipts,
            artifacts::read_artifact_preview,
            artifacts::export_artifact_original,
            artifacts::save_artifact_privacy,
            artifacts::set_input_status,
            artifacts::manage_artifact,
            artifacts::get_artifact_storage,
            artifacts::recover_legacy_inputs,
            backup::create_encrypted_backup,
            backup::discard_staged_restore,
            backup::get_restore_startup_report,
            backup::inspect_encrypted_backup,
            backup::schedule_staged_restore,
            credentials::save_ai_credential,
            credentials::delete_ai_credential,
            credentials::get_ai_credential_status,
            domain_store::domain_storage_get,
            domain_store::domain_storage_remove,
            domain_store::domain_storage_set,
            domain_store::get_domain_storage_status,
            domain_commands::execute_domain_command,
            domain_queries::query_period_summary,
            domain_queries::query_inventory_summary,
            domain_queries::export_domain_json,
            domain_queries::get_domain_upgrade_report,
            food_library::search_food_library,
            food_library::preview_food_portion,
            upload::start_mobile_upload,
            upload::stop_mobile_upload
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Fitwise");
}
