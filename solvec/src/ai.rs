use std::collections::HashMap;
use std::time::Duration;

use reqwest::blocking::Client;
use serde_json::{Value as JsonValue, json};

const DEFAULT_OPENAI_MODEL: &str = "gpt-4.1-mini";
const OPENAI_CHAT_COMPLETIONS_URL: &str = "https://api.openai.com/v1/chat/completions";
const AI_TIMEOUT_SECONDS: u64 = 30;

#[derive(Clone, Debug, PartialEq)]
pub enum AiProvider {
    Local,
    OpenAi,
}

#[derive(Clone, Debug, PartialEq)]
pub struct AiConfig {
    pub provider: AiProvider,
    pub model: String,
    pub api_key: Option<String>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct AiPrompt {
    pub developer_message: String,
    pub user_message: String,
}

#[derive(Clone, Debug, PartialEq)]
pub struct AiError {
    message: String,
}

impl AiError {
    fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
        }
    }
}

impl std::fmt::Display for AiError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "{}", self.message)
    }
}

impl AiConfig {
    pub fn from_env() -> Result<Self, AiError> {
        Self::from_vars(std::env::vars().collect())
    }

    pub fn from_vars(vars: HashMap<String, String>) -> Result<Self, AiError> {
        let provider_name = vars
            .get("SOLVELANG_AI_PROVIDER")
            .map(|value| value.trim())
            .unwrap_or("");

        let provider = match provider_name {
            "" | "local" => AiProvider::Local,
            "openai" => AiProvider::OpenAi,
            other => return Err(AiError::new(format!("unknown AI provider '{}'", other))),
        };

        let model = vars
            .get("SOLVELANG_AI_MODEL")
            .map(|value| value.trim())
            .filter(|value| !value.is_empty())
            .unwrap_or(DEFAULT_OPENAI_MODEL)
            .to_string();

        let api_key = vars
            .get("OPENAI_API_KEY")
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty());

        if provider == AiProvider::OpenAi && api_key.is_none() {
            return Err(AiError::new(
                "OPENAI_API_KEY is required when SOLVELANG_AI_PROVIDER=openai",
            ));
        }

        Ok(Self {
            provider,
            model,
            api_key,
        })
    }
}

pub fn ask_agent(
    agent_name: &str,
    instruction: &str,
    tools: &[String],
    message: &str,
) -> Result<String, AiError> {
    let config = AiConfig::from_env()?;
    ask_agent_with_config(&config, agent_name, instruction, tools, message)
}

pub fn ask_agent_with_config(
    config: &AiConfig,
    agent_name: &str,
    instruction: &str,
    tools: &[String],
    message: &str,
) -> Result<String, AiError> {
    match config.provider {
        AiProvider::Local => Ok(local_placeholder(agent_name, instruction, tools, message)),
        AiProvider::OpenAi => call_openai(config, instruction, tools, message),
    }
}

pub fn build_prompt(instruction: &str, tools: &[String], message: &str) -> AiPrompt {
    let tool_list = if tools.is_empty() {
        "none".to_string()
    } else {
        tools.join(", ")
    };

    AiPrompt {
        developer_message: format!(
            "{}\n\nApproved SolveLang tools: {}.\nOnly claim tool use if the runtime has actually provided tool results.",
            instruction, tool_list
        ),
        user_message: message.to_string(),
    }
}

fn local_placeholder(
    agent_name: &str,
    instruction: &str,
    tools: &[String],
    message: &str,
) -> String {
    let tools = if tools.is_empty() {
        "none".to_string()
    } else {
        tools.join(", ")
    };

    format!(
        "[{} AI Agent]\nInstruction: {}\nTools: {}\nUser: {}\nResponse: This is a local SolveLang agent prototype. Connect an AI provider later to generate live answers.",
        agent_name, instruction, tools, message
    )
}

