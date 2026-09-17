# Codex managed-workspace install evidence

Use this record only for the external administrator-controlled Codex marketplace import and installation proof. Repository CI cannot complete these steps.

## Import coordinates

- GitHub repository: `https://github.com/saiidz/solvelang`
- Path: repository root / blank
- Marketplace manifest: `.agents/plugins/marketplace.json`
- Plugin name: `solvelang`
- Product: `CODEX`
- Released MCP pin: `@solvelang/mcp-server@0.3.0`

## Evidence to capture

- [ ] Eligible managed workspace identified.
- [ ] Workspace administrator imports the GitHub marketplace from the repository root.
- [ ] Import succeeds without manifest/policy errors.
- [ ] SolveLang appears as available for Codex in that workspace.
- [ ] SolveLang is installed/enabled for the test user.
- [ ] A fresh Codex session loads the SolveLang plugin.
- [ ] The SolveLang MCP server starts successfully.
- [ ] Tool discovery succeeds against the released v0.3.0 package.
- [ ] At least one deterministic/read-only SolveLang tool is exercised successfully.
- [ ] Date, workspace scope, and non-sensitive screenshots or textual evidence are recorded.

## Claim boundary

Completing this checklist proves only the tested managed-workspace import/install/use path. It does not establish global public Plugin Directory publication or discovery for arbitrary ChatGPT/Codex users.
