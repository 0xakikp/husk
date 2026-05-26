// ── MCP Marketplace Registry ───────────────────────────────────────────────
// Curated catalog of MCP servers. One-click install adds them to the user's
// local MCP server list via the existing store.
//
// To add a new server:
//   1. Append an entry to MARKETPLACE below
//   2. Pick a unique id, fill command/args/env
//   3. Run type-check
//
// ---------------------------------------------------------------------------

export type McpMarketplaceItem = {
  id: string;
  name: string;
  description: string;
  longDescription?: string;
  icon: string; // Hugeicons icon component name (e.g. "Folder01Icon")
  category:
    | "Development"
    | "Cloud"
    | "Database"
    | "AI & ML"
    | "Communication"
    | "Search"
    | "Monitoring"
    | "Payments"
    | "Automation"
    | "Utilities";
  tags: string[];
  publisher: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  cwd?: string;
  homepage?: string;
  verified: boolean;
};

export const MARKETPLACE: McpMarketplaceItem[] = [
  // ── Development ──────────────────────────────────────────────────────────
  {
    id: "filesystem",
    name: "Filesystem",
    description: "Read and write files on the local filesystem",
    longDescription:
      "Gives the AI access to read, write, list, and search files on your local machine. Requires a path argument.",
    icon: "Folder01Icon",
    category: "Development",
    tags: ["files", "fs", "local"],
    publisher: "Anthropic",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-filesystem", "{{path}}"],
    env: {},
    homepage:
      "https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem",
    verified: true,
  },
  {
    id: "github",
    name: "GitHub",
    description: "Search repos, read issues, create PRs, manage code",
    longDescription:
      "Full GitHub API access — search repositories, read issues & PRs, create pull requests, manage branches, and review code.",
    icon: "GithubIcon",
    category: "Development",
    tags: ["github", "git", "code", "api"],
    publisher: "Anthropic",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-github"],
    env: { GITHUB_PERSONAL_ACCESS_TOKEN: "" },
    homepage:
      "https://github.com/modelcontextprotocol/servers/tree/main/src/github",
    verified: true,
  },
  {
    id: "git",
    name: "Git",
    description: "Read git history, diffs, and branch info",
    longDescription:
      "Local git operations — read commit history, view diffs, list branches, and understand repository state without shell access.",
    icon: "GitCommitIcon",
    category: "Development",
    tags: ["git", "version-control", "history"],
    publisher: "ModelContextProtocol",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-git"],
    env: {},
    homepage:
      "https://github.com/modelcontextprotocol/servers/tree/main/src/git",
    verified: true,
  },
  {
    id: "puppeteer",
    name: "Puppeteer",
    description: "Browser automation — scrape, screenshot, interact",
    longDescription:
      "Headless Chrome automation for web scraping, screenshots, form filling, and page interaction via Puppeteer.",
    icon: "BrowserIcon",
    category: "Development",
    tags: ["browser", "scraping", "automation", "chrome"],
    publisher: "Anthropic",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-puppeteer"],
    env: {},
    homepage:
      "https://github.com/modelcontextprotocol/servers/tree/main/src/puppeteer",
    verified: true,
  },
  {
    id: "fetch",
    name: "Fetch",
    description: "Fetch web pages and APIs via HTTP",
    longDescription:
      "Simple HTTP client for fetching web pages, REST APIs, and raw content. Supports GET/POST with headers.",
    icon: "GlobeIcon",
    category: "Development",
    tags: ["http", "api", "web", "rest"],
    publisher: "Anthropic",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-fetch"],
    env: {},
    homepage:
      "https://github.com/modelcontextprotocol/servers/tree/main/src/fetch",
    verified: true,
  },
  {
    id: "sequential-thinking",
    name: "Sequential Thinking",
    description: "Structured reasoning and problem-solving toolkit",
    longDescription:
      "Helps the AI break down complex problems into steps, maintain reasoning chains, and explore multiple solution paths.",
    icon: "BrainIcon",
    category: "Development",
    tags: ["reasoning", "thinking", "problem-solving"],
    publisher: "Anthropic",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-sequential-thinking"],
    env: {},
    homepage:
      "https://github.com/modelcontextprotocol/servers/tree/main/src/sequentialthinking",
    verified: true,
  },

  // ── Cloud ────────────────────────────────────────────────────────────────
  {
    id: "aws",
    name: "AWS",
    description: "Interact with AWS services (S3, EC2, Lambda, etc.)",
    longDescription:
      "Manage AWS resources — list S3 buckets, start/stop EC2 instances, invoke Lambda functions, and more.",
    icon: "CloudServerIcon",
    category: "Cloud",
    tags: ["aws", "amazon", "cloud", "infrastructure"],
    publisher: "Community",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-aws"],
    env: {
      AWS_ACCESS_KEY_ID: "",
      AWS_SECRET_ACCESS_KEY: "",
      AWS_REGION: "us-east-1",
    },
    homepage: "https://github.com/modelcontextprotocol/servers",
    verified: false,
  },
  {
    id: "google-drive",
    name: "Google Drive",
    description: "Search, read, and manage Google Drive files",
    longDescription:
      "Access Google Drive — search files, read document contents, list folders, and manage permissions.",
    icon: "GlobeIcon",
    category: "Cloud",
    tags: ["google", "drive", "storage", "docs"],
    publisher: "Community",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-gdrive"],
    env: {},
    homepage: "https://github.com/modelcontextprotocol/servers",
    verified: false,
  },
  {
    id: "google-maps",
    name: "Google Maps",
    description: "Geocoding, directions, places, and map data",
    longDescription:
      "Google Maps API integration — geocode addresses, get directions, search places, and retrieve location data.",
    icon: "Location01Icon",
    category: "Cloud",
    tags: ["google", "maps", "geocoding", "location"],
    publisher: "Anthropic",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-google-maps"],
    env: { GOOGLE_MAPS_API_KEY: "" },
    homepage:
      "https://github.com/modelcontextprotocol/servers/tree/main/src/google-maps",
    verified: true,
  },

  // ── Database ─────────────────────────────────────────────────────────────
  {
    id: "postgres",
    name: "PostgreSQL",
    description: "Query and manage PostgreSQL databases",
    longDescription:
      "Read and write to PostgreSQL databases. Supports schema introspection, query execution, and table management.",
    icon: "Database01Icon",
    category: "Database",
    tags: ["postgres", "sql", "database", "db"],
    publisher: "Anthropic",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-postgres", "{{connectionString}}"],
    env: {},
    homepage:
      "https://github.com/modelcontextprotocol/servers/tree/main/src/postgres",
    verified: true,
  },
  {
    id: "sqlite",
    name: "SQLite",
    description: "Query local SQLite databases",
    longDescription:
      "Read and write to local SQLite database files. Great for local development and small datasets.",
    icon: "Database02Icon",
    category: "Database",
    tags: ["sqlite", "sql", "database", "local"],
    publisher: "Anthropic",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-sqlite", "{{dbPath}}"],
    env: {},
    homepage:
      "https://github.com/modelcontextprotocol/servers/tree/main/src/sqlite",
    verified: true,
  },

  // ── AI & ML ──────────────────────────────────────────────────────────────
  {
    id: "memory",
    name: "Memory",
    description: "Persistent knowledge graph for the AI",
    longDescription:
      "A persistent memory server that lets the AI store and recall facts, relationships, and context across conversations.",
    icon: "BrainIcon",
    category: "AI & ML",
    tags: ["memory", "knowledge", "persistence", "graph"],
    publisher: "Anthropic",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-memory"],
    env: {},
    homepage:
      "https://github.com/modelcontextprotocol/servers/tree/main/src/memory",
    verified: true,
  },
  {
    id: "openai",
    name: "OpenAI",
    description: "Access OpenAI models and embeddings via MCP",
    longDescription:
      "Use OpenAI's GPT models and embeddings directly through MCP tools for text generation and vector search.",
    icon: "ArtificialIntelligence04Icon",
    category: "AI & ML",
    tags: ["openai", "gpt", "embeddings", "llm"],
    publisher: "Community",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-openai"],
    env: { OPENAI_API_KEY: "" },
    homepage: "https://github.com/modelcontextprotocol/servers",
    verified: false,
  },

  // ── Communication ────────────────────────────────────────────────────────
  {
    id: "slack",
    name: "Slack",
    description: "Send messages and search Slack workspaces",
    longDescription:
      "Send messages to channels, search messages, and read conversations in your Slack workspace.",
    icon: "SlackIcon",
    category: "Communication",
    tags: ["slack", "chat", "messaging", "team"],
    publisher: "Anthropic",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-slack"],
    env: { SLACK_BOT_TOKEN: "", SLACK_TEAM_ID: "" },
    homepage:
      "https://github.com/modelcontextprotocol/servers/tree/main/src/slack",
    verified: true,
  },
  {
    id: "n8n",
    name: "n8n",
    description: "Trigger n8n workflows and automations",
    longDescription:
      "Connect to your n8n instance to trigger workflows, list executions, and manage automation nodes.",
    icon: "Flowchart01Icon",
    category: "Communication",
    tags: ["n8n", "automation", "workflow", "integration"],
    publisher: "Community",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-n8n"],
    env: { N8N_API_KEY: "", N8N_HOST: "http://localhost:5678" },
    homepage: "https://n8n.io",
    verified: false,
  },

  // ── Search ───────────────────────────────────────────────────────────────
  {
    id: "brave-search",
    name: "Brave Search",
    description: "Web search via Brave Search API",
    longDescription:
      "Search the web using Brave's privacy-focused search engine. Returns ranked results with snippets.",
    icon: "Search01Icon",
    category: "Search",
    tags: ["search", "web", "brave", "api"],
    publisher: "Anthropic",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-brave-search"],
    env: { BRAVE_API_KEY: "" },
    homepage:
      "https://github.com/modelcontextprotocol/servers/tree/main/src/brave-search",
    verified: true,
  },

  // ── Monitoring ───────────────────────────────────────────────────────────
  {
    id: "groundcover",
    name: "Groundcover",
    description: "Kubernetes observability and monitoring",
    longDescription:
      "Query Kubernetes clusters, view logs, metrics, and traces via Groundcover's eBPF-based observability platform.",
    icon: "ChartHistogramIcon",
    category: "Monitoring",
    tags: ["kubernetes", "k8s", "monitoring", "observability", "logs"],
    publisher: "Groundcover",
    command: "npx",
    args: ["-y", "@groundcover/mcp-server"],
    env: { GROUNDCOVER_API_KEY: "" },
    homepage: "https://groundcover.com",
    verified: false,
  },

  // ── Payments ─────────────────────────────────────────────────────────────
  {
    id: "stripe",
    name: "Stripe",
    description: "Manage Stripe payments, customers, and invoices",
    longDescription:
      "Access Stripe API to create charges, manage customers, handle subscriptions, and generate invoices.",
    icon: "CreditCardPosIcon",
    category: "Payments",
    tags: ["stripe", "payments", "billing", "fintech"],
    publisher: "Stripe",
    command: "npx",
    args: ["-y", "@stripe/mcp-server"],
    env: { STRIPE_SECRET_KEY: "" },
    homepage: "https://stripe.com",
    verified: true,
  },

  // ── Automation ───────────────────────────────────────────────────────────
  {
    id: "google-stitch",
    name: "Google Stitch",
    description: "Data pipeline automation with Google Stitch",
    longDescription:
      "Manage ETL pipelines, sync data sources, and orchestrate data workflows via Google Stitch.",
    icon: "FlowConnectionIcon",
    category: "Automation",
    tags: ["google", "stitch", "etl", "pipeline", "data"],
    publisher: "Google",
    command: "npx",
    args: ["-y", "@google/stitch-mcp-server"],
    env: { STITCH_API_KEY: "" },
    homepage: "https://cloud.google.com/stitch",
    verified: false,
  },

  // ── Utilities ────────────────────────────────────────────────────────────
  {
    id: "time",
    name: "Time",
    description: "Get current time, timezone conversions, scheduling",
    longDescription:
      "Time utilities — get current time in any timezone, convert between timezones, and work with dates.",
    icon: "Clock01Icon",
    category: "Utilities",
    tags: ["time", "timezone", "date", "utility"],
    publisher: "ModelContextProtocol",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-time"],
    env: {},
    homepage:
      "https://github.com/modelcontextprotocol/servers/tree/main/src/time",
    verified: true,
  },
];

