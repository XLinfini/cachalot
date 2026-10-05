mod ai;
mod ai_requests;
mod analysis;
mod categories;
mod cache;
mod db;
mod provider_error;
mod ocr_http;

use db::AppState;
use std::sync::Mutex;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let db = db::open_database(&app.handle())?;
            let http = reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(120))
                .build()?;
            app.manage(AppState { db: Mutex::new(db), http });
            app.manage(ai_requests::AiRequests::default());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            db::list_documents,
            db::import_pdf,
            db::load_pdf,
            db::set_document_progress,
            db::set_document_starred,
            db::delete_document,
            categories::list_categories,
            categories::create_category,
            categories::move_document,
            categories::delete_category,
            db::list_providers,
            db::save_provider,
            db::get_provider_key,
            db::delete_provider,
            db::get_setting,
            db::set_setting,
            db::save_page_text,
            db::list_page_text,
            analysis::get_page_analysis,
            analysis::save_page_analysis,
            analysis::get_document_semantics,
            analysis::save_document_semantics,
            cache::cache_usage,
            cache::clear_cache,
            db::create_chat_thread,
            db::list_chat_threads,
            db::rename_chat_thread,
            db::delete_chat_thread,
            db::list_chat_messages,
            db::save_chat_message,
            db::delete_chat_message,
            ai::list_models,
            ai::test_provider,
            ai::stream_completion,
            ai_requests::register_ai_request,
            ai_requests::cancel_ai_request,
            ocr_http::ocr_http,
        ])
        .run(tauri::generate_context!())
        .expect("failed to start Cachalot");
}