fn call_openai(
    config: &AiConfig,
    instruction: &str,
    tools: &[String],
    message: &str,
) -> Result<String, AiError> {
    let api_key = config.api_key.as_ref().ok_or_else(|| {
        AiError::new("OPENAI_API_KEY is required when SOLVELANG_AI_PROVIDER=openai")
    })?;
    let prompt = build_prompt(instruction, tools, message);
    let client = Client::builder()
        .timeout(Duration::from_secs(AI_TIMEOUT_SECONDS))
        .build()
        .map_err(|error| AiError::new(format!("could not create OpenAI HTTP client: {}", error)))?;

    let response = client
        .post(OPENAI_CHAT_COMPLETIONS_URL)
        .bearer_auth(api_key)
        .header("content-type", "application/json")
        .body(
            json!({
                "model": config.model,
                "messages": [
                    {
                        "role": "developer",
                        "content": prompt.developer_message,
                    },
                    {
                        "role": "user",
                        "content": prompt.user_message,
                    }
                ],
                "temperature": 0.2,
            })
            .to_string(),
        )
        .send()
        .map_err(|error| AiError::new(format!("OpenAI request failed: {}", error)))?;

    let status = response.status();
    let body = response
        .text()
        .map_err(|error| AiError::new(format!("could not read OpenAI response: {}", error)))?;

    if !status.is_success() {
        return Err(AiError::new(format!(
            "OpenAI API error (status {}): {}",
            status.as_u16(),
            truncate_for_error(&body)
        )));
    }

    let json: JsonValue = serde_json::from_str(&body)
        .map_err(|error| AiError::new(format!("invalid OpenAI response JSON: {}", error)))?;

    json.pointer("/choices/0/message/content")
        .and_then(JsonValue::as_str)
        .map(|content| content.trim().to_string())
        .filter(|content| !content.is_empty())
        .ok_or_else(|| AiError::new("OpenAI response did not include message content"))
}

fn truncate_for_error(body: &str) -> String {
    const LIMIT: usize = 500;
    if body.chars().count() <= LIMIT {
        body.to_string()
    } else {
        format!("{}...", body.chars().take(LIMIT).collect::<String>())
    }
}

#[cfg(test)]
mod tests {
    use super::{AiConfig, AiProvider, ask_agent_with_config, build_prompt};
    use std::collections::HashMap;

    #[test]
    fn missing_provider_defaults_to_local() {
        let config = AiConfig::from_vars(HashMap::new()).expect("local config");

        assert_eq!(config.provider, AiProvider::Local);
    }

    #[test]
    fn local_provider_returns_placeholder() {
        let config = AiConfig {
            provider: AiProvider::Local,
            model: "ignored".to_string(),
            api_key: None,
        };
        let response = ask_agent_with_config(
            &config,
            "SupportBot",
            "Answer clearly.",
            &["searchDocs".to_string()],
            "Help",
        )
        .expect("local response");

        assert!(response.contains("[SupportBot AI Agent]"));
        assert!(response.contains("local SolveLang agent prototype"));
        assert!(response.contains("searchDocs"));
    }

    #[test]
    fn openai_provider_requires_api_key() {
        let mut vars = HashMap::new();
        vars.insert("SOLVELANG_AI_PROVIDER".to_string(), "openai".to_string());
        let error = AiConfig::from_vars(vars).expect_err("missing key should fail");

        assert!(error.to_string().contains("OPENAI_API_KEY is required"));
    }

    #[test]
    fn unknown_provider_is_an_error() {
        let mut vars = HashMap::new();
        vars.insert("SOLVELANG_AI_PROVIDER".to_string(), "mystery".to_string());
        let error = AiConfig::from_vars(vars).expect_err("unknown provider should fail");

        assert!(error.to_string().contains("unknown AI provider 'mystery'"));
    }

    #[test]
    fn prompt_includes_instruction_tools_and_user_message() {
        let prompt = build_prompt(
            "Answer clearly using approved tools only.",
            &["searchDocs".to_string(), "readFile".to_string()],
            "How can SolveLang help?",
        );

        assert!(
            prompt
                .developer_message
                .contains("Answer clearly using approved tools only.")
        );
        assert!(prompt.developer_message.contains("searchDocs, readFile"));
        assert!(prompt.user_message.contains("How can SolveLang help?"));
    }
}
