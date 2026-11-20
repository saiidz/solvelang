//! Signed-gate tooling for the native CLI (Phase 4).
//!
//! This module owns everything cryptographic and file-shaped about
//! signed gates; the pure core (`solvec-core`) owns the formats'
//! constants, the canonical payload, and the refusal semantics, and
//! never touches keys, files, or clocks.
//!
//! Artifacts (versioned JSON; format identifiers and the version come
//! from `solvec_core::evaluator`):
//!
//! - **Key registry** — `{"format": "solvelang.key-registry",
//!   "version": 1, "keys": [{"id", "algorithm": "ed25519",
//!   "public_key": <base64>, "status": "active" | "revoked"}]}`.
//!   A public file, safe to commit; revoking a key is a registry edit
//!   (`"status": "revoked"`). Default location: `solve-keys.json`
//!   beside the workflow.
//! - **Signatures** — `{"format": "solvelang.gate-signatures",
//!   "version": 1, "signatures": [ ... ]}` with one record per signed
//!   gate. Default location: `<workflow>.signatures.json`.
//! - **Private key** — `{"format": "solvelang.private-key",
//!   "version": 1, "id", "algorithm": "ed25519", "private_key":
//!   <base64 seed>}`. Held only by the signer, written with 0600
//!   permissions, never committed.

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use ed25519_dalek::{Signature, Signer, SigningKey, Verifier, VerifyingKey};
use sha2::{Digest, Sha256};

use solvec_core::evaluator::{
    GATE_ALGORITHM_ED25519, GATE_FORMAT_VERSION, GATE_KEY_REGISTRY_FORMAT, GATE_PRIVATE_KEY_FORMAT,
    GATE_SIGNATURES_FORMAT, GateBook, GateCheck, GateDeclaration, GateRefusal, GateSignatureRecord,
    gate_canonical_payload, gate_codes,
};

/// One registered signer key from the key registry.
#[derive(Clone, Debug, PartialEq)]
pub struct RegisteredKey {
    pub id: String,
    pub public_key: Vec<u8>,
    pub revoked: bool,
}

/// The prepared gate state for one run: the evaluator's gate book plus
/// the registry keys the host verifies against.
pub struct PreparedGates {
    pub book: GateBook,
    pub keys: Vec<RegisteredKey>,
}

/// Why gate preparation stopped before the run started.
pub enum GatePrepError {
    /// A gate refusal that must surface exactly like a runtime refusal
    /// (currently: a signatures artifact naming a removed gate).
    Refused(String),
    /// A load/usage failure (malformed artifact, missing explicit
    /// file) that is not a gate verdict.
    Failed(String),
}

pub fn sha256_hex(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    let mut hex = String::with_capacity(64);
    for byte in digest {
        hex.push_str(&format!("{byte:02x}"));
    }
    hex
}

pub fn now_unix_seconds() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs() as i64)
        .unwrap_or(0)
}

/// The default key-registry path for a workflow: `solve-keys.json`
/// beside it.
pub fn default_registry_path(workflow_path: &Path) -> PathBuf {
    workflow_dir(workflow_path).join("solve-keys.json")
}

/// The default signatures path for a workflow:
/// `<workflow-file>.signatures.json` beside it.
pub fn default_signatures_path(workflow_path: &Path) -> PathBuf {
    let mut name = workflow_path
        .file_name()
        .map(|name| name.to_os_string())
        .unwrap_or_default();
    name.push(".signatures.json");
    workflow_dir(workflow_path).join(name)
}

fn workflow_dir(workflow_path: &Path) -> &Path {
    workflow_path.parent().unwrap_or_else(|| Path::new("."))
}

// ------------------------------------------------------------ base64

const BASE64_ALPHABET: &[u8; 64] =
    b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

