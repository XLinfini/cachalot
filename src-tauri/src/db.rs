use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager, State};

pub struct AppState {
    pub db: Mutex<Connection>,
    pub http: reqwest::Client,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Document {
    pub id: String,
    pub file_name: String,
    pub title: String,
    pub page_count: i64,
    pub current_page: i64,
    pub starred: bool,
    pub category_id: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Provider {
    pub id: String,
    pub name: String,
    pub base_url: String,
    pub model_id: String,
    pub enabled: bool,
    pub has_key: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderInput {
    pub id: String,
    pub name: String,
    pub base_url: String,
    pub model_id: String,
    pub enabled: bool,
    pub api_key: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatThread {
    pub id: String,
    pub document_id: String,
    pub title: String,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatMessage {
    pub id: String,
    pub thread_id: String,
    pub parent_id: Option<String>,
    pub role: String,
    pub content: String,
    pub source_page: Option<i64>,
    pub source_region: Option<String>,
    pub provider_id: Option<String>,
    pub model_id: Option<String>,
    pub created_at: i64,
    #[serde(default)]
    pub images: Vec<serde_json::Value>,
}

pub fn now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}

pub fn open_database(app: &AppHandle) -> Result<Connection, String> {
    let directory = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
    let db = Connection::open(directory.join("cachalot.sqlite3")).map_err(|e| e.to_string())?;
    db.execute_batch(
        "PRAGMA foreign_keys = ON;
         PRAGMA journal_mode = WAL;
         CREATE TABLE IF NOT EXISTS documents (
           id TEXT PRIMARY KEY, file_name TEXT NOT NULL, title TEXT NOT NULL,
           page_count INTEGER NOT NULL, current_page INTEGER NOT NULL DEFAULT 1,
           starred INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
         );
         CREATE TABLE IF NOT EXISTS providers (
           id TEXT PRIMARY KEY, name TEXT NOT NULL, base_url TEXT NOT NULL,
           model_id TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1,
           has_key INTEGER NOT NULL DEFAULT 0
         );
         CREATE TABLE IF NOT EXISTS chat_threads (
           id TEXT PRIMARY KEY, document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
           title TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
         );
         CREATE TABLE IF NOT EXISTS chat_messages (
           id TEXT PRIMARY KEY, thread_id TEXT NOT NULL REFERENCES chat_threads(id) ON DELETE CASCADE,
           parent_id TEXT, role TEXT NOT NULL, content TEXT NOT NULL,
           source_page INTEGER, source_region TEXT, provider_id TEXT, model_id TEXT,
           created_at INTEGER NOT NULL
         );
         CREATE INDEX IF NOT EXISTS chat_messages_thread ON chat_messages(thread_id, created_at);
         CREATE TABLE IF NOT EXISTS page_text (
           document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
           page INTEGER NOT NULL, content TEXT NOT NULL,
           PRIMARY KEY(document_id, page)
         );
         CREATE TABLE IF NOT EXISTS page_analysis (
           document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
           cache_key TEXT NOT NULL, page INTEGER NOT NULL, content TEXT NOT NULL,
           PRIMARY KEY(document_id, cache_key, page)
         );
         CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);",
    )
    .map_err(|e| e.to_string())?;
    ensure_chat_images_column(&db)?;
    crate::categories::migrate(&db)?;
    Ok(db)
}

// Compatible with pre-image databases; repeated startup must remain harmless.
fn ensure_chat_images_column(db: &Connection) -> Result<(), String> {
    let present = {
        let mut statement = db.prepare("PRAGMA table_info(chat_messages)").map_err(|e| e.to_string())?;
        let columns = statement.query_map([], |row| row.get::<_, String>(1)).map_err(|e| e.to_string())?;
        columns.collect::<rusqlite::Result<Vec<_>>>().map_err(|e| e.to_string())?.iter().any(|name| name == "images")
    };
    if !present { db.execute("ALTER TABLE chat_messages ADD COLUMN images TEXT NOT NULL DEFAULT '[]'", []).map_err(|e| e.to_string())?; }
    Ok(())
}

fn document_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<Document> {
    Ok(Document {
        id: row.get(0)?, file_name: row.get(1)?, title: row.get(2)?,
        page_count: row.get(3)?, current_page: row.get(4)?,
        starred: row.get::<_, i64>(5)? != 0,
        created_at: row.get(6)?, updated_at: row.get(7)?,
        category_id: row.get(8)?,
    })
}

fn provider_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<Provider> {
    Ok(Provider {
        id: row.get(0)?, name: row.get(1)?, base_url: row.get(2)?,
        model_id: row.get(3)?, enabled: row.get::<_, i64>(4)? != 0,
        has_key: row.get::<_, i64>(5)? != 0,
    })
}

#[tauri::command]
pub fn list_documents(state: State<'_, AppState>) -> Result<Vec<Document>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let mut stmt = db.prepare("SELECT id,file_name,title,page_count,current_page,starred,created_at,updated_at,category_id FROM documents ORDER BY updated_at DESC")
        .map_err(|e| e.to_string())?;
    let result = stmt.query_map([], document_from_row).map_err(|e| e.to_string())?
        .collect::<rusqlite::Result<Vec<_>>>().map_err(|e| e.to_string());
    result
}

#[tauri::command]
pub fn import_pdf(app: AppHandle, state: State<'_, AppState>, file_name: String, data_base64: String, page_count: i64, title: Option<String>) -> Result<Document, String> {
    use base64::Engine;
    use sha2::{Digest, Sha256};
    let bytes = base64::engine::general_purpose::STANDARD.decode(data_base64).map_err(|e| e.to_string())?;
    if !bytes.starts_with(b"%PDF-") { return Err("所选文件不是有效的 PDF".into()); }
    if bytes.len() > 200 * 1024 * 1024 { return Err("PDF 超过 200 MB 限制".into()); }
    let id: String = Sha256::digest(&bytes).iter().map(|byte| format!("{byte:02x}")).collect();
    let directory = app.path().app_data_dir().map_err(|e| e.to_string())?.join("documents");
    std::fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
    let target = directory.join(format!("{id}.pdf"));
    if !target.exists() {
        let temp = directory.join(format!("{id}.tmp"));
        std::fs::write(&temp, &bytes).map_err(|e| e.to_string())?;
        std::fs::rename(temp, target).map_err(|e| e.to_string())?;
    }
    let title = title.filter(|s| !s.trim().is_empty()).unwrap_or_else(|| file_name.trim_end_matches(".pdf").to_string());
    let timestamp = now();
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.execute("INSERT INTO documents(id,file_name,title,page_count,current_page,starred,created_at,updated_at)
                VALUES(?1,?2,?3,?4,1,0,?5,?5)
                ON CONFLICT(id) DO UPDATE SET updated_at=excluded.updated_at",
        params![id, file_name, title, page_count.max(1), timestamp]).map_err(|e| e.to_string())?;
    db.query_row("SELECT id,file_name,title,page_count,current_page,starred,created_at,updated_at,category_id FROM documents WHERE id=?1", [id], document_from_row)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn load_pdf(app: AppHandle, id: String) -> Result<String, String> {
    use base64::Engine;
    if id.len() != 64 || !id.chars().all(|c| c.is_ascii_hexdigit()) { return Err("无效的文献编号".into()); }
    let path = app.path().app_data_dir().map_err(|e| e.to_string())?.join("documents").join(format!("{id}.pdf"));
    let bytes = std::fs::read(path).map_err(|e| e.to_string())?;
    Ok(base64::engine::general_purpose::STANDARD.encode(bytes))
}

#[tauri::command]
pub fn set_document_progress(state: State<'_, AppState>, id: String, page: i64) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.execute("UPDATE documents SET current_page=MIN(MAX(?2,1),page_count),updated_at=?3 WHERE id=?1", params![id,page,now()])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn set_document_starred(state: State<'_, AppState>, id: String, starred: bool) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.execute("UPDATE documents SET starred=?2 WHERE id=?1", params![id,starred as i64]).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn delete_document(app: AppHandle, state: State<'_, AppState>, id: String) -> Result<(), String> {
    if id.len() != 64 || !id.chars().all(|c| c.is_ascii_hexdigit()) { return Err("无效的文献编号".into()); }
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.execute("DELETE FROM documents WHERE id=?1", [&id]).map_err(|e| e.to_string())?;
    let path = app.path().app_data_dir().map_err(|e| e.to_string())?.join("documents").join(format!("{id}.pdf"));
    if path.exists() { std::fs::remove_file(path).map_err(|e| e.to_string())?; }
    Ok(())
}

#[tauri::command]
pub fn list_providers(state: State<'_, AppState>) -> Result<Vec<Provider>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let mut stmt = db.prepare("SELECT id,name,base_url,model_id,enabled,has_key FROM providers ORDER BY rowid")
        .map_err(|e| e.to_string())?;
    let result = stmt.query_map([], provider_from_row).map_err(|e| e.to_string())?
        .collect::<rusqlite::Result<Vec<_>>>().map_err(|e| e.to_string());
    result
}

#[tauri::command]
pub fn save_provider(state: State<'_, AppState>, provider: ProviderInput) -> Result<Provider, String> {
    if provider.name.trim().is_empty() { return Err("请填写服务商名称".into()); }
    let parsed = reqwest::Url::parse(&provider.base_url).map_err(|_| "API 地址无效")?;
    if !matches!(parsed.scheme(), "https" | "http") { return Err("API 地址必须使用 HTTP 或 HTTPS".into()); }
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let existing: Option<bool> = db.query_row("SELECT has_key FROM providers WHERE id=?1", [&provider.id], |r| Ok(r.get::<_, i64>(0)? != 0))
        .optional().map_err(|e| e.to_string())?;
    let has_key = if let Some(key) = provider.api_key.as_ref().filter(|s| !s.trim().is_empty()) {
        keyring::Entry::new("cachalot", &provider.id).map_err(|e| e.to_string())?
            .set_password(key).map_err(|e| format!("无法安全保存 API 密钥：{e}"))?;
        true
    } else { existing.unwrap_or(false) };
    db.execute("INSERT INTO providers(id,name,base_url,model_id,enabled,has_key) VALUES(?1,?2,?3,?4,?5,?6)
                ON CONFLICT(id) DO UPDATE SET name=excluded.name,base_url=excluded.base_url,model_id=excluded.model_id,enabled=excluded.enabled,has_key=excluded.has_key",
        params![provider.id,provider.name,provider.base_url.trim_end_matches('/'),provider.model_id,provider.enabled as i64,has_key as i64])
        .map_err(|e| e.to_string())?;
    db.query_row("SELECT id,name,base_url,model_id,enabled,has_key FROM providers WHERE id=?1", [&provider.id], provider_from_row)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_provider(state: State<'_, AppState>, id: String) -> Result<(), String> {
    if let Ok(entry) = keyring::Entry::new("cachalot", &id) { let _ = entry.delete_credential(); }
    state.db.lock().map_err(|e| e.to_string())?.execute("DELETE FROM providers WHERE id=?1", [id]).map_err(|e| e.to_string())?;
    Ok(())
}

/// Full credentials are returned only for an explicit reveal action. The
/// normal settings view receives a mask computed inside the native adapter.
#[tauri::command]
pub fn get_provider_key(
    state: State<'_, AppState>,
    provider_id: String,
    reveal: bool,
) -> Result<Option<String>, String> {
    let has_key = {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        db.query_row("SELECT has_key FROM providers WHERE id=?1", [&provider_id], |r| {
            Ok(r.get::<_, i64>(0)? != 0)
        })
            .optional()
            .map_err(|e| e.to_string())?
            .unwrap_or(false)
    };
    if !has_key {
        return Ok(None);
    }
    let key = keyring::Entry::new("cachalot", &provider_id)
        .map_err(|e| e.to_string())?
        .get_password()
        .map_err(|e| format!("无法读取 API 密钥：{e}"))?;
    if reveal {
        return Ok(Some(key));
    }
    let chars: Vec<char> = key.chars().collect();
    if chars.len() <= 4 {
        return Ok(Some("...".into()));
    }
    let prefix = if key.starts_with("sk-") {
        "sk-".to_string()
    } else {
        chars.iter().take(3).collect()
    };
    let suffix: String = chars[chars.len() - 4..].iter().collect();
    Ok(Some(format!("{prefix}...{suffix}")))
}

#[tauri::command]
pub fn get_setting(state: State<'_, AppState>, key: String) -> Result<Option<String>, String> {
    state.db.lock().map_err(|e| e.to_string())?.query_row("SELECT value FROM settings WHERE key=?1", [key], |r| r.get(0))
        .optional().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_setting(state: State<'_, AppState>, key: String, value: String) -> Result<(), String> {
    state.db.lock().map_err(|e| e.to_string())?.execute("INSERT INTO settings(key,value) VALUES(?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value", params![key,value])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn save_page_text(state: State<'_, AppState>, document_id: String, page: i64, content: String) -> Result<(), String> {
    state.db.lock().map_err(|e| e.to_string())?.execute("INSERT INTO page_text(document_id,page,content) VALUES(?1,?2,?3) ON CONFLICT(document_id,page) DO UPDATE SET content=excluded.content", params![document_id,page,content])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn list_page_text(state: State<'_, AppState>, document_id: String) -> Result<Vec<(i64, String)>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let mut stmt = db.prepare("SELECT page,content FROM page_text WHERE document_id=?1 ORDER BY page").map_err(|e| e.to_string())?;
    let result = stmt.query_map([document_id], |r| Ok((r.get(0)?,r.get(1)?))).map_err(|e| e.to_string())?
        .collect::<rusqlite::Result<Vec<_>>>().map_err(|e| e.to_string());
    result
}

#[tauri::command]
pub fn create_chat_thread(state: State<'_, AppState>, document_id: String) -> Result<ChatThread, String> {
    let id = uuid::Uuid::new_v4().to_string();
    let timestamp = now();
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.execute("INSERT INTO chat_threads(id,document_id,title,created_at,updated_at) VALUES(?1,?2,'新对话',?3,?3)", params![id,document_id,timestamp])
        .map_err(|e| e.to_string())?;
    Ok(ChatThread { id, document_id, title: "新对话".into(), created_at: timestamp, updated_at: timestamp })
}

#[tauri::command]
pub fn list_chat_threads(state: State<'_, AppState>, document_id: String) -> Result<Vec<ChatThread>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let mut stmt = db.prepare("SELECT id,document_id,title,created_at,updated_at FROM chat_threads WHERE document_id=?1 ORDER BY updated_at DESC")
        .map_err(|e| e.to_string())?;
    let result = stmt.query_map([document_id], |r| Ok(ChatThread { id:r.get(0)?,document_id:r.get(1)?,title:r.get(2)?,created_at:r.get(3)?,updated_at:r.get(4)? }))
        .map_err(|e| e.to_string())?.collect::<rusqlite::Result<Vec<_>>>().map_err(|e| e.to_string());
    result
}

#[tauri::command]
pub fn rename_chat_thread(state: State<'_, AppState>, id: String, title: String) -> Result<(), String> {
    state.db.lock().map_err(|e| e.to_string())?.execute("UPDATE chat_threads SET title=?2,updated_at=?3 WHERE id=?1", params![id,title,now()])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn delete_chat_thread(state: State<'_, AppState>, id: String) -> Result<(), String> {
    state.db.lock().map_err(|e| e.to_string())?.execute("DELETE FROM chat_threads WHERE id=?1", [id]).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn list_chat_messages(state: State<'_, AppState>, thread_id: String) -> Result<Vec<ChatMessage>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let mut stmt = db.prepare("SELECT id,thread_id,parent_id,role,content,source_page,source_region,provider_id,model_id,created_at,images FROM chat_messages WHERE thread_id=?1 ORDER BY created_at,rowid")
        .map_err(|e| e.to_string())?;
    let result = stmt.query_map([thread_id], |r| Ok(ChatMessage { id:r.get(0)?,thread_id:r.get(1)?,parent_id:r.get(2)?,role:r.get(3)?,content:r.get(4)?,source_page:r.get(5)?,source_region:r.get(6)?,provider_id:r.get(7)?,model_id:r.get(8)?,created_at:r.get(9)?,images:serde_json::from_str(&r.get::<_, String>(10)?).unwrap_or_default() }))
        .map_err(|e| e.to_string())?.collect::<rusqlite::Result<Vec<_>>>().map_err(|e| e.to_string());
    result
}

#[tauri::command]
pub fn save_chat_message(state: State<'_, AppState>, message: ChatMessage) -> Result<(), String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.execute("INSERT INTO chat_messages(id,thread_id,parent_id,role,content,source_page,source_region,provider_id,model_id,created_at,images)
                VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)
                ON CONFLICT(id) DO UPDATE SET content=excluded.content,source_page=excluded.source_page,source_region=excluded.source_region,provider_id=excluded.provider_id,model_id=excluded.model_id,images=excluded.images",
        params![message.id,message.thread_id,message.parent_id,message.role,message.content,message.source_page,message.source_region,message.provider_id,message.model_id,message.created_at,serde_json::to_string(&message.images).map_err(|e| e.to_string())?])
        .map_err(|e| e.to_string())?;
    db.execute("UPDATE chat_threads SET updated_at=?2 WHERE id=?1", params![message.thread_id,now()]).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn delete_chat_message(state: State<'_, AppState>, id: String) -> Result<(), String> {
    state.db.lock().map_err(|e| e.to_string())?.execute("DELETE FROM chat_messages WHERE id=?1", [id]).map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod image_migration_tests {
    use super::*;
    #[test]
    fn old_messages_survive_idempotent_image_migration() {
        let db = Connection::open_in_memory().unwrap();
        db.execute_batch("CREATE TABLE chat_messages(id TEXT,content TEXT); INSERT INTO chat_messages VALUES('old','kept');").unwrap();
        ensure_chat_images_column(&db).unwrap();
        ensure_chat_images_column(&db).unwrap();
        let row: (String,String) = db.query_row("SELECT content,images FROM chat_messages", [], |r| Ok((r.get(0)?,r.get(1)?))).unwrap();
        assert_eq!(row, ("kept".into(),"[]".into()));
    }
}
