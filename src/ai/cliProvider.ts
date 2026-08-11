import { claudeCliAvailable } from "./claudeCli";
import { codexCliAvailable } from "./codexCli";
import { geminiCliAvailable } from "./geminiCli";
import { kimiCliAvailable } from "./kimiCli";
import type { CliProviderId } from "./providers";

export const CLI_PROVIDER_IDS: CliProviderId[] = ["claude", "codex", "gemini", "kimi"];

export type CliAvailability = Record<CliProviderId, boolean>;

export const EMPTY_CLI_AVAILABILITY: CliAvailability = {
  claude: false,
  codex: false,
  gemini: false,
  kimi: false,
};

export function cliAvailable(cli: CliProviderId, refresh = false): Promise<boolean> {
  switch (cli) {
    case "claude": return claudeCliAvailable(refresh);
    case "codex": return codexCliAvailable(refresh);
    case "gemini": return geminiCliAvailable(refresh);
    case "kimi": return kimiCliAvailable(refresh);
  }
}

export function cliDisplayName(cli: CliProviderId): string {
  switch (cli) {
    case "claude": return "Claude Code";
    case "codex": return "Codex";
    case "gemini": return "Gemini CLI";
    case "kimi": return "Kimi Code";
  }
}

export function cliCommand(cli: CliProviderId): string {
  switch (cli) {
    case "claude": return "claude";
    case "codex": return "codex";
    case "gemini": return "gemini";
    case "kimi": return "kimi";
  }
}

export function cliLoginHelp(cli: CliProviderId): string {
  switch (cli) {
    case "claude":
      return "Install the claude CLI and run claude login to use your Claude subscription without an API key.";
    case "codex":
      return "Install the codex CLI and sign in with your ChatGPT account to use Codex without an API key.";
    case "gemini":
      return "Install Gemini CLI and sign in with your Google account to use its included CLI allowance without an API key.";
    case "kimi":
      return "Install Kimi Code and run kimi login to use your Kimi Code membership without an API key.";
  }
}
