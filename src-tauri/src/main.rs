// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs;
use std::process::Command;
use regex::Regex;
use std::collections::HashMap;
use serde::{Deserialize, Serialize};

// HTTP 响应结构
#[derive(Debug, Serialize, Deserialize)]
pub struct HttpResponse {
    pub status: u16,
    pub body: String,
}

// Admin 登录请求
#[tauri::command]
async fn http_admin_login(url: String, username: String, password: String) -> Result<HttpResponse, String> {
    let client = reqwest::Client::new();
    
    let mut form = HashMap::new();
    form.insert("username", username);
    form.insert("password", password);
    form.insert("language", "en".to_string());
    form.insert("platform", "web".to_string());
    form.insert("url", "http://localhost:1420".to_string());
    
    let response = client
        .post(&url)
        .header("accept", "application/prs.CRM-Back-End.v2+json")
        .header("cache-control", "max-age=0")
        .form(&form)
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;
    
    let status = response.status().as_u16();
    let body = response.text().await.map_err(|e| format!("Failed to read response: {}", e))?;
    
    Ok(HttpResponse { status, body })
}

// 获取用户列表
#[tauri::command]
async fn http_get_user_list(url: String, token: String) -> Result<HttpResponse, String> {
    let client = reqwest::Client::new();
    
    let response = client
        .get(&url)
        .header("accept", "application/prs.CRM-Back-End.v2+json")
        .header("accept-language", "zh-CN,zh;q=0.9")
        .header("cache-control", "max-age=0")
        .header("if-modified-since", "0")
        .header("referer", "http://localhost:8080/")
        .header("user-agent", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36")
        .header("sec-ch-ua", "\"Google Chrome\";v=\"143\", \"Chromium\";v=\"143\", \"Not A(Brand\";v=\"24\"")
        .header("sec-ch-ua-mobile", "?0")
        .header("sec-ch-ua-platform", "\"macOS\"")
        .header("sec-fetch-dest", "empty")
        .header("sec-fetch-mode", "cors")
        .header("sec-fetch-site", "cross-site")
        .header("authorization", format!("Bearer {}", token))
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;
    
    let status = response.status().as_u16();
    let body = response.text().await.map_err(|e| format!("Failed to read response: {}", e))?;
    
    Ok(HttpResponse { status, body })
}

// 获取 Member Token
#[tauri::command]
async fn http_get_member_token(url: String, token: String) -> Result<HttpResponse, String> {
    let client = reqwest::Client::new();
    
    let response = client
        .get(&url)
        .header("accept", "application/prs.CRM-Back-End.v2+json")
        .header("cache-control", "max-age=0")
        .header("authorization", format!("Bearer {}", token))
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;
    
    let status = response.status().as_u16();
    let body = response.text().await.map_err(|e| format!("Failed to read response: {}", e))?;
    
    Ok(HttpResponse { status, body })
}

#[tauri::command]
fn update_member_config(config_path: String, api_url: String) -> Result<String, String> {
    // Read the current config file
    let content = fs::read_to_string(&config_path)
        .map_err(|e| format!("Failed to read config file: {}", e))?;
    
    // Replace VUE_APP_API value using regex
    let re = Regex::new(r#"VUE_APP_API:\s*'[^']*'"#)
        .map_err(|e| format!("Regex error: {}", e))?;
    
    let new_content = re.replace(&content, format!("VUE_APP_API: '{}'", api_url).as_str());
    
    // Write the updated config back
    fs::write(&config_path, new_content.as_ref())
        .map_err(|e| format!("Failed to write config file: {}", e))?;
    
    Ok(format!("Config updated successfully: {}", api_url))
}

#[tauri::command]
fn start_member_dev(project_path: String) -> Result<String, String> {
    // Start pnpm run dev in background
    #[cfg(target_os = "macos")]
    {
        // Close existing Terminal windows with "pnpm run dev" and open new one
        let script = format!(
            r#"
            tell application "Terminal"
                -- Close windows running pnpm dev
                set windowsToClose to {{}}
                repeat with w in windows
                    try
                        if (custom title of w) contains "pnpm" or (name of w) contains "pnpm" then
                            set end of windowsToClose to w
                        else
                            repeat with t in tabs of w
                                if (processes of t) contains "node" or (custom title of t) contains "pnpm" then
                                    set end of windowsToClose to w
                                    exit repeat
                                end if
                            end repeat
                        end if
                    end try
                end repeat
                repeat with w in windowsToClose
                    try
                        close w
                    end try
                end repeat
                -- Start new dev server
                do script "cd '{}' && pnpm run dev"
            end tell
            "#,
            project_path
        );
        
        Command::new("osascript")
            .args(["-e", &script])
            .spawn()
            .map_err(|e| format!("Failed to start dev server: {}", e))?;
    }
    
    #[cfg(target_os = "windows")]
    {
        Command::new("cmd")
            .args(["/C", "start", "cmd", "/K", &format!("cd /d \"{}\" && pnpm run dev", project_path)])
            .spawn()
            .map_err(|e| format!("Failed to start dev server: {}", e))?;
    }
    
    #[cfg(target_os = "linux")]
    {
        Command::new("x-terminal-emulator")
            .args(["-e", &format!("bash -c 'cd \"{}\" && pnpm run dev; exec bash'", project_path)])
            .spawn()
            .map_err(|e| format!("Failed to start dev server: {}", e))?;
    }
    
    Ok("Dev server starting...".to_string())
}

#[tauri::command]
fn stop_service_by_port(port: u16) -> Result<String, String> {
    #[cfg(target_os = "macos")]
    {
        // Find and kill process on the port
        let output = Command::new("lsof")
            .args(["-ti", &format!(":{}", port)])
            .output()
            .map_err(|e| format!("Failed to find process: {}", e))?;
        
        let pids = String::from_utf8_lossy(&output.stdout);
        if pids.trim().is_empty() {
            return Ok(format!("No process found on port {}", port));
        }
        
        for pid in pids.trim().lines() {
            Command::new("kill")
                .args(["-9", pid.trim()])
                .output()
                .map_err(|e| format!("Failed to kill process {}: {}", pid, e))?;
        }
        
        Ok(format!("Stopped service on port {}", port))
    }
    
    #[cfg(target_os = "windows")]
    {
        Command::new("cmd")
            .args(["/C", &format!("for /f \"tokens=5\" %a in ('netstat -aon ^| find \"{}\" ^| find \"LISTENING\"') do taskkill /F /PID %a", port)])
            .output()
            .map_err(|e| format!("Failed to stop service: {}", e))?;
        
        Ok(format!("Stopped service on port {}", port))
    }
    
    #[cfg(target_os = "linux")]
    {
        Command::new("fuser")
            .args(["-k", &format!("{}/tcp", port)])
            .output()
            .map_err(|e| format!("Failed to stop service: {}", e))?;
        
        Ok(format!("Stopped service on port {}", port))
    }
}

// 使用系统命令打开 URL，避免 Tauri open() 的编码问题
#[tauri::command]
fn open_url_raw(url: String) -> Result<String, String> {
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

#[tauri::command]
fn check_port_in_use(port: u16) -> Result<bool, String> {
    #[cfg(target_os = "macos")]
    {
        let output = Command::new("lsof")
            .args(["-ti", &format!(":{}", port)])
            .output()
            .map_err(|e| format!("Failed to check port: {}", e))?;
        
        Ok(!output.stdout.is_empty())
    }
    
    #[cfg(target_os = "windows")]
    {
        let output = Command::new("netstat")
            .args(["-an"])
            .output()
            .map_err(|e| format!("Failed to check port: {}", e))?;
        
        let output_str = String::from_utf8_lossy(&output.stdout);
        Ok(output_str.contains(&format!(":{}", port)))
    }
    
    #[cfg(target_os = "linux")]
    {
        let output = Command::new("ss")
            .args(["-tuln"])
            .output()
            .map_err(|e| format!("Failed to check port: {}", e))?;
        
        let output_str = String::from_utf8_lossy(&output.stdout);
        Ok(output_str.contains(&format!(":{}", port)))
    }
}

// ============================================
// Jira API Commands
// ============================================

// 获取分配给当前用户的 Jira 任务 (使用新的 /rest/api/3/search/jql 端点)
#[tauri::command]
async fn jira_get_my_issues(domain: String, email: String, api_token: String, _project: String) -> Result<HttpResponse, String> {
    use base64::Engine;
    
    let client = reqwest::Client::new();
    
    // JQL: 获取所有分配给当前用户的任务（不限状态）
    let jql = "assignee = currentUser() ORDER BY updated DESC";
    
    // 新 API 使用 GET 方法，参数放在 URL 中
    // 添加 parent 字段获取父任务/Epic 信息
    let url = format!(
        "https://{}/rest/api/3/search/jql?jql={}&maxResults=100&fields=summary,status,issuetype,priority,project,created,updated,parent,duedate",
        domain,
        urlencoding::encode(jql)
    );
    
    // Jira Cloud 使用 Basic Auth: email:api_token
    let credentials = format!("{}:{}", email, api_token);
    let auth = base64::engine::general_purpose::STANDARD.encode(credentials.as_bytes());
    
    let response = client
        .get(&url)
        .header("Authorization", format!("Basic {}", auth))
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|e| format!("Jira request failed: {}", e))?;
    
    let status = response.status().as_u16();
    let body = response.text().await.map_err(|e| format!("Failed to read Jira response: {}", e))?;
    
    Ok(HttpResponse { status, body })
}

// 获取 Jira 项目列表（用于测试连接）
#[tauri::command]
async fn jira_get_projects(domain: String, email: String, api_token: String) -> Result<HttpResponse, String> {
    use base64::Engine;
    
    let client = reqwest::Client::new();
    let url = format!("https://{}/rest/api/3/project", domain);
    
    // Jira Cloud 使用 Basic Auth: email:api_token
    let credentials = format!("{}:{}", email, api_token);
    let auth = base64::engine::general_purpose::STANDARD.encode(credentials.as_bytes());
    
    let response = client
        .get(&url)
        .header("Authorization", format!("Basic {}", auth))
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|e| format!("Jira request failed: {}", e))?;
    
    let status = response.status().as_u16();
    let body = response.text().await.map_err(|e| format!("Failed to read Jira response: {}", e))?;
    
    Ok(HttpResponse { status, body })
}

// ============================================
// Git Commands
// ============================================

// 在后台线程执行 git 命令，避免阻塞 Tauri 主线程
async fn run_git(project_path: String, args: Vec<String>) -> Result<(bool, String, String), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let output = Command::new("git")
            .args(args)
            .current_dir(&project_path)
            .output()
            .map_err(|e| format!("Git command failed: {}", e))?;

        let stdout = String::from_utf8_lossy(&output.stdout).to_string();
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        Ok((output.status.success(), stdout, stderr))
    })
    .await
    .map_err(|e| format!("Git task join failed: {}", e))?
}

