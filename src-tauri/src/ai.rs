use crate::db::{AppState, Provider};
use crate::provider_error;
use futures_util::StreamExt;
use reqwest::header::{HeaderMap, HeaderValue, AUTHORIZATION};
use rusqlite::OptionalExtension;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{ipc::Channel, State};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompletionInput {
    pub provider_id: String,
    pub model_id: Option<String>,
    pub messages: Vec<Value>,
    pub temperature: Option<f64>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompletionEvent {
    pub kind: &'static str,
    pub text: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelInfo {
    pub id: String,
    pub owned_by: Option<String>,
}

fn get_provider(state: &State<'_, AppState>, id: &str) -> Result<Provider, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.query_row(
        "SELECT id,name,base_url,model_id,enabled,has_key FROM providers WHERE id=?1",
        [id],
        |r| Ok(Provider {
            id: r.get(0)?, name: r.get(1)?, base_url: r.get(2)?, model_id: r.get(3)?,
            enabled: r.get::<_, i64>(4)? != 0, has_key: r.get::<_, i64>(5)? != 0,
        }),
    )
    .optional().map_err(|e| e.to_string())?
    .ok_or_else(|| "找不到该模型服务商".to_string())
}

fn auth_headers(provider: &Provider) -> Result<HeaderMap, String> {
    let mut headers = HeaderMap::new();
    if provider.has_key {
        let key = keyring::Entry::new("cachalot", &provider.id).map_err(|e| e.to_string())?
            .get_password().map_err(|e| format!("无法读取 API 密钥：{e}"))?;
        let value = HeaderValue::from_str(&format!("Bearer {key}")).map_err(|e| e.to_string())?;
        headers.insert(AUTHORIZATION, value);
    }
    Ok(headers)
}

// Keep this rule in sync with domain/api-endpoint.ts; shared fixtures exercise
// both adapters so the settings preview always reflects the native request.
fn endpoint(base_url: &str, leaf: &str) -> Result<String, String> {
    let mut url = reqwest::Url::parse(base_url.trim()).map_err(|_| "API 地址无效")?;
    if !matches!(url.scheme(), "http" | "https") {
        return Err("API 地址必须使用 HTTP 或 HTTPS".into());
    }
    let path = url.path().trim_end_matches('/');
    let path = path.strip_suffix("/chat/completions")
        .or_else(|| path.strip_suffix("/models"))
        .unwrap_or(path);
    let root = if path.is_empty() { "/v1" } else { path };
    let path = format!("{root}/{leaf}");
    url.set_path(&path);
    url.set_fragment(None);
    Ok(url.to_string())
}

#[cfg(test)]
mod endpoint_tests {
    use super::endpoint;

    #[test]
    fn native_requests_match_the_settings_preview() {
        let cases: serde_json::Value = serde_json::from_str(include_str!("../../tests/fixtures/api-endpoints.json")).unwrap();
        for fixture in cases.as_array().unwrap() {
            let base = fixture["baseUrl"].as_str().unwrap();
            assert_eq!(endpoint(base, "models").unwrap(), fixture["models"].as_str().unwrap());
            assert_eq!(endpoint(base, "chat/completions").unwrap(), fixture["chat"].as_str().unwrap());
        }
        for invalid in ["", "infai.cc", "ftp://infai.cc", "not a URL"] {
            assert!(endpoint(invalid, "models").is_err());
        }
    }
}

#[tauri::command]
pub async fn list_models(state: State<'_, AppState>, provider_id: String) -> Result<Vec<ModelInfo>, String> {
    let provider = get_provider(&state, &provider_id)?;
    let headers = auth_headers(&provider)?;
    let secret = headers.get(AUTHORIZATION).and_then(|value| value.to_str().ok()).and_then(|value| value.strip_prefix("Bearer "));
    let response = state.http.get(endpoint(&provider.base_url, "models")?)
        .headers(headers.clone()).send().await.map_err(|e| e.to_string())?;
    let status = response.status();
    let response_headers = response.headers().clone();
    let text = response.text().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(provider_error::http_error("modelsHttp", status.as_u16(), &text, &response_headers, secret));
    }
    let body: Value = serde_json::from_str(&text).map_err(|e| e.to_string())?;
    let mut models = body.get("data").and_then(Value::as_array).ok_or("服务商未返回模型列表；可以手动填写模型 ID")?
        .iter().filter_map(|item| item.get("id").and_then(Value::as_str).map(|id| ModelInfo {
            id: id.to_string(), owned_by: item.get("owned_by").and_then(Value::as_str).map(str::to_string),
        })).collect::<Vec<_>>();
    models.sort_by(|a,b| a.id.cmp(&b.id));
    Ok(models)
}

