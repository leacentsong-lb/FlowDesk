use std::process::Command;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};
use std::{env, fs};
use crate::HttpResponse;
use base64::Engine;
use serde_json::{json, Value};

fn jira_auth_header(email: &str, api_token: &str) -> String {
    let credentials = format!("{}:{}", email, api_token);
    let encoded = base64::engine::general_purpose::STANDARD.encode(credentials.as_bytes());
    format!("Basic {}", encoded)
}

/// Fetch all versions for a Jira project (used for version picker).
#[tauri::command]
pub async fn jira_get_versions(
    domain: String,
    email: String,
    api_token: String,
    project: String,
) -> Result<HttpResponse, String> {
    let client = reqwest::Client::new();
    let url = format!(
        "https://{}/rest/api/3/project/{}/versions",
        domain,
        urlencoding::encode(&project)
    );

    let response = client
        .get(&url)
        .header("Authorization", jira_auth_header(&email, &api_token))
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|e| format!("Jira request failed: {}", e))?;

    let status = response.status().as_u16();
    let body = response.text().await.map_err(|e| format!("Failed to read response: {}", e))?;

    Ok(HttpResponse { status, body })
}

/// Fetch all issues belonging to a specific Jira fixVersion.
#[tauri::command]
pub async fn jira_get_version_issues(
    domain: String,
    email: String,
    api_token: String,
    project: String,
    version_name: String,
) -> Result<HttpResponse, String> {
    let client = reqwest::Client::new();
    let jql = format!(
        "project = {} AND fixVersion = \"{}\" ORDER BY issuetype ASC, updated DESC",
        project, version_name
    );
    let url = format!(
        "https://{}/rest/api/3/search/jql?jql={}&maxResults=200&fields=summary,status,issuetype,priority,assignee,parent",
        domain,
        urlencoding::encode(&jql)
    );

    let response = client
        .get(&url)
        .header("Authorization", jira_auth_header(&email, &api_token))
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|e| format!("Jira request failed: {}", e))?;

    let status = response.status().as_u16();
    let body = response.text().await.map_err(|e| format!("Failed to read response: {}", e))?;

    Ok(HttpResponse { status, body })
}

/// Read the `version` field from a local `package.json`.
#[tauri::command]
pub async fn read_package_version(project_path: String) -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let pkg_path = std::path::Path::new(&project_path).join("package.json");
        let content = std::fs::read_to_string(&pkg_path)
            .map_err(|e| format!("Failed to read {}: {}", pkg_path.display(), e))?;

        let parsed: serde_json::Value = serde_json::from_str(&content)
            .map_err(|e| format!("Failed to parse package.json: {}", e))?;

        let version = parsed["version"].as_str().unwrap_or("").to_string();

        Ok(serde_json::json!({
            "version": version,
            "path": pkg_path.display().to_string()
        }))
    })
    .await
    .map_err(|e| format!("Task join failed: {}", e))?
}

/// Fetch + check whether a branch exists on remote (origin).
/// Returns JSON with `{ exists: bool, ref: string }`.
#[tauri::command]
pub async fn git_remote_branch_exists(
    project_path: String,
    branch_name: String,
) -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _ = Command::new("git")
            .args(["fetch", "origin", "--prune"])
            .current_dir(&project_path)
            .output();

        let output = Command::new("git")
            .args(["branch", "-r", "--list", &format!("origin/{}", branch_name)])
            .current_dir(&project_path)
            .output()
            .map_err(|e| format!("git branch -r failed: {}", e))?;

        let stdout = String::from_utf8_lossy(&output.stdout).to_string();
        let exists = !stdout.trim().is_empty();

        Ok(serde_json::json!({
            "exists": exists,
            "ref": format!("origin/{}", branch_name)
        }))
    })
    .await
    .map_err(|e| format!("Task join failed: {}", e))?
}

/// Check behind/ahead between two branches and detect merge conflicts
/// via `git merge-tree` (dry run, no working tree modification).
#[tauri::command]
pub async fn git_merge_conflict_check(
    project_path: String,
    source_branch: String,
    target_branch: String,
) -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _ = Command::new("git")
            .args(["fetch", "origin", "--prune"])
            .current_dir(&project_path)
            .output();

        let source_ref = format!("origin/{}", source_branch);
        let target_ref = format!("origin/{}", target_branch);

        // behind: commits in source not in target
        let behind_out = Command::new("git")
            .args(["rev-list", "--count", &format!("{}..{}", target_ref, source_ref)])
            .current_dir(&project_path)
            .output();
        let behind: u32 = behind_out
            .as_ref()
            .ok()
            .filter(|o| o.status.success())
            .map(|o| String::from_utf8_lossy(&o.stdout).trim().parse().unwrap_or(0))
            .unwrap_or(0);

        // ahead: commits in target not in source
        let ahead_out = Command::new("git")
            .args(["rev-list", "--count", &format!("{}..{}", source_ref, target_ref)])
            .current_dir(&project_path)
            .output();
        let ahead: u32 = ahead_out
            .as_ref()
            .ok()
            .filter(|o| o.status.success())
            .map(|o| String::from_utf8_lossy(&o.stdout).trim().parse().unwrap_or(0))
            .unwrap_or(0);

        // Merge base
        let base_out = Command::new("git")
            .args(["merge-base", &source_ref, &target_ref])
            .current_dir(&project_path)
            .output()
            .map_err(|e| format!("merge-base failed: {}", e))?;

        if !base_out.status.success() {
            return Ok(serde_json::json!({
                "behind": behind,
                "ahead": ahead,
                "hasConflict": false,
                "error": "No common ancestor found"
            }));
        }

        let base_sha = String::from_utf8_lossy(&base_out.stdout).trim().to_string();

        // git merge-tree <base> <source> <target> — prints conflict markers if any
        let merge_tree_out = Command::new("git")
            .args(["merge-tree", &base_sha, &source_ref, &target_ref])
            .current_dir(&project_path)
            .output()
            .map_err(|e| format!("merge-tree failed: {}", e))?;

        let merge_output = String::from_utf8_lossy(&merge_tree_out.stdout).to_string();
        let has_conflict = merge_output.contains("<<<<<<<")
            || merge_output.contains("changed in both");

        Ok(serde_json::json!({
            "behind": behind,
            "ahead": ahead,
            "hasConflict": has_conflict,
            "conflictPreview": if has_conflict {
                merge_output.chars().take(2000).collect::<String>()
            } else {
                String::new()
            }
        }))
    })
    .await
    .map_err(|e| format!("Task join failed: {}", e))?
}

/// Execute `pnpm run build` in a project directory.
/// Returns status, truncated stdout/stderr, and elapsed time.
#[tauri::command]
pub async fn run_pnpm_build(project_path: String) -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let start = std::time::Instant::now();

        let output = Command::new("pnpm")
            .args(["run", "build"])
            .current_dir(&project_path)
            .output()
            .map_err(|e| format!("Failed to run pnpm build: {}", e))?;

        let elapsed_ms = start.elapsed().as_millis() as u64;
        let success = output.status.success();
        let stdout = String::from_utf8_lossy(&output.stdout).to_string();
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();

        let max_log = 4000;
        let truncated_stdout: String = stdout.chars().rev().take(max_log).collect::<String>().chars().rev().collect();
        let truncated_stderr: String = stderr.chars().rev().take(max_log).collect::<String>().chars().rev().collect();

        Ok(serde_json::json!({
            "success": success,
            "exitCode": output.status.code().unwrap_or(-1),
            "stdout": truncated_stdout,
            "stderr": truncated_stderr,
            "elapsedMs": elapsed_ms
        }))
    })
    .await
    .map_err(|e| format!("Task join failed: {}", e))?
}

