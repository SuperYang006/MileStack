import type { CliOutput } from "./output.js";
import { createStyler } from "./styler.js";

export type StepDisplay = {
  // Redraw running steps in place. When false, each step is printed once, as
  // plain text, after it finishes.
  interactive: boolean;
  color: boolean;
  now: () => number;
  tickMs: number;
  // Terminal width in cells, read at every redraw so a resize is followed.
  columns: () => number;
};

export function detectStepDisplay(
  environment: NodeJS.ProcessEnv = process.env,
  isTerminal: boolean = process.stdout.isTTY === true,
): StepDisplay {
  const interactive = isTerminal && environment["TERM"] !== "dumb";
  const noColor = environment["NO_COLOR"] !== undefined && environment["NO_COLOR"] !== "";
  return {
    interactive,
    color: interactive && !noColor,
    now: Date.now,
    tickMs: 100,
    columns: () => process.stdout.columns || 80,
  };
}

type StepState = "pending" | "running" | "done" | "failed" | "skipped";

export type Step = {
  label: string;
  state: StepState;
  detail: string;
  notes: string[];
  startedAt: number | undefined;
  endedAt: number | undefined;
};

type Row =
  | { kind: "title"; text: string; final: boolean }
  | { kind: "step"; step: Step }
  | { kind: "text"; text: string; tone: "success" | "failure" | "plain" }
  // Plain mode cannot rewrite a title it already printed, so a changed title
  // is appended where the output currently is.
  | { kind: "retitle"; text: string };

const spinnerFrames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const labelWidth = 22;
const detailWidth = 24;

// Terminal cells, counting East Asian wide characters as two.
function displayWidth(text: string): number {
  let width = 0;
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0;
    const wide =
      (code >= 0x1100 && code <= 0x115f) ||
      (code >= 0x2e80 && code <= 0xa4cf) ||
      (code >= 0xac00 && code <= 0xd7a3) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xff00 && code <= 0xff60);
    width += wide ? 2 : 1;
  }
  return width;
}

// Plain (unstyled) text cut to at most `width` cells, ending in an ellipsis.
function truncatePlain(text: string, width: number): string {
  if (displayWidth(text) <= width) {
    return text;
  }
  let result = "";
  let used = 0;
  for (const character of text) {
    const characterWidth = displayWidth(character);
    if (used + characterWidth > width - 1) {
      break;
    }
    result += character;
    used += characterWidth;
  }
  return `${result}…`;
}

