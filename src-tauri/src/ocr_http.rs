//! Vendor-neutral OCR JSON transport. Vendor endpoints, payloads and response
//! parsing live in TypeScript adapters, so new vendors need no Rust changes.
use crate::db::{AppState, Provider};
use crate::provider_error;
use reqwest::header::{HeaderMap, HeaderName, HeaderValue, CONTENT_TYPE};
use rusqlite::OptionalExtension;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::sync::OnceLock;
use tauri::State;

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
enum Auth {
    Header {
        name: String,
        prefix: Option<String>,
    },
    Query {
        name: String,
    },
    Json {
        name: String,
    },
    None,
}
impl Default for Auth {
    fn default() -> Self {
        Self::Header {
            name: "Authorization".into(),
            prefix: Some("Bearer ".into()),
        }
    }
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OcrHttpInput {
    provider_id: String,
    url: String,
    method: Option<String>,
    #[serde(default)]
    headers: HashMap<String, String>,
    #[serde(default, deserialize_with = "present_body")]
    body: Option<Value>,
    #[serde(default)]
    auth: Auth,
}
#[derive(Serialize)]
pub struct OcrJsonResponse {
    body: Value,
    details: String,
}
fn coded(code: &str) -> String {
    format!("cachalot-message:{}", json!({"code":code,"values":{}}))
}
// Distinguish an omitted body from an explicitly supplied JSON null, matching
// the browser contract (GET rejects either supplied JSON body).
fn present_body<'de, D: serde::Deserializer<'de>>(
    deserializer: D,
) -> Result<Option<Value>, D::Error> {
    Value::deserialize(deserializer).map(Some)
}

fn prepare(
    base_url: &str,
    input: &OcrHttpInput,
    secret: Option<&str>,
) -> Result<(reqwest::Url, reqwest::Method, HeaderMap, Option<Value>), String> {
    let mut url = reqwest::Url::parse(&input.url).map_err(|_| coded("invalidApiUrl"))?;
    let base = reqwest::Url::parse(base_url.trim()).map_err(|_| coded("invalidApiUrl"))?;
    if !matches!(url.scheme(), "http" | "https")
        || !url.username().is_empty()
        || url.password().is_some()
        || (!matches!(input.auth, Auth::None) && url.origin() != base.origin())
    {
        return Err(coded("invalidApiUrl"));
    }
    url.set_fragment(None);
    let method = match input.method.as_deref().unwrap_or("POST") {
        "POST" => reqwest::Method::POST,
        "GET" if input.body.is_none() => reqwest::Method::GET,
        _ => return Err(coded("ocrRequestInvalid")),
    };
    let mut headers = HeaderMap::new();
    headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
    let mut custom_names = HashSet::new();
    for (name, value) in &input.headers {
        if !custom_names.insert(name.to_ascii_lowercase()) {
            return Err(coded("ocrRequestInvalid"));
        }
        headers.insert(
            HeaderName::from_bytes(name.as_bytes()).map_err(|_| coded("ocrRequestInvalid"))?,
            HeaderValue::from_str(value).map_err(|_| coded("ocrRequestInvalid"))?,
        );
    }
    let mut body = input.body.clone();
    match &input.auth {
        Auth::Header { name, prefix } => {
            let name =
                HeaderName::from_bytes(name.as_bytes()).map_err(|_| coded("ocrRequestInvalid"))?;
            if let Some(key) = secret {
                headers.insert(
                    name,
                    HeaderValue::from_str(&format!("{}{key}", prefix.as_deref().unwrap_or("")))
                        .map_err(|_| coded("ocrRequestInvalid"))?,
                );
            }
        }
        Auth::Query { name } => {
            if name.is_empty() || name.contains(['\r', '\n']) {
                return Err(coded("ocrRequestInvalid"));
            }
            if let Some(key) = secret {
                let pairs: Vec<(String, String)> = url
                    .query_pairs()
                    .filter(|(n, _)| n != name)
                    .map(|(n, v)| (n.into_owned(), v.into_owned()))
                    .collect();
                url.query_pairs_mut()
                    .clear()
                    .extend_pairs(pairs)
                    .append_pair(name, key);
            }
        }
        Auth::Json { name } => {
            if name.is_empty() || name.contains(['\r', '\n']) {
                return Err(coded("ocrRequestInvalid"));
            }
            let fields = body
                .as_mut()
                .and_then(Value::as_object_mut)
                .ok_or_else(|| coded("ocrRequestInvalid"))?;
            if let Some(key) = secret {
                fields.insert(name.clone(), Value::String(key.into()));
            }
        }
        Auth::None => (),
    }
    Ok((url, method, headers, body))
}
fn redact(body: &mut Value, secret: Option<&str>) {
    let Some(key) = secret.filter(|key| !key.is_empty()) else {
        return;
    };
    match body {
        Value::String(value) => *value = value.replace(key, "[redacted]"),
        Value::Array(values) => values.iter_mut().for_each(|value| redact(value, secret)),
        Value::Object(values) => values.values_mut().for_each(|value| redact(value, secret)),
        _ => (),
    }
}
#[tauri::command]
pub async fn ocr_http(
    state: State<'_, AppState>,
    requests: State<'_, crate::ai_requests::AiRequests>,
    request_id: Option<String>,
    input: OcrHttpInput,
) -> Result<OcrJsonResponse, String> {
    crate::ai_requests::run(&requests, request_id, ocr_response(state, input)).await
}
async fn ocr_response(state: State<'_, AppState>, input: OcrHttpInput) -> Result<OcrJsonResponse, String> {
    let provider: Provider = {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        db.query_row(
            "SELECT id,name,base_url,model_id,enabled,has_key FROM providers WHERE id=?1",
            [&input.provider_id],
            |r| {
                Ok(Provider {
                    id: r.get(0)?,
                    name: r.get(1)?,
                    base_url: r.get(2)?,
                    model_id: r.get(3)?,
                    enabled: r.get::<_, i64>(4)? != 0,
                    has_key: r.get::<_, i64>(5)? != 0,
                })
            },
        )
        .optional()
        .map_err(|e| e.to_string())?
        .filter(|p| p.enabled)
        .ok_or_else(|| coded("configureOcr"))?
    };
    let secret = if provider.has_key && !matches!(input.auth, Auth::None) {
        Some(
            keyring::Entry::new("cachalot", &provider.id)
                .map_err(|e| e.to_string())?
                .get_password()
                .map_err(|e| e.to_string())?,
        )
    } else {
        None
    };
    let (url, method, headers, body) = prepare(&provider.base_url, &input, secret.as_deref())?;
    if body
        .as_ref()
        .is_some_and(|b| b.to_string().len() > 20 * 1024 * 1024)
    {
        return Err(coded("ocrRequestInvalid"));
    }
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    let client = CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(120))
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .expect("OCR HTTP client")
    });
    let mut request = client.request(method, url).headers(headers);
    if let Some(body) = body {
        request = request.json(&body);
    }
    let response = request
        .send()
        .await
        .map_err(|e| e.without_url().to_string())?;
    let status = response.status();
    let headers = response.headers().clone();
    let text = response
        .text()
        .await
        .map_err(|e| e.without_url().to_string())?;
    let details = provider_error::response_details(&text, &headers, secret.as_deref());
    if !status.is_success() {
        return Err(provider_error::http_error(
            "ocrHttp",
            status.as_u16(),
            &text,
            &headers,
            secret.as_deref(),
        ));
    }
    let mut body: Value = serde_json::from_str(&text).map_err(|_| {
        format!(
            "cachalot-message:{}",
            json!({"code":"ocrResponseError","values":{"details":details}})
        )
    })?;
    redact(&mut body, secret.as_deref());
    Ok(OcrJsonResponse { body, details })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shared_transport_contract() {
        let fixtures: Vec<Value> =
            serde_json::from_str(include_str!("../../tests/fixtures/ocr-http.json")).unwrap();
        for fixture in fixtures {
            let mut request = fixture["request"].clone();
            request["providerId"] = json!("fixture-provider");
            let input: OcrHttpInput = serde_json::from_value(request).unwrap();
            let result = prepare(
                fixture["baseUrl"].as_str().unwrap(),
                &input,
                Some("fixture-key-1234"),
            );
            if fixture["invalid"].as_bool() == Some(true) {
                assert!(result.is_err(), "{fixture}");
                continue;
            }
            let (url, method, headers, body) = result.unwrap();
            let expected = &fixture["expected"];
            assert_eq!(
                body.is_some(),
                expected.as_object().unwrap().contains_key("body")
            );
            assert_eq!(url.as_str(), expected["url"].as_str().unwrap());
            assert_eq!(method.as_str(), expected["method"].as_str().unwrap());
            assert_eq!(body.as_ref().unwrap_or(&Value::Null), &expected["body"]);
            for (name, value) in expected["headers"].as_object().unwrap() {
                assert_eq!(
                    headers.get(name).unwrap().to_str().unwrap(),
                    value.as_str().unwrap()
                );
            }
            if matches!(input.auth, Auth::None) {
                assert!(!format!("{url}{headers:?}{body:?}").contains("fixture-key-1234"));
            }
        }
    }

    #[test]
    fn successful_vendor_json_cannot_echo_credentials() {
        let mut body =
            json!({"formula":"x+1","debug":["echo fixture-key-1234",{"key":"fixture-key-1234"}]});
        redact(&mut body, Some("fixture-key-1234"));
        assert_eq!(
            body,
            json!({"formula":"x+1","debug":["echo [redacted]",{"key":"[redacted]"}]})
        );
    }
}