// 列出项目的所有分支
#[tauri::command]
async fn git_list_branches(project_path: String) -> Result<Vec<String>, String> {
    let (ok, stdout, stderr) = run_git(project_path, vec!["branch".into(), "-a".into()]).await?;

    if !ok {
        return Err(stderr);
    }

    let branches: Vec<String> = stdout
        .lines()
        .map(|line| line.trim().trim_start_matches("* ").to_string())
        .filter(|b| !b.contains("HEAD"))
        .collect();
    
    Ok(branches)
}

// 获取当前分支
#[tauri::command]
async fn git_current_branch(project_path: String) -> Result<String, String> {
    let (ok, stdout, stderr) = run_git(project_path, vec!["branch".into(), "--show-current".into()]).await?;

    if !ok {
        return Err(stderr);
    }

    Ok(stdout.trim().to_string())
}

// 检查工作区状态（安全检查）
#[tauri::command]
async fn git_check_working_tree(project_path: String) -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        // 1. 检查是否有未暂存的修改
        let status = Command::new("git")
            .args(["status", "--porcelain"])
            .current_dir(&project_path)
            .output()
            .map_err(|e| format!("Failed to check status: {}", e))?;

        let status_output = String::from_utf8_lossy(&status.stdout).to_string();
        let has_changes = !status_output.trim().is_empty();

        // 解析状态
        let mut staged_files: Vec<String> = Vec::new();
        let mut unstaged_files: Vec<String> = Vec::new();
        let mut untracked_files: Vec<String> = Vec::new();

        for line in status_output.lines() {
            if line.len() < 3 { continue; }
            let index_status = line.chars().nth(0).unwrap_or(' ');
            let worktree_status = line.chars().nth(1).unwrap_or(' ');
            let filename = line[3..].to_string();

            // 索引状态 (staged)
            if index_status != ' ' && index_status != '?' {
                staged_files.push(filename.clone());
            }
            // 工作区状态 (unstaged)
            if worktree_status != ' ' && worktree_status != '?' {
                unstaged_files.push(filename.clone());
            }
            // 未跟踪文件
            if index_status == '?' && worktree_status == '?' {
                untracked_files.push(filename);
            }
        }

        // 2. 获取当前分支
        let current_branch = Command::new("git")
            .args(["branch", "--show-current"])
            .current_dir(&project_path)
            .output()
            .map_err(|e| format!("Failed to get current branch: {}", e))?;

        let current_branch_name = String::from_utf8_lossy(&current_branch.stdout).trim().to_string();

        // 3. 检查是否有未推送的提交
        let unpushed = Command::new("git")
            .args(["log", "@{u}..", "--oneline"])
            .current_dir(&project_path)
            .output();

        let has_unpushed = match unpushed {
            Ok(output) => !String::from_utf8_lossy(&output.stdout).trim().is_empty(),
            Err(_) => false // 可能没有上游分支，忽略
        };

        Ok(serde_json::json!({
            "clean": !has_changes,
            "currentBranch": current_branch_name,
            "stagedFiles": staged_files,
            "unstagedFiles": unstaged_files,
            "untrackedFiles": untracked_files,
            "hasUnpushedCommits": has_unpushed,
            "summary": if has_changes {
                format!("{} staged, {} unstaged, {} untracked",
                    staged_files.len(), unstaged_files.len(), untracked_files.len())
            } else {
                "Working tree clean".to_string()
            }
        }))
    })
    .await
    .map_err(|e| format!("Git task join failed: {}", e))?
}

