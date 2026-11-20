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
    ],
  },
];

export function guideBySlug(slug: string): GuideEntry {
  const entry = guides.find((candidate) => candidate.slug === slug);
  if (!entry) throw new Error(`Unknown guide slug: ${slug}`);
  return entry;
}
