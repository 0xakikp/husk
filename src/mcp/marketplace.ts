export type McpCatalogItem = {
  id: string;
  name: string;
  description: string;
  category: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  homepage?: string;
};

/**
 * Curated catalog of well-known MCP servers (the common ones from husk's
 * marketplace). "Add" drops the server into the local list; items with
 * {{placeholders}} in args or empty env values need a quick edit afterward.
 */
export const MARKETPLACE: McpCatalogItem[] = [
  {
    id: "filesystem",
    name: "Filesystem",
    description: "Read, write, list, and search local files",
    category: "Development",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-filesystem", "{{path}}"],
    env: {},
    homepage: "https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem",
  },
  {
    id: "github",
    name: "GitHub",
    description: "Search repos, read issues, create PRs, manage code",
    category: "Development",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-github"],
    env: { GITHUB_PERSONAL_ACCESS_TOKEN: "" },
    homepage: "https://github.com/modelcontextprotocol/servers/tree/main/src/github",
  },
  {
    id: "git",
    name: "Git",
    description: "Inspect and operate on a local git repository",
    category: "Development",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-git"],
    env: {},
    homepage: "https://github.com/modelcontextprotocol/servers/tree/main/src/git",
  },
  {
    id: "fetch",
    name: "Fetch",
    description: "Fetch and convert web pages to markdown",
    category: "Search",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-fetch"],
    env: {},
    homepage: "https://github.com/modelcontextprotocol/servers/tree/main/src/fetch",
  },
  {
    id: "memory",
    name: "Memory",
    description: "Persistent knowledge-graph memory for the AI",
    category: "AI & ML",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-memory"],
    env: {},
    homepage: "https://github.com/modelcontextprotocol/servers/tree/main/src/memory",
  },
  {
    id: "sequential-thinking",
    name: "Sequential Thinking",
    description: "Structured step-by-step reasoning tool",
    category: "AI & ML",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-sequential-thinking"],
    env: {},
    homepage:
      "https://github.com/modelcontextprotocol/servers/tree/main/src/sequentialthinking",
  },
  {
    id: "puppeteer",
    name: "Puppeteer",
    description: "Drive a headless browser to navigate and scrape",
    category: "Automation",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-puppeteer"],
    env: {},
    homepage: "https://github.com/modelcontextprotocol/servers/tree/main/src/puppeteer",
  },
  {
    id: "postgres",
    name: "PostgreSQL",
    description: "Query a PostgreSQL database (read-only)",
    category: "Database",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-postgres", "{{connectionString}}"],
    env: {},
    homepage: "https://github.com/modelcontextprotocol/servers/tree/main/src/postgres",
  },
  {
    id: "sqlite",
    name: "SQLite",
    description: "Query a local SQLite database",
    category: "Database",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-sqlite", "{{dbPath}}"],
    env: {},
    homepage: "https://github.com/modelcontextprotocol/servers/tree/main/src/sqlite",
  },
  {
    id: "brave-search",
    name: "Brave Search",
    description: "Web search via the Brave Search API",
    category: "Search",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-brave-search"],
    env: { BRAVE_API_KEY: "" },
    homepage: "https://github.com/modelcontextprotocol/servers/tree/main/src/brave-search",
  },
  {
    id: "slack",
    name: "Slack",
    description: "Read and post messages in Slack",
    category: "Communication",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-slack"],
    env: { SLACK_BOT_TOKEN: "", SLACK_TEAM_ID: "" },
    homepage: "https://github.com/modelcontextprotocol/servers/tree/main/src/slack",
  },
  {
    id: "google-maps",
    name: "Google Maps",
    description: "Geocoding, directions, and place search",
    category: "Search",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-google-maps"],
    env: { GOOGLE_MAPS_API_KEY: "" },
    homepage: "https://github.com/modelcontextprotocol/servers/tree/main/src/google-maps",
  },
];
