//! Persistence endpoint for the UI-independent TypeScript analysis worker.
//! JSON stays versioned by its DTO schema and exact model/parser cache key.
use crate::db::AppState;
use rusqlite::{params, OptionalExtension};
use tauri::State;

#[tauri::command]
pub fn get_page_analysis(
    state: State<'_, AppState>, document_id: String, page: i64, cache_key: String,
) -> Result<Option<String>, String> {
    state.db.lock().map_err(|e| e.to_string())?
        .query_row("SELECT content FROM page_analysis WHERE document_id=?1 AND cache_key=?2 AND page=?3",
            params![document_id, cache_key, page], |row| row.get(0))
        .optional().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_page_analysis(
    state: State<'_, AppState>, document_id: String, page: i64, cache_key: String, content: String,
) -> Result<(), String> {
    validate_page_analysis(&document_id, page, &cache_key, &content)?;
    // One committed SQLite statement per page. Previously completed pages survive
    // interruption; foreign-key cascade removes caches when a paper is deleted.
    state.db.lock().map_err(|e| e.to_string())?.execute(
        "INSERT INTO page_analysis(document_id,cache_key,page,content) VALUES(?1,?2,?3,?4)
         ON CONFLICT(document_id,cache_key,page) DO UPDATE SET content=excluded.content",
        params![document_id, cache_key, page, content],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

fn validate_page_analysis(document_id: &str, page: i64, cache_key: &str, content: &str) -> Result<(), String> {
    if page < 1 || content.len() > 20 * 1024 * 1024 { return Err("页面分析数据超出范围。".into()); }
    let value: serde_json::Value = serde_json::from_str(&content).map_err(|e| e.to_string())?;
    let version = if value["kind"] == "page-facts" { 2 } else { 1 };
    if value["schemaVersion"] != version || value["documentId"] != document_id || value["page"] != page || value["cacheKey"] != cache_key {
        return Err("页面分析标识与缓存键不匹配。".into());
    }
    Ok(())
}

#[tauri::command]
pub fn get_document_semantics(
    state: State<'_, AppState>, document_id: String, cache_key: String,
) -> Result<Option<String>, String> {
    state.db.lock().map_err(|e| e.to_string())?
        .query_row("SELECT content FROM document_semantics WHERE document_id=?1 AND cache_key=?2",
            params![document_id, cache_key], |row| row.get(0))
        .optional().map_err(|e| e.to_string())
}

fn save_semantics(db: &rusqlite::Connection, document_id: &str, cache_key: &str, content: &str) -> Result<(), String> {
    if content.len() > 100 * 1024 * 1024 { return Err("文档语义数据超出范围。".into()); }
    let value: serde_json::Value = serde_json::from_str(content).map_err(|e| e.to_string())?;
    if value["schemaVersion"] != 1 || value["kind"] != "document-semantics"
        || value["documentId"] != document_id || value["cacheKey"] != cache_key {
        return Err("文档语义标识与缓存键不匹配。".into());
    }
    db.execute("INSERT INTO document_semantics(document_id,cache_key,content) VALUES(?1,?2,?3)
        ON CONFLICT(document_id,cache_key) DO UPDATE SET content=excluded.content",
        params![document_id, cache_key, content]).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn save_document_semantics(
    state: State<'_, AppState>, document_id: String, cache_key: String, content: String,
) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    save_semantics(&db, &document_id, &cache_key, &content)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn source_facts_use_v2_while_layout_and_formula_envelopes_keep_v1() {
        let facts = r#"{"schemaVersion":2,"kind":"page-facts","documentId":"paper","page":1,"cacheKey":"facts2:native"}"#;
        assert!(validate_page_analysis("paper", 1, "facts2:native", facts).is_ok());
        assert!(validate_page_analysis("paper", 1, "facts2:native", &facts.replace("\"schemaVersion\":2", "\"schemaVersion\":1")).is_err());
        assert!(validate_page_analysis("other", 1, "facts2:native", facts).is_err());
        assert!(validate_page_analysis("paper", 2, "facts2:native", facts).is_err());
        for kind in ["layout-observations", "formula-assets"] {
            let content = format!(r#"{{"schemaVersion":1,"kind":"{kind}","documentId":"paper","page":1,"cacheKey":"key"}}"#);
            assert!(validate_page_analysis("paper", 1, "key", &content).is_ok());
            assert!(validate_page_analysis("paper", 1, "key", &content.replace("\"schemaVersion\":1", "\"schemaVersion\":2")).is_err());
        }
    }

    #[test]
    fn semantic_snapshots_validate_identity_replace_and_follow_document_deletion() {
        let db = rusqlite::Connection::open_in_memory().unwrap();
        db.execute_batch("PRAGMA foreign_keys=ON;
            CREATE TABLE documents(id TEXT PRIMARY KEY); INSERT INTO documents VALUES('paper');
            CREATE TABLE document_semantics(document_id TEXT REFERENCES documents(id) ON DELETE CASCADE,
                cache_key TEXT, content TEXT, PRIMARY KEY(document_id,cache_key));").unwrap();
        let content = r#"{"schemaVersion":1,"kind":"document-semantics","documentId":"paper","cacheKey":"rules1","revision":1}"#;
        assert!(save_semantics(&db, "other", "rules1", content).is_err());
        assert!(save_semantics(&db, "paper", "rules2", content).is_err());
        save_semantics(&db, "paper", "rules1", content).unwrap();
        save_semantics(&db, "paper", "rules1", &content.replace("\"revision\":1", "\"revision\":2")).unwrap();
        let saved: String = db.query_row("SELECT content FROM document_semantics", [], |row| row.get(0)).unwrap();
        assert!(saved.contains("\"revision\":2"));
        db.execute("DELETE FROM documents", []).unwrap();
        assert_eq!(db.query_row("SELECT COUNT(*) FROM document_semantics", [], |row| row.get::<_, u64>(0)).unwrap(), 0);
    }
}
