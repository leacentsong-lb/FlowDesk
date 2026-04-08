use crate::HttpResponse;
use serde::Deserialize;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiTestConnectionRequest {
    pub provider: String,
    pub api_key: String,
    #[serde(alias = "baseURL")]
    pub base_url: Option<String>,
    pub model: String,
    pub organization: Option<String>,
    pub project: Option<String>,
}

fn resolve_base_url(provider: &str, base_url: Option<String>) -> String {
    let value = base_url.unwrap_or_default();
    let trimmed = value.trim();
    if !trimmed.is_empty() {
        return trimmed.trim_end_matches('/').to_string();
    }
    match provider {
        "deepseek" => "https://api.deepseek.com/v1".to_string(),
        _ => "https://api.openai.com/v1".to_string(),
    }
}

fn build_test_request(provider: &str, base: &str, model: &str) -> (String, serde_json::Value) {
    match provider {
        "deepseek" => {
            let url = format!("{}/chat/completions", base);
            let body = serde_json::json!({
                "model": model,
                "messages": [{ "role": "user", "content": "Reply with OK." }],
                "max_tokens": 5
            });
            (url, body)
        }
        _ => {
            let url = format!("{}/responses", base);
            let body = serde_json::json!({
                "model": model,
                "input": "Reply with OK."
            });
            (url, body)
        }
    }
}

#[tauri::command]
pub async fn ai_test_connection(payload: AiTestConnectionRequest) -> Result<HttpResponse, String> {
    let provider = payload.provider.trim().to_lowercase();

    let api_key = payload.api_key.trim().to_string();
    if api_key.is_empty() {
        return Err("AI API key is required".to_string());
    }

    let model = payload.model.trim().to_string();
    if model.is_empty() {
        return Err("AI model is required".to_string());
    }

    let base = resolve_base_url(&provider, payload.base_url);
    println!("[ai_test] provider={}, model={}, base={}, key_len={}", provider, model, base, api_key.len());
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| format!("HTTP client error: {}", e))?;

    let (url, body) = build_test_request(&provider, &base, &model);

    let mut request = client
        .post(&url)
        .header("Authorization", format!("Bearer {}", api_key))
        .header("Content-Type", "application/json")
        .header("Accept", "application/json")
        .json(&body);

    if let Some(org) = payload.organization.as_ref().map(|v| v.trim()).filter(|v| !v.is_empty()) {
        request = request.header("OpenAI-Organization", org);
    }

    if let Some(project) = payload.project.as_ref().map(|v| v.trim()).filter(|v| !v.is_empty()) {
        request = request.header("OpenAI-Project", project);
    }

    let response = request
        .send()
        .await
        .map_err(|e| format!("AI request failed: {}", e))?;

    let status = response.status().as_u16();
    let body = response
        .text()
        .await
        .map_err(|e| format!("Failed to read AI response: {}", e))?;

    Ok(HttpResponse { status, body })
}

#[cfg(test)]
mod tests {
    use super::build_test_request;

    #[test]
    fn openai_test_request_uses_minimal_responses_payload() {
        let (url, body) = build_test_request("openai", "https://api.openai.com/v1", "gpt-5.4");

        assert_eq!(url, "https://api.openai.com/v1/responses");
        assert_eq!(body["model"].as_str(), Some("gpt-5.4"));
        assert_eq!(body["input"].as_str(), Some("Reply with OK."));
        assert!(body.get("max_output_tokens").is_none());
    }
}