// 检查分支是否已存在
#[tauri::command]
async fn git_branch_exists(project_path: String, branch_name: String) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || {
        // 检查本地分支
        let local = Command::new("git")
            .args(["branch", "--list", &branch_name])
            .current_dir(&project_path)
            .output()
            .map_err(|e| format!("Failed to check local branch: {}", e))?;

        if !String::from_utf8_lossy(&local.stdout).trim().is_empty() {
            return Ok(true);
        }

        // 检查远程分支
        let remote = Command::new("git")
            .args(["branch", "-r", "--list", &format!("origin/{}", branch_name)])
            .current_dir(&project_path)
            .output()
            .map_err(|e| format!("Failed to check remote branch: {}", e))?;

        Ok(!String::from_utf8_lossy(&remote.stdout).trim().is_empty())
    })
    .await
    .map_err(|e| format!("Git task join failed: {}", e))?
}

// 创建并切换到新分支（带安全检查）
#[tauri::command]
async fn git_create_branch(project_path: String, base_branch: String, new_branch: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
    // ============================================
    // 安全检查 1: 检查工作区是否干净
    // ============================================
    let status = Command::new("git")
        .args(["status", "--porcelain"])
        .current_dir(&project_path)
        .output()
        .map_err(|e| format!("安全检查失败: {}", e))?;
    
    let status_output = String::from_utf8_lossy(&status.stdout).to_string();
    if !status_output.trim().is_empty() {
        // 解析修改的文件
        let modified_files: Vec<&str> = status_output.lines()
            .filter(|line| !line.starts_with("??")) // 排除未跟踪文件
            .take(5) // 只显示前5个
            .collect();
        
        let file_list = if modified_files.is_empty() {
            "有未跟踪的新文件".to_string()
        } else {
            modified_files.iter()
                .map(|f| f.get(3..).unwrap_or(f))
                .collect::<Vec<_>>()
                .join(", ")
        };
        
        return Err(format!(
            "⚠️ 工作区有未提交的更改，为防止代码丢失，请先处理:\n\n修改的文件: {}\n\n建议操作:\n1. git stash (暂存更改)\n2. git commit (提交更改)\n3. git checkout . (放弃更改，谨慎使用)", 
            file_list
        ));
    }
    
    // ============================================
    // 安全检查 2: 检查新分支是否已存在
    // ============================================
    let local_branch = Command::new("git")
        .args(["branch", "--list", &new_branch])
        .current_dir(&project_path)
        .output()
        .map_err(|e| format!("检查本地分支失败: {}", e))?;
    
    if !String::from_utf8_lossy(&local_branch.stdout).trim().is_empty() {
        return Err(format!(
            "⚠️ 本地分支 '{}' 已存在!\n\n建议操作:\n1. 如果是之前创建的，使用 git checkout {} 切换\n2. 如果要重新创建，先删除: git branch -d {}", 
            new_branch, new_branch, new_branch
        ));
    }
    
    let remote_branch = Command::new("git")
        .args(["branch", "-r", "--list", &format!("origin/{}", new_branch)])
        .current_dir(&project_path)
        .output()
        .map_err(|e| format!("检查远程分支失败: {}", e))?;
    
    if !String::from_utf8_lossy(&remote_branch.stdout).trim().is_empty() {
        return Err(format!(
            "⚠️ 远程分支 'origin/{}' 已存在!\n\n建议操作:\n1. 拉取远程分支: git checkout {}\n2. 或者使用其他分支名称", 
            new_branch, new_branch
        ));
    }
    
    // ============================================
    // 安全检查 3: 确保 base 分支存在
    // ============================================
    let base_exists = Command::new("git")
        .args(["rev-parse", "--verify", &format!("origin/{}", base_branch)])
        .current_dir(&project_path)
        .output();
    
    let base_branch_ref = match base_exists {
        Ok(output) if output.status.success() => format!("origin/{}", base_branch),
        _ => {
            // 尝试本地分支
            let local_base = Command::new("git")
                .args(["rev-parse", "--verify", &base_branch])
                .current_dir(&project_path)
                .output();
            
            match local_base {
                Ok(output) if output.status.success() => base_branch.clone(),
                _ => return Err(format!(
                    "⚠️ Base 分支 '{}' 不存在!\n\n请选择一个有效的分支", 
                    base_branch
                ))
            }
        }
    };
    
    // ============================================
    // 开始创建分支（不使用任何 --force 操作）
    // ============================================
    
    // 1. Fetch latest (安全操作，只拉取不覆盖)
    let fetch = Command::new("git")
        .args(["fetch", "origin"])
        .current_dir(&project_path)
        .output()
        .map_err(|e| format!("Fetch 失败: {}", e))?;
    
    if !fetch.status.success() {
        return Err(format!("Fetch 失败: {}", String::from_utf8_lossy(&fetch.stderr)));
    }
    
    // 2. 基于远程分支创建新分支（不需要先 checkout base）
    // 这样更安全，避免在 checkout 过程中出问题
    let create = Command::new("git")
        .args(["checkout", "-b", &new_branch, &base_branch_ref])
        .current_dir(&project_path)
        .output()
        .map_err(|e| format!("创建分支失败: {}", e))?;
    
    if !create.status.success() {
        let error_msg = String::from_utf8_lossy(&create.stderr).to_string();
        
        // 解析常见错误
        if error_msg.contains("already exists") {
            return Err(format!("⚠️ 分支 '{}' 已存在", new_branch));
        }
        if error_msg.contains("not a valid ref") {
            return Err(format!("⚠️ Base 分支 '{}' 无效", base_branch));
        }
        
        return Err(format!("创建分支失败: {}", error_msg));
    }
    
    Ok(format!("✅ 已创建并切换到分支: {}", new_branch))
    })
    .await
    .map_err(|e| format!("Git task join failed: {}", e))?
}

