use std::collections::BTreeMap;
use std::io::Read;
use std::path::{Component, Path, PathBuf};

use reqwest::blocking::Client;
use solvec_core::evaluator::{Capability, HostError, HostRequest, RuntimeHost};
use solvec_core::value::Value;

use crate::ai;
use crate::ast_runtime::ExecutionPolicy;

pub(crate) struct NativeHost {
    policy: ExecutionPolicy,
    capture_output: bool,
}

impl NativeHost {
    pub(crate) fn new(policy: ExecutionPolicy, capture_output: bool) -> Self {
        Self {
            policy,
            capture_output,
        }
    }

    fn http_get(&self, url: &str, max_response_bytes: usize) -> Result<Value, HostError> {
        let client = self.http_client()?;
        let response = client
            .get(url)
            .send()
            .map_err(|error| self.http_request_error("http_get", &error))?;
        self.http_response_to_value(response, "http_get", max_response_bytes)
    }

    fn http_post(
        &self,
        url: &str,
        body: &str,
        max_response_bytes: usize,
    ) -> Result<Value, HostError> {
        let client = self.http_client()?;
        let response = client
            .post(url)
            .header("content-type", "application/json")
            .body(body.to_string())
            .send()
            .map_err(|error| self.http_request_error("http_post", &error))?;
        self.http_response_to_value(response, "http_post", max_response_bytes)
    }

    fn http_client(&self) -> Result<Client, HostError> {
        Client::builder()
            .connect_timeout(self.policy.http_connect_timeout)
            .timeout(self.policy.http_request_timeout)
            .build()
            .map_err(|error| {
                HostError::failed(
                    Capability::Network,
                    format!("could not create HTTP client: {error}"),
                )
            })
    }

    fn http_response_to_value(
        &self,
        mut response: reqwest::blocking::Response,
        builtin: &str,
        max_response_bytes: usize,
    ) -> Result<Value, HostError> {
        let status = response.status().as_u16() as i32;
        let final_url = response.url().to_string();

        let mut headers = BTreeMap::new();
        for (name, value) in response.headers() {
            headers.insert(
                name.to_string(),
                Value::Text(value.to_str().unwrap_or("").to_string()),
            );
        }

        let body_limit = self
            .policy
            .http_max_body_bytes
            .min(max_response_bytes.saturating_sub(1));
        let read_limit = body_limit
            .checked_add(1)
            .and_then(|limit| u64::try_from(limit).ok())
            .ok_or_else(|| {
                HostError::failed(Capability::Network, "HTTP response body limit is too large")
            })?;
        let mut limited = response.by_ref().take(read_limit);
        let mut body_bytes = Vec::new();
        limited.read_to_end(&mut body_bytes).map_err(|error| {
            HostError::failed(
                Capability::Network,
                format!("could not read HTTP response body: {error}"),
            )
        })?;

        if body_bytes.len() > body_limit {
            return Err(HostError::failed(
                Capability::Network,
                format!("{builtin} response body exceeded {body_limit} bytes"),
            ));
        }

        let mut result = BTreeMap::new();
        result.insert("status".to_string(), Value::Number(status));
        result.insert("url".to_string(), Value::Text(final_url));
        result.insert(
            "body".to_string(),
            Value::Text(String::from_utf8_lossy(&body_bytes).to_string()),
        );
        result.insert("headers".to_string(), Value::Object(headers));
        Ok(Value::Object(result))
    }

    fn http_request_error(&self, builtin: &str, error: &reqwest::Error) -> HostError {
        let message = if error.is_timeout() {
            format!(
                "{builtin} timed out after {} ms",
                self.policy.http_request_timeout.as_millis()
            )
        } else {
            format!("{builtin} failed: {error}")
        };
        HostError::failed(Capability::Network, message)
    }

    fn read_file(&self, path: &str, max_response_bytes: usize) -> Result<Value, HostError> {
        if max_response_bytes == 0 {
            return Err(HostError::failed(
                Capability::FileRead,
                "read_file result exceeded 0 bytes",
            ));
        }
        let path = self.resolve_existing_allowed_path(path)?;
        let file = std::fs::File::open(path).map_err(|error| {
            HostError::failed(Capability::FileRead, format!("read_file failed: {error}"))
        })?;
        let read_limit = max_response_bytes
            .checked_add(1)
            .and_then(|limit| u64::try_from(limit).ok())
            .ok_or_else(|| {
                HostError::failed(
                    Capability::FileRead,
                    "read_file response limit is too large",
                )
            })?;
        let mut bytes = Vec::new();
        file.take(read_limit)
            .read_to_end(&mut bytes)
            .map_err(|error| {
                HostError::failed(Capability::FileRead, format!("read_file failed: {error}"))
            })?;
        if bytes.len() > max_response_bytes.saturating_sub(1) {
            return Err(HostError::failed(
                Capability::FileRead,
                format!("read_file result exceeded {max_response_bytes} bytes"),
            ));
        }
        String::from_utf8(bytes).map(Value::Text).map_err(|error| {
            HostError::failed(
                Capability::FileRead,
                format!("read_file returned non-UTF-8 data: {error}"),
            )
        })
    }