pub fn base64_encode(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let b = [
            chunk[0] as u32,
            *chunk.get(1).unwrap_or(&0) as u32,
            *chunk.get(2).unwrap_or(&0) as u32,
        ];
        let n = (b[0] << 16) | (b[1] << 8) | b[2];
        out.push(BASE64_ALPHABET[(n >> 18) as usize & 63] as char);
        out.push(BASE64_ALPHABET[(n >> 12) as usize & 63] as char);
        out.push(if chunk.len() > 1 {
            BASE64_ALPHABET[(n >> 6) as usize & 63] as char
        } else {
            '='
        });
        out.push(if chunk.len() > 2 {
            BASE64_ALPHABET[n as usize & 63] as char
        } else {
            '='
        });
    }
    out
}

pub fn base64_decode(text: &str) -> Result<Vec<u8>, String> {
    let bytes = text.as_bytes();
    if bytes.is_empty() || !bytes.len().is_multiple_of(4) {
        return Err("invalid base64 length".to_string());
    }
    let mut values = Vec::with_capacity(bytes.len());
    for (index, &byte) in bytes.iter().enumerate() {
        match byte {
            b'A'..=b'Z' => values.push(byte - b'A'),
            b'a'..=b'z' => values.push(byte - b'a' + 26),
            b'0'..=b'9' => values.push(byte - b'0' + 52),
            b'+' => values.push(62),
            b'/' => values.push(63),
            b'=' => {
                if index < bytes.len() - 2 {
                    return Err("base64 padding appears before the end".to_string());
                }
                values.push(0);
            }
            _ => return Err(format!("invalid base64 character '{}'", byte as char)),
        }
    }
    let padding = text.matches('=').count();
    if padding > 2 {
        return Err("invalid base64 padding".to_string());
    }
    let mut out = Vec::with_capacity(bytes.len() / 4 * 3);
    for chunk in values.chunks(4) {
        let n = ((chunk[0] as u32) << 18)
            | ((chunk[1] as u32) << 12)
            | ((chunk[2] as u32) << 6)
            | chunk[3] as u32;
        out.push((n >> 16) as u8);
        out.push((n >> 8) as u8);
        out.push(n as u8);
    }
    out.truncate(out.len() - padding);
    Ok(out)
}

// ------------------------------------------------------- artifact IO

fn read_json_artifact(path: &Path, expected_format: &str) -> Result<serde_json::Value, String> {
    let text = fs::read_to_string(path)
        .map_err(|error| format!("failed to read '{}': {error}", path.display()))?;
    let value: serde_json::Value = serde_json::from_str(&text)
        .map_err(|error| format!("'{}' is not valid JSON: {error}", path.display()))?;
    let format = value.get("format").and_then(|field| field.as_str());
    if format != Some(expected_format) {
        return Err(format!(
            "'{}' is not a {expected_format} artifact",
            path.display()
        ));
    }
    let version = value.get("version").and_then(|field| field.as_u64());
    if version != Some(GATE_FORMAT_VERSION as u64) {
        return Err(format!(
            "'{}' has unsupported format version {:?} (expected {})",
            path.display(),
            value.get("version"),
            GATE_FORMAT_VERSION
        ));
    }
    Ok(value)
}

fn required_string<'a>(
    object: &'a serde_json::Value,
    field: &str,
    context: &str,
) -> Result<&'a str, String> {
    object
        .get(field)
        .and_then(|value| value.as_str())
        .ok_or_else(|| format!("{context}: missing or non-string field '{field}'"))
}