/// List all open PRs for a repo whose head branch contains a Jira issue key pattern.
/// Used for matching Jira issues -> GitHub PRs.
#[tauri::command]
pub async fn github_list_all_open_prs(
    owner: String,
    repo: String,
    token: String,
) -> Result<HttpResponse, String> {
    let client = reqwest::Client::new();
    let url = format!(
        "https://api.github.com/repos/{}/{}/pulls?state=open&per_page=100",
        owner, repo
    );

    let response = client
        .get(&url)
        .header("Authorization", format!("Bearer {}", token))
        .header("Accept", "application/vnd.github+json")
        .header("User-Agent", "Dev-Helper-App")
        .header("X-GitHub-Api-Version", "2022-11-28")
        .send()
        .await
        .map_err(|e| format!("GitHub API request failed: {}", e))?;

    let status = response.status().as_u16();
    let body = response.text().await.map_err(|e| format!("Failed to read response: {}", e))?;

    Ok(HttpResponse { status, body })
}

/// Call OpenAI-compatible chat completion (non-streaming, for simple tasks).
#[tauri::command]
pub async fn ai_release_summary(
    api_key: String,
    base_url: Option<String>,
    model: String,
    prompt: String,
) -> Result<HttpResponse, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .build()
        .map_err(|e| format!("HTTP client error: {}", e))?;

    let url_base = base_url
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| "https://api.openai.com/v1".to_string());
    let url = format!("{}/chat/completions", url_base.trim_end_matches('/'));

    let payload = serde_json::json!({
        "model": model,
        "messages": [
            { "role": "system", "content": "You are a release engineer assistant. Summarize concisely in the same language the user uses." },
            { "role": "user", "content": prompt }
        ],
        "max_tokens": 800,
        "temperature": 0.3
    });

    let response = client
        .post(&url)
        .header("Content-Type", "application/json")
        .header("Authorization", format!("Bearer {}", api_key))
        .json(&payload)
        .send()
        .await
        .map_err(|e| format!("AI request failed: {}", e))?;

    let status = response.status().as_u16();
    let body = response.text().await.map_err(|e| format!("Failed to read AI response: {}", e))?;

    if status == 200 {
        if let Ok(json) = serde_json::from_str::<serde_json::Value>(&body) {
            if let Some(content) = json["choices"][0]["message"]["content"].as_str() {
                return Ok(HttpResponse {
                    status,
                    body: serde_json::json!({ "content": content }).to_string(),
                });
            }
        }
    }

    Ok(HttpResponse { status, body })
}

/// Streaming chat completion via Tauri events with reasoning/thinking support.
/// Supports OpenAI (reasoning_effort) and DeepSeek (thinking mode).
/// Sends `ai-chat-chunk-{requestId}` events with `{ delta, reasoning, done }`.
#[tauri::command]
pub async fn ai_chat_stream(
    app: tauri::AppHandle,
    api_key: String,
    base_url: Option<String>,
    model: String,
    provider: Option<String>,
    messages: Vec<serde_json::Value>,
    request_id: String,
) -> Result<(), String> {
    use tauri::Emitter;

    let provider = provider.unwrap_or_else(|| "openai".to_string());

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(180))
        .build()
        .map_err(|e| format!("HTTP client error: {}", e))?;

    let url_base = base_url
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| match provider.as_str() {
            "deepseek" => "https://api.deepseek.com/v1".to_string(),
            _ => "https://api.openai.com/v1".to_string(),
        });
    let url = format!("{}/chat/completions", url_base.trim_end_matches('/'));

    let payload = build_streaming_chat_completions_payload(&provider, &model, &messages, None);

    let response = client
        .post(&url)
        .header("Content-Type", "application/json")
        .header("Authorization", format!("Bearer {}", api_key))
        .json(&payload)
        .send()
        .await
        .map_err(|e| format!("AI stream request failed: {}", e))?;

    if !response.status().is_success() {
        let status = response.status().as_u16();
        let body = response.text().await.unwrap_or_default();
        let _ = app.emit(&format!("ai-chat-chunk-{}", request_id), serde_json::json!({
            "delta": format!("[AI 错误 HTTP {}] {}", status, &body[..body.len().min(500)]),
            "reasoning": "",
            "done": true
        }));
        return Ok(());
    }

    let event_name = format!("ai-chat-chunk-{}", request_id);
    let mut buffer = String::new();
    let mut response = response;

    loop {
        let maybe_chunk = response.chunk().await.map_err(|e| format!("Stream read error: {}", e))?;
        let raw = match maybe_chunk {
            Some(bytes) => bytes,
            None => break,
        };
        buffer.push_str(&String::from_utf8_lossy(&raw));

        while let Some(line_end) = buffer.find('\n') {
            let line = buffer[..line_end].trim().to_string();
            buffer = buffer[line_end + 1..].to_string();

            if line.is_empty() || !line.starts_with("data: ") {
                continue;
            }

            let data = &line[6..];
            if data == "[DONE]" {
                let _ = app.emit(&event_name, serde_json::json!({ "delta": "", "reasoning": "", "done": true }));
                return Ok(());
            }

            if let Ok(json) = serde_json::from_str::<serde_json::Value>(data) {
                let delta_obj = &json["choices"][0]["delta"];

                // Content delta (both OpenAI and DeepSeek)
                let content = delta_obj["content"].as_str().unwrap_or("");

                // DeepSeek reasoning_content field
                let reasoning = delta_obj["reasoning_content"].as_str().unwrap_or("");

                if !content.is_empty() || !reasoning.is_empty() {
                    let _ = app.emit(&event_name, serde_json::json!({
                        "delta": content,
                        "reasoning": reasoning,
                        "done": false
                    }));
                }
            }
        }
    }

    let _ = app.emit(&event_name, serde_json::json!({ "delta": "", "reasoning": "", "done": true }));
    Ok(())
}

