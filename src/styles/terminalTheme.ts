import type { ITheme } from "@xterm/xterm";

export type TerminalThemePreset = "husk" | "hacker" | "ocean" | "rose";

export const TERMINAL_THEME_PRESETS: Record<
  TerminalThemePreset,
  { name: string; bg: string; fg: string; cursor: string; selectionBg: string }
> = {
  husk: {
    name: "Husk",
    bg: "#0a0f0a",
    fg: "#d4e5d4",
    cursor: "#11c700",
    selectionBg: "rgba(17, 199, 0, 0.30)",
  },
  hacker: {
    name: "Hacker",
    bg: "#000000",
    fg: "#00ff00",
    cursor: "#00ff00",
    selectionBg: "rgba(0, 255, 0, 0.25)",
  },
  ocean: {
    name: "Ocean",
    bg: "#0a0e1a",
    fg: "#c7d5f0",
    cursor: "#00d4ff",
    selectionBg: "rgba(0, 212, 255, 0.25)",
  },
  rose: {
    name: "Rose",
    bg: "#0d0208",
    fg: "#ff79c6",
    cursor: "#ff79c6",
    selectionBg: "rgba(255, 121, 198, 0.25)",
  },
};

type Ansi = {
  black: string;
  red: string;
  green: string;
  yellow: string;
  blue: string;
  magenta: string;
  cyan: string;
  white: string;
  brightBlack: string;
  brightRed: string;
  brightGreen: string;
  brightYellow: string;
  brightBlue: string;
  brightMagenta: string;
  brightCyan: string;
  brightWhite: string;
};

const ANSI_PALETTES: Record<TerminalThemePreset, Ansi> = {
  husk: {
    black: "#1a1f1a",
    red: "#e74c3c",
    green: "#2ecc71",
    yellow: "#d4c520",
    blue: "#5a8f5a",
    magenta: "#b85cb8",
    cyan: "#3dd68a",
    white: "#c8d8c8",
    brightBlack: "#4a554a",
    brightRed: "#ff6b6b",
    brightGreen: "#4ade80",
    brightYellow: "#fde68a",
    brightBlue: "#7ab87a",
    brightMagenta: "#f0a0f0",
    brightCyan: "#6ee7b7",
    brightWhite: "#e8f5e8",
  },
  hacker: {
    black: "#0a1a0a",
    red: "#ff3333",
    green: "#00ff41",
    yellow: "#33ff33",
    blue: "#008f11",
    magenta: "#00cc00",
    cyan: "#20c20e",
    white: "#00ff00",
    brightBlack: "#003b00",
    brightRed: "#ff5555",
    brightGreen: "#5cff5c",
    brightYellow: "#55ff55",
    brightBlue: "#116611",
    brightMagenta: "#33ff33",
    brightCyan: "#55ff55",
    brightWhite: "#ccffcc",
  },
  ocean: {
    black: "#0f1525",
    red: "#ff6b6b",
    green: "#4ade80",
    yellow: "#fbbf24",
    blue: "#60a5fa",
    magenta: "#c084fc",
    cyan: "#22d3ee",
    white: "#c7d5f0",
    brightBlack: "#2a3b5c",
    brightRed: "#ff8888",
    brightGreen: "#86efac",
    brightYellow: "#fde047",
    brightBlue: "#93c5fd",
    brightMagenta: "#d8b4fe",
    brightCyan: "#67e8f9",
    brightWhite: "#e2e8f0",
  },
  rose: {
    black: "#1a0a12",
    red: "#ff6b9d",
    green: "#ff85a2",
    yellow: "#ffc2d1",
    blue: "#ff4d8a",
    magenta: "#ff79c6",
    cyan: "#ff9ebb",
    white: "#ffcce0",
    brightBlack: "#3d1a2a",
    brightRed: "#ff8fab",
    brightGreen: "#ffa6c1",
    brightYellow: "#ffd1dc",
    brightBlue: "#ff6b9d",
    brightMagenta: "#ff92c2",
    brightCyan: "#ffb3cd",
    brightWhite: "#ffe0ec",
  },
};

/** Build an xterm theme for a preset. In light mode the surface goes white
 *  while the preset's ANSI palette is kept. */
export function buildTerminalTheme(
  preset: TerminalThemePreset,
  dark: boolean,
  transparentBg?: boolean,
  accentColor?: string,
): ITheme {
  const p = TERMINAL_THEME_PRESETS[preset] ?? TERMINAL_THEME_PRESETS.husk;
  const ansi = ANSI_PALETTES[preset] ?? ANSI_PALETTES.husk;
  const accent = accentColor || "#11c700";

  if (!dark) {
    return {
      background: transparentBg ? "rgba(0,0,0,0)" : "#ffffff",
      foreground: "#1a1a1a",
      cursor: accent,
      cursorAccent: "#ffffff",
      selectionBackground: "rgba(45, 50, 60, 0.12)",
      selectionForeground: "#000000",
      ...ansi,
    };
  }

  return {
    background: transparentBg ? "rgba(0,0,0,0)" : p.bg,
    foreground: p.fg,
    cursor: accent,
    cursorAccent: "#0a0a0a",
    selectionBackground: "rgba(200, 205, 220, 0.15)",
    selectionForeground: "#ffffff",
    ...ansi,
  };
}
