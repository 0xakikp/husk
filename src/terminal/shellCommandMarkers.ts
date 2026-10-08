/** Themes can emit OSC 133 alongside Husk's own hooks. Process each command
 * boundary once, without dropping private prompt metadata between duplicate
 * end marks. A C after D without a new command or prompt is a theme's synthetic
 * empty-command marker, not another execution. */
export class ShellCommandMarkers {
  private last: "B" | "C" | "D" | null = null;
  private announced = false;

  announceCommand(): void { this.announced = true; }
  reset(): void { this.last = null; this.announced = false; }

  accept(data: string): boolean {
    const kind = data.split(";", 1)[0];
    if (kind === "B") {
      this.last = "B"; this.announced = false;
      return true;
    }
    if (kind !== "C" && kind !== "D") return false;
    if (!this.announced && (this.last === kind || (kind === "C" && this.last === "D"))) return false;
    this.last = kind;
    this.announced = false;
    return true;
  }
}