// 推送分支到远程
#[tauri::command]
async fn git_push_branch(project_path: String, branch: String) -> Result<String, String> {
    let (ok, _stdout, stderr) = run_git(
        project_path,
        vec!["push".into(), "-u".into(), "origin".into(), branch.clone()],
    )
    .await?;

    if !ok {
        return Err(format!("Push failed: {}", stderr));
    }

    Ok(format!("Pushed branch: {}", branch))
}

// Git Fetch 获取远程更新
#[tauri::command]
async fn git_fetch(project_path: String) -> Result<String, String> {
    let (ok, _stdout, stderr) =
        run_git(project_path, vec!["fetch".into(), "origin".into(), "--prune".into()]).await?;

    if !ok {
        return Err(format!("Fetch failed: {}", stderr));
    }

    Ok("Fetch completed".to_string())
}

// 检查分支与远程的差异 (behind/ahead)
#[tauri::command]
async fn git_check_behind_ahead(project_path: String, branch: String) -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        // 确保有最新的远程信息
        let _ = Command::new("git")
            .args(["fetch", "origin", &branch])
            .current_dir(&project_path)
            .output();

        // 获取本地分支的 commit
        let local_rev = Command::new("git")
            .args(["rev-parse", &branch])
            .current_dir(&project_path)
            .output();

        let local_commit = match local_rev {
            Ok(output) if output.status.success() => {
                String::from_utf8_lossy(&output.stdout).trim().to_string()
            },
            _ => return Ok(serde_json::json!({
                "behind": 0,
                "ahead": 0,
                "error": "Local branch not found"
            }))
        };

        // 获取远程分支的 commit
        let remote_rev = Command::new("git")
            .args(["rev-parse", &format!("origin/{}", branch)])
            .current_dir(&project_path)
            .output();

        let remote_commit = match remote_rev {
            Ok(output) if output.status.success() => {
                String::from_utf8_lossy(&output.stdout).trim().to_string()
            },
            _ => return Ok(serde_json::json!({
                "behind": 0,
                "ahead": 0,
                "error": "Remote branch not found"
            }))
        };

        // 如果 commit 相同，没有差异
        if local_commit == remote_commit {
            return Ok(serde_json::json!({
                "behind": 0,
                "ahead": 0,
                "synced": true
            }));
        }

        // 计算 behind (远程有多少提交本地没有)
        let behind_output = Command::new("git")
            .args(["rev-list", "--count", &format!("{}..origin/{}", branch, branch)])
            .current_dir(&project_path)
            .output();

        let behind: u32 = match behind_output {
            Ok(output) if output.status.success() => {
                String::from_utf8_lossy(&output.stdout).trim().parse().unwrap_or(0)
            },
            _ => 0
        };

        // 计算 ahead (本地有多少提交远程没有)
        let ahead_output = Command::new("git")
            .args(["rev-list", "--count", &format!("origin/{}..{}", branch, branch)])
            .current_dir(&project_path)
            .output();

        let ahead: u32 = match ahead_output {
            Ok(output) if output.status.success() => {
                String::from_utf8_lossy(&output.stdout).trim().parse().unwrap_or(0)
            },
            _ => 0
        };

        Ok(serde_json::json!({
            "behind": behind,
            "ahead": ahead,
            "synced": behind == 0 && ahead == 0
        }))
    })
    .await
    .map_err(|e| format!("Git task join failed: {}", e))?
}

