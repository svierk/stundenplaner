
mod db;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let migrations = db::get_migrations();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:stundenplaner.db", migrations)
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            db::export_database,
            db::import_database,
            db::save_file,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
