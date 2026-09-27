//! Categories only own membership. Deleting one never deletes a document or
//! its PDF, conversations, analysis cache, reading progress or favorite flag.
use crate::db::{now, AppState};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use tauri::State;

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Category {
    pub id: String,
    pub name: String,
    pub created_at: i64,
}

fn error(code: &str) -> String {
    format!(
        "cachalot-message:{}",
        serde_json::json!({"code": code, "values": {}})
    )
}

pub fn migrate(db: &Connection) -> Result<(), String> {
    db.execute_batch(
        "CREATE TABLE IF NOT EXISTS categories (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, name_key TEXT NOT NULL UNIQUE,
        created_at INTEGER NOT NULL
    );",
    )
    .map_err(|e| e.to_string())?;
    let exists = {
        let mut stmt = db
            .prepare("PRAGMA table_info(documents)")
            .map_err(|e| e.to_string())?;
        let columns = stmt
            .query_map([], |r| r.get::<_, String>(1))
            .map_err(|e| e.to_string())?;
        columns
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(|e| e.to_string())?
            .iter()
            .any(|name| name == "category_id")
    };
    if !exists {
        db.execute("ALTER TABLE documents ADD COLUMN category_id TEXT REFERENCES categories(id) ON DELETE SET NULL", [])
            .map_err(|e| e.to_string())?;
    }
    db.execute(
        "CREATE INDEX IF NOT EXISTS documents_category ON documents(category_id)",
        [],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

fn create_record(db: &Connection, value: &str) -> Result<Category, String> {
    let name = value.trim();
    if name.is_empty() {
        return Err(error("categoryNameRequired"));
    }
    if name.chars().count() > 80 {
        return Err(format!(
            "cachalot-message:{}",
            serde_json::json!({"code": "categoryNameTooLong", "values": {"limit": 80}})
        ));
    }
    let key = name.to_lowercase();
    if [
        "未分类论文",
        "uncategorized papers",
        "收藏",
        "我的收藏",
        "favorites",
    ]
    .contains(&key.as_str())
    {
        return Err(error("categoryNameReserved"));
    }
    let exists: bool = db
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM categories WHERE name_key=?1)",
            [&key],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    if exists {
        return Err(error("categoryNameDuplicate"));
    }
    let category = Category {
        id: uuid::Uuid::new_v4().to_string(),
        name: name.into(),
        created_at: now(),
    };
    db.execute(
        "INSERT INTO categories(id,name,name_key,created_at) VALUES(?1,?2,?3,?4)",
        params![category.id, category.name, key, category.created_at],
    )
    .map_err(|e| e.to_string())?;
    Ok(category)
}

fn move_record(db: &Connection, id: &str, category_id: Option<&str>) -> Result<(), String> {
    if let Some(target) = category_id {
        let exists: bool = db
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM categories WHERE id=?1)",
                [target],
                |r| r.get(0),
            )
            .map_err(|e| e.to_string())?;
        if !exists {
            return Err(error("categoryNotFound"));
        }
    }
    let changed = db
        .execute(
            "UPDATE documents SET category_id=?2 WHERE id=?1",
            params![id, category_id],
        )
        .map_err(|e| e.to_string())?;
    if changed == 0 {
        return Err(error("pdfNotFound"));
    }
    Ok(())
}

fn remove_record(db: &Connection, id: &str) -> Result<(), String> {
    // SQLite clears all member category_id values in the same transaction.
    let changed = db
        .execute("DELETE FROM categories WHERE id=?1", [id])
        .map_err(|e| e.to_string())?;
    if changed == 0 {
        return Err(error("categoryNotFound"));
    }
    Ok(())
}

#[tauri::command]
pub fn list_categories(state: State<'_, AppState>) -> Result<Vec<Category>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let mut stmt = db
        .prepare("SELECT id,name,created_at FROM categories ORDER BY rowid")
        .map_err(|e| e.to_string())?;
    let result = stmt
        .query_map([], |r| {
            Ok(Category {
                id: r.get(0)?,
                name: r.get(1)?,
                created_at: r.get(2)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|e| e.to_string());
    result
}

#[tauri::command]
pub fn create_category(state: State<'_, AppState>, name: String) -> Result<Category, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    create_record(&db, &name)
}

#[tauri::command]
pub fn move_document(
    state: State<'_, AppState>,
    id: String,
    category_id: Option<String>,
) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    move_record(&db, &id, category_id.as_deref())
}

#[tauri::command]
pub fn delete_category(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    remove_record(&db, &id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::OptionalExtension;

    fn old_library() -> Connection {
        let db = Connection::open_in_memory().unwrap();
        db.execute_batch("PRAGMA foreign_keys=ON;
            CREATE TABLE documents(id TEXT PRIMARY KEY, starred INTEGER, current_page INTEGER, updated_at INTEGER);
            INSERT INTO documents VALUES('old',1,3,123);
            CREATE TABLE chat_threads(id TEXT, document_id TEXT REFERENCES documents(id) ON DELETE CASCADE);
            INSERT INTO chat_threads VALUES('chat','old');
            CREATE TABLE page_analysis(document_id TEXT REFERENCES documents(id) ON DELETE CASCADE, content TEXT);
            INSERT INTO page_analysis VALUES('old','cached');").unwrap();
        db
    }

    #[test]
    fn migration_and_category_deletion_preserve_papers() {
        let db = old_library();
        migrate(&db).unwrap();
        migrate(&db).unwrap();
        let original: Option<String> = db
            .query_row(
                "SELECT category_id FROM documents WHERE id='old'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert!(original.is_none());
        let category = create_record(&db, "  Power electronics  ").unwrap();
        assert_eq!(category.name, "Power electronics");
        move_record(&db, "old", Some(&category.id)).unwrap();
        let assigned: String = db
            .query_row(
                "SELECT category_id FROM documents WHERE id='old'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(assigned, category.id);
        remove_record(&db, &category.id).unwrap();
        let paper: (Option<String>, i64, i64, i64) = db
            .query_row(
                "SELECT category_id,starred,current_page,updated_at FROM documents WHERE id='old'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
            )
            .unwrap();
        assert_eq!(paper, (None, 1, 3, 123));
        assert_eq!(
            db.query_row("SELECT COUNT(*) FROM chat_threads", [], |r| r
                .get::<_, i64>(0))
                .unwrap(),
            1
        );
        assert_eq!(
            db.query_row("SELECT content FROM page_analysis", [], |r| r
                .get::<_, String>(0))
                .unwrap(),
            "cached"
        );
    }

    #[test]
    fn invalid_targets_and_duplicate_names_cannot_change_membership() {
        let db = old_library();
        migrate(&db).unwrap();
        let category = create_record(&db, "Circuits").unwrap();
        assert!(create_record(&db, " circuits ")
            .unwrap_err()
            .contains("categoryNameDuplicate"));
        for name in ["", "未分类论文", "Favorites"] {
            assert!(create_record(&db, name).is_err());
        }
        assert!(create_record(&db, &"x".repeat(81)).is_err());
        move_record(&db, "old", Some(&category.id)).unwrap();
        assert!(move_record(&db, "old", Some("missing")).is_err());
        assert!(move_record(&db, "missing-paper", None).is_err());
        assert!(remove_record(&db, "starred").is_err());
        move_record(&db, "old", None).unwrap();
        let cleared = db
            .query_row(
                "SELECT category_id FROM documents WHERE id='old'",
                [],
                |r| r.get::<_, Option<String>>(0),
            )
            .optional()
            .unwrap();
        assert_eq!(cleared, Some(None));
    }
}
