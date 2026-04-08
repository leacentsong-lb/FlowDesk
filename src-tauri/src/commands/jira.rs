use base64::Engine;
use crate::HttpResponse;

fn jira_auth_header(email: &str, api_token: &str) -> String {
    let credentials = format!("{}:{}", email, api_token);
    let encoded = base64::engine::general_purpose::STANDARD.encode(credentials.as_bytes());
    format!("Basic {}", encoded)
}

#[tauri::command]
pub async fn jira_get_my_issues(
    domain: String,
    email: String,
    api_token: String,
    project: String,
) -> Result<HttpResponse, String> {
    let client = reqwest::Client::new();

    let projects: Vec<String> = project
        .lines()
        .map(|line| line.trim())
        .filter(|line| !line.is_empty())
        .map(|line| line.to_string())
        .collect();

    let jql = if projects.is_empty() {
        "assignee = currentUser() ORDER BY updated DESC".to_string()
    } else if projects.len() == 1 {
        format!("assignee = currentUser() AND project = {} ORDER BY updated DESC", projects[0])
    } else {
        format!(
            "assignee = currentUser() AND project in ({}) ORDER BY updated DESC",
            projects.join(", ")
        )
    };

    let url = format!(
        "https://{}/rest/api/3/search/jql?jql={}&maxResults=100&fields=*navigable",
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
    let body = response.text().await.map_err(|e| format!("Failed to read Jira response: {}", e))?;

    Ok(HttpResponse { status, body })
}

#[tauri::command]
pub async fn jira_get_projects(
    domain: String,
    email: String,
    api_token: String,
) -> Result<HttpResponse, String> {
    let client = reqwest::Client::new();
    let url = format!("https://{}/rest/api/3/project", domain);

    let response = client
        .get(&url)
        .header("Authorization", jira_auth_header(&email, &api_token))
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|e| format!("Jira request failed: {}", e))?;

    let status = response.status().as_u16();
    let body = response.text().await.map_err(|e| format!("Failed to read Jira response: {}", e))?;

    Ok(HttpResponse { status, body })
}

#[tauri::command]
pub async fn jira_get_issue(
    domain: String,
    email: String,
    api_token: String,
    issue_key: String,
) -> Result<HttpResponse, String> {
    let client = reqwest::Client::new();
    let url = format!(
        "https://{}/rest/api/3/issue/{}?fields=summary,parent,issuetype",
        domain,
        urlencoding::encode(&issue_key)
    );

    let response = client
        .get(&url)
        .header("Authorization", jira_auth_header(&email, &api_token))
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|e| format!("Jira request failed: {}", e))?;

    let status = response.status().as_u16();
    let body = response.text().await.map_err(|e| format!("Failed to read Jira response: {}", e))?;

    Ok(HttpResponse { status, body })
}