    fn write_file(&self, path: &str, body: &str) -> Result<Value, HostError> {
        let path = self.resolve_writable_allowed_path(path)?;
        std::fs::write(path, body)
            .map(|_| Value::Bool(true))
            .map_err(|error| {
                HostError::failed(Capability::FileWrite, format!("write_file failed: {error}"))
            })
    }

    fn resolve_existing_allowed_path(&self, path: &str) -> Result<PathBuf, HostError> {
        self.reject_path_traversal(path, Capability::FileRead)?;
        let canonical = std::fs::canonicalize(path).map_err(|error| {
            HostError::failed(
                Capability::FileRead,
                format!("failed to resolve '{path}': {error}"),
            )
        })?;
        self.ensure_path_in_allowed_roots(&canonical, Capability::FileRead)?;
        Ok(canonical)
    }

    fn resolve_writable_allowed_path(&self, path: &str) -> Result<PathBuf, HostError> {
        self.reject_path_traversal(path, Capability::FileWrite)?;
        let path = PathBuf::from(path);
        let parent = path.parent().unwrap_or_else(|| Path::new("."));
        let canonical_parent = std::fs::canonicalize(parent).map_err(|error| {
            HostError::failed(
                Capability::FileWrite,
                format!(
                    "failed to resolve parent directory '{}': {error}",
                    parent.display()
                ),
            )
        })?;
        self.ensure_path_in_allowed_roots(&canonical_parent, Capability::FileWrite)?;

        let file_name = path.file_name().ok_or_else(|| {
            HostError::failed(
                Capability::FileWrite,
                format!("invalid file path '{}'", path.display()),
            )
        })?;
        let candidate = canonical_parent.join(file_name);
        if self.policy.restrict_filesystem_roots {
            match std::fs::symlink_metadata(&candidate) {
                Ok(metadata) if metadata.file_type().is_symlink() => {
                    return Err(HostError::failed(
                        Capability::FileWrite,
                        format!(
                            "refusing to write through symbolic link '{}'",
                            candidate.display()
                        ),
                    ));
                }
                Ok(_) => {}
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                Err(error) => {
                    return Err(HostError::failed(
                        Capability::FileWrite,
                        format!(
                            "failed to inspect output path '{}': {error}",
                            candidate.display()
                        ),
                    ));
                }
            }
        }
        Ok(candidate)
    }

    fn reject_path_traversal(&self, path: &str, capability: Capability) -> Result<(), HostError> {
        if self.policy.restrict_filesystem_roots
            && Path::new(path)
                .components()
                .any(|component| matches!(component, Component::ParentDir))
        {
            Err(HostError::failed(
                capability,
                format!("path traversal is not allowed: '{path}'"),
            ))
        } else {
            Ok(())
        }
    }

    fn ensure_path_in_allowed_roots(
        &self,
        path: &Path,
        capability: Capability,
    ) -> Result<(), HostError> {
        if !self.policy.restrict_filesystem_roots {
            return Ok(());
        }
        if self.policy.allowed_roots.is_empty() {
            return Err(HostError::failed(
                capability,
                "filesystem access requires at least one allowed root",
            ));
        }
        if self
            .policy
            .allowed_roots
            .iter()
            .any(|root| path.starts_with(root))
        {
            Ok(())
        } else {
            Err(HostError::failed(
                capability,
                format!(
                    "path '{}' is outside allowed filesystem roots",
                    path.display()
                ),
            ))
        }
    }

    fn provider_policy(&self) -> Result<(), HostError> {
        if !self.policy.allow_env {
            return Err(HostError::denied(
                Capability::Environment,
                "environment-variable access is disabled by execution policy",
            ));
        }
        if !self.policy.allow_network
            && std::env::var("SOLVELANG_AI_PROVIDER")
                .map(|provider| provider.trim().eq_ignore_ascii_case("openai"))
                .unwrap_or(false)
        {
            return Err(HostError::denied(
                Capability::Network,
                "network access is disabled by execution policy",
            ));
        }
        Ok(())
    }

    fn ensure_response_value(
        &self,
        value: Value,
        max_response_bytes: usize,
        capability: Capability,
    ) -> Result<Value, HostError> {
        fn consume(value: &Value, remaining: &mut usize, depth: usize) -> bool {
            if depth > 256 || *remaining == 0 {
                return false;
            }
            *remaining -= 1;
            match value {
                Value::Text(text) => {
                    if text.len() > *remaining {
                        return false;
                    }
                    *remaining -= text.len();
                }
                Value::Array(values) => {
                    if values
                        .iter()
                        .any(|value| !consume(value, remaining, depth + 1))
                    {
                        return false;
                    }
                }
                Value::Object(entries) => {
                    for (key, value) in entries {
                        if key.len() > *remaining {
                            return false;
                        }
                        *remaining -= key.len();
                        if !consume(value, remaining, depth + 1) {
                            return false;
                        }
                    }
                }
                Value::Number(_) | Value::Bool(_) | Value::Null => {}
            }
            true
        }

        let mut remaining = max_response_bytes;
        if consume(&value, &mut remaining, 0) {
            Ok(value)
        } else {
            Err(HostError::failed(
                capability,
                format!("host response exceeded {max_response_bytes} bytes"),
            ))
        }
    }
}

