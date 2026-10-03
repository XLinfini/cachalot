//! Only derived document data is eligible for cache management. SQL predicates
//! deliberately cover older parser/model versions as well as current versions.
use crate::db::AppState;
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use tauri::State;

#[derive(Debug, Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum CacheKind {
    Native,
    Layout,
    PageText,
    Previews,
    Formulas,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CacheUsage {
    kind: CacheKind,
    bytes: u64,
    entries: u64,
    candidates: u64,
}

fn location(kind: CacheKind) -> (&'static str, &'static str, &'static str) {
    match kind {
        CacheKind::Native => (
            "page_analysis",
            "content",
            "cache_key NOT GLOB 'formula-assets:*' AND instr(cache_key, ':native') > 0",
        ),
        CacheKind::Layout => (
            "page_analysis",
            "content",
            "cache_key NOT GLOB 'formula-assets:*' AND instr(cache_key, ':native') = 0",
        ),
        CacheKind::Formulas => (
            "page_analysis",
            "content",
            "cache_key GLOB 'formula-assets:*'",
        ),
        CacheKind::PageText => ("page_text", "content", "1"),
        CacheKind::Previews => ("settings", "value", "key GLOB 'preview:*' AND value <> ''"),
    }
}

fn usage(db: &Connection) -> Result<Vec<CacheUsage>, rusqlite::Error> {
    [CacheKind::Native, CacheKind::Layout, CacheKind::PageText, CacheKind::Previews, CacheKind::Formulas]
        .into_iter().map(|kind| {
            let (table, column, predicate) = location(kind);
            let (entries, bytes) = db.query_row(
                &format!("SELECT COUNT(*), COALESCE(SUM(length(CAST({column} AS BLOB))), 0) FROM {table} WHERE {predicate}"),
                [], |row| Ok((row.get(0)?, row.get(1)?)),
            )?;
            let candidates = if matches!(kind, CacheKind::Formulas) {
                db.query_row("SELECT COALESCE(SUM(CASE WHEN json_valid(content) THEN (SELECT COUNT(*) FROM json_each(content, '$.candidates')) ELSE 0 END), 0) FROM page_analysis WHERE cache_key GLOB 'formula-assets:*'", [], |row| row.get(0))?
            } else { 0 };
            Ok(CacheUsage { kind, bytes, entries, candidates })
        }).collect()
}

fn clear(db: &Connection, kind: CacheKind) -> Result<(), rusqlite::Error> {
    let (table, _, predicate) = location(kind);
    // There is no user-controlled table name or SQL fragment.
    db.execute(&format!("DELETE FROM {table} WHERE {predicate}"), [])?;
    Ok(())
}

#[tauri::command]
pub fn cache_usage(state: State<'_, AppState>) -> Result<Vec<CacheUsage>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    usage(&db).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn clear_cache(state: State<'_, AppState>, kind: CacheKind) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    clear(&db, kind).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn independent_cache_clearing_preserves_papers_conversations_and_settings() {
        let db = Connection::open_in_memory().unwrap();
        db.execute_batch("CREATE TABLE page_analysis(cache_key TEXT, content TEXT);
            CREATE TABLE page_text(content TEXT);
            CREATE TABLE settings(key TEXT, value TEXT);
            CREATE TABLE documents(id TEXT); INSERT INTO documents VALUES('paper');
            CREATE TABLE chat_messages(content TEXT); INSERT INTO chat_messages VALUES('kept');
            INSERT INTO page_analysis VALUES('schema1:pdfium:heron-old:rules1', '{}');
            INSERT INTO page_analysis VALUES('schema1:pdfium:native-old', '{}');
            INSERT INTO page_analysis VALUES('schema1:pdfium:native-new', '{}');
            INSERT INTO page_analysis VALUES('formula-assets:v1:f', '{\"candidates\":{\"old-model\":\"x\",\"new-model\":\"y\"}}');
            INSERT INTO page_text VALUES('中文');
            INSERT INTO settings VALUES('preview:v1:paper', 'image');
            INSERT INTO settings VALUES('preview:v0:old', 'old');
            INSERT INTO settings VALUES('translationPrompt', 'kept');
            INSERT INTO settings VALUES('addedModels:p', 'kept');
            INSERT INTO settings VALUES('formulaOcrModel', 'kept');").unwrap();
        let rows = usage(&db).unwrap();
        assert_eq!(rows[0].entries, 2);
        assert_eq!(rows[1].entries, 1);
        assert_eq!(
            rows[2].bytes, 6,
            "UTF-8 bytes, not number of Unicode characters"
        );
        assert_eq!(rows[3].entries, 2);
        assert_eq!(rows[4].candidates, 2);
        clear(&db, CacheKind::Layout).unwrap();
        assert_eq!(usage(&db).unwrap()[0].entries, 2);
        for kind in [
            CacheKind::Native,
            CacheKind::PageText,
            CacheKind::Previews,
            CacheKind::Formulas,
        ] {
            clear(&db, kind).unwrap();
            clear(&db, kind).unwrap();
        }
        assert!(usage(&db)
            .unwrap()
            .iter()
            .all(|row| row.bytes == 0 && row.entries == 0));
        assert_eq!(
            db.query_row("SELECT COUNT(*) FROM settings", [], |r| r.get::<_, u64>(0))
                .unwrap(),
            3
        );
        assert_eq!(
            db.query_row("SELECT id FROM documents", [], |r| r.get::<_, String>(0))
                .unwrap(),
            "paper"
        );
        assert_eq!(
            db.query_row("SELECT content FROM chat_messages", [], |r| r
                .get::<_, String>(0))
                .unwrap(),
            "kept"
        );
        assert!(serde_json::from_str::<CacheKind>("\"providers\"").is_err());
    }
}
