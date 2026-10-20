mod upload;

use tauri_plugin_sql::{Migration, MigrationKind};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let migrations = vec![Migration {
        version: 1,
        description: "initial_fitwise_schema",
        sql: include_str!("../migrations/0001_schema.sql"),
        kind: MigrationKind::Up,
    }];

    tauri::Builder::default()
        .manage(upload::UploadServerControl::default())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:fitwise.db", migrations)
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            upload::start_mobile_upload,
            upload::stop_mobile_upload
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Fitwise");
}