// 执行 Merge 操作（带安全检查）
#[tauri::command]
async fn git_merge_branch(project_path: String, source_branch: String, target_branch: String) -> Result<serde_json::Value, String> {
    // ============================================
    // 安全检查 1: 检查工作区是否干净
    // ============================================
    let (status_ok, status_stdout, status_stderr) = run_git(project_path.clone(), vec!["status".into(), "--porcelain".into()]).await?;
    
    if !status_ok {
        return Err(format!("安全检查失败: {}", status_stderr));
    }

    let status_output = status_stdout;
    if !status_output.trim().is_empty() {
        return Err("⚠️ 工作区有未提交的更改，请先提交或暂存后再执行 merge".to_string());
    }
    
    // ============================================
    // 安全检查 2: 获取当前分支
    // ============================================
    let (_ok, cur_stdout, cur_stderr) = run_git(project_path.clone(), vec!["branch".into(), "--show-current".into()]).await?;
    let current_branch = cur_stdout.trim().to_string();
    let _ = cur_stderr;
    
    // ============================================
    // Step 1: Fetch latest
    // ============================================
    let _ = run_git(project_path.clone(), vec!["fetch".into(), "origin".into()]).await;
    
    // ============================================
    // Step 2: Checkout target branch
    // ============================================
    let (co_ok, _co_stdout, co_stderr) = run_git(project_path.clone(), vec!["checkout".into(), target_branch.clone()]).await?;
    if !co_ok {
        return Err(format!("切换到 {} 失败: {}", target_branch, co_stderr));
    }
    
    // ============================================
    // Step 3: Pull latest target branch
    // ============================================
    let _ = run_git(project_path.clone(), vec!["pull".into(), "origin".into(), target_branch.clone()]).await;
    
    // 忽略 pull 错误，可能是新分支
    
    // ============================================
    // Step 4: Merge source branch
    // ============================================
    let (m_ok, m_stdout, m_stderr) = run_git(project_path.clone(), vec![
        "merge".into(),
        format!("origin/{}", source_branch),
        "--no-edit".into(),
    ]).await?;

    let merge_output = m_stdout;
    let merge_stderr = m_stderr;

    if !m_ok {
        // 检查是否有冲突
        if merge_stderr.contains("CONFLICT") || merge_output.contains("CONFLICT") {
            // 回滚 merge
            let _ = run_git(project_path.clone(), vec!["merge".into(), "--abort".into()]).await;
            
            // 切换回原来的分支
            let _ = run_git(project_path.clone(), vec!["checkout".into(), current_branch.clone()]).await;
            
            return Ok(serde_json::json!({
                "success": false,
                "conflict": true,
                "message": "Merge 有冲突，已自动回滚。请手动解决冲突后重试。",
                "currentBranch": current_branch
            }));
        }
        
        // 其他错误，切换回原分支
        let _ = run_git(project_path.clone(), vec!["checkout".into(), current_branch.clone()]).await;
        
        return Err(format!("Merge 失败: {}", merge_stderr));
    }
    
    Ok(serde_json::json!({
        "success": true,
        "conflict": false,
        "message": format!("✅ 成功将 {} merge 到 {}", source_branch, target_branch),
        "currentBranch": target_branch
    }))
}

