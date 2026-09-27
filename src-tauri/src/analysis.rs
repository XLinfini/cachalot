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
    if page < 1 || content.len() > 20 * 1024 * 1024 { return Err("页面分析数据超出范围。".into()); }
    let value: serde_json::Value = serde_json::from_str(&content).map_err(|e| e.to_string())?;
    if value["schemaVersion"] != 1 || value["documentId"] != document_id || value["page"] != page || value["cacheKey"] != cache_key {
        return Err("页面分析标识与缓存键不匹配。".into());
    }
    // One committed SQLite statement per page. Previously completed pages survive
    // interruption; foreign-key cascade removes caches when a paper is deleted.
    state.db.lock().map_err(|e| e.to_string())?.execute(
        "INSERT INTO page_analysis(document_id,cache_key,page,content) VALUES(?1,?2,?3,?4)
         ON CONFLICT(document_id,cache_key,page) DO UPDATE SET content=excluded.content",
        params![document_id, cache_key, page, content],
    ).map_err(|e| e.to_string())?;
    Ok(())
}
