mod backup;
mod credentials;
mod upload;

use tauri_plugin_sql::{Migration, MigrationKind};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    backup::apply_pending_restore_before_start();
    let migrations = vec![Migration {
        version: 1,
        description: "initial_fitwise_schema",
        sql: include_str!("../migrations/0001_schema.sql"),
        kind: MigrationKind::Up,
    }];

    tauri::Builder::default()
        .manage(upload::UploadServerControl::default())
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:fitwise.db", migrations)
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            backup::create_encrypted_backup,
            backup::discard_staged_restore,
            backup::get_restore_startup_report,
            backup::inspect_encrypted_backup,
            backup::schedule_staged_restore,
            credentials::save_ai_credential,
            credentials::delete_ai_credential,
            credentials::get_ai_credential_status,
            upload::start_mobile_upload,
            upload::stop_mobile_upload
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Fitwise");
}