// 获取最近的提交记录
#[tauri::command]
async fn git_get_recent_commits(project_path: String, count: u32) -> Result<serde_json::Value, String> {
    let (ok, stdout, stderr) = run_git(
        project_path,
        vec![
            "log".into(),
            format!("-{}", count),
            "--pretty=format:%H|%s|%an|%ar|%ai".into(),
            "--no-merges".into(),
        ],
    )
    .await?;

    if !ok {
        return Err(stderr);
    }

    let commits: Vec<serde_json::Value> = stdout
        .lines()
        .filter(|line| !line.is_empty())
        .map(|line| {
            let parts: Vec<&str> = line.split('|').collect();
            serde_json::json!({
                "hash": parts.get(0).unwrap_or(&""),
                "message": parts.get(1).unwrap_or(&""),
                "author": parts.get(2).unwrap_or(&""),
                "relativeTime": parts.get(3).unwrap_or(&""),
                "date": parts.get(4).unwrap_or(&"")
            })
        })
        .collect();
    
    Ok(serde_json::json!({
        "commits": commits
    }))
}

// 获取全局 Git 用户信息（用于 PR “指派给我” 的兜底匹配）
#[tauri::command]
async fn git_get_global_user() -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let name_out = Command::new("git")
            .args(["config", "--global", "user.name"])
            .output()
            .map_err(|e| format!("获取 git user.name 失败: {}", e))?;

        let email_out = Command::new("git")
            .args(["config", "--global", "user.email"])
            .output()
            .map_err(|e| format!("获取 git user.email 失败: {}", e))?;

        let name = if name_out.status.success() {
            String::from_utf8_lossy(&name_out.stdout).trim().to_string()
        } else {
            "".to_string()
        };

        let email = if email_out.status.success() {
            String::from_utf8_lossy(&email_out.stdout).trim().to_string()
        } else {
            "".to_string()
        };

        Ok(serde_json::json!({ "name": name, "email": email }))
    })
    .await
    .map_err(|e| format!("Git task join failed: {}", e))?
}