const sgrSequence = /\x1b\[[0-9;]*m/g;

function visibleWidth(line: string): number {
  return displayWidth(line.replace(sgrSequence, ""));
}

// Cuts a styled line to at most `limit` cells; color sequences cost nothing.
function fitToWidth(line: string, limit: number): string {
  if (visibleWidth(line) <= limit) {
    return line;
  }
  let result = "";
  let width = 0;
  let index = 0;
  while (index < line.length) {
    sgrSequence.lastIndex = index;
    const sequence = sgrSequence.exec(line);
    if (sequence !== null && sequence.index === index) {
      result += sequence[0];
      index += sequence[0].length;
      continue;
    }
    const character = String.fromCodePoint(line.codePointAt(index) ?? 0);
    const characterWidth = displayWidth(character);
    if (width + characterWidth > limit - 1) {
      break;
    }
    result += character;
    width += characterWidth;
    index += character.length;
  }
  sgrSequence.lastIndex = 0;
  return sgrSequence.test(result) ? `${result}…\x1b[0m` : `${result}…`;
}

export function formatElapsed(milliseconds: number): string {
  const seconds = Math.max(0, milliseconds) / 1000;
  if (seconds < 10) {
    return `${seconds.toFixed(1)}s`;
  }
  if (seconds < 60) {
    return `${Math.floor(seconds)}s`;
  }
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m${String(Math.floor(seconds % 60)).padStart(2, "0")}s`;
}

// Prints a checklist of steps. Rows above the first unfinished one are final and
// written once; the unfinished tail is the only part redrawn in place.
export class StepReporter {
  private readonly rows: Row[] = [];
  private readonly styler: ReturnType<typeof createStyler>;
  private committed = 0;
  // Visible width of every line in the redrawn region, to know how many
  // terminal rows it covers now.
  private liveWidths: number[] = [];
  private frame = 0;
  private timer: NodeJS.Timeout | undefined;
  private readonly restoreCursor = () => {
    this.output.writeStdout("\x1b[?25h");
  };

  constructor(
    private readonly output: CliOutput,
    private readonly display: StepDisplay,
  ) {
    this.styler = createStyler(display.color);
  }

  setTitle(text: string, final = false): void {
    const existing = this.rows.find((row) => row.kind === "title");
    if (existing?.kind !== "title") {
      this.rows.unshift({ kind: "title", text, final });
    } else if (this.display.interactive || !this.isFinal(existing)) {
      existing.text = text;
      existing.final = final;
    } else if (existing.text !== text) {
      this.rows.splice(this.committed, 0, { kind: "retitle", text });
    }
    this.flush();
  }

  finalizeTitle(): void {
    const existing = this.rows.find((row) => row.kind === "title");
    if (existing?.kind === "title") {
      existing.final = true;
    }
    this.flush();
  }

  addStep(label: string, before?: Step): Step {
    const step: Step = {
      label,
      state: "pending",
      detail: "",
      notes: [],
      startedAt: undefined,
      endedAt: undefined,
    };
    const index =
      before === undefined
        ? -1
        : this.rows.findIndex((row) => row.kind === "step" && row.step === before);
    if (index < 0) {
      this.rows.push({ kind: "step", step });
    } else {
      this.rows.splice(index, 0, { kind: "step", step });
    }
    this.flush();
    return step;
  }

  start(step: Step): void {
    step.state = "running";
    step.startedAt = this.display.now();
    this.beginTicking();
    this.flush();
  }

  succeed(step: Step, detail: string, notes: string[] = []): void {
    this.finish(step, "done", detail, notes);
  }

  fail(step: Step, detail: string, notes: string[] = []): void {
    this.finish(step, "failed", detail, notes);
  }

  skip(step: Step, detail: string, notes: string[] = []): void {
    this.finish(step, "skipped", detail, notes);
  }

  // Drops steps that will not run because an earlier step failed.
  discardPending(): void {
    for (let index = this.rows.length - 1; index >= 0; index -= 1) {
      const row = this.rows[index];
      if (row?.kind === "step" && row.step.state === "pending") {
        this.rows.splice(index, 1);
      }
    }
    this.flush();
  }

  summary(tone: "success" | "failure" | "plain", text: string): void {
    this.rows.push({ kind: "text", text, tone });
    this.flush();
  }

  // Finishes the output: everything becomes final and the cursor is restored.
  close(): void {
    this.endTicking();
    for (const row of this.rows) {
      if (row.kind === "title") {
        row.final = true;
      } else if (row.kind === "step" && row.step.state === "running") {
        row.step.state = "failed";
        row.step.endedAt = this.display.now();
      }
    }
    this.discardPending();
  }

  private finish(step: Step, state: StepState, detail: string, notes: string[]): void {
    step.state = state;
    step.detail = detail;
    step.notes = notes;
    step.endedAt = this.display.now();
    this.flush();
  }

  private beginTicking(): void {
    if (!this.display.interactive || this.timer !== undefined) {
      return;
    }
    this.output.writeStdout("\x1b[?25l");
    process.on("exit", this.restoreCursor);
    this.timer = setInterval(() => {
      this.frame += 1;
      this.flush();
    }, this.display.tickMs);
    this.timer.unref();
  }

  private endTicking(): void {
    if (this.timer === undefined) {
      return;
    }
    clearInterval(this.timer);
    this.timer = undefined;
    process.off("exit", this.restoreCursor);
    this.output.writeStdout("\x1b[?25h");
  }

  private isFinal(row: Row): boolean {
    if (row.kind === "title") {
      // Plain output cannot be rewritten, so it prints the title right away.
      return row.final || !this.display.interactive;
    }
    if (row.kind === "text" || row.kind === "retitle") {
      return true;
    }
    return row.step.state === "done" || row.step.state === "failed" || row.step.state === "skipped";
  }

  private flush(): void {
    let chunk = "";
    const columns = Math.max(2, this.display.columns());
    if (this.liveWidths.length > 0) {
      const rows = this.liveWidths.reduce(
        (total, width) => total + Math.max(1, Math.ceil(width / columns)),
        0,
      );
      chunk += `\x1b[${rows}A\r\x1b[J`;
      this.liveWidths = [];
    }
    while (this.committed < this.rows.length) {
      const row = this.rows[this.committed];
      if (row === undefined || !this.isFinal(row)) {
        break;
      }
      chunk += this.formatRow(row).map((line) => `${line}\n`).join("");
      this.committed += 1;
    }
    if (this.display.interactive) {
      // Every redrawn line stays on one terminal row, so the next erase can
      // count rows exactly; finished rows above are written in full.
      const live = this.rows
        .slice(this.committed)
        .flatMap((row) => this.formatRow(row, columns - 1))
        .map((line) => fitToWidth(line, columns - 1));
      chunk += live.map((line) => `${line}\n`).join("");
      this.liveWidths = live.map(visibleWidth);
    }
    if (chunk.length > 0) {
      this.output.writeStdout(chunk);
    }
  }

  private formatRow(row: Row, limit?: number): string[] {
    if (row.kind === "title") {
      return [` ${this.styler.bold(row.text)}`, ""];
    }
    if (row.kind === "retitle") {
      return ["", ` ${this.styler.bold(row.text)}`];
    }
    if (row.kind === "text") {
      const glyph =
        row.tone === "success"
          ? this.styler.boldGreen("✓")
          : row.tone === "failure"
            ? this.styler.boldRed("✖")
            : "";
      return ["", ...row.text.split("\n").map((line, index) =>
        glyph !== "" && index === 0 ? ` ${glyph} ${line}` : `   ${line}`,
      )];
    }
    return this.formatStep(row.step, limit);
  }

  private formatStep(step: Step, limit?: number): string[] {
    const { styler } = this;
    const glyph =
      step.state === "pending"
        ? styler.dim("○")
        : step.state === "running"
          ? styler.cyan(spinnerFrames[this.frame % spinnerFrames.length] ?? "⠋")
          : step.state === "done"
            ? styler.green("✔")
            : step.state === "failed"
              ? styler.red("✖")
              : styler.dim("–");
    const paint = (text: string) => (step.state === "pending" ? styler.dim(text) : text);
    const elapsedText =
      step.startedAt === undefined
        ? ""
        : formatElapsed((step.endedAt ?? this.display.now()) - step.startedAt);
    const elapsed = elapsedText === "" ? "" : styler.dim(elapsedText);
    const detailGap = " ".repeat(Math.max(2, detailWidth - displayWidth(step.detail)));
    const labelPad = " ".repeat(Math.max(0, labelWidth - displayWidth(step.label)));
    const roomy = `  ${glyph} ${paint(step.label)}${labelPad}${
      elapsed === "" ? step.detail : `${step.detail}${detailGap}`
    }${elapsed}`.trimEnd();
    let line = roomy;
    if (limit !== undefined && visibleWidth(roomy) > limit) {
      // Narrow terminal: drop the column padding first, then shorten the
      // detail, and only then the label, so the running time stays visible.
      const fixed = 4 + displayWidth(elapsedText) + (elapsedText === "" ? 0 : 2);
      const available = Math.max(2, limit - fixed);
      const labelFits = displayWidth(step.label) <= available;
      const label = labelFits ? step.label : truncatePlain(step.label, available);
      const spare = available - displayWidth(label);
      const detail =
        step.detail !== "" && spare >= 4 ? `  ${truncatePlain(step.detail, spare - 2)}` : "";
      line = `  ${glyph} ${paint(label)}${detail}${elapsed === "" ? "" : `  ${elapsed}`}`;
    }
    const notes = step.notes.map((note) => `      ${styler.dim(note)}`);
    return [line, ...notes];
  }
}

export function createStepReporter(output: CliOutput, display: StepDisplay): StepReporter {
  return new StepReporter(output, display);
}