/// Non-streaming chat completion with tool/function calling support.
/// Returns the full OpenAI-compatible response, including any `tool_calls`.
/// This is the core API for the Agent Loop.
#[tauri::command]
pub async fn ai_tool_call_stream(
    app: tauri::AppHandle,
    api_key: String,
    base_url: Option<String>,
    model: String,
    provider: Option<String>,
    messages: Vec<serde_json::Value>,
    tools: Option<Vec<serde_json::Value>>,
    request_id: String,
) -> Result<(), String> {
    use tauri::Emitter;

    let provider = provider.unwrap_or_else(|| "openai".to_string());

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(180))
        .build()
        .map_err(|e| format!("HTTP client error: {}", e))?;

    let url_base = base_url
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| match provider.as_str() {
            "deepseek" => "https://api.deepseek.com/v1".to_string(),
            _ => "https://api.openai.com/v1".to_string(),
        });
    let url = format!("{}/chat/completions", url_base.trim_end_matches('/'));

    let payload = build_streaming_chat_completions_payload(&provider, &model, &messages, tools.as_ref());

    let response = client
        .post(&url)
        .header("Content-Type", "application/json")
        .header("Authorization", format!("Bearer {}", api_key))
        .json(&payload)
        .send()
        .await
        .map_err(|e| format!("AI tool stream request failed: {}", e))?;

    let event_name = format!("ai-tool-call-stream-{}", request_id);

    if !response.status().is_success() {
        let status = response.status().as_u16();
        let body = response.text().await.unwrap_or_default();
        let _ = app.emit(&event_name, serde_json::json!({
            "kind": "error",
            "message": format!("[AI 错误 HTTP {}] {}", status, &body[..body.len().min(500)])
        }));
        return Ok(());
    }

    let mut buffer = String::new();
    let mut response = response;
    let mut finish_reason = String::new();

    loop {
        let maybe_chunk = response.chunk().await.map_err(|e| format!("Stream read error: {}", e))?;
        let raw = match maybe_chunk {
            Some(bytes) => bytes,
            None => break,
        };
        buffer.push_str(&String::from_utf8_lossy(&raw));

        while let Some(line_end) = buffer.find('\n') {
            let line = buffer[..line_end].trim().to_string();
            buffer = buffer[line_end + 1..].to_string();

            if line.is_empty() || !line.starts_with("data: ") {
                continue;
            }

            let data = &line[6..];
            if data == "[DONE]" {
                let final_reason = if finish_reason.is_empty() { "stop" } else { &finish_reason };
                let _ = app.emit(&event_name, serde_json::json!({
                    "kind": "done",
                    "finishReason": final_reason
                }));
                return Ok(());
            }

            if let Ok(json) = serde_json::from_str::<serde_json::Value>(data) {
                let choice = &json["choices"][0];
                let delta_obj = &choice["delta"];

                if let Some(reason) = choice["finish_reason"].as_str().filter(|value| !value.is_empty()) {
                    finish_reason = reason.to_string();
                }

                let content = delta_obj["content"].as_str().unwrap_or("");
                if !content.is_empty() {
                    let _ = app.emit(&event_name, serde_json::json!({
                        "kind": "text-delta",
                        "text": content
                    }));
                }

                let reasoning = delta_obj["reasoning_content"].as_str().unwrap_or("");
                if !reasoning.is_empty() {
                    let _ = app.emit(&event_name, serde_json::json!({
                        "kind": "reasoning-delta",
                        "text": reasoning
                    }));
                }

                if let Some(tool_calls) = delta_obj["tool_calls"].as_array() {
                    for tool_call in tool_calls {
                        let index = tool_call["index"].as_u64().unwrap_or(0);
                        let id = tool_call["id"].as_str().unwrap_or("");
                        let name = tool_call["function"]["name"].as_str().unwrap_or("");
                        let arguments_fragment = tool_call["function"]["arguments"].as_str().unwrap_or("");

                        if !id.is_empty() || !name.is_empty() || !arguments_fragment.is_empty() {
                            let _ = app.emit(&event_name, serde_json::json!({
                                "kind": "tool-call-delta",
                                "index": index,
                                "id": id,
                                "name": name,
                                "argumentsFragment": arguments_fragment
                            }));
                        }
                    }
                }
            }
        }
    }

    let final_reason = if finish_reason.is_empty() { "stop" } else { &finish_reason };
    let _ = app.emit(&event_name, serde_json::json!({
        "kind": "done",
        "finishReason": final_reason
    }));
    Ok(())
}

/// Non-streaming chat completion with tool/function calling support.
/// Returns the full OpenAI-compatible response, including any `tool_calls`.
/// This is the core API for the Agent Loop.
#[tauri::command]
pub async fn ai_tool_call(
    api_key: String,
    base_url: Option<String>,
    model: String,
    provider: Option<String>,
    messages: Vec<serde_json::Value>,
    tools: Option<Vec<serde_json::Value>>,
) -> Result<serde_json::Value, String> {
    let provider = provider.unwrap_or_else(|| "openai".to_string());

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .map_err(|e| format!("HTTP client error: {}", e))?;

    let url_base = base_url
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| match provider.as_str() {
            "deepseek" => "https://api.deepseek.com/v1".to_string(),
            _ => "https://api.openai.com/v1".to_string(),
        });
    let use_responses_api = provider == "openai";
    let url = if use_responses_api {
        format!("{}/responses", url_base.trim_end_matches('/'))
    } else {
        format!("{}/chat/completions", url_base.trim_end_matches('/'))
    };

    let payload = if use_responses_api {
        build_openai_responses_payload(&model, &messages, tools.as_ref())
    } else {
        build_chat_completions_payload(&model, &messages, tools.as_ref())
    };

    let response = client
        .post(&url)
        .header("Content-Type", "application/json")
        .header("Authorization", format!("Bearer {}", api_key))
        .json(&payload)
        .send()
        .await
        .map_err(|e| format!("AI tool_call request failed: {}", e))?;

    let status = response.status().as_u16();
    let body = response.text().await.map_err(|e| format!("Read body failed: {}", e))?;

    if status != 200 {
        return Err(format!("HTTP {}: {}", status, &body[..body.len().min(500)]));
    }

    if use_responses_api {
        let parsed: serde_json::Value = serde_json::from_str(&body)
            .map_err(|e| format!("Parse JSON failed: {}", e))?;
        return Ok(adapt_responses_to_chat_completions(parsed));
    }

    serde_json::from_str(&body).map_err(|e| format!("Parse JSON failed: {}", e))
}

fn build_chat_completions_payload(
    model: &str,
    messages: &[serde_json::Value],
    tools: Option<&Vec<serde_json::Value>>,
) -> serde_json::Value {
    let has_tools = tools.map_or(false, |t| !t.is_empty());

    // deepseek-reasoner does NOT support function calling.
    // Auto-downgrade to deepseek-chat when tools are present.
    let effective_model = if has_tools && model.contains("reasoner") {
        "deepseek-chat"
    } else {
        model
    };

    let mut payload = serde_json::json!({
        "model": effective_model,
        "messages": messages,
        "max_tokens": 4096,
    });

    if has_tools {
        payload["tools"] = serde_json::json!(tools.unwrap());
        payload["tool_choice"] = serde_json::json!("auto");
    }

    payload
}

fn build_streaming_chat_completions_payload(
    provider: &str,
    model: &str,
    messages: &[serde_json::Value],
    tools: Option<&Vec<serde_json::Value>>,
) -> serde_json::Value {
    let mut payload = build_chat_completions_payload(model, messages, tools);
    payload["stream"] = serde_json::json!(true);

    if provider == "openai" {
        let max_tokens = 4000;
        payload.as_object_mut().map(|obj| obj.remove("max_tokens"));
        payload["max_completion_tokens"] = serde_json::json!(max_tokens);
        payload["reasoning_effort"] = serde_json::json!("medium");
    } else if provider == "deepseek" {
        payload["max_tokens"] = serde_json::json!(8192);
    }

    payload
}