#[tauri::command]
pub async fn test_provider(state: State<'_, AppState>, provider_id: String) -> Result<String, String> {
    let provider = get_provider(&state, &provider_id)?;
    let headers = auth_headers(&provider)?;
    let secret = headers.get(AUTHORIZATION).and_then(|value| value.to_str().ok()).and_then(|value| value.strip_prefix("Bearer "));
    let response = state.http.get(endpoint(&provider.base_url, "models")?)
        .headers(headers.clone()).send().await.map_err(|e| e.to_string())?;
    if response.status().is_success() { Ok("连接成功".into()) }
    else {
        let status = response.status().as_u16();
        let response_headers = response.headers().clone();
        let body = response.text().await.unwrap_or_default();
        Err(provider_error::http_error("modelsHttp", status, &body, &response_headers, secret))
    }
}

#[tauri::command]
pub async fn stream_completion(state: State<'_, AppState>, requests: State<'_, crate::ai_requests::AiRequests>, request_id: Option<String>, input: CompletionInput, on_event: Channel<CompletionEvent>) -> Result<(), String> {
    crate::ai_requests::run(&requests, request_id, stream_response(state, input, on_event)).await
}
async fn stream_response(state: State<'_, AppState>, input: CompletionInput, on_event: Channel<CompletionEvent>) -> Result<(), String> {
    let provider = get_provider(&state, &input.provider_id)?;
    if !provider.enabled { return Err("该服务商已停用".into()); }
    let model_id = input.model_id.as_deref().unwrap_or(&provider.model_id);
    if model_id.trim().is_empty() { return Err("请先在模型服务设置中选择模型 ID".into()); }
    if input.messages.is_empty() { return Err("没有可发送的消息".into()); }
    let headers = auth_headers(&provider)?;
    let secret = headers.get(AUTHORIZATION).and_then(|value| value.to_str().ok()).and_then(|value| value.strip_prefix("Bearer "));
    let response = state.http.post(endpoint(&provider.base_url, "chat/completions")?)
        .headers(headers.clone())
        .json(&json!({
            "model": model_id,
            "messages": input.messages,
            "temperature": input.temperature.unwrap_or(0.2),
            "stream": true
        }))
        .send().await.map_err(|e| e.to_string())?;
    if !response.status().is_success() {
        let status = response.status();
        let response_headers = response.headers().clone();
        let body = response.text().await.unwrap_or_default();
        return Err(provider_error::http_error("completionHttp", status.as_u16(), &body, &response_headers, secret));
    }
    let response_headers = response.headers().clone();
    let mut stream = response.bytes_stream();
    let mut pending: Vec<u8> = Vec::new();
    let mut completed = false;
    while let Some(chunk) = stream.next().await {
        pending.extend_from_slice(&chunk.map_err(|e| e.to_string())?);
        while let Some(newline) = pending.iter().position(|byte| *byte == b'\n') {
            let line: Vec<u8> = pending.drain(..=newline).collect();
            let line = String::from_utf8_lossy(&line);
            let line = line.trim();
            let Some(data) = line.strip_prefix("data:") else { continue; };
            let data = data.trim();
            if data == "[DONE]" { completed = true; break; }
            if let Ok(value) = serde_json::from_str::<Value>(data) {
                if value.get("error").is_some_and(|error| !error.is_null() && error != &Value::Bool(false)) {
                    return Err(provider_error::stream_error(data, &response_headers, secret));
                }
                if let Some(text) = value.pointer("/choices/0/delta/content").and_then(Value::as_str) {
                    if !text.is_empty() { let _ = on_event.send(CompletionEvent { kind: "delta", text: text.to_string() }); }
                }
            }
        }
        if completed { break; }
    }
    let _ = on_event.send(CompletionEvent { kind: "done", text: String::new() });
    Ok(())
}