// ── Search / Filter helpers ────────────────────────────────────────────────

const ALL_CATEGORIES = Array.from(
  new Set(MARKETPLACE.map((m) => m.category)),
) as McpMarketplaceItem["category"][];

export function getMarketplaceCategories(): McpMarketplaceItem["category"][] {
  return ALL_CATEGORIES;
}

export function searchMarketplace(
  query: string,
  category?: McpMarketplaceItem["category"],
): McpMarketplaceItem[] {
  const q = query.trim().toLowerCase();
  return MARKETPLACE.filter((item) => {
    if (category && item.category !== category) return false;
    if (!q) return true;
    const haystack = [item.name, item.description, item.publisher, ...item.tags]
      .join(" ")
      .toLowerCase();
    return haystack.includes(q);
  });
}

export function getMarketplaceItemById(id: string): McpMarketplaceItem | undefined {
  return MARKETPLACE.find((m) => m.id === id);
}

// ── Install helper ─────────────────────────────────────────────────────────
// Returns the env vars that need user input (empty string values = required)
export function getRequiredEnvVars(
  item: McpMarketplaceItem,
): Array<{ key: string; value: string }> {
  return Object.entries(item.env).map(([key, value]) => ({ key, value }));
}

// Check if an item has any required env vars that need filling
export function hasRequiredEnvVars(item: McpMarketplaceItem): boolean {
  return Object.keys(item.env).length > 0;
}