fn is_sha256_hex(text: &str) -> bool {
    text.len() == 64
        && text
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

/// Load and validate the public-key registry.
pub fn load_registry(path: &Path) -> Result<Vec<RegisteredKey>, String> {
    let value = read_json_artifact(path, GATE_KEY_REGISTRY_FORMAT)?;
    let entries = value
        .get("keys")
        .and_then(|field| field.as_array())
        .ok_or_else(|| format!("'{}': missing 'keys' array", path.display()))?;
    let mut keys = Vec::new();
    for entry in entries {
        let context = format!("'{}': registry entry", path.display());
        let id = required_string(entry, "id", &context)?.to_string();
        let algorithm = required_string(entry, "algorithm", &context)?;
        if algorithm != GATE_ALGORITHM_ED25519 {
            return Err(format!(
                "{context}: key '{id}' uses unsupported algorithm '{algorithm}'"
            ));
        }
        let public_key_b64 = required_string(entry, "public_key", &context)?;
        let public_key = base64_decode(public_key_b64)
            .map_err(|error| format!("{context}: key '{id}' public_key: {error}"))?;
        if public_key.len() != 32 {
            return Err(format!(
                "{context}: key '{id}' public_key must decode to 32 bytes"
            ));
        }
        let status = required_string(entry, "status", &context)?;
        let revoked = match status {
            "active" => false,
            "revoked" => true,
            other => {
                return Err(format!(
                    "{context}: key '{id}' has unknown status '{other}'"
                ));
            }
        };
        keys.push(RegisteredKey {
            id,
            public_key,
            revoked,
        });
    }
    Ok(keys)
}

/// Load and validate a signatures artifact.
pub fn load_signatures(path: &Path) -> Result<Vec<GateSignatureRecord>, String> {
    let value = read_json_artifact(path, GATE_SIGNATURES_FORMAT)?;
    let entries = value
        .get("signatures")
        .and_then(|field| field.as_array())
        .ok_or_else(|| format!("'{}': missing 'signatures' array", path.display()))?;
    let mut records = Vec::new();
    for entry in entries {
        let context = format!("'{}': signature record", path.display());
        let gate = required_string(entry, "gate", &context)?.to_string();
        let workflow_sha256 = required_string(entry, "workflow_sha256", &context)?;
        let evidence_sha256 = required_string(entry, "evidence_sha256", &context)?;
        if !is_sha256_hex(workflow_sha256) || !is_sha256_hex(evidence_sha256) {
            return Err(format!(
                "{context}: gate '{gate}' digests must be lowercase sha256 hex"
            ));
        }
        let signer = required_string(entry, "signer", &context)?.to_string();
        let (not_before, not_after) = {
            let window = |field: &str| -> Result<Option<i64>, String> {
                match entry.get(field) {
                    Some(serde_json::Value::Null) | None => Ok(None),
                    Some(value) => value.as_i64().map(Some).ok_or_else(|| {
                        format!(
                            "{context}: gate '{gate}' field '{field}' must be a unix timestamp or null"
                        )
                    }),
                }
            };
            (window("not_before")?, window("not_after")?)
        };
        let signature = required_string(entry, "signature", &context)?;
        let signature_bytes = base64_decode(signature)
            .map_err(|error| format!("{context}: gate '{gate}' signature: {error}"))?;
        if signature_bytes.len() != 64 {
            return Err(format!(
                "{context}: gate '{gate}' signature must decode to 64 bytes"
            ));
        }
        records.push(GateSignatureRecord {
            gate,
            workflow_sha256: workflow_sha256.to_string(),
            evidence_sha256: evidence_sha256.to_string(),
            signer,
            not_before,
            not_after,
            signature: signature.to_string(),
        });
    }
    Ok(records)
}

/// Write a signatures artifact, replacing any record for the same
/// (gate, signer) pair.
pub fn write_signatures(path: &Path, records: &[GateSignatureRecord]) -> Result<(), String> {
    let entries: Vec<serde_json::Value> = records
        .iter()
        .map(|record| {
            serde_json::json!({
                "gate": record.gate,
                "workflow_sha256": record.workflow_sha256,
                "evidence_sha256": record.evidence_sha256,
                "signer": record.signer,
                "not_before": record.not_before,
                "not_after": record.not_after,
                "signature": record.signature,
            })
        })
        .collect();
    let artifact = serde_json::json!({
        "format": GATE_SIGNATURES_FORMAT,
        "version": GATE_FORMAT_VERSION,
        "signatures": entries,
    });
    let mut text = serde_json::to_string_pretty(&artifact)
        .map_err(|error| format!("failed to serialize signatures: {error}"))?;
    text.push('\n');
    fs::write(path, text).map_err(|error| format!("failed to write '{}': {error}", path.display()))
}

// ------------------------------------------------------- key handling

/// Load a private-key artifact. Returns the key id and signing key.
/// The private key material never leaves this function except inside
/// the returned signing key.
pub fn load_private_key(path: &Path) -> Result<(String, SigningKey), String> {
    let value = read_json_artifact(path, GATE_PRIVATE_KEY_FORMAT)?;
    let context = format!("'{}': private key", path.display());
    let id = required_string(&value, "id", &context)?.to_string();
    let algorithm = required_string(&value, "algorithm", &context)?;
    if algorithm != GATE_ALGORITHM_ED25519 {
        return Err(format!("{context}: unsupported algorithm '{algorithm}'"));
    }
    let seed_b64 = required_string(&value, "private_key", &context)?;
    let seed =
        base64_decode(seed_b64).map_err(|error| format!("{context}: private_key: {error}"))?;
    let seed: [u8; 32] = seed
        .try_into()
        .map_err(|_| format!("{context}: private_key must decode to a 32-byte seed"))?;
    Ok((id, SigningKey::from_bytes(&seed)))
}

/// A freshly generated keypair, rendered as artifacts.
pub struct GeneratedKey {
    pub id: String,
    pub public_key_b64: String,
    pub private_key_json: String,
    pub registry_entry_json: String,
}

pub fn generate_key(id: &str) -> Result<GeneratedKey, String> {
    let mut seed = [0u8; 32];
    getrandom::fill(&mut seed)
        .map_err(|error| format!("could not gather randomness for the new key: {error}"))?;
    let signing_key = SigningKey::from_bytes(&seed);
    let public_key_b64 = base64_encode(&signing_key.verifying_key().to_bytes());
    let private_artifact = serde_json::json!({
        "format": GATE_PRIVATE_KEY_FORMAT,
        "version": GATE_FORMAT_VERSION,
        "id": id,
        "algorithm": GATE_ALGORITHM_ED25519,
        "private_key": base64_encode(&seed),
    });
    let registry_entry = serde_json::json!({
        "id": id,
        "algorithm": GATE_ALGORITHM_ED25519,
        "public_key": public_key_b64,
        "status": "active",
    });
    Ok(GeneratedKey {
        id: id.to_string(),
        public_key_b64,
        private_key_json: serde_json::to_string_pretty(&private_artifact)
            .expect("private key artifact serialization cannot fail")
            + "\n",
        registry_entry_json: serde_json::to_string_pretty(&registry_entry)
            .expect("registry entry serialization cannot fail"),
    })
}

/// Write a private-key file with owner-only permissions on Unix.
pub fn write_private_key_file(path: &Path, contents: &str) -> Result<(), String> {
    fs::write(path, contents)
        .map_err(|error| format!("failed to write '{}': {error}", path.display()))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o600)).map_err(|error| {
            format!(
                "failed to restrict permissions on '{}': {error}",
                path.display()
            )
        })?;
    }
    Ok(())
}

