//! Deterministic SolveLang evaluation with an explicit, host-owned capability seam.
//!
//! This module never performs host I/O itself. Programs that need a capability
//! must pass complete preflight and then ask the supplied [`RuntimeHost`] to
//! service a typed [`HostRequest`]. [`DenyAllHost`] is the default.

use std::borrow::Borrow;
use std::collections::{BTreeMap, HashMap, HashSet};
use std::hash::Hash;
use std::sync::Arc;

use serde_json::Value as JsonValue;

use crate::ast::{BinaryOp, ExportedDeclaration, Expr, ExprKind, SourceLocation, Stmt, UnaryOp};
use crate::value::Value;

const DEFAULT_STRUCTURAL_BYTE_LIMIT: usize = 16_777_216;
const VALUE_WORK_MULTIPLIER: usize = 16;

/// Returns the aggregate ceiling used for syntax, source, and module metadata snapshots.
pub fn structural_byte_limit(limits: EvaluationLimits) -> usize {
    limits.max_value_bytes.max(DEFAULT_STRUCTURAL_BYTE_LIMIT)
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Capability {
    Output,
    Network,
    FileRead,
    FileWrite,
    Environment,
    Provider,
    UnknownCall(String),
}

#[derive(Clone, Debug, PartialEq)]
pub enum HostRequest {
    HttpGet {
        url: String,
    },
    HttpPost {
        url: String,
        body: String,
    },
    FileRead {
        path: String,
    },
    FileWrite {
        path: String,
        body: String,
    },
    Environment {
        name: String,
    },
    Provider {
        agent: String,
        instruction: String,
        tools: Vec<String>,
        message: Value,
    },
}

impl HostRequest {
    pub fn capability(&self) -> Capability {
        match self {
            Self::HttpGet { .. } | Self::HttpPost { .. } => Capability::Network,
            Self::FileRead { .. } => Capability::FileRead,
            Self::FileWrite { .. } => Capability::FileWrite,
            Self::Environment { .. } => Capability::Environment,
            Self::Provider { .. } => Capability::Provider,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum HostErrorKind {
    Denied,
    Failed,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct HostError {
    kind: HostErrorKind,
    capability: Capability,
    message: String,
}

impl HostError {
    pub fn new(kind: HostErrorKind, capability: Capability, message: impl Into<String>) -> Self {
        Self {
            kind,
            capability,
            message: message.into(),
        }
    }

    pub fn denied(capability: Capability, message: impl Into<String>) -> Self {
        Self::new(HostErrorKind::Denied, capability, message)
    }

    pub fn failed(capability: Capability, message: impl Into<String>) -> Self {
        Self::new(HostErrorKind::Failed, capability, message)
    }

    pub fn kind(&self) -> HostErrorKind {
        self.kind
    }

    pub fn capability(&self) -> &Capability {
        &self.capability
    }

    pub fn message(&self) -> &str {
        &self.message
    }
}

impl std::fmt::Display for HostError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl std::error::Error for HostError {}

pub trait RuntimeHost {
    /// Decide whether a capability is permitted without performing the request
    /// or causing any other observable effect. Preflight relies on this method
    /// being deterministic and side-effect free.
    fn authorize(&self, capability: &Capability) -> Result<(), HostError>;

    /// Perform one already-authorized request. This is the only host request
    /// execution point exposed by the pure evaluator. Implementations must not
    /// return a value larger than `max_response_bytes`; streaming adapters
    /// should enforce the bound before buffering the complete response.
    fn invoke(
        &mut self,
        request: HostRequest,
        max_response_bytes: usize,
    ) -> Result<Value, HostError>;

    fn emit_output(&mut self, _value: &Value) -> Result<(), HostError> {
        Ok(())
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct DenyAllHost;

impl RuntimeHost for DenyAllHost {
    fn authorize(&self, capability: &Capability) -> Result<(), HostError> {
        Err(HostError::denied(
            capability.clone(),
            denied_capability_message(capability),
        ))
    }

    fn invoke(
        &mut self,
        request: HostRequest,
        _max_response_bytes: usize,
    ) -> Result<Value, HostError> {
        let capability = request.capability();
        Err(HostError::denied(
            capability.clone(),
            denied_capability_message(&capability),
        ))
    }
}

fn denied_capability_message(capability: &Capability) -> String {
    match capability {
        Capability::Output => "output delivery failed".to_string(),
        Capability::Network => "network access is disabled by execution policy".to_string(),
        Capability::FileRead => "file read access is disabled by execution policy".to_string(),
        Capability::FileWrite => "file write access is disabled by execution policy".to_string(),
        Capability::Environment => {
            "environment-variable access is disabled by execution policy".to_string()
        }
        Capability::Provider => {
            "agent and provider access is disabled by execution policy".to_string()
        }
        Capability::UnknownCall(name) => format!(
            "unknown or unsafe function call '{}' is disabled by execution policy",
            name
        ),
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct EvaluationLimits {
    pub max_loop_iterations: usize,
    pub max_steps: usize,
    pub max_call_depth: usize,
    pub max_value_bytes: usize,
}

impl Default for EvaluationLimits {
    fn default() -> Self {
        Self {
            max_loop_iterations: 10_000,
            max_steps: 1_000_000,
            max_call_depth: 256,
            max_value_bytes: 16_777_216,
        }
    }
}

#[derive(Clone, Copy, Debug)]
struct PreflightBudget {
    work: usize,
    max_work: usize,
    max_depth: usize,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ValueBudgetError {
    Bytes,
    Depth,
}

impl PreflightBudget {
    fn new(limits: EvaluationLimits) -> Self {
        Self {
            work: 0,
            max_work: limits.max_steps,
            max_depth: limits.max_call_depth,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ExportKind {
    Let,
    Function,
}

#[derive(Clone, Debug, PartialEq)]
pub struct ModuleNode {
    pub identity: String,
    pub source: String,
    pub statements: Vec<Stmt>,
    pub dependencies: Vec<String>,
    pub exports: BTreeMap<String, ExportKind>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct ModuleProgram {
    pub entry: String,
    pub modules: BTreeMap<String, ModuleNode>,
    pub order: Vec<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RuntimeErrorKind {
    Evaluation,
    CapabilityDenied,
    LimitExceeded,
    Host,
}

#[derive(Clone, Debug, PartialEq)]
pub struct RuntimeError {
    kind: RuntimeErrorKind,
    message: String,
    capability: Option<Capability>,
    context: Option<Box<RuntimeErrorContext>>,
}

#[derive(Clone, Debug, PartialEq)]
struct RuntimeErrorContext {
    location: SourceLocation,
    source_line: Option<String>,
    filename: Option<String>,
    hint: Option<String>,
}

impl RuntimeError {
    pub fn new(message: impl Into<String>) -> Self {
        Self::with_kind(RuntimeErrorKind::Evaluation, message)
    }

    pub fn with_kind(kind: RuntimeErrorKind, message: impl Into<String>) -> Self {
        Self {
            kind,
            message: message.into(),
            capability: None,
            context: None,
        }
    }

    fn at(
        kind: RuntimeErrorKind,
        message: impl Into<String>,
        location: SourceLocation,
        source_line: Option<String>,
        filename: Option<String>,
        hint: Option<String>,
    ) -> Self {
        Self {
            kind,
            message: message.into(),
            capability: None,
            context: Some(Box::new(RuntimeErrorContext {
                location,
                source_line,
                filename,
                hint,
            })),
        }
    }

    fn with_context(
        mut self,
        location: SourceLocation,
        source_line: Option<String>,
        filename: Option<String>,
    ) -> Self {
        if self.context.is_none() {
            self.context = Some(Box::new(RuntimeErrorContext {
                location,
                source_line,
                filename,
                hint: None,
            }));
        }
        self
    }

    fn from_host(error: HostError) -> Self {
        let kind = match error.kind {
            HostErrorKind::Denied => RuntimeErrorKind::CapabilityDenied,
            HostErrorKind::Failed => RuntimeErrorKind::Host,
        };
        Self {
            kind,
            message: error.message,
            capability: Some(error.capability),
            context: None,
        }
    }

    pub fn kind(&self) -> RuntimeErrorKind {
        self.kind
    }

    pub fn message(&self) -> &str {
        &self.message
    }

    pub fn capability(&self) -> Option<&Capability> {
        self.capability.as_ref()
    }

    pub fn location(&self) -> Option<SourceLocation> {
        self.context.as_ref().map(|context| context.location)
    }

    pub fn source_name(&self) -> Option<&str> {
        self.context
            .as_ref()
            .and_then(|context| context.filename.as_deref())
    }

    pub fn source_line(&self) -> Option<&str> {
        self.context
            .as_ref()
            .and_then(|context| context.source_line.as_deref())
    }

    pub fn hint(&self) -> Option<&str> {
        self.context
            .as_ref()
            .and_then(|context| context.hint.as_deref())
    }
}

impl std::fmt::Display for RuntimeError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        if let Some(context) = &self.context {
            let location = context.location;
            write!(
                formatter,
                "SolveLang Runtime Error on line {}, column {}",
                location.line, location.column
            )?;
            if let Some(filename) = &context.filename {
                write!(formatter, " in {}", filename)?;
            }
            if let Some(source_line) = &context.source_line {
                let padding_width = location
                    .column
                    .saturating_sub(1)
                    .min(source_line.chars().count());
                let padding = " ".repeat(padding_width);
                write!(
                    formatter,
                    "\n{:>3} | {}\n    | {}^\n{}",
                    location.line, source_line, padding, self.message
                )?;
            } else {
                write!(formatter, "\n{}", self.message)?;
            }
            if let Some(hint) = &context.hint {
                write!(formatter, "\nHint: {}", hint)?;
            }
            Ok(())
        } else {
            write!(formatter, "SolveLang Runtime Error: {}", self.message)
        }
    }
}

impl std::error::Error for RuntimeError {}

#[derive(Clone, Debug)]
struct Function {
    name: String,
    params: Arc<[String]>,
    body: Arc<[Stmt]>,
    location: SourceLocation,
    module_identity: Option<String>,
    source: Arc<str>,
    filename: Option<Arc<str>>,
    accounted_bytes: usize,
    accounted_work: usize,
    source_key: (usize, usize),
    source_bytes: usize,
    owns_source_accounting: bool,
}

#[derive(Clone, Copy, Debug)]
struct SourceRetention {
    references: usize,
    bytes: usize,
}

#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
struct FunctionDefinitionKey {
    filename: Option<Arc<str>>,
    line: usize,
    column: usize,
    module_identity: Option<String>,
    name: String,
}

impl From<&Function> for FunctionDefinitionKey {
    fn from(function: &Function) -> Self {
        Self {
            filename: function.filename.clone(),
            line: function.location.line,
            column: function.location.column,
            module_identity: function.module_identity.clone(),
            name: function.name.clone(),
        }
    }
}

#[derive(Clone, Debug)]
struct ImportedValue {
    module_identity: String,
    exported_name: String,
}

#[derive(Clone, Debug)]
struct ModuleScope {
    vars: HashMap<String, Value>,
    value_bytes: usize,
    functions: HashMap<String, Function>,
    function_bytes: usize,
    function_work: usize,
    function_source_refs: HashMap<(usize, usize), SourceRetention>,
    function_source_bytes: usize,
    metadata_bytes: usize,
    source_bytes: usize,
    imported_values: HashMap<String, ImportedValue>,
    namespaces: HashMap<String, String>,
    read_only_bindings: HashSet<String>,
    exports: BTreeMap<String, ExportKind>,
    source: Arc<str>,
    filename: Arc<str>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ModuleInitializationStatus {
    Initializing,
    Initialized,
}

#[derive(Clone, Debug)]
struct Agent {
    instruction: String,
    tools: Vec<String>,
    retained_bytes: usize,
}

#[derive(Clone, Debug, PartialEq)]
enum ControlFlow {
    None,
    Return(Value),
    Break,
    Continue,
}

pub struct Evaluator<H: RuntimeHost> {
    vars: HashMap<String, Value>,
    functions: HashMap<String, Function>,
    functions_bytes: usize,
    functions_work: usize,
    function_source_refs: HashMap<(usize, usize), SourceRetention>,
    function_source_bytes: usize,
    agents: HashMap<String, Agent>,
    agents_bytes: usize,
    host: H,
    limits: EvaluationLimits,
    steps: usize,
    call_depth: usize,
    configured_source: Arc<str>,
    configured_source_rejected_bytes: Option<usize>,
    configured_source_name: Option<Arc<str>>,
    source: Arc<str>,
    filename: Option<Arc<str>>,
    outputs: Vec<Value>,
    output_bytes: usize,
    input_bytes: usize,
    vars_bytes: usize,
    scope_metadata_bytes: usize,
    active_source_bytes: usize,
    module_scope_bytes: usize,
    suspended_scope_bytes: usize,
    suspended_metadata_bytes: usize,
    value_work_bytes: usize,
    retain_output: bool,
    input: Option<Value>,
    input_injected: bool,
    imported_values: HashMap<String, ImportedValue>,
    namespaces: HashMap<String, String>,
    read_only_bindings: HashSet<String>,
    module_scopes: HashMap<String, ModuleScope>,
    module_initialization: HashMap<String, ModuleInitializationStatus>,
    local_bindings: Vec<HashMap<String, Value>>,
    local_bindings_bytes: usize,
    function_scope_starts: Vec<usize>,
    active_module_calls: Vec<String>,
    active_module: Option<String>,
    module_execution_enabled: bool,
}

impl Default for Evaluator<DenyAllHost> {
    fn default() -> Self {
        Self::new(DenyAllHost)
    }
}

impl<H: RuntimeHost> Evaluator<H> {
    pub fn new(host: H) -> Self {
        Self {
            vars: HashMap::new(),
            functions: HashMap::new(),
            functions_bytes: 0,
            functions_work: 0,
            function_source_refs: HashMap::new(),
            function_source_bytes: 0,
            agents: HashMap::new(),
            agents_bytes: 0,
            host,
            limits: EvaluationLimits::default(),
            steps: 0,
            call_depth: 0,
            configured_source: Arc::from(""),
            configured_source_rejected_bytes: None,
            configured_source_name: None,
            source: Arc::from(""),
            filename: None,
            outputs: Vec::new(),
            output_bytes: 0,
            input_bytes: 0,
            vars_bytes: 0,
            scope_metadata_bytes: 0,
            active_source_bytes: 0,
            module_scope_bytes: 0,
            suspended_scope_bytes: 0,
            suspended_metadata_bytes: 0,
            value_work_bytes: 0,
            retain_output: true,
            input: None,
            input_injected: false,
            imported_values: HashMap::new(),
            namespaces: HashMap::new(),
            read_only_bindings: HashSet::new(),
            module_scopes: HashMap::new(),
            module_initialization: HashMap::new(),
            local_bindings: Vec::new(),
            local_bindings_bytes: 0,
            function_scope_starts: Vec::new(),
            active_module_calls: Vec::new(),
            active_module: None,
            module_execution_enabled: false,
        }
    }

    pub fn with_input(host: H, source: &str, source_name: &str, input: Option<Value>) -> Self {
        let mut evaluator = Self::new(host);
        evaluator.store_configured_source(source, source_name);
        evaluator.input_injected = input.is_some();
        evaluator.input = input;
        evaluator
    }

    pub fn with_output_retention(mut self, retain_output: bool) -> Self {
        self.retain_output = retain_output;
        self
    }

    pub fn with_limits(mut self, limits: EvaluationLimits) -> Self {
        self.limits = limits;
        self
    }

    pub fn limits(&self) -> EvaluationLimits {
        self.limits
    }

    pub fn set_limits(&mut self, limits: EvaluationLimits) {
        self.limits = limits;
    }

    pub fn set_input(&mut self, input: Option<Value>) {
        if (self.input_injected || input.is_some()) && self.vars.contains_key("input") {
            let bytes = self
                .vars
                .get("input")
                .map_or(0, |value| Self::known_var_entry_bytes("input", value));
            self.vars.remove("input");
            self.vars_bytes = self.vars_bytes.saturating_sub(bytes);
        }
        self.input_injected = input.is_some();
        self.input_bytes = 0;
        self.input = input;
    }

    pub fn set_source_context(&mut self, source: &str, source_name: &str) {
        self.store_configured_source(source, source_name);
    }

    fn store_configured_source(&mut self, source: &str, source_name: &str) {
        let bytes = source
            .len()
            .saturating_add(source_name.len())
            .saturating_add(2);
        if bytes > structural_byte_limit(self.limits) {
            self.configured_source = Arc::from("");
            self.configured_source_name = None;
            self.configured_source_rejected_bytes = Some(bytes);
        } else {
            self.configured_source = Arc::from(source);
            self.configured_source_name = Some(Arc::from(source_name));
            self.configured_source_rejected_bytes = None;
        }
    }

    fn injected_input_visible(&self) -> bool {
        self.input_injected && self.active_module_calls.is_empty()
    }

    pub fn outputs(&self) -> &[Value] {
        &self.outputs
    }

    pub fn host(&self) -> &H {
        &self.host
    }

    pub fn host_mut(&mut self) -> &mut H {
        &mut self.host
    }

    pub fn into_host(self) -> H {
        self.host
    }

    fn emit(&mut self, value: Value, location: SourceLocation) -> Result<(), RuntimeError> {
        let value_bytes = self.ensure_value_within_limit(&value, Some(location))?;
        if value_bytes
            > self
                .limits
                .max_value_bytes
                .saturating_sub(self.output_bytes)
        {
            return Err(self.limit_error_at(
                location,
                format!("output exceeded {} bytes", self.limits.max_value_bytes),
                Some("Reduce the number or size of emitted values.".to_string()),
            ));
        }
        if self.retain_output {
            self.ensure_retained_value_replacement(0, value_bytes, location)?;
        }
        if let Err(error) = self.host.emit_output(&value) {
            return Err(self.host_error_at(error, location));
        }
        self.output_bytes += value_bytes;
        if self.retain_output {
            self.outputs.push(value);
        }
        Ok(())
    }

    fn ensure_value_within_limit(
        &self,
        value: &Value,
        location: Option<SourceLocation>,
    ) -> Result<usize, RuntimeError> {
        match bounded_value_size(
            value,
            self.limits.max_value_bytes,
            self.limits.max_call_depth,
        ) {
            Ok(size) => Ok(size),
            Err(reason) => {
                let message = match reason {
                    ValueBudgetError::Bytes => {
                        format!("value exceeded {} bytes", self.limits.max_value_bytes)
                    }
                    ValueBudgetError::Depth => {
                        format!("value nesting exceeded {}", self.limits.max_call_depth)
                    }
                };
                Err(match location {
                    Some(location) => self.limit_error_at(
                        location,
                        message,
                        Some("Use smaller bounded values during evaluation.".to_string()),
                    ),
                    None => RuntimeError::with_kind(RuntimeErrorKind::LimitExceeded, message),
                })
            }
        }
    }

    fn ensure_literal_bytes(
        &self,
        bytes: usize,
        location: SourceLocation,
    ) -> Result<(), RuntimeError> {
        if bytes > self.limits.max_value_bytes {
            Err(self.limit_error_at(
                location,
                format!("value exceeded {} bytes", self.limits.max_value_bytes),
                Some("Use smaller bounded literal values during evaluation.".to_string()),
            ))
        } else {
            Ok(())
        }
    }

    fn charge_value_work_bytes(
        &mut self,
        bytes: usize,
        location: SourceLocation,
    ) -> Result<(), RuntimeError> {
        let work_limit = self
            .limits
            .max_value_bytes
            .saturating_mul(VALUE_WORK_MULTIPLIER);
        if bytes > work_limit.saturating_sub(self.value_work_bytes) {
            return Err(self.limit_error_at(
                location,
                format!("value work exceeded {work_limit} bytes"),
                Some("Use fewer or smaller values during one evaluation run.".to_string()),
            ));
        }
        self.value_work_bytes += bytes;
        Ok(())
    }

    fn logical_retained_value_bytes(&self) -> usize {
        self.input_bytes
            .saturating_add(self.vars_bytes)
            .saturating_add(self.functions_bytes)
            .saturating_add(self.module_scope_bytes)
            .saturating_add(self.suspended_scope_bytes)
            .saturating_add(self.local_bindings_bytes)
            .saturating_add(self.agents_bytes)
            .saturating_add(if self.retain_output {
                self.output_bytes
            } else {
                0
            })
    }

    fn retained_metadata_bytes(&self) -> usize {
        let mut bytes = self
            .scope_metadata_bytes
            .saturating_add(self.suspended_metadata_bytes);
        for (identity, scope) in &self.module_scopes {
            bytes = bytes
                .saturating_add(identity.len().saturating_add(1))
                .saturating_add(scope.metadata_bytes);
        }
        for identity in self.module_initialization.keys() {
            bytes = bytes.saturating_add(identity.len().saturating_add(1));
        }
        bytes = bytes.saturating_add(
            self.active_module
                .as_ref()
                .map_or(0, |identity| identity.len().saturating_add(1)),
        );
        for identity in &self.active_module_calls {
            bytes = bytes.saturating_add(identity.len().saturating_add(1));
        }
        bytes
    }

    fn retained_source_bytes(&self) -> usize {
        let mut bytes = self
            .configured_source
            .len()
            .saturating_add(
                self.configured_source_name
                    .as_ref()
                    .map_or(0, |name| name.len().saturating_add(1)),
            )
            .saturating_add(self.active_source_bytes)
            .saturating_add(self.function_source_bytes);
        for scope in self.module_scopes.values() {
            bytes = bytes
                .saturating_add(scope.source_bytes)
                .saturating_add(scope.function_source_bytes);
        }
        bytes
    }

    fn retained_function_work(&self) -> usize {
        self.module_scopes
            .values()
            .fold(self.functions_work, |total, scope| {
                total.saturating_add(scope.function_work)
            })
    }

    fn ensure_structural_total(
        &self,
        bytes: usize,
        category: &str,
        location: SourceLocation,
    ) -> Result<(), RuntimeError> {
        let limit = structural_byte_limit(self.limits);
        if bytes > limit {
            Err(self.limit_error_at(
                location,
                format!("retained {category} exceeded {limit} bytes"),
                Some(format!("Keep less retained {category}.")),
            ))
        } else {
            Ok(())
        }
    }

    fn ensure_metadata_replacement(
        &self,
        replaced_bytes: usize,
        new_bytes: usize,
        location: SourceLocation,
    ) -> Result<(), RuntimeError> {
        self.ensure_structural_total(
            self.retained_metadata_bytes()
                .saturating_sub(replaced_bytes)
                .saturating_add(new_bytes),
            "module metadata",
            location,
        )
    }

    fn ensure_source_replacement(
        &self,
        replaced_bytes: usize,
        new_bytes: usize,
        location: SourceLocation,
    ) -> Result<(), RuntimeError> {
        self.ensure_structural_total(
            self.retained_source_bytes()
                .saturating_sub(replaced_bytes)
                .saturating_add(new_bytes),
            "source provenance",
            location,
        )
    }

    fn ensure_retained_value_replacement(
        &self,
        replaced_bytes: usize,
        new_bytes: usize,
        location: SourceLocation,
    ) -> Result<(), RuntimeError> {
        let retained_without_replaced = self
            .logical_retained_value_bytes()
            .saturating_sub(replaced_bytes);
        if new_bytes
            > self
                .limits
                .max_value_bytes
                .saturating_sub(retained_without_replaced)
        {
            return Err(self.limit_error_at(
                location,
                format!(
                    "retained values exceeded {} bytes",
                    self.limits.max_value_bytes
                ),
                Some("Keep less live evaluator state or use smaller values.".to_string()),
            ));
        }
        Ok(())
    }

    fn ensure_retained_values_within_limit(
        &self,
        location: SourceLocation,
    ) -> Result<(), RuntimeError> {
        if self.logical_retained_value_bytes() > self.limits.max_value_bytes {
            return Err(self.limit_error_at(
                location,
                format!(
                    "retained values exceeded {} bytes",
                    self.limits.max_value_bytes
                ),
                Some("Keep less live evaluator state or use smaller values.".to_string()),
            ));
        }
        Ok(())
    }

    fn agent_metadata_bytes(
        &self,
        name: &str,
        instruction: &str,
        tools: &[String],
        location: SourceLocation,
    ) -> Result<usize, RuntimeError> {
        let mut bytes = name
            .len()
            .saturating_add(1)
            .saturating_add(instruction.len())
            .saturating_add(1)
            .saturating_add(1);
        self.ensure_literal_bytes(bytes, location)?;
        for tool in tools {
            bytes = bytes.saturating_add(tool.len()).saturating_add(1);
            self.ensure_literal_bytes(bytes, location)?;
        }
        Ok(bytes)
    }

    fn insert_agent(
        &mut self,
        name: &str,
        instruction: &str,
        tools: &[String],
        location: SourceLocation,
    ) -> Result<(), RuntimeError> {
        let retained_bytes = self.agent_metadata_bytes(name, instruction, tools, location)?;
        self.charge_value_work_bytes(retained_bytes, location)?;
        let replaced_bytes = self
            .agents
            .get(name)
            .map_or(0, |agent| agent.retained_bytes);
        self.ensure_retained_value_replacement(replaced_bytes, retained_bytes, location)?;
        self.agents_bytes = self
            .agents_bytes
            .saturating_sub(replaced_bytes)
            .saturating_add(retained_bytes);
        self.agents.insert(
            name.to_string(),
            Agent {
                instruction: instruction.to_string(),
                tools: tools.to_vec(),
                retained_bytes,
            },
        );
        Ok(())
    }

    fn function_definition_bytes(
        &self,
        name: &str,
        params: &[String],
        body: &[Stmt],
        module_identity: Option<&str>,
        filename: Option<&str>,
        location: SourceLocation,
    ) -> Result<(usize, usize), RuntimeError> {
        let (body_bytes, body_work) = syntax_snapshot_metrics(body, self.limits)
            .map_err(|error| self.limit_error_at(location, error.message().to_string(), None))?;
        let bytes = name
            .len()
            .saturating_add(1)
            .saturating_add(params.iter().fold(1usize, |total, param| {
                total.saturating_add(param.len()).saturating_add(1)
            }))
            .saturating_add(body_bytes)
            .saturating_add(module_identity.map_or(0, |identity| identity.len().saturating_add(1)))
            .saturating_add(filename.map_or(0, |name| name.len().saturating_add(1)));
        self.ensure_literal_bytes(bytes, location)?;
        Ok((
            bytes,
            body_work.saturating_add(params.len()).saturating_add(2),
        ))
    }

    fn source_snapshot_key(source: &Arc<str>) -> (usize, usize) {
        (source.as_ptr() as usize, source.len())
    }

    fn source_snapshot_bytes(source: &str) -> usize {
        source.len().saturating_add(1)
    }

    fn release_function_source(&mut self, function: &Function) {
        if !function.owns_source_accounting {
            return;
        }
        let remove =
            if let Some(retention) = self.function_source_refs.get_mut(&function.source_key) {
                retention.references = retention.references.saturating_sub(1);
                retention.references == 0
            } else {
                false
            };
        if remove && let Some(retention) = self.function_source_refs.remove(&function.source_key) {
            self.function_source_bytes = self.function_source_bytes.saturating_sub(retention.bytes);
        }
    }

    fn retain_function_source(&mut self, function: &Function) {
        if !function.owns_source_accounting {
            return;
        }
        let retention = self
            .function_source_refs
            .entry(function.source_key)
            .or_insert(SourceRetention {
                references: 0,
                bytes: function.source_bytes,
            });
        if retention.references == 0 {
            self.function_source_bytes = self
                .function_source_bytes
                .saturating_add(function.source_bytes);
        }
        retention.references = retention.references.saturating_add(1);
    }

    fn function_entry_bytes(name: &str, function: &Function) -> usize {
        name.len()
            .saturating_add(1)
            .saturating_add(function.accounted_bytes)
    }

    fn function_handle_clone_bytes(function: &Function) -> usize {
        function
            .name
            .len()
            .saturating_add(1)
            .saturating_add(
                function
                    .module_identity
                    .as_ref()
                    .map_or(0, |identity| identity.len().saturating_add(1)),
            )
            .saturating_add(
                function
                    .filename
                    .as_ref()
                    .map_or(0, |filename| filename.len().saturating_add(1)),
            )
            .saturating_add(3)
    }

    fn install_function(
        &mut self,
        name: &str,
        params: &[String],
        body: &[Stmt],
        location: SourceLocation,
    ) -> Result<(), RuntimeError> {
        if self.read_only_bindings.contains(name) {
            return Err(self.error_at(
                location,
                format!("imported binding '{}' is read-only", name),
                None,
            ));
        }
        if self.injected_input_visible()
            && (name == "input" || params.iter().any(|param| param == "input"))
        {
            return Err(RuntimeError::new(
                "the injected input value cannot be shadowed by a function",
            ));
        }

        let (definition_bytes, definition_work) = self.function_definition_bytes(
            name,
            params,
            body,
            self.active_module.as_deref(),
            self.filename.as_deref(),
            location,
        )?;
        let retained_bytes = name
            .len()
            .saturating_add(1)
            .saturating_add(definition_bytes);
        self.charge_value_work_bytes(retained_bytes, location)?;
        self.charge_steps(definition_work, location)?;
        let source_key = Self::source_snapshot_key(&self.source);
        let source_bytes = Self::source_snapshot_bytes(&self.source);
        self.ensure_literal_bytes(source_bytes, location)?;
        let replaced = self.functions.get(name).cloned();
        let replaced_entry_bytes = replaced
            .as_ref()
            .map_or(0, |function| Self::function_entry_bytes(name, function));
        let replaced_work = replaced
            .as_ref()
            .map_or(0, |function| function.accounted_work);
        let projected_work = self
            .functions_work
            .saturating_sub(replaced_work)
            .saturating_add(definition_work);
        let projected_total_work = self
            .retained_function_work()
            .saturating_sub(self.functions_work)
            .saturating_add(projected_work);
        if projected_total_work > self.limits.max_steps {
            return Err(self.limit_error_at(
                location,
                format!(
                    "retained function syntax exceeded {} steps",
                    self.limits.max_steps
                ),
                None,
            ));
        }
        let replaced_source_bytes = replaced.as_ref().map_or(0, |function| {
            if function.owns_source_accounting
                && self
                    .function_source_refs
                    .get(&function.source_key)
                    .is_some_and(|retention| retention.references == 1)
            {
                function.source_bytes
            } else {
                0
            }
        });
        let new_source_bytes = if replaced.as_ref().is_some_and(|function| {
            function.owns_source_accounting && function.source_key == source_key
        }) || self.function_source_refs.contains_key(&source_key)
        {
            0
        } else {
            source_bytes
        };
        self.ensure_source_replacement(replaced_source_bytes, new_source_bytes, location)?;
        self.ensure_retained_value_replacement(replaced_entry_bytes, retained_bytes, location)?;

        let function = Function {
            name: name.to_string(),
            params: params.to_vec().into(),
            body: body.to_vec().into(),
            location,
            module_identity: self.active_module.clone(),
            source: self.source.clone(),
            filename: self.filename.clone(),
            accounted_bytes: definition_bytes,
            accounted_work: definition_work,
            source_key,
            source_bytes,
            owns_source_accounting: true,
        };
        if let Some(replaced) = &replaced {
            self.release_function_source(replaced);
        }
        self.retain_function_source(&function);
        self.functions_bytes = self
            .functions_bytes
            .saturating_sub(replaced_entry_bytes)
            .saturating_add(retained_bytes);
        self.functions_work = projected_work;
        self.functions.insert(name.to_string(), function);
        Ok(())
    }

    fn insert_function_alias(
        &mut self,
        local: &str,
        mut function: Function,
        location: SourceLocation,
    ) -> Result<(), RuntimeError> {
        let accounted_bytes = Self::function_handle_clone_bytes(&function);
        let retained_bytes = local
            .len()
            .saturating_add(1)
            .saturating_add(accounted_bytes);
        self.charge_value_work_bytes(local.len().saturating_add(1), location)?;
        self.charge_steps(1, location)?;

        let replaced = self.functions.get(local).cloned();
        let replaced_entry_bytes = replaced
            .as_ref()
            .map_or(0, |function| Self::function_entry_bytes(local, function));
        let replaced_work = replaced
            .as_ref()
            .map_or(0, |function| function.accounted_work);
        let projected_work = self
            .functions_work
            .saturating_sub(replaced_work)
            .saturating_add(1);
        let projected_total_work = self
            .retained_function_work()
            .saturating_sub(self.functions_work)
            .saturating_add(projected_work);
        if projected_total_work > self.limits.max_steps {
            return Err(self.limit_error_at(
                location,
                format!(
                    "retained function syntax exceeded {} steps",
                    self.limits.max_steps
                ),
                None,
            ));
        }
        self.ensure_retained_value_replacement(replaced_entry_bytes, retained_bytes, location)?;

        function.accounted_bytes = accounted_bytes;
        function.accounted_work = 1;
        function.owns_source_accounting = false;
        if let Some(replaced) = &replaced {
            self.release_function_source(replaced);
        }
        self.functions_bytes = self
            .functions_bytes
            .saturating_sub(replaced_entry_bytes)
            .saturating_add(retained_bytes);
        self.functions_work = projected_work;
        self.functions.insert(local.to_string(), function);
        Ok(())
    }

    fn insert_var(
        &mut self,
        name: &str,
        value: Value,
        location: SourceLocation,
    ) -> Result<(), RuntimeError> {
        let value_bytes = self.ensure_value_within_limit(&value, Some(location))?;
        let name_clone_bytes = name.len().saturating_add(1).saturating_mul(2);
        self.charge_value_work_bytes(name_clone_bytes, location)?;
        let entry_bytes = name.len().saturating_add(1).saturating_add(value_bytes);
        self.ensure_literal_bytes(entry_bytes, location)?;
        let replaced_bytes = self
            .vars
            .get(name)
            .map_or(0, |existing| Self::known_var_entry_bytes(name, existing));
        self.ensure_retained_value_replacement(replaced_bytes, entry_bytes, location)?;
        self.vars_bytes = self
            .vars_bytes
            .saturating_sub(replaced_bytes)
            .saturating_add(entry_bytes);
        self.vars.insert(name.to_string(), value);
        Ok(())
    }

    fn known_var_entry_bytes(name: &str, value: &Value) -> usize {
        let value_bytes = bounded_value_size(value, usize::MAX, usize::MAX)
            .expect("retained evaluator values were bounded before insertion");
        name.len().saturating_add(1).saturating_add(value_bytes)
    }

    fn insert_read_only_binding(
        &mut self,
        name: &str,
        location: SourceLocation,
    ) -> Result<(), RuntimeError> {
        if self.read_only_bindings.contains(name) {
            return Ok(());
        }
        let bytes = name.len().saturating_add(1);
        self.charge_value_work_bytes(bytes, location)?;
        self.ensure_metadata_replacement(
            self.scope_metadata_bytes,
            self.scope_metadata_bytes.saturating_add(bytes),
            location,
        )?;
        self.scope_metadata_bytes = self.scope_metadata_bytes.saturating_add(bytes);
        self.read_only_bindings.insert(name.to_string());
        Ok(())
    }

    fn insert_namespace(
        &mut self,
        local: &str,
        identity: &str,
        location: SourceLocation,
    ) -> Result<(), RuntimeError> {
        let new_bytes = local.len().saturating_add(identity.len()).saturating_add(2);
        self.charge_value_work_bytes(new_bytes, location)?;
        let replaced_bytes = self.namespaces.get(local).map_or(0, |existing| {
            local.len().saturating_add(existing.len()).saturating_add(2)
        });
        let projected = self
            .scope_metadata_bytes
            .saturating_sub(replaced_bytes)
            .saturating_add(new_bytes);
        self.ensure_metadata_replacement(self.scope_metadata_bytes, projected, location)?;
        self.scope_metadata_bytes = projected;
        self.namespaces
            .insert(local.to_string(), identity.to_string());
        Ok(())
    }

    fn insert_imported_value(
        &mut self,
        local: &str,
        module_identity: &str,
        exported_name: &str,
        location: SourceLocation,
    ) -> Result<(), RuntimeError> {
        let new_bytes = local
            .len()
            .saturating_add(module_identity.len())
            .saturating_add(exported_name.len())
            .saturating_add(3);
        self.charge_value_work_bytes(new_bytes, location)?;
        let replaced_bytes = self.imported_values.get(local).map_or(0, |existing| {
            local
                .len()
                .saturating_add(existing.module_identity.len())
                .saturating_add(existing.exported_name.len())
                .saturating_add(3)
        });
        let projected = self
            .scope_metadata_bytes
            .saturating_sub(replaced_bytes)
            .saturating_add(new_bytes);
        self.ensure_metadata_replacement(self.scope_metadata_bytes, projected, location)?;
        self.scope_metadata_bytes = projected;
        self.imported_values.insert(
            local.to_string(),
            ImportedValue {
                module_identity: module_identity.to_string(),
                exported_name: exported_name.to_string(),
            },
        );
        Ok(())
    }

    fn insert_module_scope(
        &mut self,
        identity: String,
        scope: ModuleScope,
        location: SourceLocation,
    ) -> Result<(), RuntimeError> {
        let retained_bytes = scope.value_bytes.saturating_add(scope.function_bytes);
        let replaced_bytes = self
            .module_scopes
            .get(&identity)
            .map(|existing| existing.value_bytes.saturating_add(existing.function_bytes))
            .unwrap_or(0);
        let replaced_metadata = self
            .module_scopes
            .get(&identity)
            .map_or(0, |existing| existing.metadata_bytes);
        let replaced_source = self.module_scopes.get(&identity).map_or(0, |existing| {
            existing
                .source_bytes
                .saturating_add(existing.function_source_bytes)
        });
        let replaced_work = self
            .module_scopes
            .get(&identity)
            .map_or(0, |existing| existing.function_work);
        let identity_metadata = if self.module_scopes.contains_key(&identity) {
            0
        } else {
            identity.len().saturating_add(1)
        };
        self.ensure_metadata_replacement(
            replaced_metadata,
            scope.metadata_bytes.saturating_add(identity_metadata),
            location,
        )?;
        self.ensure_source_replacement(
            replaced_source,
            scope
                .source_bytes
                .saturating_add(scope.function_source_bytes),
            location,
        )?;
        let projected_work = self
            .retained_function_work()
            .saturating_sub(replaced_work)
            .saturating_add(scope.function_work);
        if projected_work > self.limits.max_steps {
            return Err(self.limit_error_at(
                location,
                format!(
                    "retained function syntax exceeded {} steps",
                    self.limits.max_steps
                ),
                None,
            ));
        }
        self.ensure_retained_value_replacement(replaced_bytes, retained_bytes, location)?;
        self.module_scope_bytes = self
            .module_scope_bytes
            .saturating_sub(replaced_bytes)
            .saturating_add(retained_bytes);
        self.module_scopes.insert(identity, scope);
        Ok(())
    }

    fn ensure_aggregate_value_addition(
        &self,
        aggregate_bytes: usize,
        addition_bytes: usize,
        location: SourceLocation,
    ) -> Result<usize, RuntimeError> {
        let next = aggregate_bytes.saturating_add(addition_bytes);
        self.ensure_literal_bytes(next, location)?;
        Ok(next)
    }

    fn current_scope_clone_bytes(&self) -> usize {
        let mut bytes = self.vars_bytes;
        for (key, function) in &self.functions {
            bytes = bytes
                .saturating_add(key.len().saturating_add(1))
                .saturating_add(Self::function_handle_clone_bytes(function));
        }
        for (key, imported) in &self.imported_values {
            bytes = bytes
                .saturating_add(key.len().saturating_add(1))
                .saturating_add(imported.module_identity.len().saturating_add(1))
                .saturating_add(imported.exported_name.len().saturating_add(1));
        }
        for (key, identity) in &self.namespaces {
            bytes = bytes
                .saturating_add(key.len().saturating_add(1))
                .saturating_add(identity.len().saturating_add(1));
        }
        for name in &self.read_only_bindings {
            bytes = bytes.saturating_add(name.len().saturating_add(1));
        }
        bytes.saturating_add(
            self.filename
                .as_ref()
                .map_or(0, |filename| filename.len().saturating_add(1)),
        )
    }

    fn current_scope_logical_clone_bytes(&self) -> usize {
        self.functions
            .iter()
            .fold(self.vars_bytes, |bytes, (key, function)| {
                bytes
                    .saturating_add(key.len().saturating_add(1))
                    .saturating_add(Self::function_handle_clone_bytes(function))
            })
    }

    fn stored_scope_clone_bytes(scope: &ModuleScope) -> usize {
        let mut bytes = scope.value_bytes;
        for (key, function) in &scope.functions {
            bytes = bytes
                .saturating_add(key.len().saturating_add(1))
                .saturating_add(Self::function_handle_clone_bytes(function));
        }
        for (key, imported) in &scope.imported_values {
            bytes = bytes
                .saturating_add(key.len().saturating_add(1))
                .saturating_add(imported.module_identity.len().saturating_add(1))
                .saturating_add(imported.exported_name.len().saturating_add(1));
        }
        for (key, identity) in &scope.namespaces {
            bytes = bytes
                .saturating_add(key.len().saturating_add(1))
                .saturating_add(identity.len().saturating_add(1));
        }
        for name in &scope.read_only_bindings {
            bytes = bytes.saturating_add(name.len().saturating_add(1));
        }
        for name in scope.exports.keys() {
            bytes = bytes.saturating_add(name.len().saturating_add(1));
        }
        bytes.saturating_add(scope.filename.len().saturating_add(1))
    }

    fn error_at(
        &self,
        location: SourceLocation,
        message: impl Into<String>,
        hint: Option<String>,
    ) -> RuntimeError {
        RuntimeError::at(
            RuntimeErrorKind::Evaluation,
            message,
            location,
            self.source_line(location),
            self.filename.as_ref().map(|name| name.to_string()),
            hint,
        )
    }

    fn attach_location(&self, error: RuntimeError, location: SourceLocation) -> RuntimeError {
        error.with_context(
            location,
            self.source_line(location),
            self.filename.as_ref().map(|name| name.to_string()),
        )
    }

    fn host_error_at(&self, error: HostError, location: SourceLocation) -> RuntimeError {
        self.attach_location(RuntimeError::from_host(error), location)
    }

    fn limit_error_at(
        &self,
        location: SourceLocation,
        message: impl Into<String>,
        hint: Option<String>,
    ) -> RuntimeError {
        let mut error = RuntimeError::at(
            RuntimeErrorKind::LimitExceeded,
            message,
            location,
            self.source_line(location),
            self.filename.as_ref().map(|name| name.to_string()),
            hint,
        );
        error.kind = RuntimeErrorKind::LimitExceeded;
        error
    }

    fn source_line(&self, location: SourceLocation) -> Option<String> {
        self.source
            .lines()
            .nth(location.line.saturating_sub(1))
            .map(str::to_owned)
    }

    fn charge_preflight_work(
        &self,
        budget: &mut PreflightBudget,
        location: Option<SourceLocation>,
    ) -> Result<(), RuntimeError> {
        self.charge_preflight_work_units(budget, 1, location)
    }

    fn charge_preflight_work_units(
        &self,
        budget: &mut PreflightBudget,
        units: usize,
        location: Option<SourceLocation>,
    ) -> Result<(), RuntimeError> {
        if units > budget.max_work.saturating_sub(budget.work) {
            let message = format!("evaluation stopped after {} steps", budget.max_work);
            return Err(match location {
                Some(location) => self.limit_error_at(location, message, None),
                None => RuntimeError::with_kind(RuntimeErrorKind::LimitExceeded, message),
            });
        }
        budget.work += units;
        Ok(())
    }

    fn clone_preflight_functions(
        &self,
        function_names: &HashSet<String>,
        budget: &mut PreflightBudget,
        location: SourceLocation,
    ) -> Result<HashSet<String>, RuntimeError> {
        for name in function_names {
            self.charge_preflight_work_units(budget, name.len().saturating_add(1), Some(location))?;
        }
        Ok(function_names.clone())
    }

    fn preflight_child_depth(
        &self,
        budget: &PreflightBudget,
        parent_depth: usize,
        location: SourceLocation,
    ) -> Result<usize, RuntimeError> {
        let child_depth = parent_depth.saturating_add(1);
        if child_depth > budget.max_depth {
            return Err(self.limit_error_at(
                location,
                format!("syntax nesting exceeded {}", budget.max_depth),
                None,
            ));
        }
        Ok(child_depth)
    }

    fn reset_epoch(&mut self, source: &str, source_name: Option<&str>) {
        self.vars.clear();
        self.vars_bytes = 0;
        self.functions.clear();
        self.functions_bytes = 0;
        self.functions_work = 0;
        self.function_source_refs.clear();
        self.function_source_bytes = 0;
        self.agents.clear();
        self.agents_bytes = 0;
        self.outputs.clear();
        self.output_bytes = 0;
        self.imported_values.clear();
        self.namespaces.clear();
        self.read_only_bindings.clear();
        self.module_scopes.clear();
        self.module_scope_bytes = 0;
        self.suspended_scope_bytes = 0;
        self.suspended_metadata_bytes = 0;
        self.value_work_bytes = 0;
        self.module_initialization.clear();
        self.local_bindings.clear();
        self.local_bindings_bytes = 0;
        self.function_scope_starts.clear();
        self.active_module_calls.clear();
        self.active_module = None;
        self.module_execution_enabled = false;
        self.scope_metadata_bytes = 0;
        self.active_source_bytes = source
            .len()
            .saturating_add(source_name.map_or(0, str::len))
            .saturating_add(2);
        self.steps = 0;
        self.call_depth = 0;
        self.source = Arc::from(source);
        self.filename = source_name.map(Arc::from);
    }

    fn set_active_source(&mut self, source: &str, source_name: &str) {
        self.source = Arc::from(source);
        self.filename = Some(Arc::from(source_name));
    }

    fn retained_function_catalog(
        &self,
        budget: &mut PreflightBudget,
    ) -> Result<Vec<Function>, RuntimeError> {
        let location = Some(SourceLocation::new(1, 1));
        let mut allocation_units = 0usize;
        for (retained_name, function) in &self.functions {
            let definition_bytes = function
                .name
                .len()
                .saturating_add(function.filename.as_ref().map_or(0, |name| name.len()))
                .saturating_add(function.module_identity.as_ref().map_or(0, String::len));
            allocation_units = allocation_units
                .saturating_add(3)
                .saturating_add(retained_name.len())
                .saturating_add(definition_bytes.saturating_mul(2));
        }
        for (identity, scope) in &self.module_scopes {
            allocation_units = allocation_units
                .saturating_add(1)
                .saturating_add(identity.len());
            for (retained_name, function) in &scope.functions {
                let definition_bytes = function
                    .name
                    .len()
                    .saturating_add(function.filename.as_ref().map_or(0, |name| name.len()))
                    .saturating_add(function.module_identity.as_ref().map_or(0, String::len));
                allocation_units = allocation_units
                    .saturating_add(3)
                    .saturating_add(retained_name.len())
                    .saturating_add(definition_bytes.saturating_mul(2));
            }
        }
        self.charge_preflight_work_units(budget, allocation_units, location)?;

        let mut catalog = BTreeMap::new();
        let mut entry_names = self.functions.keys().collect::<Vec<_>>();
        entry_names.sort();
        for retained_name in entry_names {
            let function = self
                .functions
                .get(retained_name)
                .expect("retained function name came from the same map");
            catalog
                .entry(FunctionDefinitionKey::from(function))
                .or_insert_with(|| function.clone());
        }

        let mut module_identities = self.module_scopes.keys().collect::<Vec<_>>();
        module_identities.sort();
        for identity in module_identities {
            let scope = self
                .module_scopes
                .get(identity)
                .expect("module identity came from the same map");
            let mut retained_names = scope.functions.keys().collect::<Vec<_>>();
            retained_names.sort();
            for retained_name in retained_names {
                let function = scope
                    .functions
                    .get(retained_name)
                    .expect("retained function name came from the same module scope");
                catalog
                    .entry(FunctionDefinitionKey::from(function))
                    .or_insert_with(|| function.clone());
            }
        }

        Ok(catalog.into_values().collect())
    }

    fn preflight_scope_context(
        &self,
        functions: &HashMap<String, Function>,
        imported_values: &HashMap<String, ImportedValue>,
        namespaces: &HashMap<String, String>,
        defining_module: Option<&str>,
        budget: &mut PreflightBudget,
    ) -> Result<(HashSet<String>, HashMap<String, ExportKind>), RuntimeError> {
        let location = Some(SourceLocation::new(1, 1));
        let mut allocation_units = namespaces.keys().fold(0usize, |total, name| {
            total.saturating_add(1).saturating_add(name.len())
        });
        for (name, function) in functions {
            allocation_units = allocation_units
                .saturating_add(2)
                .saturating_add(name.len());
            let imported = match defining_module {
                Some(identity) => function.module_identity.as_deref() != Some(identity),
                None => function.module_identity.is_some(),
            };
            if imported {
                allocation_units = allocation_units
                    .saturating_add(1)
                    .saturating_add(name.len());
            }
        }
        for name in imported_values.keys() {
            allocation_units = allocation_units
                .saturating_add(2)
                .saturating_add(name.len());
        }
        self.charge_preflight_work_units(budget, allocation_units, location)?;

        let mut function_names = HashSet::new();
        let mut module_imports = HashMap::new();

        let mut names = functions.keys().collect::<Vec<_>>();
        names.sort();
        for name in names {
            function_names.insert(name.clone());
            let function = functions
                .get(name)
                .expect("function name came from the same scope");
            let imported = match defining_module {
                Some(identity) => function.module_identity.as_deref() != Some(identity),
                None => function.module_identity.is_some(),
            };
            if imported {
                module_imports.insert(name.clone(), ExportKind::Function);
            }
        }

        let mut imported_names = imported_values.keys().collect::<Vec<_>>();
        imported_names.sort();
        for name in imported_names {
            module_imports.insert(name.clone(), ExportKind::Let);
        }

        Ok((function_names, module_imports))
    }

    fn prepare_agent_projection(
        &self,
        budget: &mut PreflightBudget,
    ) -> Result<(HashMap<String, usize>, usize), RuntimeError> {
        let allocation_units = self.agents.keys().fold(0usize, |total, name| {
            total.saturating_add(2).saturating_add(name.len())
        });
        self.charge_preflight_work_units(
            budget,
            allocation_units,
            Some(SourceLocation::new(1, 1)),
        )?;
        Ok((
            self.agents
                .iter()
                .map(|(name, agent)| (name.clone(), agent.retained_bytes))
                .collect(),
            self.agents_bytes,
        ))
    }

    fn ensure_projected_agent_bytes(
        &self,
        retained_without_agents: usize,
        projected_agent_bytes: usize,
        location: SourceLocation,
    ) -> Result<(), RuntimeError> {
        if projected_agent_bytes
            > self
                .limits
                .max_value_bytes
                .saturating_sub(retained_without_agents)
        {
            return Err(self.limit_error_at(
                location,
                format!(
                    "retained values exceeded {} bytes",
                    self.limits.max_value_bytes
                ),
                Some("Keep less live evaluator state or use smaller agent metadata.".to_string()),
            ));
        }
        Ok(())
    }

    fn preflight_agent_metadata(
        &self,
        statements: &[Stmt],
        projected_sizes: &mut HashMap<String, usize>,
        projected_bytes: &mut usize,
        retained_without_agents: Option<usize>,
        budget: &mut PreflightBudget,
        depth: usize,
    ) -> Result<(), RuntimeError> {
        for statement in statements {
            let location = statement_location(statement);
            self.charge_preflight_work(budget, Some(location))?;
            match statement {
                Stmt::Agent {
                    name,
                    instruction,
                    tools,
                    ..
                } => {
                    let entry_bytes =
                        self.agent_metadata_bytes(name, instruction, tools, location)?;
                    self.charge_preflight_work_units(
                        budget,
                        entry_bytes.saturating_add(2),
                        Some(location),
                    )?;
                    let previous = projected_sizes.get(name).copied().unwrap_or(0);
                    if entry_bytes > previous {
                        let next = projected_bytes
                            .saturating_sub(previous)
                            .saturating_add(entry_bytes);
                        match retained_without_agents {
                            Some(retained_bytes) => {
                                self.ensure_projected_agent_bytes(retained_bytes, next, location)?;
                            }
                            None => self.ensure_literal_bytes(next, location)?,
                        }
                        projected_sizes.insert(name.clone(), entry_bytes);
                        *projected_bytes = next;
                    }
                }
                Stmt::Export {
                    declaration: crate::ast::ExportedDeclaration::Function { body, .. },
                    ..
                }
                | Stmt::Function { body, .. }
                | Stmt::While { body, .. }
                | Stmt::For { body, .. } => {
                    if let Some(first) = body.first() {
                        let child_depth =
                            self.preflight_child_depth(budget, depth, statement_location(first))?;
                        self.preflight_agent_metadata(
                            body,
                            projected_sizes,
                            projected_bytes,
                            retained_without_agents,
                            budget,
                            child_depth,
                        )?;
                    }
                }
                Stmt::If {
                    then_branch,
                    else_branch,
                    ..
                } => {
                    for branch in [then_branch, else_branch] {
                        if let Some(first) = branch.first() {
                            let child_depth = self.preflight_child_depth(
                                budget,
                                depth,
                                statement_location(first),
                            )?;
                            self.preflight_agent_metadata(
                                branch,
                                projected_sizes,
                                projected_bytes,
                                retained_without_agents,
                                budget,
                                child_depth,
                            )?;
                        }
                    }
                }
                Stmt::LegacyInclude { .. }
                | Stmt::ModuleImport { .. }
                | Stmt::NamedModuleImport { .. }
                | Stmt::Export { .. }
                | Stmt::Let { .. }
                | Stmt::Assign { .. }
                | Stmt::Print { .. }
                | Stmt::Return { .. }
                | Stmt::Break { .. }
                | Stmt::Continue { .. }
                | Stmt::Ask { .. }
                | Stmt::Expr(_) => {}
            }
        }
        Ok(())
    }

    pub fn run(&mut self, statements: &[Stmt]) -> Result<(), RuntimeError> {
        self.value_work_bytes = 0;
        if !self.retain_output {
            self.output_bytes = 0;
        }
        let source_name = self.configured_source_name.clone();
        let saved_source = self.source.clone();
        let saved_filename = self.filename.clone();
        self.source = self.configured_source.clone();
        self.filename = source_name.clone();
        if self.input_injected && self.read_only_bindings.contains("input") {
            let error = self.error_at(
                SourceLocation::new(1, 1),
                "the injected input value conflicts with a retained entry import",
                Some("Run a fresh module epoch without an import named 'input'.".to_string()),
            );
            self.source = saved_source;
            self.filename = saved_filename;
            return Err(error);
        }
        if let Some(bytes) = self.configured_source_rejected_bytes {
            let error = self.limit_error_at(
                SourceLocation::new(1, 1),
                format!(
                    "source snapshot of {bytes} bytes exceeded {} bytes",
                    structural_byte_limit(self.limits)
                ),
                Some("Use a smaller source snapshot.".to_string()),
            );
            self.source = saved_source;
            self.filename = saved_filename;
            return Err(error);
        }
        if let Err(error) = bounded_syntax_snapshot_bytes(statements, self.limits) {
            let error = self.attach_location(error, SourceLocation::new(1, 1));
            self.source = saved_source;
            self.filename = saved_filename;
            return Err(error);
        }
        if let Err(error) = self.validate_plain_surface(statements) {
            self.source = saved_source;
            self.filename = saved_filename;
            return Err(error);
        }
        if let Err(error) = self.validate_control_flow(statements, 0) {
            self.source = saved_source;
            self.filename = saved_filename;
            return Err(error);
        }
        let mut preflight_budget = PreflightBudget::new(self.limits);
        if let Err(error) =
            self.validate_incremental_import_semantics(statements, &mut preflight_budget)
        {
            self.source = saved_source;
            self.filename = saved_filename;
            return Err(error);
        }
        let new_source_bytes = self
            .configured_source
            .len()
            .saturating_add(source_name.as_ref().map_or(0, |name| name.len()))
            .saturating_add(2);
        if let Err(error) = self.ensure_source_replacement(
            self.active_source_bytes,
            new_source_bytes,
            SourceLocation::new(1, 1),
        ) {
            self.source = saved_source;
            self.filename = saved_filename;
            return Err(error);
        }
        if let Some(input) = &self.input {
            match self.ensure_value_within_limit(input, Some(SourceLocation::new(1, 1))) {
                Ok(size) => self.input_bytes = size,
                Err(error) => {
                    self.input_bytes = 0;
                    self.source = saved_source;
                    self.filename = saved_filename;
                    return Err(error);
                }
            }
        } else {
            self.input_bytes = 0;
        }
        if let Err(error) = self.ensure_retained_values_within_limit(SourceLocation::new(1, 1)) {
            self.source = saved_source;
            self.filename = saved_filename;
            return Err(error);
        }
        let retained_functions = match self.retained_function_catalog(&mut preflight_budget) {
            Ok(functions) => functions,
            Err(error) => {
                self.source = saved_source;
                self.filename = saved_filename;
                return Err(error);
            }
        };
        let (mut function_names, entry_module_imports) = match self.preflight_scope_context(
            &self.functions,
            &self.imported_values,
            &self.namespaces,
            None,
            &mut preflight_budget,
        ) {
            Ok(context) => context,
            Err(error) => {
                self.source = saved_source;
                self.filename = saved_filename;
                return Err(error);
            }
        };
        let module_identity_units =
            self.module_scopes
                .iter()
                .fold(0usize, |total, (identity, scope)| {
                    total
                        .saturating_add(2)
                        .saturating_add(identity.len())
                        .saturating_add(scope.filename.len())
                });
        if let Err(error) = self.charge_preflight_work_units(
            &mut preflight_budget,
            module_identity_units,
            Some(SourceLocation::new(1, 1)),
        ) {
            self.source = saved_source;
            self.filename = saved_filename;
            return Err(error);
        }
        let mut module_contexts = HashMap::new();
        let mut module_identities = self.module_scopes.keys().cloned().collect::<Vec<_>>();
        module_identities.sort();
        for identity in module_identities {
            let (scope_source, scope_filename) = {
                let scope = self
                    .module_scopes
                    .get(&identity)
                    .expect("module identity came from the same map");
                (scope.source.clone(), scope.filename.clone())
            };
            self.source = scope_source;
            self.filename = Some(scope_filename);
            let scope = self
                .module_scopes
                .get(&identity)
                .expect("module identity came from the same map");
            match self.preflight_scope_context(
                &scope.functions,
                &scope.imported_values,
                &scope.namespaces,
                Some(&identity),
                &mut preflight_budget,
            ) {
                Ok(context) => {
                    module_contexts.insert(identity, context);
                }
                Err(error) => {
                    self.source = saved_source;
                    self.filename = saved_filename;
                    return Err(error);
                }
            }
        }
        for function in &retained_functions {
            self.source = function.source.clone();
            self.filename = function.filename.clone();
            let (input_injected, retained_function_names, retained_module_imports) =
                match function.module_identity.as_deref() {
                    Some(identity) => {
                        let Some((names, imports)) = module_contexts.get(identity) else {
                            let error = self.error_at(
                                function.location,
                                "retained module function has no defining module scope",
                                None,
                            );
                            self.source = saved_source;
                            self.filename = saved_filename;
                            return Err(error);
                        };
                        (false, names, Some(imports))
                    }
                    None => (
                        self.input_injected,
                        &function_names,
                        self.module_execution_enabled
                            .then_some(&entry_module_imports),
                    ),
                };
            if let Err(error) = self.preflight_function(
                &function.name,
                &function.params,
                &function.body,
                function.location,
                input_injected,
                retained_function_names,
                retained_module_imports,
                &mut preflight_budget,
                0,
            ) {
                self.source = saved_source;
                self.filename = saved_filename;
                return Err(error);
            }
        }
        self.source = self.configured_source.clone();
        self.filename = source_name.clone();
        if let Err(error) = self.preflight_statements(
            statements,
            self.input_injected,
            &mut function_names,
            None,
            &mut preflight_budget,
            0,
        ) {
            self.source = saved_source;
            self.filename = saved_filename;
            return Err(error);
        }
        let retained_without_agents = self
            .logical_retained_value_bytes()
            .saturating_sub(self.agents_bytes);
        let (mut projected_agent_sizes, mut projected_agent_bytes) =
            match self.prepare_agent_projection(&mut preflight_budget) {
                Ok(projection) => projection,
                Err(error) => {
                    self.source = saved_source;
                    self.filename = saved_filename;
                    return Err(error);
                }
            };
        for function in &retained_functions {
            self.source = function.source.clone();
            self.filename = function.filename.clone();
            if let Err(error) = self.preflight_agent_metadata(
                &function.body,
                &mut projected_agent_sizes,
                &mut projected_agent_bytes,
                Some(retained_without_agents),
                &mut preflight_budget,
                0,
            ) {
                self.source = saved_source;
                self.filename = saved_filename;
                return Err(error);
            }
        }
        self.source = self.configured_source.clone();
        self.filename = source_name;
        if let Err(error) = self.preflight_agent_metadata(
            statements,
            &mut projected_agent_sizes,
            &mut projected_agent_bytes,
            Some(retained_without_agents),
            &mut preflight_budget,
            0,
        ) {
            self.source = saved_source;
            self.filename = saved_filename;
            return Err(error);
        }
        self.active_source_bytes = new_source_bytes;
        self.steps = 0;
        self.call_depth = 0;
        self.execute_block(statements).map(|_| ())
    }

    pub fn run_modules(&mut self, program: &ModuleProgram) -> Result<(), RuntimeError> {
        let mut preflight_budget = PreflightBudget::new(self.limits);
        self.charge_preflight_work(&mut preflight_budget, None)?;
        if let Err(failure) = module_program_snapshot_metrics(program, self.limits) {
            return Err(match failure.identity {
                Some(identity) => {
                    let source_line = program
                        .modules
                        .get(identity)
                        .and_then(|node| node.source.lines().next())
                        .map(str::to_owned);
                    RuntimeError::at(
                        RuntimeErrorKind::LimitExceeded,
                        failure.error.message().to_string(),
                        SourceLocation::new(1, 1),
                        source_line,
                        Some(identity.to_string()),
                        None,
                    )
                }
                None => failure.error,
            });
        }
        if program.order.is_empty() {
            return Err(RuntimeError::new("explicit module graph is empty"));
        }
        let entry_identity = program.entry.clone();
        let entry = program
            .modules
            .get(&entry_identity)
            .ok_or_else(|| RuntimeError::new("explicit module entry is missing from the graph"))?;
        let saved_source = self.source.clone();
        let saved_filename = self.filename.clone();
        self.set_active_source(&entry.source, &entry_identity);
        let validated_input_bytes = match &self.input {
            Some(input) => {
                match self.ensure_value_within_limit(input, Some(SourceLocation::new(1, 1))) {
                    Ok(bytes) => bytes,
                    Err(error) => {
                        self.source = saved_source;
                        self.filename = saved_filename;
                        return Err(error);
                    }
                }
            }
            None => 0,
        };
        self.source = saved_source.clone();
        self.filename = saved_filename.clone();
        if program.order.last() != Some(&entry_identity) {
            return Err(RuntimeError::new(
                "explicit module entry must be last in initialization order",
            ));
        }
        let mut identities = HashSet::new();
        let mut positions = HashMap::new();
        for (position, identity) in program.order.iter().enumerate() {
            self.charge_preflight_work(&mut preflight_budget, None)?;
            if !identities.insert(identity) {
                return Err(RuntimeError::new(format!(
                    "duplicate module '{}' in initialization order",
                    identity
                )));
            }
            let node = program
                .modules
                .get(identity)
                .ok_or_else(|| RuntimeError::new("resolved module is missing from the graph"))?;
            if node.identity != *identity {
                return Err(RuntimeError::new(format!(
                    "module identity '{}' does not match graph key '{}'",
                    node.identity, identity
                )));
            }
            positions.insert(identity.as_str(), position);
        }
        if identities.len() != program.modules.len() {
            return Err(RuntimeError::new(
                "module graph contains a node absent from initialization order",
            ));
        }
        for (identity, node) in &program.modules {
            self.charge_preflight_work(&mut preflight_budget, None)?;
            let position = positions[identity.as_str()];
            for dependency in &node.dependencies {
                self.charge_preflight_work(&mut preflight_budget, None)?;
                let dependency_position = positions.get(dependency.as_str()).ok_or_else(|| {
                    RuntimeError::new(format!(
                        "module '{}' depends on missing module '{}'",
                        identity, dependency
                    ))
                })?;
                if *dependency_position >= position {
                    return Err(RuntimeError::new(format!(
                        "module dependency '{}' must precede '{}' in initialization order",
                        dependency, identity
                    )));
                }
            }
        }

        for identity in &program.order {
            let node = program
                .modules
                .get(identity)
                .expect("validated module order refers to a node");
            self.set_active_source(&node.source, identity);
            if let Err(error) = self.validate_control_flow(&node.statements, 0) {
                self.source = saved_source;
                self.filename = saved_filename;
                return Err(error);
            }
            let named_imports = match self.validate_module_preflight(
                program,
                node,
                identity != &entry_identity,
                &mut preflight_budget,
            ) {
                Ok(named_imports) => named_imports,
                Err(error) => {
                    self.source = saved_source;
                    self.filename = saved_filename;
                    return Err(error);
                }
            };
            let mut function_names = named_imports
                .iter()
                .filter(|(_, kind)| **kind == ExportKind::Function)
                .map(|(name, _)| name.clone())
                .collect::<HashSet<_>>();
            if let Err(error) = self.preflight_statements(
                &node.statements,
                identity == &entry_identity && self.input_injected,
                &mut function_names,
                Some(&named_imports),
                &mut preflight_budget,
                0,
            ) {
                self.source = saved_source;
                self.filename = saved_filename;
                return Err(error);
            }
        }
        let mut projected_agent_sizes = HashMap::new();
        let mut projected_agent_bytes = 0usize;
        for identity in &program.order {
            let node = program
                .modules
                .get(identity)
                .expect("validated module order refers to a node");
            self.set_active_source(&node.source, identity);
            if let Err(error) = self.preflight_agent_metadata(
                &node.statements,
                &mut projected_agent_sizes,
                &mut projected_agent_bytes,
                None,
                &mut preflight_budget,
                0,
            ) {
                self.source = saved_source;
                self.filename = saved_filename;
                return Err(error);
            }
        }
        // Dependency top levels are host-incapable by validation above. Build
        // their pure state in isolation so any value/work failure occurs before
        // the current workflow epoch is reset.
        let mut initialized = Evaluator::new(DenyAllHost)
            .with_limits(self.limits)
            .with_output_retention(false);
        for identity in &program.order {
            if identity == &entry_identity {
                continue;
            }
            if let Err(error) = initialized.initialize_module(program, identity) {
                self.source = saved_source;
                self.filename = saved_filename;
                return Err(error);
            }
        }
        initialized.set_active_source(&entry.source, &entry_identity);
        initialized.active_source_bytes = entry
            .source
            .len()
            .saturating_add(entry_identity.len())
            .saturating_add(2);
        initialized.module_execution_enabled = true;
        if let Err(error) =
            initialized.install_imports(&entry.statements, entry.dependencies.as_slice())
        {
            self.source = saved_source;
            self.filename = saved_filename;
            return Err(error);
        }

        let staged_retained_bytes = initialized
            .module_scope_bytes
            .saturating_add(initialized.functions_bytes)
            .saturating_add(projected_agent_bytes);
        if validated_input_bytes
            > self
                .limits
                .max_value_bytes
                .saturating_sub(staged_retained_bytes)
        {
            let error = self.limit_error_at(
                SourceLocation::new(1, 1),
                format!(
                    "retained values exceeded {} bytes",
                    self.limits.max_value_bytes
                ),
                Some("Use smaller input, agent metadata, or initialized module state.".to_string()),
            );
            self.source = saved_source;
            self.filename = saved_filename;
            return Err(error);
        }

        let initialized_steps = initialized.steps;
        let initialized_value_work_bytes = initialized.value_work_bytes;
        let initialized_module_scope_bytes = initialized.module_scope_bytes;
        let initialized_scopes = std::mem::take(&mut initialized.module_scopes);
        let initialized_status = std::mem::take(&mut initialized.module_initialization);
        let initialized_functions = std::mem::take(&mut initialized.functions);
        let initialized_functions_bytes = std::mem::take(&mut initialized.functions_bytes);
        let initialized_functions_work = std::mem::take(&mut initialized.functions_work);
        let initialized_function_source_refs =
            std::mem::take(&mut initialized.function_source_refs);
        let initialized_function_source_bytes =
            std::mem::take(&mut initialized.function_source_bytes);
        let initialized_imported_values = std::mem::take(&mut initialized.imported_values);
        let initialized_namespaces = std::mem::take(&mut initialized.namespaces);
        let initialized_read_only = std::mem::take(&mut initialized.read_only_bindings);
        let initialized_metadata_bytes = std::mem::take(&mut initialized.scope_metadata_bytes);

        self.reset_epoch(&entry.source, Some(&entry_identity));
        self.input_bytes = validated_input_bytes;
        self.steps = initialized_steps;
        self.value_work_bytes = initialized_value_work_bytes;
        self.module_scope_bytes = initialized_module_scope_bytes;
        self.module_scopes = initialized_scopes;
        self.module_initialization = initialized_status;
        self.functions = initialized_functions;
        self.functions_bytes = initialized_functions_bytes;
        self.functions_work = initialized_functions_work;
        self.function_source_refs = initialized_function_source_refs;
        self.function_source_bytes = initialized_function_source_bytes;
        self.imported_values = initialized_imported_values;
        self.namespaces = initialized_namespaces;
        self.read_only_bindings = initialized_read_only;
        self.scope_metadata_bytes = initialized_metadata_bytes;

        self.module_execution_enabled = true;
        self.execute_block(&entry.statements).map(|_| ())
    }

    fn validate_control_flow(
        &self,
        statements: &[Stmt],
        loop_depth: usize,
    ) -> Result<(), RuntimeError> {
        for statement in statements {
            match statement {
                Stmt::Break { location } | Stmt::Continue { location } if loop_depth == 0 => {
                    return Err(self.error_at(
                        *location,
                        "loop control may only appear inside a loop",
                        None,
                    ));
                }
                Stmt::Function { body, .. }
                | Stmt::Export {
                    declaration: ExportedDeclaration::Function { body, .. },
                    ..
                } => self.validate_control_flow(body, 0)?,
                Stmt::If {
                    then_branch,
                    else_branch,
                    ..
                } => {
                    self.validate_control_flow(then_branch, loop_depth)?;
                    self.validate_control_flow(else_branch, loop_depth)?;
                }
                Stmt::While { body, .. } | Stmt::For { body, .. } => {
                    self.validate_control_flow(body, loop_depth.saturating_add(1))?;
                }
                _ => {}
            }
        }
        Ok(())
    }

    fn validate_plain_surface(&self, statements: &[Stmt]) -> Result<(), RuntimeError> {
        for statement in statements {
            match statement {
                Stmt::LegacyInclude { .. }
                | Stmt::ModuleImport { .. }
                | Stmt::NamedModuleImport { .. }
                | Stmt::Export { .. } => {
                    return Err(self.error_at(
                        statement_location(statement),
                        "module loading is unavailable in the pure evaluator",
                        Some(
                            "Resolve includes and imports into an in-memory ModuleProgram before evaluation."
                                .to_string(),
                        ),
                    ));
                }
                Stmt::Function { body, .. } | Stmt::While { body, .. } | Stmt::For { body, .. } => {
                    self.validate_plain_surface(body)?
                }
                Stmt::If {
                    then_branch,
                    else_branch,
                    ..
                } => {
                    self.validate_plain_surface(then_branch)?;
                    self.validate_plain_surface(else_branch)?;
                }
                _ => {}
            }
        }
        Ok(())
    }

    fn validate_incremental_import_semantics(
        &self,
        statements: &[Stmt],
        budget: &mut PreflightBudget,
    ) -> Result<(), RuntimeError> {
        self.validate_incremental_import_block(statements, &mut Vec::new(), None, budget)
    }

    fn validate_incremental_import_block<'a>(
        &self,
        statements: &'a [Stmt],
        scopes: &mut Vec<HashSet<&'a str>>,
        scope: Option<HashSet<&'a str>>,
        budget: &mut PreflightBudget,
    ) -> Result<(), RuntimeError> {
        let pushed = scope.is_some();
        if let Some(scope) = scope {
            scopes.push(scope);
        }
        let result = statements.iter().try_for_each(|statement| {
            self.charge_preflight_work(budget, Some(statement_location(statement)))?;
            match statement {
                Stmt::Let {
                    name,
                    value,
                    location,
                } => {
                    self.validate_incremental_import_expr(value, scopes, budget)?;
                    if self.read_only_bindings.contains(name) && scopes.is_empty() {
                        return Err(self.error_at(
                            *location,
                            format!("imported binding '{}' is read-only", name),
                            None,
                        ));
                    }
                    if let Some(scope) = scopes.last_mut() {
                        self.charge_preflight_work_units(
                            budget,
                            name.len().saturating_add(1),
                            Some(*location),
                        )?;
                        scope.insert(name);
                    }
                    Ok(())
                }
                Stmt::Assign {
                    name,
                    value,
                    location,
                } => {
                    self.validate_incremental_import_expr(value, scopes, budget)?;
                    if self.read_only_bindings.contains(name)
                        && !lexical_binding_exists(scopes, name)
                    {
                        return Err(self.error_at(
                            *location,
                            format!("imported binding '{}' is read-only", name),
                            None,
                        ));
                    }
                    Ok(())
                }
                Stmt::Function {
                    name,
                    params,
                    body,
                    location,
                } => {
                    if self.read_only_bindings.contains(name) {
                        return Err(self.error_at(
                            *location,
                            format!("imported binding '{}' is read-only", name),
                            None,
                        ));
                    }
                    let mut function_scope = HashSet::new();
                    for param in params {
                        self.charge_preflight_work_units(
                            budget,
                            param.len().saturating_add(1),
                            Some(*location),
                        )?;
                        function_scope.insert(param.as_str());
                    }
                    let mut function_scopes = Vec::new();
                    self.validate_incremental_import_block(
                        body,
                        &mut function_scopes,
                        Some(function_scope),
                        budget,
                    )
                }
                Stmt::If {
                    condition,
                    then_branch,
                    else_branch,
                    ..
                } => {
                    self.validate_incremental_import_expr(condition, scopes, budget)?;
                    let nested = (!scopes.is_empty()).then(HashSet::new);
                    self.validate_incremental_import_block(then_branch, scopes, nested, budget)?;
                    let nested = (!scopes.is_empty()).then(HashSet::new);
                    self.validate_incremental_import_block(else_branch, scopes, nested, budget)
                }
                Stmt::While {
                    condition, body, ..
                } => {
                    self.validate_incremental_import_expr(condition, scopes, budget)?;
                    let nested = (!scopes.is_empty()).then(HashSet::new);
                    self.validate_incremental_import_block(body, scopes, nested, budget)
                }
                Stmt::For {
                    name,
                    iterable,
                    body,
                    location,
                } => {
                    self.validate_incremental_import_expr(iterable, scopes, budget)?;
                    self.charge_preflight_work_units(
                        budget,
                        name.len().saturating_add(1),
                        Some(*location),
                    )?;
                    self.validate_incremental_import_block(
                        body,
                        scopes,
                        Some(HashSet::from([name.as_str()])),
                        budget,
                    )
                }
                Stmt::Print { value, .. } | Stmt::Return { value, .. } | Stmt::Expr(value) => {
                    self.validate_incremental_import_expr(value, scopes, budget)
                }
                Stmt::Ask { message, .. } => {
                    self.validate_incremental_import_expr(message, scopes, budget)
                }
                Stmt::LegacyInclude { .. }
                | Stmt::ModuleImport { .. }
                | Stmt::NamedModuleImport { .. }
                | Stmt::Export { .. }
                | Stmt::Break { .. }
                | Stmt::Continue { .. }
                | Stmt::Agent { .. } => Ok(()),
            }
        });
        if pushed {
            scopes.pop();
        }
        result
    }

    fn validate_incremental_import_expr(
        &self,
        expression: &Expr,
        scopes: &mut Vec<HashSet<&str>>,
        budget: &mut PreflightBudget,
    ) -> Result<(), RuntimeError> {
        self.charge_preflight_work(budget, Some(expression.location))?;
        match &expression.kind {
            ExprKind::Call { name, args } => {
                if self.read_only_bindings.contains(name)
                    && self.functions.contains_key(name)
                    && lexical_binding_exists(scopes, name)
                {
                    return Err(self.error_at(
                        expression.location,
                        format!("lexical binding '{}' is not callable", name),
                        None,
                    ));
                }
                for argument in args {
                    self.validate_incremental_import_expr(argument, scopes, budget)?;
                }
            }
            ExprKind::ModuleCall {
                namespace, args, ..
            } => {
                if self.namespaces.contains_key(namespace)
                    && lexical_binding_exists(scopes, namespace)
                {
                    return Err(self.error_at(
                        expression.location,
                        format!("lexical binding '{}' is not a module namespace", namespace),
                        None,
                    ));
                }
                for argument in args {
                    self.validate_incremental_import_expr(argument, scopes, budget)?;
                }
            }
            ExprKind::Array(values) => {
                for value in values {
                    self.validate_incremental_import_expr(value, scopes, budget)?;
                }
            }
            ExprKind::Object(entries) => {
                for value in entries.values() {
                    self.validate_incremental_import_expr(value, scopes, budget)?;
                }
            }
            ExprKind::Property(target, _) | ExprKind::Unary { expr: target, .. } => {
                self.validate_incremental_import_expr(target, scopes, budget)?;
            }
            ExprKind::Index(target, index)
            | ExprKind::Binary {
                left: target,
                right: index,
                ..
            } => {
                self.validate_incremental_import_expr(target, scopes, budget)?;
                self.validate_incremental_import_expr(index, scopes, budget)?;
            }
            ExprKind::Number(_) | ExprKind::Text(_) | ExprKind::Bool(_) | ExprKind::Variable(_) => {
            }
        }
        Ok(())
    }

    fn validate_module_preflight(
        &self,
        program: &ModuleProgram,
        node: &ModuleNode,
        require_declarative_top_level: bool,
        budget: &mut PreflightBudget,
    ) -> Result<HashMap<String, ExportKind>, RuntimeError> {
        self.validate_module_export_contract(node, budget)?;
        let mut dependencies = node.dependencies.iter();
        let mut named_imports = HashMap::new();
        let mut namespaces = HashMap::new();

        for statement in &node.statements {
            self.charge_preflight_work(budget, Some(statement_location(statement)))?;
            if require_declarative_top_level {
                self.validate_module_declaration_shape(statement, budget, 0)?;
            }
            match statement {
                Stmt::ModuleImport {
                    namespace,
                    location,
                    ..
                } => {
                    let dependency = dependencies.next().ok_or_else(|| {
                        self.error_at(
                            *location,
                            "explicit module import is absent from the validated dependency graph",
                            None,
                        )
                    })?;
                    self.charge_preflight_work(budget, Some(*location))?;
                    let dependency_node = program.modules.get(dependency).ok_or_else(|| {
                        self.error_at(
                            *location,
                            "explicit module dependency is absent from the in-memory program",
                            None,
                        )
                    })?;
                    namespaces.insert(namespace.clone(), dependency_node.identity.clone());
                }
                Stmt::NamedModuleImport {
                    bindings, location, ..
                } => {
                    let dependency = dependencies.next().ok_or_else(|| {
                        self.error_at(
                            *location,
                            "explicit module import is absent from the validated dependency graph",
                            None,
                        )
                    })?;
                    self.charge_preflight_work(budget, Some(*location))?;
                    let dependency_node = program.modules.get(dependency).ok_or_else(|| {
                        self.error_at(
                            *location,
                            "explicit module dependency is absent from the in-memory program",
                            None,
                        )
                    })?;
                    for binding in bindings {
                        self.charge_preflight_work(budget, Some(binding.exported_location))?;
                        let kind =
                            dependency_node
                                .exports
                                .get(&binding.exported)
                                .ok_or_else(|| {
                                    self.error_at(
                                        binding.exported_location,
                                        format!(
                                            "module '{}' does not export '{}'",
                                            dependency, binding.exported
                                        ),
                                        None,
                                    )
                                })?;
                        named_imports.insert(binding.local.clone(), *kind);
                    }
                }
                _ => {}
            }
        }

        if dependencies.next().is_some() {
            return Err(self.error_at(
                SourceLocation::new(1, 1),
                "validated module graph contains an unbound explicit import",
                None,
            ));
        }
        for statement in &node.statements {
            if !matches!(
                statement,
                Stmt::ModuleImport { .. } | Stmt::NamedModuleImport { .. }
            ) {
                self.validate_module_statement(
                    statement,
                    program,
                    &named_imports,
                    &namespaces,
                    &mut Vec::new(),
                    false,
                    budget,
                    0,
                )?;
            }
        }
        Ok(named_imports)
    }

    fn validate_module_export_contract(
        &self,
        node: &ModuleNode,
        budget: &mut PreflightBudget,
    ) -> Result<(), RuntimeError> {
        let mut declared = BTreeMap::new();
        for statement in &node.statements {
            self.charge_preflight_work(budget, Some(statement_location(statement)))?;
            let (name, kind, location) = match statement {
                Stmt::Export { declaration, .. } => match declaration {
                    crate::ast::ExportedDeclaration::Let { name, location, .. } => {
                        (name, ExportKind::Let, *location)
                    }
                    crate::ast::ExportedDeclaration::Function { name, location, .. } => {
                        (name, ExportKind::Function, *location)
                    }
                },
                _ => continue,
            };
            if declared.insert(name.clone(), kind).is_some() {
                return Err(self.error_at(
                    location,
                    format!("duplicate exported declaration '{}'", name),
                    None,
                ));
            }
        }
        for _ in &node.exports {
            self.charge_preflight_work(budget, Some(SourceLocation::new(1, 1)))?;
        }
        if declared != node.exports {
            return Err(self.error_at(
                SourceLocation::new(1, 1),
                format!(
                    "module '{}' export metadata does not match its declarations",
                    node.identity
                ),
                None,
            ));
        }
        Ok(())
    }

    fn validate_module_declaration_shape(
        &self,
        statement: &Stmt,
        budget: &mut PreflightBudget,
        depth: usize,
    ) -> Result<(), RuntimeError> {
        match statement {
            Stmt::ModuleImport { .. }
            | Stmt::NamedModuleImport { .. }
            | Stmt::Function { .. } => Ok(()),
            Stmt::Let { value, .. } => {
                let child_depth =
                    self.preflight_child_depth(budget, depth, value.location)?;
                self.validate_pure_module_initializer(value, budget, child_depth)
            }
            Stmt::Export { declaration, .. } => match declaration {
                crate::ast::ExportedDeclaration::Let { value, .. } => {
                    let child_depth =
                        self.preflight_child_depth(budget, depth, value.location)?;
                    self.validate_pure_module_initializer(value, budget, child_depth)
                }
                crate::ast::ExportedDeclaration::Function { .. } => Ok(()),
            },
            _ => Err(self.error_at(
                statement_location(statement),
                "module top level may contain only imports, let declarations, and fn declarations",
                Some(
                    "Keep module setup declarative; executable statements belong in exported functions."
                        .to_string(),
                ),
            )),
        }
    }

    fn validate_pure_module_initializer(
        &self,
        expression: &Expr,
        budget: &mut PreflightBudget,
        depth: usize,
    ) -> Result<(), RuntimeError> {
        self.charge_preflight_work(budget, Some(expression.location))?;
        match &expression.kind {
            ExprKind::Call { .. } | ExprKind::ModuleCall { .. } => Err(self.error_at(
                expression.location,
                "module top-level initializers may not call functions",
                Some("Use literals, data construction, and operators at module top level; call functions explicitly after initialization.".to_string()),
            )),
            ExprKind::Array(values) => {
                for value in values {
                    let child_depth =
                        self.preflight_child_depth(budget, depth, value.location)?;
                    self.validate_pure_module_initializer(value, budget, child_depth)?;
                }
                Ok(())
            }
            ExprKind::Object(entries) => {
                let key_bytes = entries.keys().try_fold(1usize, |total, key| {
                    total.checked_add(key.len()).ok_or(())
                });
                self.ensure_literal_bytes(key_bytes.unwrap_or(usize::MAX), expression.location)?;
                for value in entries.values() {
                    let child_depth =
                        self.preflight_child_depth(budget, depth, value.location)?;
                    self.validate_pure_module_initializer(value, budget, child_depth)?;
                }
                Ok(())
            }
            ExprKind::Property(target, _) | ExprKind::Unary { expr: target, .. } => {
                let child_depth =
                    self.preflight_child_depth(budget, depth, target.location)?;
                self.validate_pure_module_initializer(target, budget, child_depth)
            }
            ExprKind::Index(target, index) => {
                let target_depth =
                    self.preflight_child_depth(budget, depth, target.location)?;
                self.validate_pure_module_initializer(target, budget, target_depth)?;
                let index_depth = self.preflight_child_depth(budget, depth, index.location)?;
                self.validate_pure_module_initializer(index, budget, index_depth)
            }
            ExprKind::Binary { left, right, .. } => {
                let left_depth = self.preflight_child_depth(budget, depth, left.location)?;
                self.validate_pure_module_initializer(left, budget, left_depth)?;
                let right_depth = self.preflight_child_depth(budget, depth, right.location)?;
                self.validate_pure_module_initializer(right, budget, right_depth)
            }
            ExprKind::Number(_) | ExprKind::Text(_) | ExprKind::Bool(_) | ExprKind::Variable(_) => {
                Ok(())
            }
        }
    }

    #[allow(clippy::too_many_arguments)]
    fn validate_module_statement(
        &self,
        statement: &Stmt,
        program: &ModuleProgram,
        named_imports: &HashMap<String, ExportKind>,
        namespaces: &HashMap<String, String>,
        lexical_scopes: &mut Vec<HashSet<String>>,
        in_function: bool,
        budget: &mut PreflightBudget,
        depth: usize,
    ) -> Result<(), RuntimeError> {
        self.charge_preflight_work(budget, Some(statement_location(statement)))?;
        match statement {
            Stmt::LegacyInclude { .. }
            | Stmt::ModuleImport { .. }
            | Stmt::NamedModuleImport { .. }
            | Stmt::Break { .. }
            | Stmt::Continue { .. }
            | Stmt::Agent { .. } => Ok(()),
            Stmt::Export { declaration, .. } => match declaration {
                crate::ast::ExportedDeclaration::Let {
                    name,
                    value,
                    location,
                } => self.validate_module_let(
                    name,
                    value,
                    *location,
                    program,
                    named_imports,
                    namespaces,
                    lexical_scopes,
                    in_function,
                    budget,
                    depth,
                ),
                crate::ast::ExportedDeclaration::Function {
                    name,
                    params,
                    body,
                    location,
                } => {
                    if named_imports.contains_key(name) || namespaces.contains_key(name) {
                        return Err(self.error_at(
                            *location,
                            format!("imported binding '{}' is read-only", name),
                            None,
                        ));
                    }
                    self.validate_module_function(
                        params,
                        body,
                        *location,
                        program,
                        named_imports,
                        namespaces,
                        lexical_scopes,
                        budget,
                        depth,
                    )
                }
            },
            Stmt::Let {
                name,
                value,
                location,
            } => self.validate_module_let(
                name,
                value,
                *location,
                program,
                named_imports,
                namespaces,
                lexical_scopes,
                in_function,
                budget,
                depth,
            ),
            Stmt::Assign {
                name,
                value,
                location,
            } => {
                if (named_imports.contains_key(name) || namespaces.contains_key(name))
                    && !lexical_binding_exists(lexical_scopes, name)
                {
                    return Err(self.error_at(
                        *location,
                        format!("imported binding '{}' is read-only", name),
                        None,
                    ));
                }
                let child_depth = self.preflight_child_depth(budget, depth, value.location)?;
                self.validate_module_expr(
                    value,
                    program,
                    named_imports,
                    namespaces,
                    lexical_scopes,
                    budget,
                    child_depth,
                )
            }
            Stmt::Print { value, .. } | Stmt::Return { value, .. } | Stmt::Expr(value) => {
                let child_depth = self.preflight_child_depth(budget, depth, value.location)?;
                self.validate_module_expr(
                    value,
                    program,
                    named_imports,
                    namespaces,
                    lexical_scopes,
                    budget,
                    child_depth,
                )
            }
            Stmt::Function {
                name,
                params,
                body,
                location,
            } => {
                if named_imports.contains_key(name) || namespaces.contains_key(name) {
                    return Err(self.error_at(
                        *location,
                        format!("imported binding '{}' is read-only", name),
                        None,
                    ));
                }
                self.validate_module_function(
                    params,
                    body,
                    *location,
                    program,
                    named_imports,
                    namespaces,
                    lexical_scopes,
                    budget,
                    depth,
                )
            }
            Stmt::If {
                condition,
                then_branch,
                else_branch,
                ..
            } => {
                let condition_depth =
                    self.preflight_child_depth(budget, depth, condition.location)?;
                self.validate_module_expr(
                    condition,
                    program,
                    named_imports,
                    namespaces,
                    lexical_scopes,
                    budget,
                    condition_depth,
                )?;
                let create_nested_scope = in_function || !lexical_scopes.is_empty();
                self.validate_module_block(
                    then_branch,
                    program,
                    named_imports,
                    namespaces,
                    lexical_scopes,
                    in_function,
                    create_nested_scope.then(HashSet::new),
                    budget,
                    depth,
                )?;
                self.validate_module_block(
                    else_branch,
                    program,
                    named_imports,
                    namespaces,
                    lexical_scopes,
                    in_function,
                    create_nested_scope.then(HashSet::new),
                    budget,
                    depth,
                )
            }
            Stmt::While {
                condition, body, ..
            } => {
                let condition_depth =
                    self.preflight_child_depth(budget, depth, condition.location)?;
                self.validate_module_expr(
                    condition,
                    program,
                    named_imports,
                    namespaces,
                    lexical_scopes,
                    budget,
                    condition_depth,
                )?;
                let create_nested_scope = in_function || !lexical_scopes.is_empty();
                self.validate_module_block(
                    body,
                    program,
                    named_imports,
                    namespaces,
                    lexical_scopes,
                    in_function,
                    create_nested_scope.then(HashSet::new),
                    budget,
                    depth,
                )
            }
            Stmt::For {
                name,
                iterable,
                body,
                ..
            } => {
                let iterable_depth =
                    self.preflight_child_depth(budget, depth, iterable.location)?;
                self.validate_module_expr(
                    iterable,
                    program,
                    named_imports,
                    namespaces,
                    lexical_scopes,
                    budget,
                    iterable_depth,
                )?;
                self.validate_module_block(
                    body,
                    program,
                    named_imports,
                    namespaces,
                    lexical_scopes,
                    in_function,
                    Some(HashSet::from([name.clone()])),
                    budget,
                    depth,
                )
            }
            Stmt::Ask { message, .. } => {
                let child_depth = self.preflight_child_depth(budget, depth, message.location)?;
                self.validate_module_expr(
                    message,
                    program,
                    named_imports,
                    namespaces,
                    lexical_scopes,
                    budget,
                    child_depth,
                )
            }
        }
    }

    #[allow(clippy::too_many_arguments)]
    fn validate_module_let(
        &self,
        name: &str,
        value: &Expr,
        location: SourceLocation,
        program: &ModuleProgram,
        named_imports: &HashMap<String, ExportKind>,
        namespaces: &HashMap<String, String>,
        lexical_scopes: &mut Vec<HashSet<String>>,
        in_function: bool,
        budget: &mut PreflightBudget,
        depth: usize,
    ) -> Result<(), RuntimeError> {
        let in_lexical_scope = in_function || !lexical_scopes.is_empty();
        if !in_lexical_scope && (named_imports.contains_key(name) || namespaces.contains_key(name))
        {
            return Err(self.error_at(
                location,
                format!("imported binding '{}' is read-only", name),
                None,
            ));
        }
        let child_depth = self.preflight_child_depth(budget, depth, value.location)?;
        self.validate_module_expr(
            value,
            program,
            named_imports,
            namespaces,
            lexical_scopes,
            budget,
            child_depth,
        )?;
        if in_lexical_scope {
            lexical_scopes
                .last_mut()
                .expect("a lexical declaration has an active scope")
                .insert(name.to_string());
        }
        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    fn validate_module_function(
        &self,
        params: &[String],
        body: &[Stmt],
        location: SourceLocation,
        program: &ModuleProgram,
        named_imports: &HashMap<String, ExportKind>,
        namespaces: &HashMap<String, String>,
        _lexical_scopes: &mut Vec<HashSet<String>>,
        budget: &mut PreflightBudget,
        depth: usize,
    ) -> Result<(), RuntimeError> {
        for _ in params {
            self.charge_preflight_work(budget, Some(location))?;
        }
        let mut function_scopes = Vec::new();
        self.validate_module_block(
            body,
            program,
            named_imports,
            namespaces,
            &mut function_scopes,
            true,
            Some(params.iter().cloned().collect()),
            budget,
            depth,
        )
    }

    #[allow(clippy::too_many_arguments)]
    fn validate_module_block(
        &self,
        statements: &[Stmt],
        program: &ModuleProgram,
        named_imports: &HashMap<String, ExportKind>,
        namespaces: &HashMap<String, String>,
        lexical_scopes: &mut Vec<HashSet<String>>,
        in_function: bool,
        scope: Option<HashSet<String>>,
        budget: &mut PreflightBudget,
        parent_depth: usize,
    ) -> Result<(), RuntimeError> {
        let pushed_scope = scope.is_some();
        if let Some(scope) = scope {
            lexical_scopes.push(scope);
        }
        let result = statements.iter().try_for_each(|statement| {
            let depth =
                self.preflight_child_depth(budget, parent_depth, statement_location(statement))?;
            self.validate_module_statement(
                statement,
                program,
                named_imports,
                namespaces,
                lexical_scopes,
                in_function,
                budget,
                depth,
            )
        });
        if pushed_scope {
            lexical_scopes.pop();
        }
        result
    }

    #[allow(clippy::too_many_arguments)]
    fn validate_module_expr(
        &self,
        expression: &Expr,
        program: &ModuleProgram,
        named_imports: &HashMap<String, ExportKind>,
        namespaces: &HashMap<String, String>,
        lexical_scopes: &mut Vec<HashSet<String>>,
        budget: &mut PreflightBudget,
        depth: usize,
    ) -> Result<(), RuntimeError> {
        self.charge_preflight_work(budget, Some(expression.location))?;
        match &expression.kind {
            ExprKind::Array(values) => {
                for value in values {
                    let child_depth = self.preflight_child_depth(budget, depth, value.location)?;
                    self.validate_module_expr(
                        value,
                        program,
                        named_imports,
                        namespaces,
                        lexical_scopes,
                        budget,
                        child_depth,
                    )?;
                }
                Ok(())
            }
            ExprKind::Object(entries) => {
                for value in entries.values() {
                    let child_depth = self.preflight_child_depth(budget, depth, value.location)?;
                    self.validate_module_expr(
                        value,
                        program,
                        named_imports,
                        namespaces,
                        lexical_scopes,
                        budget,
                        child_depth,
                    )?;
                }
                Ok(())
            }
            ExprKind::Property(target, _) | ExprKind::Unary { expr: target, .. } => {
                let child_depth = self.preflight_child_depth(budget, depth, target.location)?;
                self.validate_module_expr(
                    target,
                    program,
                    named_imports,
                    namespaces,
                    lexical_scopes,
                    budget,
                    child_depth,
                )
            }
            ExprKind::Index(target, index) => {
                let target_depth = self.preflight_child_depth(budget, depth, target.location)?;
                self.validate_module_expr(
                    target,
                    program,
                    named_imports,
                    namespaces,
                    lexical_scopes,
                    budget,
                    target_depth,
                )?;
                let index_depth = self.preflight_child_depth(budget, depth, index.location)?;
                self.validate_module_expr(
                    index,
                    program,
                    named_imports,
                    namespaces,
                    lexical_scopes,
                    budget,
                    index_depth,
                )
            }
            ExprKind::Binary { left, right, .. } => {
                let left_depth = self.preflight_child_depth(budget, depth, left.location)?;
                self.validate_module_expr(
                    left,
                    program,
                    named_imports,
                    namespaces,
                    lexical_scopes,
                    budget,
                    left_depth,
                )?;
                let right_depth = self.preflight_child_depth(budget, depth, right.location)?;
                self.validate_module_expr(
                    right,
                    program,
                    named_imports,
                    namespaces,
                    lexical_scopes,
                    budget,
                    right_depth,
                )
            }
            ExprKind::Call { name, args } => {
                if named_imports.contains_key(name) && lexical_binding_exists(lexical_scopes, name)
                {
                    return Err(self.error_at(
                        expression.location,
                        format!("lexical binding '{}' is not callable", name),
                        None,
                    ));
                }
                for argument in args {
                    let child_depth =
                        self.preflight_child_depth(budget, depth, argument.location)?;
                    self.validate_module_expr(
                        argument,
                        program,
                        named_imports,
                        namespaces,
                        lexical_scopes,
                        budget,
                        child_depth,
                    )?;
                }
                Ok(())
            }
            ExprKind::ModuleCall {
                namespace,
                member,
                args,
            } => {
                if lexical_binding_exists(lexical_scopes, namespace) {
                    return Err(self.error_at(
                        expression.location,
                        format!("lexical binding '{}' is not a module namespace", namespace),
                        None,
                    ));
                }
                let identity = namespaces.get(namespace).ok_or_else(|| {
                    self.error_at(
                        expression.location,
                        format!("unknown module namespace '{}'", namespace),
                        None,
                    )
                })?;
                let dependency = program.modules.get(identity).ok_or_else(|| {
                    self.error_at(
                        expression.location,
                        "module namespace is absent from the in-memory program",
                        None,
                    )
                })?;
                if dependency.exports.get(member) != Some(&ExportKind::Function) {
                    return Err(self.error_at(
                        expression.location,
                        format!(
                            "module '{}' does not export function '{}'",
                            identity, member
                        ),
                        None,
                    ));
                }
                for argument in args {
                    let child_depth =
                        self.preflight_child_depth(budget, depth, argument.location)?;
                    self.validate_module_expr(
                        argument,
                        program,
                        named_imports,
                        namespaces,
                        lexical_scopes,
                        budget,
                        child_depth,
                    )?;
                }
                Ok(())
            }
            ExprKind::Number(_) | ExprKind::Text(_) | ExprKind::Bool(_) | ExprKind::Variable(_) => {
                Ok(())
            }
        }
    }

    fn initialize_module(
        &mut self,
        program: &ModuleProgram,
        identity: &str,
    ) -> Result<(), RuntimeError> {
        match self.module_initialization.get(identity) {
            Some(ModuleInitializationStatus::Initialized) => return Ok(()),
            Some(ModuleInitializationStatus::Initializing) => {
                return Err(RuntimeError::new(format!(
                    "recursive initialization of module '{}' was rejected",
                    identity
                )));
            }
            None => {}
        }
        let node = program
            .modules
            .get(identity)
            .ok_or_else(|| RuntimeError::new("resolved module is missing from the graph"))?;
        let export_clone_bytes = node.exports.keys().fold(1usize, |total, name| {
            total.saturating_add(name.len()).saturating_add(1)
        });
        let saved_scope_source = self.source.clone();
        let saved_scope_filename = self.filename.clone().unwrap_or_default();
        let saved_scope_clone_bytes = self.current_scope_clone_bytes();
        let saved_scope_metadata_bytes = saved_scope_clone_bytes.saturating_sub(self.vars_bytes);
        self.set_active_source(&node.source, identity);
        self.ensure_metadata_replacement(
            0,
            identity.len().saturating_add(1),
            SourceLocation::new(1, 1),
        )?;
        self.charge_value_work_bytes(export_clone_bytes, SourceLocation::new(1, 1))?;
        self.charge_value_work_bytes(saved_scope_clone_bytes, SourceLocation::new(1, 1))?;
        self.ensure_metadata_replacement(0, saved_scope_metadata_bytes, SourceLocation::new(1, 1))?;
        self.module_initialization.insert(
            identity.to_string(),
            ModuleInitializationStatus::Initializing,
        );

        let saved_scope = self.clone_scope_snapshot(saved_scope_source, saved_scope_filename);
        let saved_agents = std::mem::take(&mut self.agents);
        let saved_agents_bytes = std::mem::take(&mut self.agents_bytes);
        let saved_local_bindings = std::mem::take(&mut self.local_bindings);
        let saved_local_bindings_bytes = std::mem::take(&mut self.local_bindings_bytes);
        let saved_function_scope_starts = std::mem::take(&mut self.function_scope_starts);
        let saved_active_module_calls = std::mem::take(&mut self.active_module_calls);
        let saved_active_module = self.active_module.take();
        let saved_module_execution_enabled = self.module_execution_enabled;
        let saved_suspended_scope_bytes = self.suspended_scope_bytes;

        self.vars.clear();
        self.vars_bytes = 0;
        self.scope_metadata_bytes = 0;
        self.suspended_scope_bytes = 0;
        self.functions.clear();
        self.functions_bytes = 0;
        self.functions_work = 0;
        self.function_source_refs.clear();
        self.function_source_bytes = 0;
        self.imported_values.clear();
        self.namespaces.clear();
        self.read_only_bindings.clear();
        self.scope_metadata_bytes = 0;
        self.active_source_bytes = node
            .source
            .len()
            .saturating_add(identity.len())
            .saturating_add(2);
        self.active_module = Some(identity.to_string());
        self.module_execution_enabled = true;

        let result = self
            .install_imports(&node.statements, node.dependencies.as_slice())
            .and_then(|_| self.execute_module_declarations(&node.statements));
        let initialized_scope = result.as_ref().ok().map(|_| {
            let value_bytes = self.vars_bytes;
            let function_bytes = self.functions_bytes;
            let function_work = self.functions_work;
            let function_source_bytes = self.function_source_bytes;
            self.vars_bytes = 0;
            self.functions_bytes = 0;
            self.functions_work = 0;
            self.function_source_bytes = 0;
            let metadata_bytes =
                std::mem::take(&mut self.scope_metadata_bytes).saturating_add(export_clone_bytes);
            let source_bytes = std::mem::take(&mut self.active_source_bytes);
            ModuleScope {
                vars: std::mem::take(&mut self.vars),
                value_bytes,
                functions: std::mem::take(&mut self.functions),
                function_bytes,
                function_work,
                function_source_refs: std::mem::take(&mut self.function_source_refs),
                function_source_bytes,
                metadata_bytes,
                source_bytes,
                imported_values: std::mem::take(&mut self.imported_values),
                namespaces: std::mem::take(&mut self.namespaces),
                read_only_bindings: std::mem::take(&mut self.read_only_bindings),
                exports: node.exports.clone(),
                source: self.source.clone(),
                filename: Arc::from(identity),
            }
        });

        let insertion_result = initialized_scope.map(|scope| {
            self.insert_module_scope(identity.to_string(), scope, SourceLocation::new(1, 1))
        });

        self.restore_scope(saved_scope);
        self.suspended_scope_bytes = saved_suspended_scope_bytes;
        self.agents = saved_agents;
        self.agents_bytes = saved_agents_bytes;
        self.local_bindings = saved_local_bindings;
        self.local_bindings_bytes = saved_local_bindings_bytes;
        self.function_scope_starts = saved_function_scope_starts;
        self.active_module_calls = saved_active_module_calls;
        self.active_module = saved_active_module;
        self.module_execution_enabled = saved_module_execution_enabled;

        if let Err(error) = result {
            self.module_initialization.remove(identity);
            return Err(error);
        }
        if let Some(Err(error)) = insertion_result {
            self.module_initialization.remove(identity);
            return Err(error);
        }
        self.module_initialization.insert(
            identity.to_string(),
            ModuleInitializationStatus::Initialized,
        );
        Ok(())
    }

    fn install_imports(
        &mut self,
        statements: &[Stmt],
        dependencies: &[String],
    ) -> Result<(), RuntimeError> {
        let mut dependencies = dependencies.iter();
        for statement in statements {
            let location = match statement {
                Stmt::ModuleImport { location, .. } | Stmt::NamedModuleImport { location, .. } => {
                    *location
                }
                _ => continue,
            };
            let dependency = dependencies.next().ok_or_else(|| {
                self.error_at(
                    location,
                    "explicit module import is absent from the validated dependency graph",
                    None,
                )
            })?;
            if !self.module_scopes.contains_key(dependency) {
                return Err(self.error_at(
                    location,
                    "explicit module dependency was not initialized",
                    None,
                ));
            }

            match statement {
                Stmt::ModuleImport { namespace, .. } => {
                    self.insert_read_only_binding(namespace, location)?;
                    self.insert_namespace(namespace, dependency, location)?;
                }
                Stmt::NamedModuleImport { bindings, .. } => {
                    for binding in bindings {
                        let export_kind = self
                            .module_scopes
                            .get(dependency)
                            .and_then(|scope| scope.exports.get(&binding.exported))
                            .copied();
                        self.insert_read_only_binding(&binding.local, location)?;
                        match export_kind {
                            Some(ExportKind::Let) => {
                                self.insert_imported_value(
                                    &binding.local,
                                    dependency,
                                    &binding.exported,
                                    location,
                                )?;
                            }
                            Some(ExportKind::Function) => {
                                let handle_bytes = self
                                    .module_scopes
                                    .get(dependency)
                                    .and_then(|scope| scope.functions.get(&binding.exported))
                                    .map(Self::function_handle_clone_bytes)
                                    .ok_or_else(|| {
                                        self.error_at(
                                            location,
                                            "validated exported function was not initialized",
                                            None,
                                        )
                                    })?;
                                self.charge_value_work_bytes(handle_bytes, location)?;
                                let function = self
                                    .module_scopes
                                    .get(dependency)
                                    .and_then(|scope| scope.functions.get(&binding.exported))
                                    .cloned()
                                    .expect("validated exported function remains initialized");
                                self.insert_function_alias(&binding.local, function, location)?;
                            }
                            None => {
                                return Err(self.error_at(
                                    location,
                                    "validated module import is missing its export",
                                    None,
                                ));
                            }
                        }
                    }
                }
                _ => unreachable!("only imports reach the import installer"),
            }
        }
        if dependencies.next().is_some() {
            return Err(RuntimeError::new(
                "validated module graph contains an unbound explicit import",
            ));
        }
        Ok(())
    }

    fn preflight_statements(
        &self,
        statements: &[Stmt],
        input_injected: bool,
        function_names: &mut HashSet<String>,
        module_imports: Option<&HashMap<String, ExportKind>>,
        budget: &mut PreflightBudget,
        depth: usize,
    ) -> Result<(), RuntimeError> {
        for statement in statements {
            let location = statement_location(statement);
            self.charge_preflight_work(budget, Some(location))?;
            if matches!(statement, Stmt::LegacyInclude { .. })
                || module_imports.is_none()
                    && matches!(
                        statement,
                        Stmt::ModuleImport { .. }
                            | Stmt::NamedModuleImport { .. }
                            | Stmt::Export { .. }
                    )
            {
                return Err(self.error_at(
                    location,
                    "module loading is unavailable in the pure evaluator",
                    Some(
                        "Resolve includes and imports into an in-memory ModuleProgram before evaluation."
                            .to_string(),
                    ),
                ));
            }
            match statement {
                Stmt::LegacyInclude { .. } | Stmt::Break { .. } | Stmt::Continue { .. } => {}
                Stmt::ModuleImport {
                    namespace,
                    location,
                    ..
                } => {
                    if input_injected && namespace == "input" {
                        return Err(self.error_at(
                            *location,
                            "the injected input value is read-only",
                            Some(
                                "The injected input value cannot be declared, assigned, or shadowed."
                                    .to_string(),
                            ),
                        ));
                    }
                }
                Stmt::NamedModuleImport { bindings, .. } => {
                    for binding in bindings {
                        self.charge_preflight_work(budget, Some(binding.exported_location))?;
                        if input_injected && binding.local == "input" {
                            return Err(self.error_at(
                                binding.exported_location,
                                "the injected input value is read-only",
                                Some(
                                    "The injected input value cannot be declared, assigned, or shadowed."
                                        .to_string(),
                                ),
                            ));
                        }
                        if module_imports.and_then(|imports| imports.get(&binding.local))
                            == Some(&ExportKind::Function)
                        {
                            function_names.insert(binding.local.clone());
                        }
                    }
                }
                Stmt::Let {
                    name,
                    value,
                    location,
                }
                | Stmt::Assign {
                    name,
                    value,
                    location,
                } => {
                    if input_injected && name == "input" {
                        return Err(self.error_at(
                            *location,
                            "the injected input value is read-only",
                            Some(
                                "The injected input value cannot be declared, assigned, or shadowed."
                                    .to_string(),
                            ),
                        ));
                    }
                    let child_depth = self.preflight_child_depth(budget, depth, value.location)?;
                    self.preflight_expr(
                        value,
                        function_names,
                        module_imports,
                        budget,
                        child_depth,
                    )?;
                }
                Stmt::Export { declaration, .. } => match declaration {
                    crate::ast::ExportedDeclaration::Let {
                        name,
                        value,
                        location,
                    } => {
                        if input_injected && name == "input" {
                            return Err(self.error_at(
                                *location,
                                "the injected input value is read-only",
                                None,
                            ));
                        }
                        let child_depth =
                            self.preflight_child_depth(budget, depth, value.location)?;
                        self.preflight_expr(
                            value,
                            function_names,
                            module_imports,
                            budget,
                            child_depth,
                        )?;
                    }
                    crate::ast::ExportedDeclaration::Function {
                        name,
                        params,
                        body,
                        location,
                    } => {
                        self.preflight_function(
                            name,
                            params,
                            body,
                            *location,
                            input_injected,
                            function_names,
                            module_imports,
                            budget,
                            depth,
                        )?;
                        function_names.insert(name.clone());
                    }
                },
                Stmt::Print { value, .. } | Stmt::Return { value, .. } | Stmt::Expr(value) => {
                    let child_depth = self.preflight_child_depth(budget, depth, value.location)?;
                    self.preflight_expr(value, function_names, module_imports, budget, child_depth)?
                }
                Stmt::Function {
                    name,
                    params,
                    body,
                    location,
                } => {
                    self.preflight_function(
                        name,
                        params,
                        body,
                        *location,
                        input_injected,
                        function_names,
                        module_imports,
                        budget,
                        depth,
                    )?;
                    function_names.insert(name.clone());
                }
                Stmt::If {
                    condition,
                    then_branch,
                    else_branch,
                    ..
                } => {
                    let condition_depth =
                        self.preflight_child_depth(budget, depth, condition.location)?;
                    self.preflight_expr(
                        condition,
                        function_names,
                        module_imports,
                        budget,
                        condition_depth,
                    )?;
                    let mut then_functions =
                        self.clone_preflight_functions(function_names, budget, location)?;
                    if let Some(first) = then_branch.first() {
                        let branch_depth =
                            self.preflight_child_depth(budget, depth, statement_location(first))?;
                        self.preflight_statements(
                            then_branch,
                            input_injected,
                            &mut then_functions,
                            module_imports,
                            budget,
                            branch_depth,
                        )?;
                    }
                    let mut else_functions =
                        self.clone_preflight_functions(function_names, budget, location)?;
                    if let Some(first) = else_branch.first() {
                        let branch_depth =
                            self.preflight_child_depth(budget, depth, statement_location(first))?;
                        self.preflight_statements(
                            else_branch,
                            input_injected,
                            &mut else_functions,
                            module_imports,
                            budget,
                            branch_depth,
                        )?;
                    }
                }
                Stmt::While {
                    condition, body, ..
                } => {
                    let condition_depth =
                        self.preflight_child_depth(budget, depth, condition.location)?;
                    self.preflight_expr(
                        condition,
                        function_names,
                        module_imports,
                        budget,
                        condition_depth,
                    )?;
                    let mut body_functions =
                        self.clone_preflight_functions(function_names, budget, location)?;
                    if let Some(first) = body.first() {
                        let body_depth =
                            self.preflight_child_depth(budget, depth, statement_location(first))?;
                        self.preflight_statements(
                            body,
                            input_injected,
                            &mut body_functions,
                            module_imports,
                            budget,
                            body_depth,
                        )?;
                    }
                }
                Stmt::For {
                    name,
                    iterable,
                    body,
                    location,
                } => {
                    if input_injected && name == "input" {
                        return Err(self.error_at(
                            *location,
                            "the injected input value is read-only",
                            Some(
                                "The injected input value cannot be declared, assigned, or shadowed."
                                    .to_string(),
                            ),
                        ));
                    }
                    let iterable_depth =
                        self.preflight_child_depth(budget, depth, iterable.location)?;
                    self.preflight_expr(
                        iterable,
                        function_names,
                        module_imports,
                        budget,
                        iterable_depth,
                    )?;
                    let mut body_functions =
                        self.clone_preflight_functions(function_names, budget, *location)?;
                    if let Some(first) = body.first() {
                        let body_depth =
                            self.preflight_child_depth(budget, depth, statement_location(first))?;
                        self.preflight_statements(
                            body,
                            input_injected,
                            &mut body_functions,
                            module_imports,
                            budget,
                            body_depth,
                        )?;
                    }
                }
                Stmt::Agent { location, .. } => {
                    self.authorize_at(Capability::Provider, *location, budget)?;
                }
                Stmt::Ask {
                    message, location, ..
                } => {
                    let child_depth =
                        self.preflight_child_depth(budget, depth, message.location)?;
                    self.preflight_expr(
                        message,
                        function_names,
                        module_imports,
                        budget,
                        child_depth,
                    )?;
                    self.authorize_at(Capability::Provider, *location, budget)?;
                }
            }
        }
        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    fn preflight_function(
        &self,
        name: &str,
        params: &[String],
        body: &[Stmt],
        location: SourceLocation,
        input_injected: bool,
        function_names: &HashSet<String>,
        module_imports: Option<&HashMap<String, ExportKind>>,
        budget: &mut PreflightBudget,
        depth: usize,
    ) -> Result<(), RuntimeError> {
        if input_injected && name == "input" {
            return Err(self.error_at(
                location,
                "the injected input value is read-only",
                Some(
                    "The injected input value cannot be declared, assigned, or shadowed."
                        .to_string(),
                ),
            ));
        }
        for param in params {
            self.charge_preflight_work(budget, Some(location))?;
            if input_injected && param == "input" {
                return Err(self.error_at(
                    location,
                    "the injected input value is read-only",
                    Some(
                        "The injected input value cannot be declared, assigned, or shadowed."
                            .to_string(),
                    ),
                ));
            }
        }
        if is_explicitly_unsafe_name(name) {
            self.authorize_at(Capability::UnknownCall(name.to_string()), location, budget)?;
        }
        let mut body_functions =
            self.clone_preflight_functions(function_names, budget, location)?;
        body_functions.insert(name.to_string());
        if let Some(first) = body.first() {
            let body_depth =
                self.preflight_child_depth(budget, depth, statement_location(first))?;
            self.preflight_statements(
                body,
                input_injected,
                &mut body_functions,
                module_imports,
                budget,
                body_depth,
            )?;
        }
        Ok(())
    }

    fn preflight_minimum_value_size(
        &self,
        expression: &Expr,
        budget: &mut PreflightBudget,
        depth: usize,
    ) -> Result<usize, RuntimeError> {
        self.charge_preflight_work(budget, Some(expression.location))?;
        let size = match &expression.kind {
            ExprKind::Text(value) => value.len().saturating_add(1),
            ExprKind::Array(values) => {
                let mut size = 1usize;
                for value in values {
                    let child_depth = self.preflight_child_depth(budget, depth, value.location)?;
                    size = size.saturating_add(self.preflight_minimum_value_size(
                        value,
                        budget,
                        child_depth,
                    )?);
                    self.ensure_literal_bytes(size, expression.location)?;
                }
                size
            }
            ExprKind::Object(entries) => {
                let mut size = 1usize;
                for (key, value) in entries {
                    size = size.saturating_add(key.len());
                    self.ensure_literal_bytes(size, expression.location)?;
                    let child_depth = self.preflight_child_depth(budget, depth, value.location)?;
                    size = size.saturating_add(self.preflight_minimum_value_size(
                        value,
                        budget,
                        child_depth,
                    )?);
                    self.ensure_literal_bytes(size, expression.location)?;
                }
                size
            }
            ExprKind::Number(_)
            | ExprKind::Bool(_)
            | ExprKind::Variable(_)
            | ExprKind::Property(_, _)
            | ExprKind::Index(_, _)
            | ExprKind::Unary { .. }
            | ExprKind::Binary { .. }
            | ExprKind::Call { .. }
            | ExprKind::ModuleCall { .. } => 1,
        };
        self.ensure_literal_bytes(size, expression.location)?;
        Ok(size)
    }

    fn preflight_expr(
        &self,
        expression: &Expr,
        function_names: &HashSet<String>,
        module_imports: Option<&HashMap<String, ExportKind>>,
        budget: &mut PreflightBudget,
        depth: usize,
    ) -> Result<(), RuntimeError> {
        self.preflight_minimum_value_size(expression, budget, depth)?;
        self.charge_preflight_work(budget, Some(expression.location))?;
        match &expression.kind {
            ExprKind::Array(values) => {
                for value in values {
                    let child_depth = self.preflight_child_depth(budget, depth, value.location)?;
                    self.preflight_expr(
                        value,
                        function_names,
                        module_imports,
                        budget,
                        child_depth,
                    )?;
                }
            }
            ExprKind::Object(entries) => {
                for value in entries.values() {
                    let child_depth = self.preflight_child_depth(budget, depth, value.location)?;
                    self.preflight_expr(
                        value,
                        function_names,
                        module_imports,
                        budget,
                        child_depth,
                    )?;
                }
            }
            ExprKind::Property(target, _) | ExprKind::Unary { expr: target, .. } => {
                let child_depth = self.preflight_child_depth(budget, depth, target.location)?;
                self.preflight_expr(target, function_names, module_imports, budget, child_depth)?;
            }
            ExprKind::Index(target, index) => {
                let target_depth = self.preflight_child_depth(budget, depth, target.location)?;
                self.preflight_expr(target, function_names, module_imports, budget, target_depth)?;
                let index_depth = self.preflight_child_depth(budget, depth, index.location)?;
                self.preflight_expr(index, function_names, module_imports, budget, index_depth)?;
            }
            ExprKind::Binary { left, right, .. } => {
                let left_depth = self.preflight_child_depth(budget, depth, left.location)?;
                self.preflight_expr(left, function_names, module_imports, budget, left_depth)?;
                let right_depth = self.preflight_child_depth(budget, depth, right.location)?;
                self.preflight_expr(right, function_names, module_imports, budget, right_depth)?;
            }
            ExprKind::Call { name, args } => {
                for argument in args {
                    let child_depth =
                        self.preflight_child_depth(budget, depth, argument.location)?;
                    self.preflight_expr(
                        argument,
                        function_names,
                        module_imports,
                        budget,
                        child_depth,
                    )?;
                }
                if let Some(capability) = host_capability(name) {
                    self.authorize_at(capability, expression.location, budget)?;
                } else if !is_pure_builtin(name) && !function_names.contains(name) {
                    return Err(self.error_at(
                        expression.location,
                        format!("unknown function '{}'", name),
                        None,
                    ));
                }
            }
            ExprKind::ModuleCall { args, .. } => {
                if module_imports.is_none() {
                    return Err(self.error_at(
                        expression.location,
                        "module loading is unavailable in the pure evaluator",
                        Some(
                            "Resolve includes and imports into an in-memory ModuleProgram before evaluation."
                                .to_string(),
                        ),
                    ));
                }
                for argument in args {
                    let child_depth =
                        self.preflight_child_depth(budget, depth, argument.location)?;
                    self.preflight_expr(
                        argument,
                        function_names,
                        module_imports,
                        budget,
                        child_depth,
                    )?;
                }
            }
            ExprKind::Text(value) => {
                self.ensure_literal_bytes(value.len().saturating_add(1), expression.location)?;
            }
            ExprKind::Number(_) | ExprKind::Bool(_) | ExprKind::Variable(_) => {}
        }
        Ok(())
    }

    fn authorize_at(
        &self,
        capability: Capability,
        location: SourceLocation,
        budget: &mut PreflightBudget,
    ) -> Result<(), RuntimeError> {
        self.charge_preflight_work(budget, Some(location))?;
        self.host
            .authorize(&capability)
            .map_err(|error| self.host_error_at(error, location))
    }

    fn execute_module_declarations(&mut self, statements: &[Stmt]) -> Result<(), RuntimeError> {
        for statement in statements {
            match statement {
                Stmt::ModuleImport { .. } | Stmt::NamedModuleImport { .. } => {}
                Stmt::Let { value, .. } => {
                    self.require_pure_module_initializer(value)?;
                    self.execute(statement)?;
                }
                Stmt::Function { .. } => {
                    self.execute(statement)?;
                }
                Stmt::Export { declaration, .. } => match declaration {
                    crate::ast::ExportedDeclaration::Let {
                        name,
                        value,
                        location,
                    } => {
                        self.require_pure_module_initializer(value)?;
                        self.charge_step(*location)?;
                        self.execute_let_declaration(name, value, *location)?;
                    }
                    crate::ast::ExportedDeclaration::Function {
                        name,
                        params,
                        body,
                        location,
                    } => {
                        self.charge_step(*location)?;
                        self.install_function(name, params, body, *location)?;
                    }
                },
                _ => {
                    return Err(self.error_at(
                        statement_location(statement),
                        "module top level may contain only imports, let declarations, and fn declarations",
                        Some("Keep module setup declarative; executable statements belong in exported functions.".to_string()),
                    ));
                }
            }
        }
        Ok(())
    }

    fn execute_let_declaration(
        &mut self,
        name: &str,
        expression: &Expr,
        location: SourceLocation,
    ) -> Result<ControlFlow, RuntimeError> {
        if self.read_only_bindings.contains(name) && !self.executing_function() {
            return Err(self.error_at(
                location,
                format!("imported binding '{}' is read-only", name),
                None,
            ));
        }
        if self.injected_input_visible() && name == "input" {
            return Err(self.error_at(location, "the injected input value is read-only", None));
        }
        let value = self.eval(expression)?;
        if self.executing_function() {
            let index = self
                .local_bindings
                .len()
                .checked_sub(1)
                .expect("module function has a local binding scope");
            self.insert_local_binding(index, name, value, location)?;
            return Ok(ControlFlow::None);
        }
        self.insert_var(name, value, location)?;
        Ok(ControlFlow::None)
    }

    fn require_pure_module_initializer(&self, expression: &Expr) -> Result<(), RuntimeError> {
        if let Some(location) = first_call_location(expression) {
            return Err(self.error_at(
                location,
                "module top-level initializers may not call functions",
                Some("Use literals, data construction, and operators at module top level; call functions explicitly after initialization.".to_string()),
            ));
        }
        Ok(())
    }

    fn executing_function(&self) -> bool {
        !self.local_bindings.is_empty()
    }

    fn local_value(&self, name: &str) -> Option<Value> {
        let start = self.function_scope_starts.last().copied().unwrap_or(0);
        self.local_bindings
            .get(start..)
            .unwrap_or_default()
            .iter()
            .rev()
            .find_map(|scope| scope.get(name).cloned())
    }

    fn local_binding_scope(&self, name: &str) -> Option<usize> {
        let start = self.function_scope_starts.last().copied().unwrap_or(0);
        (start..self.local_bindings.len())
            .rev()
            .find(|index| self.local_bindings[*index].contains_key(name))
    }

    fn local_binding_entry_bytes(
        &self,
        name: &str,
        value: &Value,
        location: SourceLocation,
    ) -> Result<usize, RuntimeError> {
        let value_bytes = self.ensure_value_within_limit(value, Some(location))?;
        let entry_bytes = name.len().saturating_add(1).saturating_add(value_bytes);
        self.ensure_literal_bytes(entry_bytes, location)?;
        Ok(entry_bytes)
    }

    fn push_local_scope(
        &mut self,
        bindings: HashMap<String, Value>,
        location: SourceLocation,
    ) -> Result<(), RuntimeError> {
        let mut scope_bytes = 0usize;
        for (name, value) in &bindings {
            let entry_bytes = self.local_binding_entry_bytes(name, value, location)?;
            scope_bytes = scope_bytes.saturating_add(entry_bytes);
            self.ensure_literal_bytes(scope_bytes, location)?;
        }
        self.ensure_retained_value_replacement(0, scope_bytes, location)?;
        self.local_bindings_bytes = self.local_bindings_bytes.saturating_add(scope_bytes);
        self.local_bindings.push(bindings);
        Ok(())
    }

    fn push_empty_local_scope(&mut self) {
        self.local_bindings.push(HashMap::new());
    }

    fn pop_local_scope(&mut self) {
        if let Some(bindings) = self.local_bindings.pop() {
            let removed = bindings.iter().fold(0usize, |total, (name, value)| {
                total.saturating_add(Self::known_var_entry_bytes(name, value))
            });
            self.local_bindings_bytes = self.local_bindings_bytes.saturating_sub(removed);
        }
    }

    fn insert_local_binding(
        &mut self,
        index: usize,
        name: &str,
        value: Value,
        location: SourceLocation,
    ) -> Result<(), RuntimeError> {
        let name_clone_bytes = name.len().saturating_add(1).saturating_mul(2);
        self.charge_value_work_bytes(name_clone_bytes, location)?;
        let entry_bytes = self.local_binding_entry_bytes(name, &value, location)?;
        let replaced_bytes = self.local_bindings[index]
            .get(name)
            .map_or(0, |existing| Self::known_var_entry_bytes(name, existing));
        self.ensure_retained_value_replacement(replaced_bytes, entry_bytes, location)?;
        self.local_bindings_bytes = self
            .local_bindings_bytes
            .saturating_sub(replaced_bytes)
            .saturating_add(entry_bytes);
        self.local_bindings[index].insert(name.to_string(), value);
        Ok(())
    }

    fn execute_module_scoped_block(
        &mut self,
        statements: &[Stmt],
    ) -> Result<ControlFlow, RuntimeError> {
        if !self.executing_function() {
            return self.execute_block(statements);
        }

        self.push_empty_local_scope();
        let flow = self.execute_block(statements);
        self.pop_local_scope();
        flow
    }

    fn execute_block(&mut self, statements: &[Stmt]) -> Result<ControlFlow, RuntimeError> {
        for statement in statements {
            let flow = self.execute(statement)?;
            if flow != ControlFlow::None {
                return Ok(flow);
            }
        }

        Ok(ControlFlow::None)
    }

    fn execute(&mut self, statement: &Stmt) -> Result<ControlFlow, RuntimeError> {
        self.charge_step(statement_location(statement))?;
        match statement {
            Stmt::LegacyInclude { location, .. } => Err(self.error_at(
                *location,
                "legacy imports must be expanded before evaluation",
                Some("Run source through the compatibility import loader.".to_string()),
            )),
            Stmt::ModuleImport { location, .. } | Stmt::NamedModuleImport { location, .. } => {
                if self.module_execution_enabled {
                    Ok(ControlFlow::None)
                } else {
                    Err(self.error_at(
                        *location,
                        "explicit local modules are not executable until module resolution is available",
                        Some(
                            "Use the legacy import form until the resolver implementation is released."
                                .to_string(),
                        ),
                    ))
                }
            }
            Stmt::Export {
                declaration,
                location,
            } => {
                if !self.module_execution_enabled {
                    return Err(self.error_at(
                        *location,
                        "explicit local modules are not executable until module resolution is available",
                        Some(
                            "Use the legacy import form until the resolver implementation is released."
                                .to_string(),
                        ),
                    ));
                }
                match declaration {
                    crate::ast::ExportedDeclaration::Let {
                        name,
                        value,
                        location,
                    } => {
                        self.charge_step(*location)?;
                        self.execute_let_declaration(name, value, *location)
                    }
                    crate::ast::ExportedDeclaration::Function {
                        name,
                        params,
                        body,
                        location,
                    } => {
                        self.charge_step(*location)?;
                        self.install_function(name, params, body, *location)?;
                        Ok(ControlFlow::None)
                    }
                }
            }
            Stmt::Let {
                name,
                value,
                location,
            } => self.execute_let_declaration(name, value, *location),
            Stmt::Assign {
                name,
                value,
                location,
            } => {
                if self.read_only_bindings.contains(name)
                    && self.local_binding_scope(name).is_none()
                {
                    return Err(self.error_at(
                        *location,
                        format!("imported binding '{}' is read-only", name),
                        None,
                    ));
                }
                if self.injected_input_visible() && name == "input" {
                    return Err(self.error_at(
                        *location,
                        "the injected input value is read-only",
                        None,
                    ));
                }
                if let Some(index) = self.local_binding_scope(name) {
                    let value = self.eval(value)?;
                    self.insert_local_binding(index, name, value, *location)?;
                    return Ok(ControlFlow::None);
                }
                if !self.vars.contains_key(name) {
                    return Err(self.error_at(
                        *location,
                        format!("unknown variable '{}'", name),
                        None,
                    ));
                }
                let value = self.eval(value)?;
                self.insert_var(name, value, *location)?;
                Ok(ControlFlow::None)
            }
            Stmt::Print { value, location } => {
                let value = self.eval(value)?;
                self.emit(value, *location)?;
                Ok(ControlFlow::None)
            }
            Stmt::Return { value, .. } => Ok(ControlFlow::Return(self.eval(value)?)),
            Stmt::Function {
                name,
                params,
                body,
                location,
            } => {
                self.install_function(name, params, body, *location)?;
                Ok(ControlFlow::None)
            }
            Stmt::If {
                condition,
                then_branch,
                else_branch,
                ..
            } => {
                if self.eval(condition)?.is_truthy() {
                    self.execute_module_scoped_block(then_branch)
                } else {
                    self.execute_module_scoped_block(else_branch)
                }
            }
            Stmt::While {
                condition,
                body,
                location,
            } => {
                let mut safety_counter = 0;

                while self.eval(condition)?.is_truthy() {
                    if safety_counter >= self.limits.max_loop_iterations {
                        return Err(self.limit_error_at(
                            *location,
                            format!(
                                "loop stopped after {} iterations",
                                self.limits.max_loop_iterations
                            ),
                            Some(
                                "Review the loop condition or add a terminating update."
                                    .to_string(),
                            ),
                        ));
                    }
                    safety_counter += 1;
                    match self.execute_module_scoped_block(body)? {
                        ControlFlow::None | ControlFlow::Continue => {}
                        ControlFlow::Break => return Ok(ControlFlow::None),
                        flow @ ControlFlow::Return(_) => return Ok(flow),
                    }
                }

                Ok(ControlFlow::None)
            }
            Stmt::For {
                name,
                iterable,
                body,
                location,
            } => {
                let values = match self.eval(iterable)? {
                    Value::Array(values) => values,
                    _ => {
                        return Err(self.error_at(
                            iterable.location,
                            "for loops require an array iterable",
                            Some(
                                "Use an array value after 'in', such as: for item in items { ... }"
                                    .to_string(),
                            ),
                        ));
                    }
                };
                if values.len() > self.limits.max_loop_iterations {
                    return Err(self.limit_error_at(
                        *location,
                        format!(
                            "loop stopped after {} iterations",
                            self.limits.max_loop_iterations
                        ),
                        Some(format!(
                            "Iterate over an array with at most {} items.",
                            self.limits.max_loop_iterations
                        )),
                    ));
                }
                for value in values {
                    self.charge_step(*location)?;
                    self.charge_value_work_bytes(name.len().saturating_add(1), *location)?;
                    let mut loop_scope = HashMap::new();
                    loop_scope.insert(name.to_string(), value);
                    self.push_local_scope(loop_scope, *location)?;
                    let flow = self.execute_module_scoped_block(body);
                    self.pop_local_scope();
                    match flow? {
                        ControlFlow::None | ControlFlow::Continue => {}
                        ControlFlow::Break => return Ok(ControlFlow::None),
                        flow @ ControlFlow::Return(_) => return Ok(flow),
                    }
                }
                Ok(ControlFlow::None)
            }
            Stmt::Break { .. } => Ok(ControlFlow::Break),
            Stmt::Continue { .. } => Ok(ControlFlow::Continue),
            Stmt::Agent {
                name,
                instruction,
                tools,
                location,
            } => {
                self.insert_agent(name, instruction, tools, *location)?;
                Ok(ControlFlow::None)
            }
            Stmt::Ask {
                agent,
                message,
                location,
            } => {
                let message_value = self.eval(message)?;
                let response = self.ask_agent(agent, message_value, *location)?;
                self.emit(response, *location)?;
                Ok(ControlFlow::None)
            }
            Stmt::Expr(expr) => {
                self.eval(expr)?;
                Ok(ControlFlow::None)
            }
        }
    }

    fn eval(&mut self, expr: &Expr) -> Result<Value, RuntimeError> {
        self.charge_step(expr.location)?;
        let value = self.eval_inner(expr)?;
        let value_bytes = self.ensure_value_within_limit(&value, Some(expr.location))?;
        self.charge_value_work_bytes(value_bytes, expr.location)?;
        Ok(value)
    }

    fn eval_inner(&mut self, expr: &Expr) -> Result<Value, RuntimeError> {
        match &expr.kind {
            ExprKind::Number(value) => Ok(Value::Number(*value)),
            ExprKind::Text(value) => Ok(Value::Text(value.clone())),
            ExprKind::Bool(value) => Ok(Value::Bool(*value)),
            ExprKind::Variable(name) => {
                if let Some(value) = self.local_value(name) {
                    return Ok(value);
                }
                if let Some(imported) = self.imported_values.get(name) {
                    return self.imported_value(imported, expr.location);
                }
                if let Some(identity) = self.namespaces.get(name) {
                    return self.namespace_value(identity, expr.location);
                }
                if name == "input" && self.injected_input_visible() {
                    return self.input.clone().ok_or_else(|| {
                        self.error_at(expr.location, "injected input is unavailable", None)
                    });
                }
                self.vars.get(name).cloned().ok_or_else(|| {
                    self.error_at(expr.location, format!("unknown variable '{}'", name), None)
                })
            }
            ExprKind::Array(values) => {
                let mut result = Vec::new();
                let mut aggregate_bytes = 1usize;
                for value in values {
                    let value = self.eval(value)?;
                    let value_bytes =
                        self.ensure_value_within_limit(&value, Some(expr.location))?;
                    aggregate_bytes = self.ensure_aggregate_value_addition(
                        aggregate_bytes,
                        value_bytes,
                        expr.location,
                    )?;
                    result.push(value);
                }
                Ok(Value::Array(result))
            }
            ExprKind::Object(entries) => {
                let mut result = BTreeMap::new();
                let mut aggregate_bytes = 1usize;
                for (key, value_expr) in entries {
                    aggregate_bytes = self.ensure_aggregate_value_addition(
                        aggregate_bytes,
                        key.len(),
                        expr.location,
                    )?;
                    let value = self.eval(value_expr)?;
                    let value_bytes =
                        self.ensure_value_within_limit(&value, Some(expr.location))?;
                    aggregate_bytes = self.ensure_aggregate_value_addition(
                        aggregate_bytes,
                        value_bytes,
                        expr.location,
                    )?;
                    result.insert(key.clone(), value);
                }
                Ok(Value::Object(result))
            }
            ExprKind::Property(target, property) => {
                if let ExprKind::Variable(namespace) = &target.kind
                    && self.local_value(namespace).is_none()
                    && let Some(identity) = self.namespaces.get(namespace)
                {
                    return self.namespace_export_value(identity, property, expr.location);
                }
                let target = self.eval(target)?;
                match target {
                    Value::Object(entries) => {
                        Ok(entries.get(property).cloned().unwrap_or(Value::Null))
                    }
                    value => Err(self.error_at(
                        expr.location,
                        format!(
                            "Property access requires an object, got {}.",
                            value.type_name()
                        ),
                        Some("Use property access only with an object value.".to_string()),
                    )),
                }
            }
            ExprKind::Index(target, index) => {
                let target = self.eval(target)?;
                let index_value = self.eval(index)?;

                match target {
                    Value::Array(values) => match index_value {
                        Value::Number(index_number) if index_number < 0 => Err(self.error_at(
                            index.location,
                            "Array index cannot be negative.",
                            Some("Use an index starting at 0.".to_string()),
                        )),
                        Value::Number(index_number) => values.get(index_number as usize).cloned().ok_or_else(|| {
                            self.error_at(
                                index.location,
                                format!("Array index {} is out of bounds for an array of length {}.", index_number, values.len()),
                                Some(if values.is_empty() { "The array is empty, so no index is valid.".to_string() } else { format!("Use an index between 0 and {}.", values.len() - 1) }),
                            )
                        }),
                        value => Err(self.error_at(
                            index.location,
                            format!("Array index must be a number, got {}.", value.type_name()),
                            Some("Use a numeric array index.".to_string()),
                        )),
                    },
                    Value::Object(entries) => match index_value {
                        Value::Text(key) => Ok(entries.get(&key).cloned().unwrap_or(Value::Null)),
                        value => Err(self.error_at(
                            index.location,
                            format!("Object index must be text, got {}.", value.type_name()),
                            Some("Use a quoted object key.".to_string()),
                        )),
                    },
                    value => Err(self.error_at(
                        expr.location,
                        format!("Index access requires an array or object, got {}.", value.type_name()),
                        Some("Use [index] with an array or object value.".to_string()),
                    )),
                }
            }
            ExprKind::Unary { operator, expr } => {
                let value = self.eval(expr)?;
                Ok(self.eval_unary(operator, value))
            }
            ExprKind::Binary {
                left,
                operator,
                right,
            } => {
                let left = self.eval(left)?;
                let right = self.eval(right)?;
                self.eval_binary(left, operator, right, expr.location)
            }
            ExprKind::Call { name, args } => self.call_function(name, args, expr.location),
            ExprKind::ModuleCall {
                namespace,
                member,
                args,
            } => self.call_module_function(namespace, member, args, expr.location),
        }
    }

    fn eval_unary(&self, operator: &UnaryOp, value: Value) -> Value {
        match operator {
            UnaryOp::Not => Value::Bool(!value.is_truthy()),
        }
    }

    fn eval_binary(
        &self,
        left: Value,
        operator: &BinaryOp,
        right: Value,
        location: SourceLocation,
    ) -> Result<Value, RuntimeError> {
        match operator {
            BinaryOp::Add => {
                self.checked_numeric_binary(left, right, location, "+", i32::checked_add)
            }
            BinaryOp::Subtract => {
                self.checked_numeric_binary(left, right, location, "-", i32::checked_sub)
            }
            BinaryOp::Multiply => {
                self.checked_numeric_binary(left, right, location, "*", i32::checked_mul)
            }
            BinaryOp::Divide => {
                let (left_number, right_number) =
                    self.numeric_operands(left, right, location, "/")?;
                if right_number == 0 {
                    Err(self.error_at(
                        location,
                        "divide by zero",
                        Some("Use a non-zero divisor.".to_string()),
                    ))
                } else {
                    left_number
                        .checked_div(right_number)
                        .map(Value::Number)
                        .ok_or_else(|| self.integer_overflow_error(location, "/"))
                }
            }
            BinaryOp::Join => Ok(Value::Text(format!("{}{}", left, right))),
            BinaryOp::And => Ok(Value::Bool(left.is_truthy() && right.is_truthy())),
            BinaryOp::Or => Ok(Value::Bool(left.is_truthy() || right.is_truthy())),
            BinaryOp::Equal => Ok(Value::Bool(left == right)),
            BinaryOp::NotEqual => Ok(Value::Bool(left != right)),
            BinaryOp::Greater => self.numeric_comparison(left, right, location, ">", |a, b| a > b),
            BinaryOp::GreaterEqual => {
                self.numeric_comparison(left, right, location, ">=", |a, b| a >= b)
            }
            BinaryOp::Less => self.numeric_comparison(left, right, location, "<", |a, b| a < b),
            BinaryOp::LessEqual => {
                self.numeric_comparison(left, right, location, "<=", |a, b| a <= b)
            }
        }
    }

    fn checked_numeric_binary(
        &self,
        left: Value,
        right: Value,
        location: SourceLocation,
        operator: &str,
        operation: impl FnOnce(i32, i32) -> Option<i32>,
    ) -> Result<Value, RuntimeError> {
        let (left, right) = self.numeric_operands(left, right, location, operator)?;
        operation(left, right)
            .map(Value::Number)
            .ok_or_else(|| self.integer_overflow_error(location, operator))
    }

    fn integer_overflow_error(&self, location: SourceLocation, operator: &str) -> RuntimeError {
        self.error_at(
            location,
            format!("integer overflow for operator '{}'", operator),
            Some("Keep arithmetic results within the signed 32-bit integer range.".to_string()),
        )
    }

    fn numeric_comparison(
        &self,
        left: Value,
        right: Value,
        location: SourceLocation,
        operator: &str,
        comparison: impl FnOnce(i32, i32) -> bool,
    ) -> Result<Value, RuntimeError> {
        let (left, right) = self.numeric_operands(left, right, location, operator)?;
        Ok(Value::Bool(comparison(left, right)))
    }

    fn numeric_operands(
        &self,
        left: Value,
        right: Value,
        location: SourceLocation,
        operator: &str,
    ) -> Result<(i32, i32), RuntimeError> {
        match (&left, &right) {
            (Value::Number(left), Value::Number(right)) => Ok((*left, *right)),
            _ => Err(self.error_at(
                location,
                format!(
                    "operator '{}' requires number operands, got {} and {}",
                    operator,
                    left.type_name(),
                    right.type_name()
                ),
                Some("Use numbers with arithmetic and ordered comparison operators.".to_string()),
            )),
        }
    }

    fn call_function(
        &mut self,
        name: &str,
        args: &[Expr],
        location: SourceLocation,
    ) -> Result<Value, RuntimeError> {
        if self.read_only_bindings.contains(name) && self.local_value(name).is_some() {
            return Err(self.error_at(
                location,
                format!("lexical binding '{}' is not callable", name),
                None,
            ));
        }
        if let Some(value) = self.call_builtin(name, args, location) {
            return value.map_err(|error| self.attach_location(error, location));
        }

        let handle_bytes = self
            .functions
            .get(name)
            .map(Self::function_handle_clone_bytes)
            .ok_or_else(|| self.error_at(location, format!("unknown function '{}'", name), None))?;
        self.charge_value_work_bytes(handle_bytes, location)?;
        let function = self
            .functions
            .get(name)
            .cloned()
            .expect("validated function remains available");
        self.ensure_function_arity(&function, args.len(), location)?;
        let values = self.evaluate_argument_values(args, location)?;
        self.invoke_function(function, values, location)
    }

    fn call_module_function(
        &mut self,
        namespace: &str,
        member: &str,
        args: &[Expr],
        location: SourceLocation,
    ) -> Result<Value, RuntimeError> {
        if self.local_value(namespace).is_some() {
            return Err(self.error_at(
                location,
                format!("lexical binding '{}' is not a module namespace", namespace),
                None,
            ));
        }
        let identity_bytes = self.namespaces.get(namespace).map_or(0, |identity| {
            namespace
                .len()
                .saturating_add(identity.len())
                .saturating_add(2)
        });
        self.charge_value_work_bytes(identity_bytes, location)?;
        let identity = self.namespaces.get(namespace).cloned().ok_or_else(|| {
            self.error_at(
                location,
                format!("unknown module namespace '{}'", namespace),
                None,
            )
        })?;
        let scope = self
            .module_scopes
            .get(&identity)
            .ok_or_else(|| self.error_at(location, "module namespace was not initialized", None))?;
        if scope.exports.get(member) != Some(&ExportKind::Function) {
            return Err(self.error_at(
                location,
                format!(
                    "module '{}' does not export function '{}'",
                    identity, member
                ),
                None,
            ));
        }
        let handle_bytes = scope
            .functions
            .get(member)
            .map(Self::function_handle_clone_bytes)
            .ok_or_else(|| {
                self.error_at(
                    location,
                    "validated exported function was not initialized",
                    None,
                )
            })?;
        self.charge_value_work_bytes(handle_bytes, location)?;
        let function = self
            .module_scopes
            .get(&identity)
            .and_then(|scope| scope.functions.get(member))
            .cloned()
            .expect("validated exported function remains initialized");
        self.ensure_function_arity(&function, args.len(), location)?;
        let values = self.evaluate_argument_values(args, location)?;
        self.invoke_function(function, values, location)
    }

    fn ensure_function_arity(
        &self,
        function: &Function,
        received: usize,
        location: SourceLocation,
    ) -> Result<(), RuntimeError> {
        if received != function.params.len() {
            return Err(self.error_at(
                location,
                format!(
                    "Function '{}' expects {} arguments but received {}.",
                    function.name,
                    function.params.len(),
                    received
                ),
                Some("Pass exactly the parameters declared by the function.".to_string()),
            ));
        }
        Ok(())
    }

    fn evaluate_argument_values(
        &mut self,
        args: &[Expr],
        location: SourceLocation,
    ) -> Result<Vec<Value>, RuntimeError> {
        let mut values = Vec::new();
        let mut aggregate_bytes = 1usize;
        for argument in args {
            let value = self.eval(argument)?;
            let value_bytes = self.ensure_value_within_limit(&value, Some(location))?;
            aggregate_bytes =
                self.ensure_aggregate_value_addition(aggregate_bytes, value_bytes, location)?;
            values.push(value);
        }
        Ok(values)
    }

    fn invoke_function(
        &mut self,
        function: Function,
        values: Vec<Value>,
        location: SourceLocation,
    ) -> Result<Value, RuntimeError> {
        self.ensure_function_arity(&function, values.len(), location)?;
        if self.call_depth >= self.limits.max_call_depth {
            return Err(self.limit_error_at(
                location,
                format!("call depth exceeded {}", self.limits.max_call_depth),
                Some(
                    "Break the recursive cycle or increase the deterministic call-depth limit."
                        .to_string(),
                ),
            ));
        }

        let saved_suspended_scope_bytes = self.suspended_scope_bytes;
        let saved_suspended_metadata_bytes = self.suspended_metadata_bytes;
        let saved_scope_logical_clone_bytes = self.current_scope_logical_clone_bytes();
        let saved_scope_metadata_bytes = self
            .current_scope_clone_bytes()
            .saturating_sub(self.vars_bytes);
        let saved = self.capture_scope(location)?;
        let module_identity = function.module_identity.clone();
        let same_module_call = module_identity
            .as_ref()
            .is_some_and(|identity| self.active_module_calls.last() == Some(identity));

        let parameter_name_bytes = function.params.iter().fold(0usize, |total, name| {
            total.saturating_add(name.len().saturating_add(1))
        });
        self.ensure_literal_bytes(parameter_name_bytes.saturating_add(1), location)?;
        self.charge_value_work_bytes(parameter_name_bytes, location)?;
        let prepared_module_scope = if let Some(identity) = &module_identity
            && !same_module_call
        {
            let scope_value_bytes = self
                .module_scopes
                .get(identity)
                .map(|scope| {
                    scope
                        .value_bytes
                        .saturating_add(scope.function_bytes)
                        .saturating_add(scope.function_source_bytes)
                        .saturating_add(scope.metadata_bytes)
                        .saturating_add(scope.source_bytes)
                })
                .ok_or_else(|| {
                    self.error_at(
                        location,
                        "function's defining module was not initialized",
                        None,
                    )
                })?;
            let scope_clone_bytes = self
                .module_scopes
                .get(identity)
                .map(Self::stored_scope_clone_bytes)
                .expect("validated module scope remains available");
            let scope_clone_metadata_bytes = scope_clone_bytes.saturating_sub(
                self.module_scopes
                    .get(identity)
                    .map_or(0, |scope| scope.value_bytes),
            );
            self.ensure_metadata_replacement(
                0,
                saved_scope_metadata_bytes.saturating_add(scope_clone_metadata_bytes),
                location,
            )?;
            self.charge_value_work_bytes(scope_clone_bytes, location)?;
            let scope = self.module_scopes.get(identity).cloned().ok_or_else(|| {
                self.error_at(
                    location,
                    "function's defining module was not initialized",
                    None,
                )
            })?;
            let newly_replaced_scope_bytes = if self
                .active_module_calls
                .iter()
                .any(|active| active == identity)
            {
                0
            } else {
                scope_value_bytes
            };
            Some((scope, newly_replaced_scope_bytes))
        } else {
            None
        };
        let saved_local_state = if module_identity.is_some() {
            Some((
                std::mem::take(&mut self.local_bindings),
                std::mem::take(&mut self.local_bindings_bytes),
            ))
        } else {
            None
        };
        let suspended_local_bytes = saved_local_state.as_ref().map_or(0, |(_, bytes)| *bytes);
        let params = function
            .params
            .iter()
            .cloned()
            .zip(values)
            .collect::<HashMap<_, _>>();

        self.suspended_metadata_bytes = self
            .suspended_metadata_bytes
            .saturating_add(saved_scope_metadata_bytes);
        let switched_module_scope = prepared_module_scope.is_some();
        if let Some((scope, _scope_value_bytes)) = prepared_module_scope {
            self.apply_scope(scope);
        }
        self.suspended_scope_bytes = self
            .suspended_scope_bytes
            .saturating_add(saved_scope_logical_clone_bytes)
            .saturating_add(suspended_local_bytes);

        let function_scope_start = self.local_bindings.len();
        let transition_error = self
            .ensure_retained_values_within_limit(location)
            .and_then(|_| self.push_local_scope(params, location))
            .err();
        if let Some(error) = transition_error {
            let message = error.message().to_string();
            if switched_module_scope {
                self.restore_scope(saved);
            }
            self.suspended_scope_bytes = saved_suspended_scope_bytes;
            self.suspended_metadata_bytes = saved_suspended_metadata_bytes;
            if let Some((bindings, bytes)) = saved_local_state {
                self.local_bindings = bindings;
                self.local_bindings_bytes = bytes;
            }
            return Err(self.limit_error_at(location, message, None));
        }
        if let Some(identity) = &module_identity {
            self.active_module_calls.push(identity.clone());
        }
        self.function_scope_starts.push(function_scope_start);

        self.source = function.source.clone();
        self.filename = function.filename.clone();
        self.call_depth += 1;
        let flow = match self.execute_block(&function.body) {
            Ok(ControlFlow::Break | ControlFlow::Continue) => Err(self.error_at(
                location,
                "loop control escaped a function body",
                Some("Use break and continue only directly inside a loop.".to_string()),
            )),
            other => other,
        };
        self.call_depth -= 1;
        if module_identity.is_some() {
            self.pop_local_scope();
            self.function_scope_starts.pop();
            self.active_module_calls.pop();
        } else {
            self.pop_local_scope();
            self.function_scope_starts.pop();
        }

        // A module call is the transaction boundary. A successful cross-module call
        // commits its defining module before the caller resumes; a later caller
        // failure rolls back only the caller, not the already committed callee.
        if let (Some(identity), Ok(_)) = (&module_identity, &flow)
            && !same_module_call
        {
            let updated_vars = std::mem::take(&mut self.vars);
            let updated_value_bytes = std::mem::take(&mut self.vars_bytes);
            let scope = self
                .module_scopes
                .get_mut(identity)
                .expect("module scope remains initialized during its function call");
            self.module_scope_bytes = self
                .module_scope_bytes
                .saturating_sub(scope.value_bytes)
                .saturating_add(updated_value_bytes);
            scope.vars = updated_vars;
            scope.value_bytes = updated_value_bytes;
        }

        match (module_identity.is_some(), same_module_call, flow.is_ok()) {
            (true, true, true) => self.restore_scope_preserving_vars(saved),
            _ => self.restore_scope(saved),
        }
        self.suspended_scope_bytes = saved_suspended_scope_bytes;
        self.suspended_metadata_bytes = saved_suspended_metadata_bytes;
        if let Some((bindings, bytes)) = saved_local_state {
            self.local_bindings = bindings;
            self.local_bindings_bytes = bytes;
        }
        let flow = flow?;
        match flow {
            ControlFlow::None => Ok(Value::Null),
            ControlFlow::Return(value) => Ok(value),
            ControlFlow::Break | ControlFlow::Continue => {
                unreachable!("escaped loop control was normalized before transaction handling")
            }
        }
    }

    fn imported_value(
        &self,
        imported: &ImportedValue,
        location: SourceLocation,
    ) -> Result<Value, RuntimeError> {
        self.module_scopes
            .get(&imported.module_identity)
            .and_then(|scope| scope.vars.get(&imported.exported_name))
            .cloned()
            .ok_or_else(|| {
                self.error_at(
                    location,
                    "validated imported value was not initialized",
                    None,
                )
            })
    }

    fn namespace_value(
        &self,
        identity: &str,
        location: SourceLocation,
    ) -> Result<Value, RuntimeError> {
        let scope = self
            .module_scopes
            .get(identity)
            .ok_or_else(|| self.error_at(location, "module namespace was not initialized", None))?;
        let mut values = BTreeMap::new();
        for (name, kind) in &scope.exports {
            if *kind == ExportKind::Let
                && let Some(value) = scope.vars.get(name)
            {
                values.insert(name.clone(), value.clone());
            }
        }
        Ok(Value::Object(values))
    }

    fn namespace_export_value(
        &self,
        identity: &str,
        name: &str,
        location: SourceLocation,
    ) -> Result<Value, RuntimeError> {
        let scope = self
            .module_scopes
            .get(identity)
            .ok_or_else(|| self.error_at(location, "module namespace was not initialized", None))?;
        match scope.exports.get(name) {
            Some(ExportKind::Let) => scope.vars.get(name).cloned().ok_or_else(|| {
                self.error_at(
                    location,
                    "validated exported value was not initialized",
                    None,
                )
            }),
            Some(ExportKind::Function) => Err(self.error_at(
                location,
                format!(
                    "module '{}' export '{}' is a function and must be called",
                    identity, name
                ),
                None,
            )),
            None => Ok(Value::Null),
        }
    }

    fn capture_scope(&mut self, location: SourceLocation) -> Result<ModuleScope, RuntimeError> {
        let clone_bytes = self.current_scope_clone_bytes();
        self.ensure_metadata_replacement(0, clone_bytes.saturating_sub(self.vars_bytes), location)?;
        self.charge_value_work_bytes(clone_bytes, location)?;
        Ok(self.clone_scope_snapshot(
            self.source.clone(),
            self.filename.clone().unwrap_or_default(),
        ))
    }

    fn clone_scope_snapshot(&self, source: Arc<str>, filename: Arc<str>) -> ModuleScope {
        ModuleScope {
            vars: self.vars.clone(),
            value_bytes: self.vars_bytes,
            functions: self.functions.clone(),
            function_bytes: self.functions_bytes,
            function_work: self.functions_work,
            function_source_refs: self.function_source_refs.clone(),
            function_source_bytes: self.function_source_bytes,
            metadata_bytes: self.scope_metadata_bytes,
            source_bytes: self.active_source_bytes,
            imported_values: self.imported_values.clone(),
            namespaces: self.namespaces.clone(),
            read_only_bindings: self.read_only_bindings.clone(),
            exports: BTreeMap::new(),
            source,
            filename,
        }
    }

    fn apply_scope(&mut self, scope: ModuleScope) {
        self.vars = scope.vars;
        self.vars_bytes = scope.value_bytes;
        self.functions = scope.functions;
        self.functions_bytes = scope.function_bytes;
        self.functions_work = scope.function_work;
        self.function_source_refs = scope.function_source_refs;
        self.function_source_bytes = scope.function_source_bytes;
        self.scope_metadata_bytes = scope.metadata_bytes;
        self.active_source_bytes = scope.source_bytes;
        self.imported_values = scope.imported_values;
        self.namespaces = scope.namespaces;
        self.read_only_bindings = scope.read_only_bindings;
        self.source = scope.source;
        self.filename = Some(scope.filename);
    }

    fn restore_scope(&mut self, scope: ModuleScope) {
        self.apply_scope(scope);
    }

    fn restore_scope_preserving_vars(&mut self, scope: ModuleScope) {
        self.functions = scope.functions;
        self.functions_bytes = scope.function_bytes;
        self.functions_work = scope.function_work;
        self.function_source_refs = scope.function_source_refs;
        self.function_source_bytes = scope.function_source_bytes;
        self.scope_metadata_bytes = scope.metadata_bytes;
        self.active_source_bytes = scope.source_bytes;
        self.imported_values = scope.imported_values;
        self.namespaces = scope.namespaces;
        self.read_only_bindings = scope.read_only_bindings;
        self.source = scope.source;
        self.filename = Some(scope.filename);
    }

    fn call_builtin(
        &mut self,
        name: &str,
        args: &[Expr],
        location: SourceLocation,
    ) -> Option<Result<Value, RuntimeError>> {
        match name {
            "length" => Some(self.length(args, location)),
            "is_empty" => Some(self.is_empty(args, location)),
            "contains" => Some(self.contains(args, location)),
            "get" => Some(self.get(args, location)),
            "keys" => Some(self.keys(args, location)),
            "values" => Some(self.values(args, location)),
            "entries" => Some(self.entries(args, location)),
            "json_parse" => Some(self.json_parse(args, location)),
            "json_stringify" => Some(self.json_stringify(args, location)),
            "http_get" => {
                let input = self
                    .evaluate_builtin_arguments("http_get", args, 1, 1, location)
                    .map(|values| values.into_iter().next().expect("one checked argument"));

                match input {
                    Ok(Value::Text(url)) => {
                        Some(self.invoke_host(HostRequest::HttpGet { url }, location))
                    }
                    Ok(_) => Some(Err(self.error_at(
                        location,
                        "http_get expects a text URL",
                        None,
                    ))),
                    Err(error) => Some(Err(error)),
                }
            }
            "http_post" => {
                let values = self.evaluate_builtin_arguments("http_post", args, 2, 2, location);
                let (url, body) = match values {
                    Ok(mut values) => (Ok(values.remove(0)), Ok(values.remove(0))),
                    Err(error) => (Err(error), Ok(Value::Null)),
                };

                match (url, body) {
                    (Ok(Value::Text(url)), Ok(Value::Text(body))) => {
                        Some(self.invoke_host(HostRequest::HttpPost { url, body }, location))
                    }
                    (Ok(Value::Text(_)), Ok(_)) => Some(Err(self.error_at(
                        location,
                        "http_post expects a text body",
                        None,
                    ))),
                    (Ok(_), Ok(_)) => Some(Err(self.error_at(
                        location,
                        "http_post expects a text URL",
                        None,
                    ))),
                    (Err(error), _) | (_, Err(error)) => Some(Err(error)),
                }
            }
            "read_file" => {
                let input = self
                    .evaluate_builtin_arguments("read_file", args, 1, 1, location)
                    .map(|values| values.into_iter().next().expect("one checked argument"));

                match input {
                    Ok(Value::Text(path)) => {
                        Some(self.invoke_host(HostRequest::FileRead { path }, location))
                    }
                    Ok(_) => Some(Err(self.error_at(
                        location,
                        "read_file expects a text path",
                        None,
                    ))),
                    Err(error) => Some(Err(error)),
                }
            }
            "write_file" => {
                let values = self.evaluate_builtin_arguments("write_file", args, 2, 2, location);
                let (path, body) = match values {
                    Ok(mut values) => (Ok(values.remove(0)), Ok(values.remove(0))),
                    Err(error) => (Err(error), Ok(Value::Null)),
                };

                match (path, body) {
                    (Ok(Value::Text(path)), Ok(Value::Text(body))) => {
                        Some(self.invoke_host(HostRequest::FileWrite { path, body }, location))
                    }
                    (Ok(Value::Text(_)), Ok(_)) => Some(Err(self.error_at(
                        location,
                        "write_file expects a text body",
                        None,
                    ))),
                    (Ok(_), Ok(_)) => Some(Err(self.error_at(
                        location,
                        "write_file expects a text path",
                        None,
                    ))),
                    (Err(error), _) | (_, Err(error)) => Some(Err(error)),
                }
            }
            "env" => {
                let input = self
                    .evaluate_builtin_arguments("env", args, 1, 1, location)
                    .map(|values| values.into_iter().next().expect("one checked argument"));

                match input {
                    Ok(Value::Text(name)) => {
                        Some(self.invoke_host(HostRequest::Environment { name }, location))
                    }
                    Ok(_) => Some(Err(self.error_at(
                        location,
                        "env expects a text variable name",
                        None,
                    ))),
                    Err(error) => Some(Err(error)),
                }
            }
            _ => None,
        }
    }

    fn length(&mut self, args: &[Expr], location: SourceLocation) -> Result<Value, RuntimeError> {
        let values = self.evaluate_builtin_arguments("length", args, 1, 1, location)?;
        let length = match &values[0] {
            Value::Text(value) => value.chars().count(),
            Value::Array(values) => values.len(),
            Value::Object(entries) => entries.len(),
            value => {
                return Err(self.error_at(
                    location,
                    format!(
                        "length expects a text, array, or object value, got {}",
                        value.type_name()
                    ),
                    None,
                ));
            }
        };
        let length = i32::try_from(length).map_err(|_| {
            self.error_at(
                location,
                "length result exceeds SolveLang's signed 32-bit number range",
                None,
            )
        })?;
        Ok(Value::Number(length))
    }

    fn is_empty(&mut self, args: &[Expr], location: SourceLocation) -> Result<Value, RuntimeError> {
        let values = self.evaluate_builtin_arguments("is_empty", args, 1, 1, location)?;
        let is_empty = match &values[0] {
            Value::Text(value) => value.is_empty(),
            Value::Array(values) => values.is_empty(),
            Value::Object(entries) => entries.is_empty(),
            value => {
                return Err(self.error_at(
                    location,
                    format!(
                        "is_empty expects a text, array, or object value, got {}",
                        value.type_name()
                    ),
                    None,
                ));
            }
        };
        Ok(Value::Bool(is_empty))
    }

    fn contains(&mut self, args: &[Expr], location: SourceLocation) -> Result<Value, RuntimeError> {
        let values = self.evaluate_builtin_arguments("contains", args, 2, 2, location)?;
        let contains = match (&values[0], &values[1]) {
            (Value::Text(text), Value::Text(needle)) => text.contains(needle),
            (Value::Text(_), value) => {
                return Err(self.error_at(
                    location,
                    format!(
                        "contains expects a text search value for text, got {}",
                        value.type_name()
                    ),
                    None,
                ));
            }
            (Value::Array(values), needle) => values.contains(needle),
            (Value::Object(entries), Value::Text(key)) => entries.contains_key(key),
            (Value::Object(_), value) => {
                return Err(self.error_at(
                    location,
                    format!(
                        "contains expects a text key for an object, got {}",
                        value.type_name()
                    ),
                    None,
                ));
            }
            (value, _) => {
                return Err(self.error_at(
                    location,
                    format!(
                        "contains expects a text, array, or object value, got {}",
                        value.type_name()
                    ),
                    None,
                ));
            }
        };
        Ok(Value::Bool(contains))
    }

    fn get(&mut self, args: &[Expr], location: SourceLocation) -> Result<Value, RuntimeError> {
        let values = self.evaluate_builtin_arguments("get", args, 2, 3, location)?;
        let fallback = values.get(2).cloned().unwrap_or(Value::Null);
        match (&values[0], &values[1]) {
            (Value::Array(items), Value::Number(index)) => Ok(usize::try_from(*index)
                .ok()
                .and_then(|index| items.get(index).cloned())
                .unwrap_or(fallback)),
            (Value::Array(_), value) => Err(self.error_at(
                location,
                format!(
                    "get expects a number index for an array, got {}",
                    value.type_name()
                ),
                None,
            )),
            (Value::Object(entries), Value::Text(key)) => {
                Ok(entries.get(key).cloned().unwrap_or(fallback))
            }
            (Value::Object(_), value) => Err(self.error_at(
                location,
                format!(
                    "get expects a text key for an object, got {}",
                    value.type_name()
                ),
                None,
            )),
            (value, _) => Err(self.error_at(
                location,
                format!(
                    "get expects an array or object value, got {}",
                    value.type_name()
                ),
                None,
            )),
        }
    }

    fn keys(&mut self, args: &[Expr], location: SourceLocation) -> Result<Value, RuntimeError> {
        let values = self.evaluate_builtin_arguments("keys", args, 1, 1, location)?;
        match &values[0] {
            Value::Object(entries) => {
                let bytes = entries.keys().fold(1usize, |total, key| {
                    total.saturating_add(key.len()).saturating_add(1)
                });
                self.ensure_helper_result_budget(bytes, 1, location)?;
                Ok(Value::Array(
                    entries.keys().cloned().map(Value::Text).collect(),
                ))
            }
            value => Err(self.error_at(
                location,
                format!("keys expects an object value, got {}", value.type_name()),
                None,
            )),
        }
    }

    fn values(&mut self, args: &[Expr], location: SourceLocation) -> Result<Value, RuntimeError> {
        let values = self.evaluate_builtin_arguments("values", args, 1, 1, location)?;
        match &values[0] {
            Value::Object(entries) => {
                let mut bytes = 1usize;
                let mut depth = 1usize;
                for value in entries.values() {
                    bytes = bytes
                        .saturating_add(self.ensure_value_within_limit(value, Some(location))?);
                    depth = depth.max(value_depth(value).saturating_add(1));
                }
                self.ensure_helper_result_budget(bytes, depth, location)?;
                Ok(Value::Array(entries.values().cloned().collect()))
            }
            value => Err(self.error_at(
                location,
                format!("values expects an object value, got {}", value.type_name()),
                None,
            )),
        }
    }

    fn entries(&mut self, args: &[Expr], location: SourceLocation) -> Result<Value, RuntimeError> {
        let values = self.evaluate_builtin_arguments("entries", args, 1, 1, location)?;
        match &values[0] {
            Value::Object(entries) => {
                let mut result_bytes = 1usize;
                let mut result_depth = 2usize;
                for (key, value) in entries {
                    let value_bytes = self.ensure_value_within_limit(value, Some(location))?;
                    result_bytes = result_bytes
                        .saturating_add(1)
                        .saturating_add(key.len().saturating_add(1))
                        .saturating_add(value_bytes);
                    result_depth = result_depth.max(value_depth(value).saturating_add(2));
                }
                self.ensure_helper_result_budget(result_bytes, result_depth, location)?;
                Ok(Value::Array(
                    entries
                        .iter()
                        .map(|(key, value)| {
                            Value::Array(vec![Value::Text(key.clone()), value.clone()])
                        })
                        .collect(),
                ))
            }
            value => Err(self.error_at(
                location,
                format!("entries expects an object value, got {}", value.type_name()),
                None,
            )),
        }
    }

    fn ensure_helper_result_budget(
        &mut self,
        bytes: usize,
        depth: usize,
        location: SourceLocation,
    ) -> Result<(), RuntimeError> {
        self.ensure_literal_bytes(bytes, location)?;
        if depth > self.limits.max_call_depth {
            return Err(self.limit_error_at(
                location,
                format!("value nesting exceeded {}", self.limits.max_call_depth),
                Some("Use a shallower helper result.".to_string()),
            ));
        }
        self.charge_value_work_bytes(bytes, location)
    }

    fn json_parse(
        &mut self,
        args: &[Expr],
        location: SourceLocation,
    ) -> Result<Value, RuntimeError> {
        let value = self
            .evaluate_builtin_arguments("json_parse", args, 1, 1, location)?
            .into_iter()
            .next()
            .expect("one checked argument");
        let Value::Text(text) = value else {
            return Err(self.error_at(location, "json_parse expects a text value", None));
        };
        self.validate_json_parse_budget(&text, location)?;
        let json = serde_json::from_str::<JsonValue>(&text)
            .map_err(|error| self.error_at(location, format!("invalid JSON: {}", error), None))?;
        let value = Value::from_json(json).map_err(|message| {
            self.error_at(location, format!("invalid JSON: {}", message), None)
        })?;
        self.ensure_value_within_limit(&value, Some(location))?;
        Ok(value)
    }

    fn validate_json_parse_budget(
        &mut self,
        text: &str,
        location: SourceLocation,
    ) -> Result<(), RuntimeError> {
        let mut in_string = false;
        let mut escaped = false;
        let mut in_atom = false;
        let mut depth = 0usize;
        let mut nodes = 0usize;
        for byte in text.bytes() {
            if in_string {
                if escaped {
                    escaped = false;
                } else if byte == b'\\' {
                    escaped = true;
                } else if byte == b'"' {
                    in_string = false;
                }
                continue;
            }
            match byte {
                b'"' => {
                    in_string = true;
                    in_atom = false;
                    nodes = nodes.saturating_add(1);
                }
                b'[' | b'{' => {
                    in_atom = false;
                    nodes = nodes.saturating_add(1);
                    depth = depth.saturating_add(1);
                    if depth > self.limits.max_call_depth {
                        return Err(self.limit_error_at(
                            location,
                            format!("value nesting exceeded {}", self.limits.max_call_depth),
                            None,
                        ));
                    }
                }
                b']' | b'}' => {
                    in_atom = false;
                    depth = depth.saturating_sub(1);
                }
                b',' | b':' | b' ' | b'\n' | b'\r' | b'\t' => in_atom = false,
                _ if !in_atom => {
                    in_atom = true;
                    nodes = nodes.saturating_add(1);
                }
                _ => {}
            }
            if nodes > self.limits.max_steps || nodes > self.limits.max_value_bytes {
                return Err(self.limit_error_at(
                    location,
                    "JSON structure exceeded deterministic evaluation limits",
                    Some("Parse a smaller JSON document.".to_string()),
                ));
            }
        }
        let estimated_peak = text.len().saturating_mul(3).saturating_add(
            nodes
                .saturating_mul(std::mem::size_of::<Value>())
                .saturating_mul(2),
        );
        let peak_limit = self.limits.max_value_bytes.saturating_mul(4);
        if estimated_peak > peak_limit {
            return Err(self.limit_error_at(
                location,
                format!("JSON parse work exceeded {peak_limit} bytes"),
                Some("Parse a smaller or less fragmented JSON document.".to_string()),
            ));
        }
        self.charge_steps(nodes, location)?;
        self.charge_value_work_bytes(estimated_peak, location)
    }

    fn json_stringify(
        &mut self,
        args: &[Expr],
        location: SourceLocation,
    ) -> Result<Value, RuntimeError> {
        let value = self
            .evaluate_builtin_arguments("json_stringify", args, 1, 1, location)?
            .into_iter()
            .next()
            .expect("one checked argument");
        let encoded_bytes = bounded_json_encoded_len(
            &value,
            self.limits.max_value_bytes.saturating_sub(1),
            self.limits.max_call_depth,
        )
        .map_err(|reason| match reason {
            ValueBudgetError::Bytes => self.limit_error_at(
                location,
                format!("value exceeded {} bytes", self.limits.max_value_bytes),
                Some("Stringify a smaller value.".to_string()),
            ),
            ValueBudgetError::Depth => self.limit_error_at(
                location,
                format!("value nesting exceeded {}", self.limits.max_call_depth),
                Some("Stringify a shallower value.".to_string()),
            ),
        })?;
        self.charge_value_work_bytes(encoded_bytes.saturating_add(1), location)?;
        let mut output = String::with_capacity(encoded_bytes);
        write_json_value(&value, &mut output);
        debug_assert_eq!(output.len(), encoded_bytes);
        Ok(Value::Text(output))
    }

    fn evaluate_builtin_arguments(
        &mut self,
        name: &str,
        args: &[Expr],
        minimum: usize,
        maximum: usize,
        location: SourceLocation,
    ) -> Result<Vec<Value>, RuntimeError> {
        if args.len() < minimum || args.len() > maximum {
            let expected = if minimum == maximum {
                minimum.to_string()
            } else {
                format!("between {} and {}", minimum, maximum)
            };
            return Err(self.error_at(
                location,
                format!(
                    "{} expects {} argument{} but received {}",
                    name,
                    expected,
                    if maximum == 1 { "" } else { "s" },
                    args.len()
                ),
                None,
            ));
        }
        self.evaluate_argument_values(args, location)
    }

    fn invoke_host(
        &mut self,
        request: HostRequest,
        location: SourceLocation,
    ) -> Result<Value, RuntimeError> {
        let capability = request.capability();
        if let Err(error) = self.host.authorize(&capability) {
            return Err(self.host_error_at(error, location));
        }
        match self.host.invoke(request, self.limits.max_value_bytes) {
            Ok(value) => {
                self.ensure_value_within_limit(&value, Some(location))?;
                Ok(value)
            }
            Err(error) => Err(self.host_error_at(error, location)),
        }
    }

    fn ask_agent(
        &mut self,
        name: &str,
        message: Value,
        location: SourceLocation,
    ) -> Result<Value, RuntimeError> {
        let retained_bytes = self
            .agents
            .get(name)
            .map_or(0, |agent| agent.retained_bytes);
        self.charge_value_work_bytes(retained_bytes, location)?;
        let agent =
            self.agents.get(name).cloned().ok_or_else(|| {
                self.error_at(location, format!("unknown agent '{}'", name), None)
            })?;
        self.invoke_host(
            HostRequest::Provider {
                agent: name.to_string(),
                instruction: agent.instruction,
                tools: agent.tools,
                message,
            },
            location,
        )
    }

    fn charge_step(&mut self, location: SourceLocation) -> Result<(), RuntimeError> {
        self.charge_steps(1, location)
    }

    fn charge_steps(&mut self, steps: usize, location: SourceLocation) -> Result<(), RuntimeError> {
        if steps > self.limits.max_steps.saturating_sub(self.steps) {
            return Err(self.limit_error_at(
                location,
                format!("evaluation stopped after {} steps", self.limits.max_steps),
                Some("Increase the deterministic step limit or simplify the workflow.".to_string()),
            ));
        }
        self.steps += steps;
        Ok(())
    }
}

fn bounded_value_size(
    value: &Value,
    max_bytes: usize,
    max_depth: usize,
) -> Result<usize, ValueBudgetError> {
    fn consume_bytes(remaining: &mut usize, amount: usize) -> Result<(), ValueBudgetError> {
        if amount > *remaining {
            Err(ValueBudgetError::Bytes)
        } else {
            *remaining -= amount;
            Ok(())
        }
    }

    fn consume_value(
        value: &Value,
        remaining: &mut usize,
        depth: usize,
        max_depth: usize,
    ) -> Result<(), ValueBudgetError> {
        if depth > max_depth {
            return Err(ValueBudgetError::Depth);
        }
        consume_bytes(remaining, 1)?;
        match value {
            Value::Text(text) => consume_bytes(remaining, text.len()),
            Value::Array(values) => {
                for value in values {
                    consume_value(value, remaining, depth.saturating_add(1), max_depth)?;
                }
                Ok(())
            }
            Value::Object(entries) => {
                for (key, value) in entries {
                    consume_bytes(remaining, key.len())?;
                    consume_value(value, remaining, depth.saturating_add(1), max_depth)?;
                }
                Ok(())
            }
            Value::Number(_) | Value::Bool(_) | Value::Null => Ok(()),
        }
    }

    let mut remaining = max_bytes;
    consume_value(value, &mut remaining, 0, max_depth)?;
    Ok(max_bytes - remaining)
}

fn value_depth(value: &Value) -> usize {
    match value {
        Value::Array(values) => values
            .iter()
            .map(value_depth)
            .max()
            .unwrap_or(0)
            .saturating_add(1),
        Value::Object(entries) => entries
            .values()
            .map(value_depth)
            .max()
            .unwrap_or(0)
            .saturating_add(1),
        Value::Number(_) | Value::Text(_) | Value::Bool(_) | Value::Null => 0,
    }
}

fn bounded_json_encoded_len(
    value: &Value,
    max_bytes: usize,
    max_depth: usize,
) -> Result<usize, ValueBudgetError> {
    fn consume(remaining: &mut usize, bytes: usize) -> Result<(), ValueBudgetError> {
        if bytes > *remaining {
            Err(ValueBudgetError::Bytes)
        } else {
            *remaining -= bytes;
            Ok(())
        }
    }

    fn string_len(value: &str) -> usize {
        value.chars().fold(2usize, |total, character| {
            total.saturating_add(match character {
                '"' | '\\' | '\u{08}' | '\u{0c}' | '\n' | '\r' | '\t' => 2,
                character if character <= '\u{1f}' => 6,
                character => character.len_utf8(),
            })
        })
    }

    fn visit(
        value: &Value,
        remaining: &mut usize,
        depth: usize,
        max_depth: usize,
    ) -> Result<(), ValueBudgetError> {
        if depth > max_depth {
            return Err(ValueBudgetError::Depth);
        }
        match value {
            Value::Null => consume(remaining, 4),
            Value::Bool(true) => consume(remaining, 4),
            Value::Bool(false) => consume(remaining, 5),
            Value::Number(number) => consume(remaining, number.to_string().len()),
            Value::Text(text) => consume(remaining, string_len(text)),
            Value::Array(values) => {
                consume(remaining, 2)?;
                for (index, value) in values.iter().enumerate() {
                    if index > 0 {
                        consume(remaining, 1)?;
                    }
                    visit(value, remaining, depth.saturating_add(1), max_depth)?;
                }
                Ok(())
            }
            Value::Object(entries) => {
                consume(remaining, 2)?;
                for (index, (key, value)) in entries.iter().enumerate() {
                    if index > 0 {
                        consume(remaining, 1)?;
                    }
                    consume(remaining, string_len(key))?;
                    consume(remaining, 1)?;
                    visit(value, remaining, depth.saturating_add(1), max_depth)?;
                }
                Ok(())
            }
        }
    }

    let mut remaining = max_bytes;
    visit(value, &mut remaining, 0, max_depth)?;
    Ok(max_bytes - remaining)
}

fn write_json_string(value: &str, output: &mut String) {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    output.push('"');
    for character in value.chars() {
        match character {
            '"' => output.push_str("\\\""),
            '\\' => output.push_str("\\\\"),
            '\u{08}' => output.push_str("\\b"),
            '\u{0c}' => output.push_str("\\f"),
            '\n' => output.push_str("\\n"),
            '\r' => output.push_str("\\r"),
            '\t' => output.push_str("\\t"),
            character if character <= '\u{1f}' => {
                let value = character as usize;
                output.push_str("\\u00");
                output.push(HEX[(value >> 4) & 0x0f] as char);
                output.push(HEX[value & 0x0f] as char);
            }
            character => output.push(character),
        }
    }
    output.push('"');
}

fn write_json_value(value: &Value, output: &mut String) {
    match value {
        Value::Null => output.push_str("null"),
        Value::Bool(value) => output.push_str(if *value { "true" } else { "false" }),
        Value::Number(value) => output.push_str(&value.to_string()),
        Value::Text(value) => write_json_string(value, output),
        Value::Array(values) => {
            output.push('[');
            for (index, value) in values.iter().enumerate() {
                if index > 0 {
                    output.push(',');
                }
                write_json_value(value, output);
            }
            output.push(']');
        }
        Value::Object(entries) => {
            output.push('{');
            for (index, (key, value)) in entries.iter().enumerate() {
                if index > 0 {
                    output.push(',');
                }
                write_json_string(key, output);
                output.push(':');
                write_json_value(value, output);
            }
            output.push('}');
        }
    }
}

struct SyntaxSnapshotBudget {
    bytes: usize,
    work: usize,
    limits: EvaluationLimits,
}

impl SyntaxSnapshotBudget {
    fn new(limits: EvaluationLimits) -> Self {
        Self {
            bytes: 0,
            work: 0,
            limits,
        }
    }

    fn node(&mut self) -> Result<(), RuntimeError> {
        if self.work >= self.limits.max_steps {
            return Err(RuntimeError::with_kind(
                RuntimeErrorKind::LimitExceeded,
                format!("evaluation stopped after {} steps", self.limits.max_steps),
            ));
        }
        self.work += 1;
        self.bytes(1)
    }

    fn bytes(&mut self, bytes: usize) -> Result<(), RuntimeError> {
        let limit = structural_byte_limit(self.limits);
        if bytes > limit.saturating_sub(self.bytes) {
            return Err(RuntimeError::with_kind(
                RuntimeErrorKind::LimitExceeded,
                format!("syntax snapshot exceeded {limit} bytes"),
            ));
        }
        self.bytes += bytes;
        Ok(())
    }

    fn string(&mut self, value: &str) -> Result<(), RuntimeError> {
        self.node()?;
        self.bytes(value.len().saturating_add(1))
    }

    fn child_depth(&self, depth: usize) -> Result<usize, RuntimeError> {
        let child = depth.saturating_add(1);
        if child > self.limits.max_call_depth {
            Err(RuntimeError::with_kind(
                RuntimeErrorKind::LimitExceeded,
                format!("syntax nesting exceeded {}", self.limits.max_call_depth),
            ))
        } else {
            Ok(child)
        }
    }
}

fn snapshot_statements(
    statements: &[Stmt],
    budget: &mut SyntaxSnapshotBudget,
    depth: usize,
) -> Result<(), RuntimeError> {
    for statement in statements {
        snapshot_statement(statement, budget, depth)?;
    }
    Ok(())
}

fn snapshot_statement(
    statement: &Stmt,
    budget: &mut SyntaxSnapshotBudget,
    depth: usize,
) -> Result<(), RuntimeError> {
    budget.node()?;
    match statement {
        Stmt::LegacyInclude { path, .. } => budget.string(path),
        Stmt::ModuleImport {
            path, namespace, ..
        } => {
            budget.string(path)?;
            budget.string(namespace)
        }
        Stmt::NamedModuleImport { path, bindings, .. } => {
            budget.string(path)?;
            for binding in bindings {
                budget.node()?;
                budget.string(&binding.exported)?;
                budget.string(&binding.local)?;
            }
            Ok(())
        }
        Stmt::Export { declaration, .. } => {
            let child = budget.child_depth(depth)?;
            snapshot_declaration(declaration, budget, child)
        }
        Stmt::Let { name, value, .. } | Stmt::Assign { name, value, .. } => {
            budget.string(name)?;
            let child = budget.child_depth(depth)?;
            snapshot_expression(value, budget, child)
        }
        Stmt::Print { value, .. } | Stmt::Return { value, .. } => {
            let child = budget.child_depth(depth)?;
            snapshot_expression(value, budget, child)
        }
        Stmt::Function {
            name, params, body, ..
        } => {
            budget.string(name)?;
            for param in params {
                budget.string(param)?;
            }
            let child = budget.child_depth(depth)?;
            snapshot_statements(body, budget, child)
        }
        Stmt::If {
            condition,
            then_branch,
            else_branch,
            ..
        } => {
            let child = budget.child_depth(depth)?;
            snapshot_expression(condition, budget, child)?;
            snapshot_statements(then_branch, budget, child)?;
            snapshot_statements(else_branch, budget, child)
        }
        Stmt::While {
            condition, body, ..
        } => {
            let child = budget.child_depth(depth)?;
            snapshot_expression(condition, budget, child)?;
            snapshot_statements(body, budget, child)
        }
        Stmt::For {
            name,
            iterable,
            body,
            ..
        } => {
            budget.string(name)?;
            let child = budget.child_depth(depth)?;
            snapshot_expression(iterable, budget, child)?;
            snapshot_statements(body, budget, child)
        }
        Stmt::Agent {
            name,
            instruction,
            tools,
            ..
        } => {
            budget.string(name)?;
            budget.string(instruction)?;
            for tool in tools {
                budget.string(tool)?;
            }
            Ok(())
        }
        Stmt::Ask { agent, message, .. } => {
            budget.string(agent)?;
            let child = budget.child_depth(depth)?;
            snapshot_expression(message, budget, child)
        }
        Stmt::Expr(expression) => {
            let child = budget.child_depth(depth)?;
            snapshot_expression(expression, budget, child)
        }
        Stmt::Break { .. } | Stmt::Continue { .. } => Ok(()),
    }
}

fn snapshot_declaration(
    declaration: &ExportedDeclaration,
    budget: &mut SyntaxSnapshotBudget,
    depth: usize,
) -> Result<(), RuntimeError> {
    budget.node()?;
    match declaration {
        ExportedDeclaration::Let { name, value, .. } => {
            budget.string(name)?;
            let child = budget.child_depth(depth)?;
            snapshot_expression(value, budget, child)
        }
        ExportedDeclaration::Function {
            name, params, body, ..
        } => {
            budget.string(name)?;
            for param in params {
                budget.string(param)?;
            }
            let child = budget.child_depth(depth)?;
            snapshot_statements(body, budget, child)
        }
    }
}

fn snapshot_expression(
    expression: &Expr,
    budget: &mut SyntaxSnapshotBudget,
    depth: usize,
) -> Result<(), RuntimeError> {
    budget.node()?;
    match &expression.kind {
        ExprKind::Text(value) | ExprKind::Variable(value) => budget.string(value),
        ExprKind::Array(values) => {
            let child = budget.child_depth(depth)?;
            for value in values {
                snapshot_expression(value, budget, child)?;
            }
            Ok(())
        }
        ExprKind::Object(entries) => {
            let child = budget.child_depth(depth)?;
            for (key, value) in entries {
                budget.node()?;
                budget.string(key)?;
                snapshot_expression(value, budget, child)?;
            }
            Ok(())
        }
        ExprKind::Property(target, property) => {
            budget.string(property)?;
            let child = budget.child_depth(depth)?;
            snapshot_expression(target, budget, child)
        }
        ExprKind::Index(target, index) => {
            let child = budget.child_depth(depth)?;
            snapshot_expression(target, budget, child)?;
            snapshot_expression(index, budget, child)
        }
        ExprKind::Unary { expr, .. } => {
            let child = budget.child_depth(depth)?;
            snapshot_expression(expr, budget, child)
        }
        ExprKind::Binary { left, right, .. } => {
            let child = budget.child_depth(depth)?;
            snapshot_expression(left, budget, child)?;
            snapshot_expression(right, budget, child)
        }
        ExprKind::Call { name, args } => {
            budget.string(name)?;
            let child = budget.child_depth(depth)?;
            for argument in args {
                snapshot_expression(argument, budget, child)?;
            }
            Ok(())
        }
        ExprKind::ModuleCall {
            namespace,
            member,
            args,
        } => {
            budget.string(namespace)?;
            budget.string(member)?;
            let child = budget.child_depth(depth)?;
            for argument in args {
                snapshot_expression(argument, budget, child)?;
            }
            Ok(())
        }
        ExprKind::Number(_) | ExprKind::Bool(_) => Ok(()),
    }
}

/// Validates and sizes an in-memory syntax snapshot without allocating a traversal copy.
pub fn bounded_syntax_snapshot_bytes(
    statements: &[Stmt],
    limits: EvaluationLimits,
) -> Result<usize, RuntimeError> {
    syntax_snapshot_metrics(statements, limits).map(|(bytes, _)| bytes)
}

/// Validates and counts syntax nodes without allocating a traversal copy.
pub fn bounded_syntax_snapshot_work(
    statements: &[Stmt],
    limits: EvaluationLimits,
) -> Result<usize, RuntimeError> {
    syntax_snapshot_metrics(statements, limits).map(|(_, work)| work)
}

fn syntax_snapshot_metrics(
    statements: &[Stmt],
    limits: EvaluationLimits,
) -> Result<(usize, usize), RuntimeError> {
    let mut budget = SyntaxSnapshotBudget::new(limits);
    snapshot_statements(statements, &mut budget, 0)?;
    Ok((budget.bytes, budget.work))
}

/// Validates and sizes an explicit-module program without allocating a traversal copy.
pub fn bounded_module_program_snapshot_bytes(
    program: &ModuleProgram,
    limits: EvaluationLimits,
) -> Result<usize, RuntimeError> {
    module_program_snapshot_metrics(program, limits).map_err(|failure| failure.error)
}

struct ModuleSnapshotFailure<'a> {
    error: RuntimeError,
    identity: Option<&'a str>,
}

fn module_program_snapshot_metrics<'a>(
    program: &'a ModuleProgram,
    limits: EvaluationLimits,
) -> Result<usize, ModuleSnapshotFailure<'a>> {
    let mut budget = SyntaxSnapshotBudget::new(limits);
    budget.node().map_err(|error| ModuleSnapshotFailure {
        error,
        identity: None,
    })?;
    budget
        .string(&program.entry)
        .map_err(|error| ModuleSnapshotFailure {
            error,
            identity: None,
        })?;
    for identity in &program.order {
        budget
            .string(identity)
            .map_err(|error| ModuleSnapshotFailure {
                error,
                identity: None,
            })?;
    }
    for (key, node) in &program.modules {
        let identity = Some(key.as_str());
        budget
            .node()
            .map_err(|error| ModuleSnapshotFailure { error, identity })?;
        budget
            .string(key)
            .map_err(|error| ModuleSnapshotFailure { error, identity })?;
        budget
            .string(&node.identity)
            .map_err(|error| ModuleSnapshotFailure { error, identity })?;
        budget
            .string(&node.source)
            .map_err(|error| ModuleSnapshotFailure { error, identity })?;
        snapshot_statements(&node.statements, &mut budget, 0)
            .map_err(|error| ModuleSnapshotFailure { error, identity })?;
        for dependency in &node.dependencies {
            budget
                .string(dependency)
                .map_err(|error| ModuleSnapshotFailure { error, identity })?;
        }
        for export in node.exports.keys() {
            budget
                .node()
                .map_err(|error| ModuleSnapshotFailure { error, identity })?;
            budget
                .string(export)
                .map_err(|error| ModuleSnapshotFailure { error, identity })?;
        }
    }
    Ok(budget.bytes)
}

fn lexical_binding_exists<T>(scopes: &[HashSet<T>], name: &str) -> bool
where
    T: Borrow<str> + Eq + Hash,
{
    scopes.iter().rev().any(|scope| scope.contains(name))
}

fn is_pure_builtin(name: &str) -> bool {
    matches!(
        name,
        "length"
            | "is_empty"
            | "contains"
            | "get"
            | "keys"
            | "values"
            | "entries"
            | "json_parse"
            | "json_stringify"
    )
}

fn host_capability(name: &str) -> Option<Capability> {
    match name {
        "http_get" | "http_post" => Some(Capability::Network),
        "read_file" => Some(Capability::FileRead),
        "write_file" => Some(Capability::FileWrite),
        "env" => Some(Capability::Environment),
        _ => None,
    }
}

fn is_explicitly_unsafe_name(name: &str) -> bool {
    matches!(
        name,
        "shell"
            | "shell_exec"
            | "exec"
            | "process"
            | "spawn"
            | "plugin"
            | "load_plugin"
            | "stripe"
            | "stripe_charge"
            | "send_email"
            | "linear_create_issue"
            | "db_write"
            | "delete_file"
    )
}

fn statement_location(statement: &Stmt) -> SourceLocation {
    match statement {
        Stmt::LegacyInclude { location, .. }
        | Stmt::ModuleImport { location, .. }
        | Stmt::NamedModuleImport { location, .. }
        | Stmt::Export { location, .. }
        | Stmt::Let { location, .. }
        | Stmt::Assign { location, .. }
        | Stmt::Print { location, .. }
        | Stmt::Return { location, .. }
        | Stmt::Function { location, .. }
        | Stmt::If { location, .. }
        | Stmt::While { location, .. }
        | Stmt::For { location, .. }
        | Stmt::Break { location }
        | Stmt::Continue { location }
        | Stmt::Agent { location, .. }
        | Stmt::Ask { location, .. } => *location,
        Stmt::Expr(expression) => expression.location,
    }
}

fn first_call_location(expression: &Expr) -> Option<SourceLocation> {
    match &expression.kind {
        ExprKind::Call { .. } | ExprKind::ModuleCall { .. } => Some(expression.location),
        ExprKind::Array(values) => values.iter().find_map(first_call_location),
        ExprKind::Object(entries) => entries.values().find_map(first_call_location),
        ExprKind::Property(target, _) | ExprKind::Unary { expr: target, .. } => {
            first_call_location(target)
        }
        ExprKind::Index(target, index) => {
            first_call_location(target).or_else(|| first_call_location(index))
        }
        ExprKind::Binary { left, right, .. } => {
            first_call_location(left).or_else(|| first_call_location(right))
        }
        ExprKind::Number(_) | ExprKind::Text(_) | ExprKind::Bool(_) | ExprKind::Variable(_) => None,
    }
}

#[cfg(test)]
mod state_tests {
    use super::{DenyAllHost, Evaluator, ExportKind, ModuleNode, ModuleProgram};
    use crate::{ast::Stmt, lexer, parser::Parser, value::Value};

    fn parse(source: &str) -> Vec<Stmt> {
        Parser::new(lexer::lex(source))
            .parse()
            .expect("module source parses")
    }

    fn node(
        identity: &str,
        source: &str,
        dependencies: &[&str],
        exports: &[(&str, ExportKind)],
    ) -> ModuleNode {
        ModuleNode {
            identity: identity.to_string(),
            source: source.to_string(),
            statements: parse(source),
            dependencies: dependencies
                .iter()
                .map(|dependency| (*dependency).to_string())
                .collect(),
            exports: exports
                .iter()
                .map(|(name, kind)| ((*name).to_string(), *kind))
                .collect(),
        }
    }

    fn program(entry: &str, order: &[&str], nodes: Vec<ModuleNode>) -> ModuleProgram {
        ModuleProgram {
            entry: entry.to_string(),
            modules: nodes
                .into_iter()
                .map(|node| (node.identity.clone(), node))
                .collect(),
            order: order.iter().map(|item| (*item).to_string()).collect(),
        }
    }

    #[test]
    fn nested_same_module_failure_rolls_back_the_outermost_call_chain() {
        let counter_source = r#"
export let count = 1
fn first() { count = count + 2 }
fn second() { count = count + 3 }
export fn fail_outer() { count = count + 1 first() second() return 1 / 0 }
"#;
        let entry_source = "import \"counter.solve\" as counter\ncounter.fail_outer()\n";
        let modules = program(
            "entry.solve",
            &["counter.solve", "entry.solve"],
            vec![
                node(
                    "counter.solve",
                    counter_source,
                    &[],
                    &[
                        ("count", ExportKind::Let),
                        ("fail_outer", ExportKind::Function),
                    ],
                ),
                node("entry.solve", entry_source, &["counter.solve"], &[]),
            ],
        );
        let mut evaluator = Evaluator::new(DenyAllHost);

        evaluator
            .run_modules(&modules)
            .expect_err("same-module chain fails");

        assert_eq!(
            evaluator.module_scopes["counter.solve"].vars["count"],
            Value::Number(1)
        );
    }

    #[test]
    fn failed_caller_rolls_back_locally_but_keeps_committed_callee_state() {
        let callee_source = r#"
export let count = 0
export fn bump() { count = count + 1 return count }
"#;
        let caller_source = r#"
import "callee.solve" as callee
export let count = 0
export fn fail_after_callee() { count = count + 10 let committed = callee.bump() return 1 / 0 }
"#;
        let entry_source = "import \"caller.solve\" as caller\ncaller.fail_after_callee()\n";
        let modules = program(
            "entry.solve",
            &["callee.solve", "caller.solve", "entry.solve"],
            vec![
                node(
                    "callee.solve",
                    callee_source,
                    &[],
                    &[("count", ExportKind::Let), ("bump", ExportKind::Function)],
                ),
                node(
                    "caller.solve",
                    caller_source,
                    &["callee.solve"],
                    &[
                        ("count", ExportKind::Let),
                        ("fail_after_callee", ExportKind::Function),
                    ],
                ),
                node("entry.solve", entry_source, &["caller.solve"], &[]),
            ],
        );
        let mut evaluator = Evaluator::new(DenyAllHost);

        evaluator
            .run_modules(&modules)
            .expect_err("caller fails after committed callee call");

        assert_eq!(
            evaluator.module_scopes["caller.solve"].vars["count"],
            Value::Number(0)
        );
        assert_eq!(
            evaluator.module_scopes["callee.solve"].vars["count"],
            Value::Number(1)
        );
    }

    #[test]
    fn failed_initialization_rolls_back_the_whole_module_phase() {
        let good_source = "export let value = 1\n";
        let bad_source = "export let value = 1 / 0\n";
        let entry_source = "import \"bad.solve\" as bad\n";
        let modules = program(
            "entry.solve",
            &["good.solve", "bad.solve", "entry.solve"],
            vec![
                node(
                    "good.solve",
                    good_source,
                    &[],
                    &[("value", ExportKind::Let)],
                ),
                node("bad.solve", bad_source, &[], &[("value", ExportKind::Let)]),
                node("entry.solve", entry_source, &["bad.solve"], &[]),
            ],
        );
        let mut evaluator = Evaluator::new(DenyAllHost);

        let error = evaluator
            .run_modules(&modules)
            .expect_err("imperative module initializer fails atomically");

        assert_eq!(error.source_name(), Some("bad.solve"));
        assert!(evaluator.module_scopes.is_empty());
        assert!(evaluator.module_initialization.is_empty());
        assert!(evaluator.outputs().is_empty());
    }
}
