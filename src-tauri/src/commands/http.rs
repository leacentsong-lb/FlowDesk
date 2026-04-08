use std::process::Command;
use crate::HttpResponse;

#[tauri::command]
pub async fn http_post_json(url: String, body: String) -> Result<HttpResponse, String> {
    let client = reqwest::Client::new();

    let response = client
        .post(&url)
        .header("Content-Type", "application/json")
        .header("Accept", "application/json")
        .body(body)
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    let status = response.status().as_u16();
    let response_body = response.text().await.map_err(|e| format!("Failed to read response: {}", e))?;

    Ok(HttpResponse { status, body: response_body })
}

#[tauri::command]
pub fn open_url_raw(url: String) -> Result<String, String> {
    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(&url)
            .spawn()
            .map_err(|e| format!("Failed to open URL: {}", e))?;
    }

    #[cfg(target_os = "windows")]
    {
        Command::new("cmd")
            .args(["/C", "start", "", &url])
            .spawn()
            .map_err(|e| format!("Failed to open URL: {}", e))?;
    }

    #[cfg(target_os = "linux")]
    {
        Command::new("xdg-open")
            .arg(&url)
            .spawn()
            .map_err(|e| format!("Failed to open URL: {}", e))?;
    }

    Ok("URL opened".to_string())
}