fn build_openai_responses_payload(
    model: &str,
    messages: &[serde_json::Value],
    tools: Option<&Vec<serde_json::Value>>,
) -> serde_json::Value {
    let mut payload = serde_json::json!({
        "model": model,
        "input": convert_messages_to_responses_input(messages),
    });

    if let Some(tools_arr) = tools {
        let converted_tools: Vec<serde_json::Value> = tools_arr
            .iter()
            .map(convert_tool_to_responses_shape)
            .collect();

        if !converted_tools.is_empty() {
            payload["tools"] = serde_json::json!(converted_tools);
        }
    }

    payload
}

fn convert_tool_to_responses_shape(tool: &serde_json::Value) -> serde_json::Value {
    if let Some(function) = tool.get("function") {
        serde_json::json!({
            "type": "function",
            "name": function["name"].as_str().unwrap_or("tool"),
            "description": function["description"].as_str().unwrap_or(""),
            "parameters": function["parameters"].clone()
        })
    } else {
        tool.clone()
    }
}

fn convert_messages_to_responses_input(messages: &[serde_json::Value]) -> Vec<serde_json::Value> {
    let mut input: Vec<serde_json::Value> = Vec::new();

    for message in messages {
        let role = message["role"].as_str().unwrap_or("");
        match role {
            "tool" => {
                input.push(serde_json::json!({
                    "type": "function_call_output",
                    "call_id": message["tool_call_id"].as_str().unwrap_or(""),
                    "output": message["content"].as_str().unwrap_or("")
                }));
            }
            "assistant" => {
                if let Some(tool_calls) = message["tool_calls"].as_array() {
                    for tool_call in tool_calls {
                        input.push(serde_json::json!({
                            "type": "function_call",
                            "call_id": tool_call["id"].as_str().unwrap_or(""),
                            "name": tool_call["function"]["name"].as_str().unwrap_or(""),
                            "arguments": tool_call["function"]["arguments"].as_str().unwrap_or("")
                        }));
                    }
                }

                if let Some(content) = message["content"].as_str().filter(|value| !value.is_empty()) {
                    input.push(serde_json::json!({
                        "role": "assistant",
                        "content": content
                    }));
                }
            }
            "system" | "user" => {
                if let Some(content) = message["content"].as_str() {
                    input.push(serde_json::json!({
                        "role": role,
                        "content": content
                    }));
                }
            }
            _ => {}
        }
    }

    input
}

fn adapt_responses_to_chat_completions(response: serde_json::Value) -> serde_json::Value {
    let output = response["output"].as_array().cloned().unwrap_or_default();
    let mut content_parts: Vec<String> = Vec::new();
    let mut tool_calls: Vec<serde_json::Value> = Vec::new();

    for item in output {
        match item["type"].as_str().unwrap_or("") {
            "message" => {
                if let Some(contents) = item["content"].as_array() {
                    for content in contents {
                        if content["type"].as_str() == Some("output_text") {
                            if let Some(text) = content["text"].as_str() {
                                content_parts.push(text.to_string());
                            }
                        }
                    }
                }
            }
            "function_call" => {
                let call_id = item["call_id"]
                    .as_str()
                    .or_else(|| item["id"].as_str())
                    .unwrap_or("call_unknown");
                tool_calls.push(serde_json::json!({
                    "id": call_id,
                    "type": "function",
                    "function": {
                        "name": item["name"].as_str().unwrap_or(""),
                        "arguments": item["arguments"].as_str().unwrap_or("{}")
                    }
                }));
            }
            _ => {}
        }
    }

    let content = if content_parts.is_empty() {
        response["output_text"].as_str().unwrap_or("").to_string()
    } else {
        content_parts.join("")
    };

    serde_json::json!({
        "choices": [{
            "finish_reason": if tool_calls.is_empty() { "stop" } else { "tool_calls" },
            "message": {
                "role": "assistant",
                "content": if content.is_empty() { serde_json::Value::Null } else { serde_json::Value::String(content) },
                "tool_calls": if tool_calls.is_empty() { serde_json::Value::Null } else { serde_json::Value::Array(tool_calls) }
            }
        }]
    })
}

#[cfg(test)]
mod ai_tool_call_tests {
    use super::{adapt_responses_to_chat_completions, build_openai_responses_payload, build_streaming_chat_completions_payload};

    #[test]
    fn openai_tool_call_uses_responses_input_and_function_tools() {
        let payload = build_openai_responses_payload(
            "gpt-5.4",
            &vec![
                serde_json::json!({ "role": "system", "content": "You are helpful." }),
                serde_json::json!({ "role": "user", "content": "Check repo status." }),
            ],
            Some(&vec![
                serde_json::json!({
                    "type": "function",
                    "function": {
                        "name": "scan_pr_status",
                        "description": "Scan prs",
                        "parameters": { "type": "object", "properties": {} }
                    }
                })
            ]),
        );

        assert_eq!(payload["model"].as_str(), Some("gpt-5.4"));
        assert!(payload.get("messages").is_none());
        assert!(payload["input"].is_array());
        assert_eq!(payload["tools"][0]["type"].as_str(), Some("function"));
        assert_eq!(payload["tools"][0]["name"].as_str(), Some("scan_pr_status"));
    }

    #[test]
    fn adapts_openai_responses_function_calls_to_chat_shape() {
        let adapted = adapt_responses_to_chat_completions(serde_json::json!({
            "output": [
                {
                    "type": "function_call",
                    "call_id": "call_123",
                    "name": "scan_pr_status",
                    "arguments": "{\"repo\":\"member\"}"
                }
            ],
            "output_text": ""
        }));

        assert_eq!(adapted["choices"][0]["finish_reason"].as_str(), Some("tool_calls"));
        assert_eq!(
            adapted["choices"][0]["message"]["tool_calls"][0]["function"]["name"].as_str(),
            Some("scan_pr_status")
        );
        assert_eq!(adapted["choices"][0]["message"]["tool_calls"][0]["id"].as_str(), Some("call_123"));
    }

    #[test]
    fn openai_streaming_payload_uses_max_completion_tokens() {
        let payload = build_streaming_chat_completions_payload(
            "openai",
            "gpt-5.4",
            &vec![serde_json::json!({ "role": "user", "content": "hello" })],
            None,
        );

        assert_eq!(payload["stream"].as_bool(), Some(true));
        assert!(payload.get("max_tokens").is_none());
        assert_eq!(payload["max_completion_tokens"].as_u64(), Some(4000));
    }

    #[test]
    fn deepseek_streaming_payload_keeps_max_tokens() {
        let payload = build_streaming_chat_completions_payload(
            "deepseek",
            "deepseek-chat",
            &vec![serde_json::json!({ "role": "user", "content": "hello" })],
            None,
        );

        assert_eq!(payload["stream"].as_bool(), Some(true));
        assert_eq!(payload["max_tokens"].as_u64(), Some(8192));
        assert!(payload.get("max_completion_tokens").is_none());
    }
}