// 切换分支（带安全检查，不允许在有未提交改动时切换）
#[tauri::command]
async fn git_checkout_branch(project_path: String, branch: String) -> Result<String, String> {
    // 安全检查：工作区必须干净
    let (ok, stdout, stderr) = run_git(project_path.clone(), vec!["status".into(), "--porcelain".into()]).await?;
    if !ok {
        return Err(format!("安全检查失败: {}", stderr));
    }
    if !stdout.trim().is_empty() {
        return Err("⚠️ 工作区有未提交的更改，请先提交或暂存后再切换分支".to_string());
    }

    // 先尝试直接 checkout（本地分支）
    let (co_ok, _co_stdout, _co_stderr) = run_git(project_path.clone(), vec!["checkout".into(), branch.clone()]).await?;
    if co_ok {
        return Ok(format!("✅ 已切换到分支: {}", branch));
    }

    // 如果本地不存在，尝试基于远程创建跟踪分支
    let (trk_ok, _trk_stdout, trk_stderr) = run_git(
        project_path,
        vec!["checkout".into(), "-t".into(), format!("origin/{}", branch)],
    )
    .await?;

    if !trk_ok {
        return Err(format!(
            "切换分支失败: {}",
            trk_stderr
        ));
    }

    Ok(format!("✅ 已拉取并切换到分支: {}", branch))
}

// 拉取当前分支最新远程更新（带安全检查）
#[tauri::command]
async fn git_pull_branch(project_path: String, branch: String) -> Result<String, String> {
    // 安全检查：工作区必须干净
    let (ok, stdout, stderr) = run_git(project_path.clone(), vec!["status".into(), "--porcelain".into()]).await?;
    if !ok {
        return Err(format!("安全检查失败: {}", stderr));
    }
    if !stdout.trim().is_empty() {
        return Err("⚠️ 工作区有未提交的更改，请先提交或暂存后再执行 pull".to_string());
    }

    // Fetch 先更新远程引用
    let _ = run_git(project_path.clone(), vec!["fetch".into(), "origin".into()]).await;

    // 确保在目标分支上
    let (co_ok, _co_stdout, co_stderr) = run_git(project_path.clone(), vec!["checkout".into(), branch.clone()]).await?;
    if !co_ok {
        return Err(format!("切换到 {} 失败: {}", branch, co_stderr));
    }

    // Pull（不做任何 force 行为）
    let (p_ok, _p_stdout, p_stderr) = run_git(project_path, vec!["pull".into(), "origin".into(), branch.clone()]).await?;
    if !p_ok {
        return Err(format!("Pull 失败: {}", p_stderr));
    }

    Ok(format!("✅ 已拉取最新代码: {}", branch))
}

