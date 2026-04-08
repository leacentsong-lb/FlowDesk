use std::process::Command;

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

#[tauri::command]
pub async fn git_list_branches(project_path: String) -> Result<Vec<String>, String> {
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

#[tauri::command]
pub async fn git_check_working_tree(project_path: String) -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let status = Command::new("git")
            .args(["status", "--porcelain"])
            .current_dir(&project_path)
            .output()
            .map_err(|e| format!("Failed to check status: {}", e))?;

        let status_output = String::from_utf8_lossy(&status.stdout).to_string();
        let has_changes = !status_output.trim().is_empty();

        let mut staged_files: Vec<String> = Vec::new();
        let mut unstaged_files: Vec<String> = Vec::new();
        let mut untracked_files: Vec<String> = Vec::new();

        for line in status_output.lines() {
            if line.len() < 3 { continue; }
            let index_status = line.chars().nth(0).unwrap_or(' ');
            let worktree_status = line.chars().nth(1).unwrap_or(' ');
            let filename = line[3..].to_string();

            if index_status != ' ' && index_status != '?' {
                staged_files.push(filename.clone());
            }
            if worktree_status != ' ' && worktree_status != '?' {
                unstaged_files.push(filename.clone());
            }
            if index_status == '?' && worktree_status == '?' {
                untracked_files.push(filename);
            }
        }

        let current_branch = Command::new("git")
            .args(["branch", "--show-current"])
            .current_dir(&project_path)
            .output()
            .map_err(|e| format!("Failed to get current branch: {}", e))?;

        let current_branch_name = String::from_utf8_lossy(&current_branch.stdout).trim().to_string();

        let unpushed = Command::new("git")
            .args(["log", "@{u}..", "--oneline"])
            .current_dir(&project_path)
            .output();

        let has_unpushed = match unpushed {
            Ok(output) => !String::from_utf8_lossy(&output.stdout).trim().is_empty(),
            Err(_) => false
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

#[tauri::command]
pub async fn git_branch_exists(project_path: String, branch_name: String) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let local = Command::new("git")
            .args(["branch", "--list", &branch_name])
            .current_dir(&project_path)
            .output()
            .map_err(|e| format!("Failed to check local branch: {}", e))?;

        if !String::from_utf8_lossy(&local.stdout).trim().is_empty() {
            return Ok(true);
        }

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

#[tauri::command]
pub async fn git_create_branch(
    project_path: String,
    base_branch: String,
    new_branch: String,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let status = Command::new("git")
            .args(["status", "--porcelain"])
            .current_dir(&project_path)
            .output()
            .map_err(|e| format!("安全检查失败: {}", e))?;

        let status_output = String::from_utf8_lossy(&status.stdout).to_string();
        if !status_output.trim().is_empty() {
            let modified_files: Vec<&str> = status_output.lines()
                .filter(|line| !line.starts_with("??"))
                .take(5)
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
                "⚠️ 工作区有未提交的更改:\n修改的文件: {}\n建议: git stash / git commit / git checkout .",
                file_list
            ));
        }

        let local_branch = Command::new("git")
            .args(["branch", "--list", &new_branch])
            .current_dir(&project_path)
            .output()
            .map_err(|e| format!("检查本地分支失败: {}", e))?;

        if !String::from_utf8_lossy(&local_branch.stdout).trim().is_empty() {
            return Err(format!("⚠️ 本地分支 '{}' 已存在", new_branch));
        }

        let remote_branch = Command::new("git")
            .args(["branch", "-r", "--list", &format!("origin/{}", new_branch)])
            .current_dir(&project_path)
            .output()
            .map_err(|e| format!("检查远程分支失败: {}", e))?;

        if !String::from_utf8_lossy(&remote_branch.stdout).trim().is_empty() {
            return Err(format!("⚠️ 远程分支 'origin/{}' 已存在", new_branch));
        }

        let base_exists = Command::new("git")
            .args(["rev-parse", "--verify", &format!("origin/{}", base_branch)])
            .current_dir(&project_path)
            .output();

        let base_branch_ref = match base_exists {
            Ok(output) if output.status.success() => format!("origin/{}", base_branch),
            _ => {
                let local_base = Command::new("git")
                    .args(["rev-parse", "--verify", &base_branch])
                    .current_dir(&project_path)
                    .output();

                match local_base {
                    Ok(output) if output.status.success() => base_branch.clone(),
                    _ => return Err(format!("⚠️ Base 分支 '{}' 不存在", base_branch))
                }
            }
        };

        let fetch = Command::new("git")
            .args(["fetch", "origin"])
            .current_dir(&project_path)
            .output()
            .map_err(|e| format!("Fetch 失败: {}", e))?;

        if !fetch.status.success() {
            return Err(format!("Fetch 失败: {}", String::from_utf8_lossy(&fetch.stderr)));
        }

        let create = Command::new("git")
            .args(["checkout", "-b", &new_branch, &base_branch_ref])
            .current_dir(&project_path)
            .output()
            .map_err(|e| format!("创建分支失败: {}", e))?;

        if !create.status.success() {
            let error_msg = String::from_utf8_lossy(&create.stderr).to_string();
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

#[tauri::command]
pub async fn git_push_branch(project_path: String, branch: String) -> Result<String, String> {
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

#[tauri::command]
pub async fn git_get_remote_info(project_path: String) -> Result<String, String> {
    let (ok, stdout, stderr) = run_git(project_path, vec!["remote".into(), "get-url".into(), "origin".into()]).await?;
    if !ok {
        return Err(stderr);
    }
    let url = stdout.trim().to_string();

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
