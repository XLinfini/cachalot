use regex::Regex;
use reqwest::header::HeaderMap;
use serde_json::json;
use std::sync::OnceLock;

/// Diagnostics are UI text, never HTML or model context. Share the same
/// redaction fixtures with the browser adapter.
pub fn response_details(body: &str, headers: &HeaderMap, secret: Option<&str>) -> String {
    let mut details = serde_json::from_str::<serde_json::Value>(body)
        .ok()
        .and_then(|value| serde_json::to_string_pretty(&value).ok())
        .unwrap_or_else(|| body.trim().to_string());
    let request_id = ["x-request-id", "request-id", "cf-ray"]
        .iter()
        .find_map(|name| headers.get(*name).and_then(|value| value.to_str().ok()));
    if let Some(id) = request_id.filter(|id| !details.contains(id)) {
        if !details.is_empty() {
            details.push('\n');
        }
        details.push_str(&format!("request_id: {id}"));
    }
    if let Some(key) = secret.filter(|key| !key.is_empty()) {
        details = details.replace(key, "[redacted]");
        if let Ok(encoded) = serde_json::to_string(key) {
            details = details.replace(&encoded[1..encoded.len() - 1], "[redacted]");
        }
    }
    static FIELDS: OnceLock<Regex> = OnceLock::new();
    static BEARER: OnceLock<Regex> = OnceLock::new();
    static KEYS: OnceLock<Regex> = OnceLock::new();
    static IMAGES: OnceLock<Regex> = OnceLock::new();
    details = FIELDS.get_or_init(|| Regex::new(r#"(?i)("(?:api[_-]?key|authorization|access[_-]?token|password|token)"\s*:\s*)"(?:\\.|[^"\\])*""#).unwrap())
        .replace_all(&details, r#"$1"[redacted]""#).into_owned();
    details = BEARER
        .get_or_init(|| Regex::new(r"(?i)\bBearer[ \t]+[A-Za-z0-9._~+/-]+=*").unwrap())
        .replace_all(&details, "Bearer [redacted]")
        .into_owned();
    details = KEYS
        .get_or_init(|| Regex::new(r"\bsk-[A-Za-z0-9_-]+").unwrap())
        .replace_all(&details, "[redacted]")
        .into_owned();
    details = IMAGES
        .get_or_init(|| Regex::new(r"data:image/[^;,\s]+;base64,[A-Za-z0-9+/=\r\n]+").unwrap())
        .replace_all(&details, "[image data]")
        .into_owned();
    if details.chars().count() > 16384 {
        details = details.chars().take(16384).collect::<String>() + "\n…";
    }
    details
}

pub fn http_error(
    code: &str,
    status: u16,
    body: &str,
    headers: &HeaderMap,
    secret: Option<&str>,
) -> String {
    let details = response_details(body, headers, secret);
    let descriptor = if details.is_empty() {
        json!({ "code": code, "values": { "status": status } })
    } else {
        json!({ "code": format!("{code}Details"), "values": { "status": status, "details": details } })
    };
    format!("cachalot-message:{descriptor}")
}

pub fn stream_error(body: &str, headers: &HeaderMap, secret: Option<&str>) -> String {
    format!(
        "cachalot-message:{}",
        json!({
            "code": "completionStreamError",
            "values": { "details": response_details(body, headers, secret) }
        })
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn diagnostics_and_redaction_match_the_browser_contract() {
        let fixtures: serde_json::Value =
            serde_json::from_str(include_str!("../../tests/fixtures/provider-errors.json"))
                .unwrap();
        for fixture in fixtures.as_array().unwrap() {
            let mut headers = HeaderMap::new();
            for (name, value) in fixture["headers"].as_object().unwrap() {
                headers.insert(
                    reqwest::header::HeaderName::from_bytes(name.as_bytes()).unwrap(),
                    value.as_str().unwrap().parse().unwrap(),
                );
            }
            let body = fixture["body"].as_str().unwrap();
            let secret = fixture["secret"].as_str();
            let details = response_details(body, &headers, secret);
            for text in fixture["contains"].as_array().unwrap() {
                assert!(details.contains(text.as_str().unwrap()));
            }
            if let Some(excludes) = fixture["excludes"].as_array() {
                for text in excludes {
                    assert!(!details.contains(text.as_str().unwrap()));
                }
            }
            let encoded = http_error("completionHttp", 503, body, &headers, secret);
            let value: serde_json::Value =
                serde_json::from_str(encoded.strip_prefix("cachalot-message:").unwrap()).unwrap();
            assert_eq!(value["values"]["status"], 503);
            assert_eq!(
                value["code"],
                if details.is_empty() {
                    "completionHttp"
                } else {
                    "completionHttpDetails"
                }
            );
        }
        assert!(response_details(
            &("x".repeat(500) + "upstream reason"),
            &HeaderMap::new(),
            None
        )
        .contains("upstream reason"));
        assert_eq!(
            response_details(&"α".repeat(20000), &HeaderMap::new(), None)
                .chars()
                .count(),
            16386
        );
    }
}
