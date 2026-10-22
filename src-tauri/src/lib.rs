mod body_commands;
mod data_diagnostics;
mod domain_commands;
mod domain_queries;
mod domain_store;
mod domain_upgrade;
mod food_library;
mod meal_corrections;
mod recipes;
mod record_commands;
mod workout_commands;

#[cfg(test)]
mod migration_scenario_tests;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            data_diagnostics::get_runtime_diagnostics,
            data_diagnostics::write_json_export,
            domain_store::domain_storage_get,
            domain_store::domain_storage_remove,
            domain_store::domain_storage_set,
            domain_store::get_domain_storage_status,
            domain_commands::execute_domain_command,
            domain_queries::query_period_summary,
            domain_queries::export_domain_json,
            domain_queries::get_domain_upgrade_report,
            food_library::search_food_library,
            food_library::preview_food_portion
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Fitwise");
}
