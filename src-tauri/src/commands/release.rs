use std::process::Command;
use crate::HttpResponse;
use base64::Engine;

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