// --------------------------------------------------------- verification

/// The native host's gate verification: registry membership, then the
/// Ed25519 signature over the canonical payload the evaluator built.
pub fn verify_gate_signature(keys: &[RegisteredKey], check: &GateCheck) -> Result<(), GateRefusal> {
    let Some(key) = keys.iter().find(|key| key.id == check.signer) else {
        return Err(GateRefusal::new(
            gate_codes::UNKNOWN_SIGNER,
            format!(
                "gate '{}' signer '{}' is not in the key registry",
                check.gate, check.signer
            ),
        ));
    };
    if key.revoked {
        return Err(GateRefusal::new(
            gate_codes::SIGNER_REVOKED,
            format!(
                "gate '{}' signer '{}' has been revoked in the key registry",
                check.gate, check.signer
            ),
        ));
    }
    let signature_bytes = base64_decode(&check.signature).map_err(|error| {
        GateRefusal::new(
            gate_codes::SIGNATURE_INVALID,
            format!(
                "gate '{}' signature is not valid base64: {error}",
                check.gate
            ),
        )
    })?;
    let signature_bytes: [u8; 64] = signature_bytes.try_into().map_err(|_| {
        GateRefusal::new(
            gate_codes::SIGNATURE_INVALID,
            format!("gate '{}' signature must decode to 64 bytes", check.gate),
        )
    })?;
    let public_key: [u8; 32] = key
        .public_key
        .as_slice()
        .try_into()
        .expect("registry loading validated a 32-byte public key");
    let verifying_key = VerifyingKey::from_bytes(&public_key).map_err(|error| {
        GateRefusal::new(
            gate_codes::SIGNATURE_INVALID,
            format!(
                "gate '{}' signer key is not a valid Ed25519 key: {error}",
                check.gate
            ),
        )
    })?;
    verifying_key
        .verify(&check.payload, &Signature::from_bytes(&signature_bytes))
        .map_err(|_| {
            GateRefusal::new(
                gate_codes::SIGNATURE_INVALID,
                format!(
                    "gate '{}' signature does not verify against signer '{}'",
                    check.gate, check.signer
                ),
            )
        })
}