// 获取远程仓库信息 (owner/repo)
#[tauri::command]
async fn git_get_remote_info(project_path: String) -> Result<String, String> {
    let (ok, stdout, stderr) = run_git(project_path, vec!["remote".into(), "get-url".into(), "origin".into()]).await?;
    if !ok {
        return Err(stderr);
    }
    let url = stdout.trim().to_string();
    
    // Parse GitHub URL: git@github.com:owner/repo.git or https://github.com/owner/repo.git
    let repo_info = if url.starts_with("git@") {
        url.trim_start_matches("git@github.com:")
            .trim_end_matches(".git")
            .to_string()
    } else {
        url.trim_start_matches("https://github.com/")
            .trim_end_matches(".git")
            .to_string()
    };
    
    Ok(repo_info)
}

// ============================================
// GitHub API Commands
// ============================================

// 创建 Draft PR
#[tauri::command]
async fn github_create_draft_pr(
    owner: String,
    repo: String,
    title: String,
    head: String,
    base: String,
    body: String,
    token: String
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
    
    let response = client
        .post(&url)
        .header("Authorization", format!("Bearer {}", token))
        .header("Accept", "application/vnd.github+json")
        .header("User-Agent", "Dev-Helper-App")
        .header("X-GitHub-Api-Version", "2022-11-28")
        .json(&payload)
        .send()
        .await
        .map_err(|e| format!("GitHub API request failed: {}", e))?;
    
    let status = response.status().as_u16();
    let resp_body = response.text().await.map_err(|e| format!("Failed to read GitHub response: {}", e))?;
    
    Ok(HttpResponse { status, body: resp_body })
}

// 获取仓库的 Open PRs
#[tauri::command]
async fn github_list_open_prs(owner: String, repo: String, token: String) -> Result<HttpResponse, String> {
    let client = reqwest::Client::new();
    
    let url = format!(
        "https://api.github.com/repos/{}/{}/pulls?state=open&per_page=50",
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
    let resp_body = response.text().await.map_err(|e| format!("Failed to read GitHub response: {}", e))?;
    
    Ok(HttpResponse { status, body: resp_body })
}

// 获取当前 GitHub 用户信息
#[tauri::command]
async fn github_get_current_user(token: String) -> Result<HttpResponse, String> {
    let client = reqwest::Client::new();
    
    let response = client
        .get("https://api.github.com/user")
        .header("Authorization", format!("Bearer {}", token))
        .header("Accept", "application/vnd.github+json")
        .header("User-Agent", "Dev-Helper-App")
        .header("X-GitHub-Api-Version", "2022-11-28")
        .send()
        .await
        .map_err(|e| format!("GitHub API request failed: {}", e))?;
    
    let status = response.status().as_u16();
    let resp_body = response.text().await.map_err(|e| format!("Failed to read GitHub response: {}", e))?;
    
    Ok(HttpResponse { status, body: resp_body })
}

// ============================================
// RSS Feed Commands
// ============================================

// 获取 RSS Feed
#[tauri::command]
async fn fetch_rss_feed(url: String) -> Result<HttpResponse, String> {
    let client = reqwest::Client::new();
    
    let response = client
        .get(&url)
        .header("User-Agent", "Dev-Helper-App")
        .send()
        .await
        .map_err(|e| format!("RSS fetch failed: {}", e))?;
    
    let status = response.status().as_u16();
    let body = response.text().await.map_err(|e| format!("Failed to read RSS: {}", e))?;
    
    Ok(HttpResponse { status, body })
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            update_member_config, 
            start_member_dev,
            stop_service_by_port,
            check_port_in_use,
            open_url_raw,
            http_admin_login,
            http_get_user_list,
            http_get_member_token,
            // Jira
            jira_get_my_issues,
            jira_get_projects,
            // Git
            git_list_branches,
            git_current_branch,
            git_check_working_tree,
            git_branch_exists,
            git_create_branch,
            git_push_branch,
            git_get_remote_info,
            git_fetch,
            git_check_behind_ahead,
            git_merge_branch,
            git_get_recent_commits,
            git_get_global_user,
            git_checkout_branch,
            git_pull_branch,
            // GitHub
            github_create_draft_pr,
            github_list_open_prs,
            github_get_current_user,
            // RSS
            fetch_rss_feed
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