/// List merged PRs targeting a specific base branch (e.g. release/v3.8.2).
#[tauri::command]
pub async fn github_list_merged_prs(
    owner: String,
    repo: String,
    base_branch: String,
    token: String,
) -> Result<HttpResponse, String> {
    let client = reqwest::Client::new();
    let url = format!(
        "https://api.github.com/repos/{}/{}/pulls?state=closed&base={}&per_page=100",
        owner,
        repo,
        urlencoding::encode(&base_branch)
    );

    let response = client
        .get(&url)
        .header("Authorization", format!("Bearer {}", token))
        .header("Accept", "application/vnd.github+json")
        .header("User-Agent", "Dev-Helper-App")
        .header("X-GitHub-Api-Version", "2022-11-28")
        .send()
        .await
        .map_err(|e| format!("GitHub API request failed: {}", e))?;

    let status = response.status().as_u16();
    let body = response.text().await.map_err(|e| format!("Failed to read response: {}", e))?;

    Ok(HttpResponse { status, body })
}

fn release_store_path() -> PathBuf {
    env::temp_dir().join("flowdesk-release-store.json")
}

fn release_artifact_dir(session_id: &str) -> Result<PathBuf, String> {
    let dir = env::temp_dir()
        .join("flowdesk-release-artifacts")
        .join(session_id);
    fs::create_dir_all(&dir).map_err(|e| format!("Failed to create artifact directory: {}", e))?;
    Ok(dir)
}

fn timestamp_string() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .to_string()
}

fn load_release_store() -> Result<Value, String> {
    let path = release_store_path();
    if !path.exists() {
        return Ok(json!({ "sessions": [] }));
    }

    let content = fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read release store: {}", e))?;
    serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse release store: {}", e))
}

fn save_release_store(store: &Value) -> Result<(), String> {
    let path = release_store_path();
    let serialized = serde_json::to_string_pretty(store)
        .map_err(|e| format!("Failed to serialize release store: {}", e))?;
    fs::write(&path, serialized)
        .map_err(|e| format!("Failed to persist release store: {}", e))
}

fn get_sessions_mut(store: &mut Value) -> Result<&mut Vec<Value>, String> {
    store
        .get_mut("sessions")
        .and_then(Value::as_array_mut)
        .ok_or_else(|| "Release store is missing sessions array".to_string())
}

fn find_session_index(sessions: &[Value], session_id: &str) -> Option<usize> {
    sessions.iter().position(|session| {
        session
            .get("sessionId")
            .and_then(Value::as_str)
            .map(|id| id == session_id)
            .unwrap_or(false)
    })
}

fn read_release_session_value(session_id: &str) -> Result<Value, String> {
    let store = load_release_store()?;
    let sessions = store
        .get("sessions")
        .and_then(Value::as_array)
        .ok_or_else(|| "Release store is missing sessions array".to_string())?;
    let index = find_session_index(sessions, session_id)
        .ok_or_else(|| format!("Release Session not found: {}", session_id))?;
    Ok(sessions[index].clone())
}

fn upsert_release_session_value(session: Value) -> Result<Value, String> {
    let session_id = session
        .get("sessionId")
        .and_then(Value::as_str)
        .ok_or_else(|| "session.sessionId is required".to_string())?
        .to_string();

    let mut store = load_release_store()?;
    let sessions = get_sessions_mut(&mut store)?;

    match find_session_index(sessions, &session_id) {
        Some(index) => sessions[index] = session.clone(),
        None => sessions.push(session.clone()),
    }

    save_release_store(&store)?;
    Ok(session)
}

fn session_step_status(session: &Value, step_id: &str) -> String {
    session
        .get("steps")
        .and_then(|steps| steps.get(step_id))
        .and_then(|step| step.get("status"))
        .and_then(Value::as_str)
        .unwrap_or("pending")
        .to_string()
}

fn session_step_result(session: &Value, step_id: &str) -> Value {
    session
        .get("steps")
        .and_then(|steps| steps.get(step_id))
        .and_then(|step| step.get("result"))
        .cloned()
        .unwrap_or_else(|| json!(null))
}

fn repo_key(repo: &Value) -> String {
    repo.get("key").and_then(Value::as_str).unwrap_or("").to_string()
}

fn repo_path(repo: &Value) -> String {
    repo.get("path").and_then(Value::as_str).unwrap_or("").to_string()
}

fn run_git_output(project_path: &str, args: &[String]) -> Result<std::process::Output, String> {
    Command::new("git")
        .args(args)
        .current_dir(project_path)
        .output()
        .map_err(|e| format!("git {:?} failed: {}", args, e))
}