// ------------------------------------------------------------- evidence

/// Resolve an evidence path inside the workflow directory. Returns
/// the canonical path only when the target exists and stays inside
/// the directory — evidence outside the workflow's own tree is never
/// read for a gate.
fn confined_evidence_path(workflow_path: &Path, evidence: &str) -> Option<PathBuf> {
    let dir = workflow_dir(workflow_path);
    let canonical_dir = dir.canonicalize().ok()?;
    let canonical = dir.join(evidence).canonicalize().ok()?;
    if canonical.starts_with(&canonical_dir) && canonical.is_file() {
        Some(canonical)
    } else {
        None
    }
}

fn read_evidence(workflow_path: &Path, evidence: &str) -> Option<Vec<u8>> {
    let path = confined_evidence_path(workflow_path, evidence)?;
    fs::read(path).ok()
}

// ------------------------------------------------------------ run prep

/// Build the gate book for a run. Returns `Ok(None)` when the
/// workflow declares no gates (the run is then exactly as before).
pub fn prepare_gate_book(
    declarations: &[GateDeclaration],
    source_content: &str,
    workflow_path: &Path,
    keys_path: Option<&Path>,
    signatures_path: Option<&Path>,
    now_unix_seconds: i64,
) -> Result<Option<PreparedGates>, GatePrepError> {
    if declarations.is_empty() {
        return Ok(None);
    }

    let registry_path = keys_path
        .map(Path::to_path_buf)
        .unwrap_or_else(|| default_registry_path(workflow_path));
    let keys = if registry_path.is_file() {
        load_registry(&registry_path).map_err(GatePrepError::Failed)?
    } else if keys_path.is_some() {
        return Err(GatePrepError::Failed(format!(
            "key registry '{}' does not exist",
            registry_path.display()
        )));
    } else {
        Vec::new()
    };

    let signatures_file = signatures_path
        .map(Path::to_path_buf)
        .unwrap_or_else(|| default_signatures_path(workflow_path));
    let signatures = if signatures_file.is_file() {
        load_signatures(&signatures_file).map_err(GatePrepError::Failed)?
    } else if signatures_path.is_some() {
        return Err(GatePrepError::Failed(format!(
            "signatures file '{}' does not exist",
            signatures_file.display()
        )));
    } else {
        Vec::new()
    };

    // A signatures artifact that names a gate the workflow no longer
    // declares means the gate was removed after signing. The run
    // refuses before anything executes: the artifact travels with the
    // workflow, so deleting a gate declaration cannot silently drop
    // the requirement.
    for record in &signatures {
        if !declarations.iter().any(|gate| gate.name == record.gate) {
            return Err(GatePrepError::Refused(format!(
                "signatures exist for gate '{}', which the workflow no longer declares; the gate was removed after signing. Restore the gate declaration or re-issue the signatures artifact without it",
                record.gate
            )));
        }
    }

    let mut evidence_sha256 = BTreeMap::new();
    for declaration in declarations {
        if let Some(bytes) = read_evidence(workflow_path, &declaration.evidence) {
            evidence_sha256.insert(declaration.name.clone(), sha256_hex(&bytes));
        }
    }

    Ok(Some(PreparedGates {
        book: GateBook {
            workflow_sha256: sha256_hex(source_content.as_bytes()),
            signatures,
            evidence_sha256,
            now_unix_seconds: Some(now_unix_seconds),
        },
        keys,
    }))
}

