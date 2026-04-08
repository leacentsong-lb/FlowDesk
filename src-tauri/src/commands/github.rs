use crate::HttpResponse;

fn github_headers(token: &str) -> Vec<(&str, String)> {
    vec![
        ("Authorization", format!("Bearer {}", token)),
        ("Accept", "application/vnd.github+json".to_string()),
        ("User-Agent", "Dev-Helper-App".to_string()),
        ("X-GitHub-Api-Version", "2022-11-28".to_string()),
    ]
}

#[tauri::command]
pub async fn github_create_draft_pr(
    owner: String,
    repo: String,
    title: String,
    head: String,
    base: String,
    body: String,
    token: String,
) -> Result<HttpResponse, String> {
    let client = reqwest::Client::new();
    let url = format!("https://api.github.com/repos/{}/{}/pulls", owner, repo);

    let payload = serde_json::json!({
        "title": title,
        "head": head,
        "base": base,
        "body": body,
        "draft": true
    });

    let mut req = client.post(&url);
    for (key, val) in github_headers(&token) {
        req = req.header(key, val);
    }

    let response = req
        .json(&payload)
        .send()
        .await
        .map_err(|e| format!("GitHub API request failed: {}", e))?;

    let status = response.status().as_u16();
    let resp_body = response.text().await.map_err(|e| format!("Failed to read GitHub response: {}", e))?;

    Ok(HttpResponse { status, body: resp_body })
}

#[tauri::command]
pub async fn github_list_open_prs(
    owner: String,
    repo: String,
    token: String,
) -> Result<HttpResponse, String> {
    let client = reqwest::Client::new();
    let url = format!(
        "https://api.github.com/repos/{}/{}/pulls?state=open&per_page=50",
        owner, repo
    );

    let mut req = client.get(&url);
    for (key, val) in github_headers(&token) {
        req = req.header(key, val);
    }

    let response = req
        .send()
        .await
        .map_err(|e| format!("GitHub API request failed: {}", e))?;

    let status = response.status().as_u16();
    let resp_body = response.text().await.map_err(|e| format!("Failed to read GitHub response: {}", e))?;

    Ok(HttpResponse { status, body: resp_body })
}

#[tauri::command]
pub async fn github_get_current_user(token: String) -> Result<HttpResponse, String> {
    let client = reqwest::Client::new();

    let mut req = client.get("https://api.github.com/user");
    for (key, val) in github_headers(&token) {
        req = req.header(key, val);
    }

    let response = req
        .send()
        .await
        .map_err(|e| format!("GitHub API request failed: {}", e))?;

    let status = response.status().as_u16();
    let resp_body = response.text().await.map_err(|e| format!("Failed to read GitHub response: {}", e))?;

    Ok(HttpResponse { status, body: resp_body })
}
