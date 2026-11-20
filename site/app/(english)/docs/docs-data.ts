// Developer documentation hub: one entry per guide.
// Every guide is titled as the problem a developer would type, carries
// copy-paste commands copied from the repository's own documentation,
// and states its honest limits on the page. Facts on these pages are
// pinned by the public-site QA tests against the repository's sources.

export interface GuideCode {
  intro?: string;
  code: readonly string[];
  outro?: string;
}

export interface GuideSection {
  heading: string;
  body: readonly string[];
  steps?: readonly string[];
  code?: readonly GuideCode[];
}

export interface GuideLink {
  href: string;
  label: string;
}

export interface GuideEntry {
  slug: string;
  question: string;
  title: string;
  summary: string;
  intro: readonly string[];
  sections: readonly GuideSection[];
  limits: readonly string[];
  links: readonly GuideLink[];
}

export const guides: readonly GuideEntry[] = [
  {
    slug: "mcp-server-local-setup",
    question: "I want my coding agent to understand my repository",
    title: "How do I install SolveLang and set up the MCP server locally?",
    summary:
      "Install the SolveLang CLI, run the published MCP server with npx, and point Claude Code or Codex at your workspace — read-only, local-first, and bounded to the project you name.",
    intro: [
      "The SolveLang MCP server gives a coding agent — Claude Code, Codex, or another MCP client — read-only analysis of your workflows, your repository graph, and Solve Context packs, running entirely on your own machine over stdio.",
      "This guide takes the shortest path: the published npm package. The MCP setup page carries the full plugin and manual-configuration reference; this page gets you running and then links you there.",
    ],
    sections: [
      {
        heading: "What you get",
        body: [
          "The published server, `@solvelang/mcp-server@0.3.0`, exposes 29 read-only tools: workflow and n8n analysis, Solve Graph queries over a repository graph, and the Solve Context tools for planning and building context packs.",
          "Every tool is read-only and bounded to the workspace you name: no file writes, no network requests, and no execution of your repository's code.",
        ],
      },
      {
        heading: "Before you start",
        body: [],
        steps: [
          "Install Node.js 20 or newer — the MCP server runs on Node.",
          "Have the project you want analysed on this machine, and know its absolute path.",
          "Optional: install the SolveLang CLI (`solvec`) if you want `.solve` validation — that one tool runs your local `solvec`.",
        ],
        code: [
          {
            intro: "The CLI lives in the repository's `solvec` folder and builds with Cargo (Git and Rust/Cargo are the only requirements):",
            code: [
              "git clone https://github.com/saiidz/solvelang.git",
              "cd solvelang/solvec",
              "cargo build --release",
              "./target/release/solvec run ../examples/hello.solve",
            ],
            outro: "Put `solvec` on your `PATH`, or tell the server where it is with `SOLVELANG_SOLVEC` (shown in the Codex configuration below).",
          },
        ],
      },
      {
        heading: "Run the published server",
        body: [
          "One environment variable names the workspace the server may read. Everything it serves is bounded to that root:",
        ],
        code: [
          {
            code: [
              "SOLVELANG_WORKSPACE_ROOT=/absolute/path/to/project \\",
              "  npx --yes @solvelang/mcp-server@0.3.0",
            ],
          },
        ],
      },
      {
        heading: "Add it to your MCP client",
        body: ["Register the same command with your client, then restart the client so it picks the server up."],
        code: [
          {
            intro: "For Claude Code:",
            code: [
              "claude mcp add --transport stdio \\",
              "  --env SOLVELANG_WORKSPACE_ROOT=/absolute/path/to/workspace \\",
              "  solvelang -- npx --yes @solvelang/mcp-server@0.3.0",
            ],
          },
          {
            intro: "For Codex, the manual configuration in `~/.codex/config.toml`:",
            code: [
              "[mcp_servers.solvelang]",
              "command = \"npx\"",
              "args = [\"--yes\", \"@solvelang/mcp-server@0.3.0\"]",
              "",
              "[mcp_servers.solvelang.env]",
              "SOLVELANG_WORKSPACE_ROOT = \"/absolute/path/to/workspace\"",
              "# Optional, needed only for solvelang_validate_solve:",
              "# SOLVELANG_SOLVEC = \"/absolute/path/to/solvec\"",
            ],
          },
        ],
      },
      {
        heading: "Check it worked",
        body: [
          "Call `solvelang_capabilities`, or use your client's list-tools view, to inspect the exact tools exposed by the installed version. Do not infer the tools of the published package from the repository's current source tree — the package distributes the tagged release, and the two can differ.",
        ],
        steps: [
          "Restart your MCP client so it loads the new server.",
          "Call `solvelang_capabilities` and confirm the tool list answers.",
          "Try a read-only call: ask for a Solve Graph summary, or a context plan for a file you know.",
        ],
      },
    ],
    limits: [
      "Read-only means read-only: the analysis and context tools never write files, make network requests, execute repository code, or inspect credential values.",
      "All file discovery and reading stays inside `SOLVELANG_WORKSPACE_ROOT`, and likely sensitive paths are denied by the context runtime policy.",
      "`.solve` validation is the one tool that needs more than Node: it runs your local `solvec`, found on `PATH` or via `SOLVELANG_SOLVEC`.",
      "The published 0.3.0 package distributes the tagged release source. Later changes on the repository's main branch are not in the npm package until a separate distribution ships them.",
      "Managed-workspace marketplace installation and a public Plugin Directory listing remain unverified — the npx path above is the supported route today.",
    ],
    links: [
      { href: "/mcp-setup/", label: "MCP setup reference — the plugin path, manual configuration, and running from current source" },
      { href: "/mcp/", label: "SolveLang MCP and plugin reference" },
      { href: "/solve-context/", label: "Solve Context — context planning, packing, and handoff" },
      { href: "/docs/remote-mcp-endpoint/", label: "Connect to the remote MCP endpoint instead" },
      { href: "/docs/context-packs/", label: "How context packs work" },
    ],
  },
  {
    slug: "remote-mcp-endpoint",
    question: "I want SolveLang analysis from a cloud agent that cannot run local tools",
    title: "How do I connect to the SolveLang remote MCP endpoint?",
    summary:
      "Connect a server-side or cloud MCP client to https://mcp.solve-lang.com — bearer-authenticated, read-only, raw JSON in — with the 10 remote tools, the rate limit, and the honest differences from the local server.",
    intro: [
      "The remote endpoint is SolveLang's read-only analysis surface behind authenticated HTTPS, for clients that cannot launch the local stdio package — server-side connectors and cloud agents. It went live on November 20, 2026.",
      "It is deliberately narrower than the local server: it accepts only raw JSON supplied in the request, and it never touches a filesystem — there is no server-side workspace.",
    ],
    sections: [
      {
        heading: "Where it lives",
        body: [
          "MCP requests go to `https://mcp.solve-lang.com/mcp` (POST only, Streamable HTTP, stateless). The health endpoint answers in public, so you can confirm the service is up before configuring anything:",
        ],
        code: [
          {
            code: ["curl https://mcp.solve-lang.com/healthz"],
            outro: "It answers `{\"status\":\"ok\",\"service\":\"solvelang-mcp\",\"mode\":\"remote-read-only\"}`.",
          },
        ],
      },
      {
        heading: "The 10 remote tools",
        body: [
          "Two n8n tools: `solvelang_analyze_n8n` and `solvelang_generate_n8n_report`.",
          "Seven Solve Graph tools — `solvelang_graph_find_nodes`, `solvelang_graph_search_nodes`, `solvelang_graph_dependencies`, `solvelang_graph_dependents`, `solvelang_graph_shortest_path`, `solvelang_graph_impact`, and `solvelang_graph_explain_impact` — answering over the canonical graph JSON you supply in the request.",
          "And `solvelang_capabilities`, which reports the exact surface and the effective rate limit of the deployment you are talking to.",
        ],
      },
      {
        heading: "Connect a client",
        body: [],
        steps: [
          "Point the client at `https://mcp.solve-lang.com/mcp`.",
          "Send your bearer token on every request as the `Authorization: Bearer <token>` header. Tokens are issued by SolveLang; the production token is held on the SolveLang host only — never in Git, a plugin manifest, documentation, or chat. Write to hello@solve-lang.com for access.",
          "Make a first call to `solvelang_capabilities` to confirm the connection and see the surface you have.",
        ],
        code: [
          {
            intro: "A client configuration for the endpoint looks like this (add the Authorization header in whatever way your client supports):",
            code: [
              "{",
              "  \"mcpServers\": {",
              "    \"solvelang\": {",
              "      \"type\": \"http\",",
              "      \"url\": \"https://mcp.solve-lang.com/mcp\"",
              "    }",
              "  }",
              "}",
            ],
          },
        ],
      },
      {
        heading: "How it differs from the local server",
        body: [
          "Raw JSON only: the remote tools analyse the workflow or graph JSON in your request. The local server's workspace tools — reading your project, building context packs — do not exist here, and `.solve` validation stays local because it needs your `solvec`.",
          "Ceilings: a request may be at most 4 MiB, and n8n and graph inputs keep their existing 2 MiB analysis limits.",
          "Rate limit: 60 requests per 60 seconds per source address, enforced before authentication and before MCP parsing. Past the limit the endpoint answers `429` with a `Retry-After` header; `solvelang_capabilities` reports the limit in force.",
        ],
      },
    ],
    limits: [
      "Narrower by design: 10 tools against the local server's 29, and only the inputs you send — no server-side workspace, no filesystem access, no subprocesses, and no network calls from the tools.",
      "The built-in rate limiter keys on the source address it sees, so callers behind a shared proxy are aggregated into one budget; edge rate limiting in front of the origin remains outstanding production hardening.",
      "Raw workflow and graph input is not intentionally logged or persisted by the application, and responses carry `Cache-Control: no-store`.",
    ],
    links: [
      { href: "/docs/mcp-server-local-setup/", label: "Set up the local server instead — the full 29-tool surface with your workspace" },
      { href: "/mcp/", label: "SolveLang MCP and plugin reference" },
      {
        href: "https://github.com/saiidz/solvelang/blob/main/docs/integrations/remote-mcp.md",
        label: "The remote boundary document in the repository",
      },
    ],
  },
  {
    slug: "context-packs",
    question: "I want to hand a coding agent exactly the context it needs — nothing more",
    title: "How do SolveLang context packs work?",
    summary:
      "What a context pack is, how to build one with the local MCP server's Solve Context tools, how every excerpt stays pinned to its source, and how to hand a pack to an agent — plus what packs deliberately do not claim.",
    intro: [
      "A context pack is a bounded, exact selection of repository context for one task: the files and excerpts an agent needs, each one pinned to the source it came from, built deterministically on your own machine by Solve Context through the local MCP server.",
      "The point is control: instead of an agent wandering a repository, or a retrieval system guessing, the pack states exactly what context a task gets — and can prove where every piece came from.",
    ],
    sections: [
      {
        heading: "What a pack contains",
        body: [
          "Exact excerpts with provenance: every excerpt records its source, and graph excerpts are hash-pinned — the pack carries the source hashes, so a reader can verify an excerpt against the file it came from.",
          "A byte budget: packs are built to a bounded size, so the context a task receives is a deliberate choice, not whatever happened to fit.",
          "Determinism: the same inputs produce the same pack. Selection is a deterministic process over your workspace, not a model's guess.",
        ],
      },
      {
        heading: "Build a pack",
        body: [
          "The wider Solve Context family also includes `solvelang_context_capabilities` (what the installed version offers), `solvelang_context_handoff` and `solvelang_context_handoff_validate` (moving work between agents), and `solvelang_context_compact_structured` with `solvelang_context_expand_rle` (lossless compaction, covered below).",
        ],
        steps: [
          "Set up the local MCP server (the local setup guide) — packs are a local-server feature; the remote endpoint has no workspace and cannot build them.",
          "Call `solvelang_context_plan` to plan the context for your task.",
          "Call `solvelang_context_pack` to build the pack from that plan.",
          "Read pieces back with `solvelang_context_retrieve` — and note that retrieval rejects stale context: if the source changed after the pack was built, retrieval refuses rather than serving you yesterday's code.",
        ],
      },
      {
        heading: "Use a pack with an agent",
        body: [
          "Give the pack to the agent as the starting context for the task, together with the task itself. The agent works from pinned excerpts instead of re-discovering the repository, and impact questions can be answered from the pack's graph excerpts with the Solve Graph tools.",
          "Handing work over: handoff state is portable between Claude Code and Codex, so a task planned with one tool can be picked up by the other with the same pack and the same provenance.",
        ],
      },
      {
        heading: "Compaction without losing information",
        body: [
          "Structured context can be compacted with `solvelang_context_compact_structured` and expanded back with `solvelang_context_expand_rle`. The pair is correctness-first and lossless: expansion reproduces the original, so compaction is a transport choice, never an information loss.",
        ],
      },
    ],
    limits: [
      "Selection is deterministic and lexical over the files the workspace walk can see. There are no embeddings and no persistent index behind a pack: a pack is built when you ask, from the tree as it stands.",
      "Workspace reading is bounded by a 2 MB per-file safety cap: files over the cap are excluded from pack candidates and listed as skipped, and likely sensitive paths are denied by the context runtime policy.",
      "No token-savings claim is made for packs. The published context evaluations are synthetic or use pinned source snapshots, and public comparative claims stay disabled until the full real-agent acceptance matrix is complete.",
      "Solve Context does not launch agents, call providers, or mutate repositories. It prepares context; your agent does the work.",
    ],
    links: [
      { href: "/solve-context/", label: "Solve Context — deterministic context planning, packing, retrieval, and handoff" },
      { href: "/docs/mcp-server-local-setup/", label: "Set up the local MCP server first" },
      {
        href: "https://github.com/saiidz/solvelang#solve-context-and-mcp-usage",
        label: "Solve Context and MCP usage in the repository README",
      },
    ],
  },
];

export function guideBySlug(slug: string): GuideEntry {
  const entry = guides.find((candidate) => candidate.slug === slug);
  if (!entry) throw new Error(`Unknown guide slug: ${slug}`);
  return entry;
}