// --------------------------------------------------------------- signing

/// Sign one gate and upsert the record into the signatures artifact.
#[allow(clippy::too_many_arguments)]
pub fn sign_gate(
    declarations: &[GateDeclaration],
    source_content: &str,
    workflow_path: &Path,
    gate_name: &str,
    key_path: &Path,
    registry_path: &Path,
    signatures_path: &Path,
    not_before: Option<i64>,
    not_after: Option<i64>,
) -> Result<GateSignatureRecord, String> {
    let Some(declaration) = declarations.iter().find(|gate| gate.name == gate_name) else {
        let declared: Vec<&str> = declarations.iter().map(|gate| gate.name.as_str()).collect();
        return Err(format!(
            "workflow declares no gate named '{gate_name}' (declared gates: {})",
            if declared.is_empty() {
                "none".to_string()
            } else {
                declared.join(", ")
            }
        ));
    };

    let (key_id, signing_key) = load_private_key(key_path)?;
    let registry = load_registry(registry_path).map_err(|error| {
        format!(
            "{error} (the signing key must be registered before it can sign; registry: {})",
            registry_path.display()
        )
    })?;
    let Some(registered) = registry.iter().find(|key| key.id == key_id) else {
        return Err(format!(
            "key '{key_id}' is not registered in '{}'; add its public key to the registry first",
            registry_path.display()
        ));
    };
    if registered.revoked {
        return Err(format!(
            "key '{key_id}' is revoked in '{}' and cannot sign",
            registry_path.display()
        ));
    }
    if registered.public_key != signing_key.verifying_key().to_bytes().as_slice() {
        return Err(format!(
            "key '{key_id}' in '{}' does not match the private key in '{}'",
            registry_path.display(),
            key_path.display()
        ));
    }
    if !declaration.signers.is_empty() && !declaration.signers.contains(&key_id) {
        return Err(format!(
            "gate '{gate_name}' declares signers [{}]; key '{key_id}' is not one of them",
            declaration.signers.join(", ")
        ));
    }

    let evidence_bytes = read_evidence(workflow_path, &declaration.evidence).ok_or_else(|| {
        format!(
            "evidence '{}' for gate '{gate_name}' could not be read inside the workflow directory",
            declaration.evidence
        )
    })?;

    let mut record = GateSignatureRecord {
        gate: gate_name.to_string(),
        workflow_sha256: sha256_hex(source_content.as_bytes()),
        evidence_sha256: sha256_hex(&evidence_bytes),
        signer: key_id,
        not_before,
        not_after,
        signature: String::new(),
    };
    let payload = gate_canonical_payload(&record);
    record.signature = base64_encode(&signing_key.sign(&payload).to_bytes());

    let mut records = if signatures_path.is_file() {
        load_signatures(signatures_path)?
    } else {
        Vec::new()
    };
    records.retain(|existing| !(existing.gate == record.gate && existing.signer == record.signer));
    records.push(record.clone());
    write_signatures(signatures_path, &records)?;
    Ok(record)
}