impl RuntimeHost for NativeHost {
    fn authorize(&self, capability: &Capability) -> Result<(), HostError> {
        match capability {
            Capability::Network if !self.policy.allow_network => Err(HostError::denied(
                capability.clone(),
                "network access is disabled by execution policy",
            )),
            Capability::FileRead if !self.policy.allow_file_read => Err(HostError::denied(
                capability.clone(),
                "file read access is disabled by execution policy",
            )),
            Capability::FileWrite if !self.policy.allow_file_write => Err(HostError::denied(
                capability.clone(),
                "file write access is disabled by execution policy",
            )),
            Capability::Environment if !self.policy.allow_env => Err(HostError::denied(
                capability.clone(),
                "environment-variable access is disabled by execution policy",
            )),
            Capability::UnknownCall(name) if self.policy.deny_unknown_calls() => {
                Err(HostError::denied(
                    capability.clone(),
                    format!(
                        "unknown or unsafe function call '{}' is disabled by execution policy",
                        name
                    ),
                ))
            }
            Capability::Provider => self.provider_policy(),
            Capability::Output
            | Capability::Network
            | Capability::FileRead
            | Capability::FileWrite
            | Capability::Environment
            | Capability::UnknownCall(_) => Ok(()),
        }
    }

    fn invoke(
        &mut self,
        request: HostRequest,
        max_response_bytes: usize,
    ) -> Result<Value, HostError> {
        let capability = request.capability();
        let value = match request {
            HostRequest::HttpGet { url } => self.http_get(&url, max_response_bytes),
            HostRequest::HttpPost { url, body } => self.http_post(&url, &body, max_response_bytes),
            HostRequest::FileRead { path } => self.read_file(&path, max_response_bytes),
            HostRequest::FileWrite { path, body } => self.write_file(&path, &body),
            HostRequest::Environment { name } => {
                Ok(Value::Text(std::env::var(name).unwrap_or_default()))
            }
            HostRequest::Provider {
                agent,
                instruction,
                tools,
                message,
            } => ai::ask_agent(&agent, &instruction, &tools, &message.to_string())
                .map(Value::Text)
                .map_err(|error| HostError::failed(Capability::Provider, error.to_string())),
        }?;
        self.ensure_response_value(value, max_response_bytes, capability)
    }

    fn emit_output(&mut self, value: &Value) -> Result<(), HostError> {
        if !self.capture_output {
            println!("{value}");
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::NativeHost;
    use crate::ast_runtime::ExecutionPolicy;
    use solvec_core::{
        evaluator::{Capability, HostRequest, RuntimeHost},
        value::Value,
    };

    #[test]
    fn response_budget_failure_retains_the_request_capability() {
        let host = NativeHost::new(ExecutionPolicy::unrestricted(), true);

        let error = host
            .ensure_response_value(
                Value::Text("oversized".to_string()),
                4,
                Capability::Environment,
            )
            .expect_err("oversized native responses fail before entering the evaluator");

        assert_eq!(error.capability(), &Capability::Environment);
        assert!(error.message().contains("host response exceeded 4 bytes"));
    }

    #[cfg(unix)]
    #[test]
    fn restricted_file_writes_reject_existing_symlinks() {
        use std::os::unix::fs::symlink;

        let root = std::env::temp_dir().join(format!(
            "solvelang_native_host_symlink_{}",
            std::process::id()
        ));
        std::fs::create_dir_all(&root).expect("create test root");
        let target = root.join("target.txt");
        let link = root.join("link.txt");
        std::fs::write(&target, "original").expect("write target");
        let _ = std::fs::remove_file(&link);
        symlink(&target, &link).expect("create symlink");

        let mut policy = ExecutionPolicy::unrestricted();
        policy.allowed_roots = vec![std::fs::canonicalize(&root).expect("canonicalize test root")];
        policy.restrict_filesystem_roots = true;
        let mut host = NativeHost::new(policy, true);
        let error = host
            .invoke(
                HostRequest::FileWrite {
                    path: link.to_string_lossy().into_owned(),
                    body: "overwritten".to_string(),
                },
                16_777_216,
            )
            .expect_err("symlink write should fail");

        assert!(
            error
                .to_string()
                .contains("refusing to write through symbolic link"),
            "unexpected error: {error}"
        );
        assert_eq!(
            std::fs::read_to_string(target).expect("read target"),
            "original"
        );
        let _ = std::fs::remove_file(link);
        let _ = std::fs::remove_file(root.join("target.txt"));
        let _ = std::fs::remove_dir(root);
    }
}
