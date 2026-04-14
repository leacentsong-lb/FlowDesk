#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::{Deserialize, Serialize};

mod commands;

#[derive(Debug, Serialize, Deserialize)]
pub struct HttpResponse {
    pub status: u16,
    pub body: String,
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            commands::sidecar::ai_sidecar_ensure_running,
            commands::http::open_url_raw,
            commands::http::http_post_json,
            commands::jira::jira_get_my_issues,
            commands::jira::jira_get_projects,
            commands::jira::jira_get_issue,
            commands::git::git_list_branches,
            commands::git::git_check_working_tree,
            commands::git::git_branch_exists,
            commands::git::git_create_branch,
            commands::git::git_push_branch,
            commands::git::git_get_remote_info,
            commands::github::github_create_draft_pr,
            commands::github::github_list_open_prs,
            commands::github::github_get_current_user,
            commands::release::jira_get_versions,
            commands::release::jira_get_version_issues,
            commands::release::read_package_version,
            commands::release::git_remote_branch_exists,
            commands::release::git_merge_conflict_check,
            commands::release::run_pnpm_build,
            commands::release::github_list_all_open_prs,
            commands::release::github_list_merged_prs,
            commands::agent::agent_run_command,
            commands::agent::agent_read_file,
            commands::agent::agent_list_dir,
            commands::agent::agent_write_file,
            commands::agent::agent_edit_file,
            commands::agent::agent_multiedit_file,
            commands::agent::agent_web_search,
            commands::agent::agent_scan_workspace_repos,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
