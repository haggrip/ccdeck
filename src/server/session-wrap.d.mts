/** The desktop app's end-of-turn call as the deck keeps it (session-wrap.mjs). */
export interface Wrap {
  id: string | null;
  at: number;
  recap: string | null;
  ask: { question: string | null; choices: string[]; blocked: boolean } | null;
}
export const WRAP_TOOL: "mcp__ccd_turn__wrap_up";
export const WRAP_MARK: string;
export function wrapFromInput(input: unknown, id: unknown, at: number): Wrap | null;
export function normaliseWrap(w: unknown): Wrap | null;
export const wrapKey: (w: Wrap | null | undefined) => string;
export function wrapOf(line: string): Wrap | null;
export function isPromptLine(line: string): boolean;
export function foldWrapLine(out: Record<string, unknown>, line: string): void;
