use std::fs;
use std::path::PathBuf;
use tauri::AppHandle;
use tauri::Manager;
use tauri_plugin_sql::{Migration, MigrationKind};

pub fn get_migrations() -> Vec<Migration> {
    vec![
        Migration {
            version: 1,
            description: "create_subjects_table",
            sql: "
                CREATE TABLE IF NOT EXISTS subjects (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT NOT NULL,
                    created_at TEXT NOT NULL DEFAULT (datetime('now'))
                );
                CREATE TABLE IF NOT EXISTS subject_grade_configs (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    subject_id INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
                    grade_level INTEGER NOT NULL,
                    min_hours_per_week INTEGER NOT NULL DEFAULT 0,
                    max_hours_per_week INTEGER NOT NULL DEFAULT 0,
                    UNIQUE(subject_id, grade_level)
                );
                CREATE TABLE IF NOT EXISTS subject_allowed_days (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    subject_id INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
                    day INTEGER NOT NULL CHECK(day BETWEEN 1 AND 5),
                    UNIQUE(subject_id, day)
                );
                CREATE TABLE IF NOT EXISTS subject_allowed_slots (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    subject_id INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
                    slot INTEGER NOT NULL CHECK(slot >= 1),
                    UNIQUE(subject_id, slot)
                );
            ",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "create_teachers_table",
            sql: "
                CREATE TABLE IF NOT EXISTS teachers (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    first_name TEXT NOT NULL,
                    last_name TEXT NOT NULL,
                    abbreviation TEXT NOT NULL UNIQUE,
                    hours_per_week INTEGER NOT NULL DEFAULT 28,
                    is_class_teacher INTEGER NOT NULL DEFAULT 0 CHECK(is_class_teacher IN (0,1)),
                    has_free_day INTEGER NOT NULL DEFAULT 0 CHECK(has_free_day IN (0,1)),
                    free_days TEXT NOT NULL DEFAULT '[]',
                    own_class_id INTEGER REFERENCES classes(id) ON DELETE SET NULL,
                    created_at TEXT NOT NULL DEFAULT (datetime('now'))
                );
                CREATE TABLE IF NOT EXISTS teacher_core_subjects (
                    teacher_id INTEGER NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
                    subject_id INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
                    PRIMARY KEY (teacher_id, subject_id)
                );
                CREATE TABLE IF NOT EXISTS teacher_allowed_subjects (
                    teacher_id INTEGER NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
                    subject_id INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
                    PRIMARY KEY (teacher_id, subject_id)
                );
                CREATE TABLE IF NOT EXISTS teacher_forbidden_subjects (
                    teacher_id INTEGER NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
                    subject_id INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
                    PRIMARY KEY (teacher_id, subject_id)
                );
            ",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 3,
            description: "create_classes_table",
            sql: "
                CREATE TABLE IF NOT EXISTS classes (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT NOT NULL UNIQUE,
                    grade_level INTEGER NOT NULL DEFAULT 1 CHECK(grade_level BETWEEN 1 AND 4),
                    hours_per_week INTEGER NOT NULL DEFAULT 25,
                    max_hours_per_day INTEGER NOT NULL DEFAULT 6,
                    allow_free_periods INTEGER NOT NULL DEFAULT 0 CHECK(allow_free_periods IN (0,1)),
                    created_at TEXT NOT NULL DEFAULT (datetime('now'))
                );
                CREATE TABLE IF NOT EXISTS class_subjects (
                    class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
                    subject_id INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
                    hours_per_week INTEGER NOT NULL DEFAULT 0,
                    PRIMARY KEY (class_id, subject_id)
                );
            ",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 4,
            description: "create_timetable_tables",
            sql: "
                CREATE TABLE IF NOT EXISTS timetables (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT NOT NULL,
                    generated_at TEXT NOT NULL DEFAULT (datetime('now')),
                    school_year TEXT NOT NULL DEFAULT ''
                );
                CREATE TABLE IF NOT EXISTS timetable_entries (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    timetable_id INTEGER NOT NULL REFERENCES timetables(id) ON DELETE CASCADE,
                    class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
                    subject_id INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
                    teacher_id INTEGER NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
                    day INTEGER NOT NULL CHECK(day BETWEEN 1 AND 5),
                    slot INTEGER NOT NULL CHECK(slot >= 1),
                    is_double_staffed INTEGER NOT NULL DEFAULT 0 CHECK(is_double_staffed IN (0,1))
                );
                CREATE TABLE IF NOT EXISTS timetable_double_staff (
                    entry_id INTEGER NOT NULL REFERENCES timetable_entries(id) ON DELETE CASCADE,
                    teacher_id INTEGER NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
                    PRIMARY KEY (entry_id, teacher_id)
                );
            ",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 5,
            description: "simplify_subject_grade_config",
            sql: "
                CREATE TABLE subject_grade_configs_new (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    subject_id INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
                    grade_level INTEGER NOT NULL,
                    hours_per_week INTEGER NOT NULL DEFAULT 0,
                    UNIQUE(subject_id, grade_level)
                );
                INSERT INTO subject_grade_configs_new (id, subject_id, grade_level, hours_per_week)
                    SELECT id, subject_id, grade_level, max_hours_per_week FROM subject_grade_configs;
                DROP TABLE subject_grade_configs;
                ALTER TABLE subject_grade_configs_new RENAME TO subject_grade_configs;
            ",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 6,
            description: "grade_level_configs_and_simplify_classes",
            sql: "
                CREATE TABLE IF NOT EXISTS grade_level_configs (
                    grade_level INTEGER PRIMARY KEY,
                    min_hours_per_day INTEGER NOT NULL DEFAULT 4,
                    max_hours_per_day INTEGER NOT NULL DEFAULT 6
                );
                INSERT OR IGNORE INTO grade_level_configs (grade_level, min_hours_per_day, max_hours_per_day) VALUES (1, 4, 5);
                INSERT OR IGNORE INTO grade_level_configs (grade_level, min_hours_per_day, max_hours_per_day) VALUES (2, 4, 5);
                INSERT OR IGNORE INTO grade_level_configs (grade_level, min_hours_per_day, max_hours_per_day) VALUES (3, 5, 6);
                INSERT OR IGNORE INTO grade_level_configs (grade_level, min_hours_per_day, max_hours_per_day) VALUES (4, 5, 6);

                PRAGMA foreign_keys = OFF;
                CREATE TABLE classes_new (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT NOT NULL UNIQUE,
                    grade_level INTEGER NOT NULL DEFAULT 1 CHECK(grade_level BETWEEN 1 AND 4),
                    allow_free_periods INTEGER NOT NULL DEFAULT 0 CHECK(allow_free_periods IN (0,1)),
                    created_at TEXT NOT NULL DEFAULT (datetime('now'))
                );
                INSERT INTO classes_new (id, name, grade_level, allow_free_periods, created_at)
                    SELECT id, name, grade_level, allow_free_periods, created_at FROM classes;
                DROP TABLE classes;
                ALTER TABLE classes_new RENAME TO classes;
                PRAGMA foreign_keys = ON;
            ",
            kind: MigrationKind::Up,
        },
    ]
}

fn get_db_path(app: &AppHandle) -> Result<PathBuf, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?;
    Ok(data_dir.join("stundenplaner.db"))
}

#[tauri::command]
pub async fn export_database(app: AppHandle, dest_path: String) -> Result<(), String> {
    let db_path = get_db_path(&app)?;
    fs::copy(&db_path, &dest_path).map_err(|e| format!("Export failed: {e}"))?;
    Ok(())
}

#[tauri::command]
pub async fn import_database(app: AppHandle, src_path: String) -> Result<(), String> {
    let db_path = get_db_path(&app)?;
    fs::copy(&src_path, &db_path).map_err(|e| format!("Import failed: {e}"))?;
    Ok(())
}

#[tauri::command]
pub async fn save_file(path: String, data: Vec<u8>) -> Result<(), String> {
    fs::write(&path, &data).map_err(|e| format!("Fehler beim Speichern: {e}"))?;
    Ok(())
}