fn run_git_text(project_path: &str, args: &[String]) -> Result<String, String> {
    let output = run_git_output(project_path, args)?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

fn git_status_clean(project_path: &str) -> Result<bool, String> {
    let output = run_git_text(project_path, &vec!["status".into(), "--porcelain".into()])?;
    Ok(output.trim().is_empty())
}

fn git_diff_name_only(project_path: &str, left_ref: &str, right_ref: &str) -> Result<Vec<String>, String> {
    let output = run_git_text(project_path, &vec![
        "diff".into(),
        "--name-only".into(),
        left_ref.into(),
        right_ref.into(),
    ])?;
    Ok(output
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(str::to_string)
        .collect())
}

fn git_show_file(project_path: &str, git_ref: &str, relative_path: &str) -> Result<String, String> {
    run_git_text(project_path, &vec![
        "show".into(),
        format!("{}:{}", git_ref, relative_path),
    ])
}

fn flatten_json_keys(prefix: &str, value: &Value, acc: &mut Vec<(String, String)>) {
    match value {
        Value::Object(map) => {
            for (key, child) in map {
                let next_prefix = if prefix.is_empty() {
                    key.to_string()
                } else {
                    format!("{}.{}", prefix, key)
                };
                flatten_json_keys(&next_prefix, child, acc);
            }
        }
        Value::Array(items) => {
            for (index, child) in items.iter().enumerate() {
                flatten_json_keys(&format!("{}[{}]", prefix, index), child, acc);
            }
        }
        _ => {
            acc.push((prefix.to_string(), value.to_string()));
        }
    }
}

fn detect_config_file(path: &str) -> bool {
    let lower = path.to_lowercase();
    lower.ends_with(".json")
        || lower.ends_with(".yaml")
        || lower.ends_with(".yml")
        || lower.ends_with(".toml")
        || lower.contains("config")
        || lower.contains("/public/")
}

fn detect_i18n_file(path: &str) -> bool {
    let lower = path.to_lowercase();
    lower.contains("i18n")
        || lower.contains("locale")
        || lower.contains("locales")
        || lower.contains("messages")
        || lower.ends_with(".po")
        || lower.ends_with(".json")
}

#[tauri::command]
pub async fn release_session_create(
    version: Option<String>,
    environment: String,
) -> Result<Value, String> {
    let session_id = format!("release-session-{}", timestamp_string());
    let now = timestamp_string();
    let session = json!({
        "sessionId": session_id,
        "version": version.unwrap_or_default(),
        "environment": environment,
        "status": "draft",
        "steps": {},
        "approvals": [],
        "artifacts": [],
        "repos": [],
        "blockedSteps": [],
        "pendingApprovals": [],
        "currentGate": Value::Null,
        "createdAt": now,
        "updatedAt": now
    });
    let saved = upsert_release_session_value(session)?;
    Ok(json!({
        "ok": true,
        "session": saved,
        "summary": "Release Session 已创建。"
    }))
}

#[tauri::command]
pub async fn release_session_read(session_id: String) -> Result<Value, String> {
    let session = read_release_session_value(&session_id)?;
    Ok(json!({
        "ok": true,
        "session": session
    }))
}

#[tauri::command]
pub async fn release_session_update(session: Value) -> Result<Value, String> {
    let mut next_session = session.clone();
    if let Some(object) = next_session.as_object_mut() {
        object.insert("updatedAt".to_string(), json!(timestamp_string()));
    }
    let saved = upsert_release_session_value(next_session)?;
    Ok(json!({
        "ok": true,
        "session": saved
    }))
}

#[tauri::command]
pub async fn release_session_list(status: Option<String>) -> Result<Value, String> {
    let store = load_release_store()?;
    let sessions = store
        .get("sessions")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let filtered = sessions
        .into_iter()
        .filter(|session| {
            status
                .as_ref()
                .map(|expected| session.get("status").and_then(Value::as_str).unwrap_or("") == expected)
                .unwrap_or(true)
        })
        .collect::<Vec<_>>();
    Ok(json!({
        "ok": true,
        "sessions": filtered,
        "summary": format!("找到 {} 个 Release Session。", filtered.len())
    }))
}

#[tauri::command]
pub async fn release_approval_create(
    session_id: String,
    step_id: String,
    action: String,
    target: String,
    summary: String,
) -> Result<Value, String> {
    let mut session = read_release_session_value(&session_id)?;
    let approval_id = format!("approval-{}-{}", step_id, timestamp_string());
    let approval = json!({
        "approvalId": approval_id,
        "sessionId": session_id,
        "stepId": step_id,
        "action": action,
        "target": target,
        "summary": summary,
        "requestedBy": "system",
        "approvedBy": "",
        "decision": "pending",
        "ts": timestamp_string()
    });

    session["approvals"]
        .as_array_mut()
        .ok_or_else(|| "Session approvals is not an array".to_string())?
        .push(approval.clone());
    session["currentGate"] = json!({
        "approvalId": approval_id,
        "stepId": approval["stepId"],
        "action": approval["action"],
        "target": approval["target"],
        "summary": approval["summary"]
    });
    session["updatedAt"] = json!(timestamp_string());

    let saved = upsert_release_session_value(session)?;
    Ok(json!({
        "ok": true,
        "session": saved,
        "approval": approval
    }))
}

#[tauri::command]
pub async fn release_approval_decide(
    session_id: String,
    approval_id: String,
    decision: String,
    actor: String,
) -> Result<Value, String> {
    let mut session = read_release_session_value(&session_id)?;
    let approvals = session["approvals"]
        .as_array_mut()
        .ok_or_else(|| "Session approvals is not an array".to_string())?;

    let mut updated = None;
    for approval in approvals.iter_mut() {
        if approval.get("approvalId").and_then(Value::as_str) == Some(approval_id.as_str()) {
            approval["decision"] = json!(decision.clone());
            approval["approvedBy"] = json!(actor.clone());
            approval["ts"] = json!(timestamp_string());
            updated = Some(approval.clone());
            break;
        }
    }

    if updated.is_none() {
        return Err(format!("Approval not found: {}", approval_id));
    }

    session["currentGate"] = Value::Null;
    session["updatedAt"] = json!(timestamp_string());

    let saved = upsert_release_session_value(session)?;
    Ok(json!({
        "ok": true,
        "session": saved,
        "approval": updated.unwrap()
    }))
}

#[tauri::command]
pub async fn release_collect_config_changes(
    session_id: String,
    version: String,
    repos: Vec<Value>,
) -> Result<Value, String> {
    let release_ref = format!("origin/release/v{}", version.trim_start_matches('v'));
    let mut changes = Vec::new();

    for repo in repos {
        let repo_path = repo_path(&repo);
        if repo_path.is_empty() {
            continue;
        }
        let diff_files = git_diff_name_only(&repo_path, "origin/latest", &release_ref).unwrap_or_default();
        let matched_files = diff_files
            .into_iter()
            .filter(|file| detect_config_file(file))
            .collect::<Vec<_>>();
        if !matched_files.is_empty() {
            changes.push(json!({
                "repoKey": repo_key(&repo),
                "repoPath": repo_path,
                "files": matched_files
            }));
        }
    }

    Ok(json!({
        "ok": true,
        "stepId": "configChanges",
        "sessionId": session_id,
        "hasChanges": !changes.is_empty(),
        "changes": changes,
        "summary": if changes.is_empty() {
            "未发现需要单独处理的配置变更。"
        } else {
            "检测到配置变更，请在审批后决定是否应用。"
        }
    }))
}

#[tauri::command]
pub async fn release_preview_config_changes(session_id: String) -> Result<Value, String> {
    let session = read_release_session_value(&session_id)?;
    let changes = session_step_result(&session, "configChanges")
        .get("changes")
        .cloned()
        .unwrap_or_else(|| json!([]));
    Ok(json!({
        "ok": true,
        "stepId": "configChanges",
        "previews": changes,
        "summary": "已生成配置变更预览。"
    }))
}

#[tauri::command]
pub async fn release_apply_config_changes(session_id: String) -> Result<Value, String> {
    let session = read_release_session_value(&session_id)?;
    let version = session.get("version").and_then(Value::as_str).unwrap_or("").trim().to_string();
    let release_ref = format!("origin/release/v{}", version.trim_start_matches('v'));
    let changes = session_step_result(&session, "configChanges")
        .get("changes")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();

    let mut applied = Vec::new();
    for repo in changes {
        let repo_path = repo.get("repoPath").and_then(Value::as_str).unwrap_or("").to_string();
        let repo_key = repo.get("repoKey").and_then(Value::as_str).unwrap_or("").to_string();
        let files = repo.get("files").and_then(Value::as_array).cloned().unwrap_or_default();
        for file in files {
            if let Some(relative_path) = file.as_str() {
                let content = git_show_file(&repo_path, &release_ref, relative_path)?;
                let absolute_path = PathBuf::from(&repo_path).join(relative_path);
                if let Some(parent) = absolute_path.parent() {
                    fs::create_dir_all(parent)
                        .map_err(|e| format!("Failed to create config parent directory: {}", e))?;
                }
                fs::write(&absolute_path, content)
                    .map_err(|e| format!("Failed to write config file {}: {}", absolute_path.display(), e))?;
                applied.push(json!({
                    "repoKey": repo_key,
                    "path": absolute_path.display().to_string()
                }));
            }
        }
    }

    Ok(json!({
        "ok": true,
        "stepId": "applyConfigChanges",
        "artifacts": [{
            "stepId": "applyConfigChanges",
            "kind": "config-apply",
            "title": "Applied config changes",
            "count": applied.len()
        }],
        "applied": applied,
        "summary": if applied.is_empty() {
            "没有需要写入的配置变更。".to_string()
        } else {
            format!("已将 {} 个配置文件同步到工作区。", applied.len())
        }
    }))
}

#[tauri::command]
pub async fn release_collect_i18n_changes(
    session_id: String,
    version: String,
    repos: Vec<Value>,
) -> Result<Value, String> {
    let release_ref = format!("origin/release/v{}", version.trim_start_matches('v'));
    let mut entries = Vec::new();

    for repo in repos {
        let repo_path = repo_path(&repo);
        if repo_path.is_empty() {
            continue;
        }
        let diff_files = git_diff_name_only(&repo_path, "origin/latest", &release_ref).unwrap_or_default();
        for file in diff_files.into_iter().filter(|file| detect_i18n_file(file)) {
            let release_content = git_show_file(&repo_path, &release_ref, &file).unwrap_or_default();
            let latest_content = git_show_file(&repo_path, "origin/latest", &file).unwrap_or_default();

            let mut rows = Vec::new();
            if file.to_lowercase().ends_with(".json") {
                let release_json = serde_json::from_str::<Value>(&release_content).unwrap_or_else(|_| json!({}));
                let latest_json = serde_json::from_str::<Value>(&latest_content).unwrap_or_else(|_| json!({}));
                let mut release_keys = Vec::new();
                let mut latest_keys = Vec::new();
                flatten_json_keys("", &release_json, &mut release_keys);
                flatten_json_keys("", &latest_json, &mut latest_keys);

                let latest_map = latest_keys.into_iter().collect::<std::collections::HashMap<_, _>>();
                for (key, value) in release_keys {
                    let change_type = match latest_map.get(&key) {
                        None => "added",
                        Some(existing) if existing != &value => "changed",
                        _ => continue,
                    };
                    rows.push(json!({
                        "repoKey": repo_key(&repo),
                        "file": file,
                        "key": key,
                        "changeType": change_type
                    }));
                }
            }

            if rows.is_empty() {
                rows.push(json!({
                    "repoKey": repo_key(&repo),
                    "file": file,
                    "key": file,
                    "changeType": "changed"
                }));
            }

            entries.extend(rows);
        }
    }

    Ok(json!({
        "ok": true,
        "stepId": "i18nChanges",
        "sessionId": session_id,
        "entries": entries,
        "summary": if entries.is_empty() {
            "未发现 i18n 差异。".to_string()
        } else {
            format!("识别到 {} 条 i18n 变更。", entries.len())
        }
    }))
}

#[tauri::command]
pub async fn release_generate_i18n_artifacts(session_id: String) -> Result<Value, String> {
    let session = read_release_session_value(&session_id)?;
    let entries = session_step_result(&session, "i18nChanges")
        .get("entries")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let artifact_dir = release_artifact_dir(&session_id)?;
    let file_path = artifact_dir.join("i18n-changes.csv");

    let mut csv = String::from("repo,file,key,changeType\n");
    for entry in &entries {
        let line = format!(
            "\"{}\",\"{}\",\"{}\",\"{}\"\n",
            entry.get("repoKey").and_then(Value::as_str).unwrap_or(""),
            entry.get("file").and_then(Value::as_str).unwrap_or(""),
            entry.get("key").and_then(Value::as_str).unwrap_or(""),
            entry.get("changeType").and_then(Value::as_str).unwrap_or("")
        );
        csv.push_str(&line);
    }
    fs::write(&file_path, csv).map_err(|e| format!("Failed to write i18n CSV: {}", e))?;

    Ok(json!({
        "ok": true,
        "stepId": "i18nArtifacts",
        "artifacts": [{
            "stepId": "i18nArtifacts",
            "kind": "i18n-csv",
            "path": file_path.display().to_string(),
            "title": "i18n changes CSV"
        }],
        "summary": if entries.is_empty() {
            "未发现 i18n 变更，已生成空白 CSV 占位产物。".to_string()
        } else {
            format!("已生成 i18n CSV 产物，共 {} 条变更。", entries.len())
        }
    }))
}

#[tauri::command]
pub async fn release_generate_readiness_report(session_id: String) -> Result<Value, String> {
    let session = read_release_session_value(&session_id)?;
    let required_steps = vec![
        "credentials",
        "jiraIssues",
        "prStatus",
        "preflight",
        "configChanges",
        "i18nChanges",
        "i18nArtifacts",
    ];
    let blocked = required_steps
        .iter()
        .filter(|step_id| session_step_status(&session, step_id) == "blocked")
        .map(|step_id| step_id.to_string())
        .collect::<Vec<_>>();
    let pending = required_steps
        .iter()
        .filter(|step_id| !["done", "skipped"].contains(&session_step_status(&session, step_id).as_str()))
        .map(|step_id| step_id.to_string())
        .collect::<Vec<_>>();

    let has_config_changes = session_step_result(&session, "configChanges")
        .get("hasChanges")
        .and_then(Value::as_bool)
        .unwrap_or(false);

    let mut pending_approvals = Vec::new();
    if has_config_changes {
        pending_approvals.push(json!({
            "stepId": "applyConfigChanges",
            "action": "apply_config_changes",
            "target": "configuration files"
        }));
    }
    pending_approvals.push(json!({
        "stepId": "mergeLatest",
        "action": "execute_release_merge",
        "target": format!("release/v{} -> latest", session.get("version").and_then(Value::as_str).unwrap_or(""))
    }));

    let ok = blocked.is_empty() && pending.is_empty();
    Ok(json!({
        "ok": ok,
        "stepId": "readinessReport",
        "status": if ok { "ready" } else { "blocked" },
        "blockedSteps": blocked,
        "pendingSteps": pending,
        "pendingApprovals": pending_approvals,
        "summary": if ok {
            "发布检查全部通过，可以申请执行后续危险步骤。"
        } else {
            "仍存在未完成或阻塞的检查步骤。"
        }
    }))
}

#[tauri::command]
pub async fn release_execute_merge(session_id: String) -> Result<Value, String> {
    let session = read_release_session_value(&session_id)?;
    let version = session.get("version").and_then(Value::as_str).unwrap_or("").trim().to_string();
    let release_ref = format!("origin/release/v{}", version.trim_start_matches('v'));
    let repos = session.get("repos").and_then(Value::as_array).cloned().unwrap_or_default();
    let mut results = Vec::new();
    let mut failed = Vec::new();

    for repo in repos {
        let path = repo_path(&repo);
        let key = repo_key(&repo);
        if path.is_empty() {
            continue;
        }
        if !git_status_clean(&path)? {
            failed.push(key.clone());
            results.push(json!({
                "repoKey": key,
                "ok": false,
                "detail": "工作区不干净，拒绝自动合并。"
            }));
            continue;
        }

        let _ = run_git_output(&path, &vec!["fetch".into(), "origin".into(), "--prune".into()]);
        let _ = run_git_output(&path, &vec!["checkout".into(), "-B".into(), "latest".into(), "origin/latest".into()]);
        let merge_output = run_git_output(&path, &vec![
            "merge".into(),
            "--no-ff".into(),
            "--no-edit".into(),
            release_ref.clone(),
        ])?;
        if merge_output.status.success() {
            let sha = run_git_text(&path, &vec!["rev-parse".into(), "HEAD".into()]).unwrap_or_default();
            results.push(json!({
                "repoKey": key,
                "ok": true,
                "sha": sha
            }));
        } else {
            failed.push(key.clone());
            results.push(json!({
                "repoKey": key,
                "ok": false,
                "detail": String::from_utf8_lossy(&merge_output.stderr).trim().to_string()
            }));
        }
    }

    Ok(json!({
        "ok": failed.is_empty(),
        "stepId": "mergeLatest",
        "results": results,
        "summary": if failed.is_empty() {
            "release -> latest 合并已完成。".to_string()
        } else {
            format!("以下仓库合并失败：{}", failed.join("、"))
        }
    }))
}

#[tauri::command]
pub async fn release_execute_post_merge_build(session_id: String) -> Result<Value, String> {
    let session = read_release_session_value(&session_id)?;
    let repos = session.get("repos").and_then(Value::as_array).cloned().unwrap_or_default();
    let mut results = Vec::new();
    let mut failed = Vec::new();

    for repo in repos {
        let path = repo_path(&repo);
        let key = repo_key(&repo);
        if path.is_empty() {
            continue;
        }
        let build_result = run_pnpm_build(path.clone()).await?;
        let ok = build_result.get("success").and_then(Value::as_bool).unwrap_or(false);
        if !ok {
            failed.push(key.clone());
        }
        results.push(json!({
            "repoKey": key,
            "ok": ok,
            "elapsedMs": build_result.get("elapsedMs").cloned().unwrap_or_else(|| json!(0)),
            "stdout": build_result.get("stdout").cloned().unwrap_or_else(|| json!("")),
            "stderr": build_result.get("stderr").cloned().unwrap_or_else(|| json!(""))
        }));
    }

    Ok(json!({
        "ok": failed.is_empty(),
        "stepId": "buildVerification",
        "results": results,
        "summary": if failed.is_empty() {
            "合并后的构建验证全部通过。".to_string()
        } else {
            format!("构建失败仓库：{}", failed.join("、"))
        }
    }))
}

#[tauri::command]
pub async fn release_create_tag(session_id: String) -> Result<Value, String> {
    let session = read_release_session_value(&session_id)?;
    let version = session.get("version").and_then(Value::as_str).unwrap_or("").trim().to_string();
    let tag_name = format!("release/v{}", version.trim_start_matches('v'));
    let repos = session.get("repos").and_then(Value::as_array).cloned().unwrap_or_default();
    let mut results = Vec::new();
    let mut failed = Vec::new();

    for repo in repos {
        let path = repo_path(&repo);
        let key = repo_key(&repo);
        if path.is_empty() {
            continue;
        }
        let exists = run_git_output(&path, &vec![
            "rev-parse".into(),
            "--verify".into(),
            format!("refs/tags/{}", tag_name),
        ])?;
        if exists.status.success() {
            let sha = run_git_text(&path, &vec!["rev-list".into(), "-n".into(), "1".into(), tag_name.clone()]).unwrap_or_default();
            results.push(json!({
                "repoKey": key,
                "ok": true,
                "tag": tag_name,
                "sha": sha,
                "detail": "Tag 已存在"
            }));
            continue;
        }

        let output = run_git_output(&path, &vec!["tag".into(), tag_name.clone()])?;
        if output.status.success() {
            let sha = run_git_text(&path, &vec!["rev-parse".into(), "HEAD".into()]).unwrap_or_default();
            results.push(json!({
                "repoKey": key,
                "ok": true,
                "tag": tag_name,
                "sha": sha
            }));
        } else {
            failed.push(key.clone());
            results.push(json!({
                "repoKey": key,
                "ok": false,
                "detail": String::from_utf8_lossy(&output.stderr).trim().to_string()
            }));
        }
    }

    Ok(json!({
        "ok": failed.is_empty(),
        "stepId": "tagRelease",
        "results": results,
        "summary": if failed.is_empty() {
            format!("已完成 Tag 创建：{}", tag_name)
        } else {
            format!("以下仓库创建 Tag 失败：{}", failed.join("、"))
        }
    }))
}

#[tauri::command]
pub async fn release_generate_confluence_draft(session_id: String) -> Result<Value, String> {
    let session = read_release_session_value(&session_id)?;
    let artifact_dir = release_artifact_dir(&session_id)?;
    let draft_id = format!("draft-{}", timestamp_string());
    let file_path = artifact_dir.join(format!("{}.md", draft_id));
    let version = session.get("version").and_then(Value::as_str).unwrap_or("");
    let status = session.get("status").and_then(Value::as_str).unwrap_or("");
    let repos = session.get("repos").and_then(Value::as_array).cloned().unwrap_or_default();
    let approvals = session.get("approvals").and_then(Value::as_array).cloned().unwrap_or_default();
    let artifacts = session.get("artifacts").and_then(Value::as_array).cloned().unwrap_or_default();

    let mut lines = vec![
        format!("# Release {}", version),
        String::new(),
        format!("- Session: {}", session_id),
        format!("- Status: {}", status),
        format!("- GeneratedAt: {}", timestamp_string()),
        String::new(),
        "## Repositories".to_string(),
    ];
    for repo in repos {
        lines.push(format!(
            "- {}",
            repo.get("repo").and_then(Value::as_str).unwrap_or_else(|| repo.get("key").and_then(Value::as_str).unwrap_or(""))
        ));
    }
    lines.push(String::new());
    lines.push("## Approvals".to_string());
    for approval in approvals {
        lines.push(format!(
            "- {}: {}",
            approval.get("stepId").and_then(Value::as_str).unwrap_or(""),
            approval.get("decision").and_then(Value::as_str).unwrap_or("pending")
        ));
    }
    lines.push(String::new());
    lines.push("## Artifacts".to_string());
    for artifact in artifacts {
        lines.push(format!(
            "- {} {}",
            artifact.get("kind").and_then(Value::as_str).unwrap_or("artifact"),
            artifact.get("path").and_then(Value::as_str).unwrap_or("")
        ));
    }

    fs::write(&file_path, lines.join("\n"))
        .map_err(|e| format!("Failed to write Confluence draft: {}", e))?;

    Ok(json!({
        "ok": true,
        "stepId": "confluenceDraft",
        "draftId": draft_id,
        "artifacts": [{
            "stepId": "confluenceDraft",
            "kind": "confluence-draft",
            "path": file_path.display().to_string(),
            "title": format!("Release {} draft", version)
        }],
        "summary": "已生成运维发布文档草稿。"
    }))
}

#[tauri::command]
pub async fn release_publish_confluence_doc(
    session_id: String,
    draft_id: Option<String>,
) -> Result<Value, String> {
    let artifact_dir = release_artifact_dir(&session_id)?;
    let draft_name = draft_id.unwrap_or_else(|| "latest-draft".to_string());
    let source = artifact_dir.join(format!("{}.md", draft_name));
    let target = artifact_dir.join(format!("published-{}.md", timestamp_string()));

    if source.exists() {
        fs::copy(&source, &target)
            .map_err(|e| format!("Failed to publish Confluence draft locally: {}", e))?;
    } else {
        fs::write(&target, "# Published Release Document\n")
            .map_err(|e| format!("Failed to create published document: {}", e))?;
    }

    Ok(json!({
        "ok": true,
        "stepId": "confluencePublish",
        "artifacts": [{
            "stepId": "confluencePublish",
            "kind": "confluence-published",
            "path": target.display().to_string(),
            "title": "Published release document"
        }],
        "url": format!("file://{}", target.display()),
        "summary": "已发布运维发布文档。"
    }))
}
