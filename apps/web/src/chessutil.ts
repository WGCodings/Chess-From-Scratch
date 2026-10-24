// Chess rules for the boards (chess.js): legal moves for chessground, moves
// in UCI notation, the end of a game, and engine scores for people.

import { Chess, DEFAULT_POSITION, validateFen } from "chess.js";
import type { Key } from "chessground/types";

export { Chess, DEFAULT_POSITION };

/** Legal moves as chessground wants them: from-square → to-squares. */
export function legalDests(chess: Chess): Map<Key, Key[]> {
  const dests = new Map<Key, Key[]>();
  for (const m of chess.moves({ verbose: true })) {
    const list = dests.get(m.from as Key) ?? [];
    if (!list.includes(m.to as Key)) list.push(m.to as Key);
    dests.set(m.from as Key, list);
  }
  return dests;
}

/** Plays a UCI move (e2e4, e7e8q); returns its SAN, or null when it is not legal. */
export function playUci(chess: Chess, uci: string): string | null {
  try {
    const m = chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.length > 4 ? uci[4] : undefined });
    return m.san;
  } catch {
    return null;
  }
}

/** The UCI notation of chess.js's last move. */
export function lastUci(chess: Chess): string | null {
  const h = chess.history({ verbose: true });
  const m = h[h.length - 1];
  return m ? `${m.from}${m.to}${m.promotion ?? ""}` : null;
}

/** A move from one square to another needs a promotion piece. */
export function isPromotion(chess: Chess, from: string, to: string): boolean {
  return chess.moves({ verbose: true }).some((m) => m.from === from && m.to === to && !!m.promotion);
}

/** A principal variation in SAN from `fen`, as far as its moves are legal. */
export function pvToSan(fen: string, pv: string[], max = 12): string {
  const c = new Chess(fen);
  const out: string[] = [];
  for (const uci of pv.slice(0, max)) {
    const before = c.moveNumber();
    const white = c.turn() === "w";
    const san = playUci(c, uci);
    if (!san) break;
    out.push(white ? `${before}. ${san}` : out.length === 0 ? `${before}… ${san}` : san);
  }
  return out.join(" ");
}

export type GameResult = "1-0" | "0-1" | "1/2-1/2";

/** How the game ended by the rules, or null while it goes on. */
export function gameEnd(chess: Chess): { result: GameResult; reason: string } | null {
  if (chess.isCheckmate()) return { result: chess.turn() === "w" ? "0-1" : "1-0", reason: "checkmate" };
  if (chess.isStalemate()) return { result: "1/2-1/2", reason: "stalemate" };
  if (chess.isThreefoldRepetition()) return { result: "1/2-1/2", reason: "threefold repetition" };
  if (chess.isInsufficientMaterial()) return { result: "1/2-1/2", reason: "insufficient material" };
  if (chess.isDrawByFiftyMoves()) return { result: "1/2-1/2", reason: "50-move rule" };
  return null;
}

/** Why a FEN can't be used, or null. */
export function fenProblem(fen: string): string | null {
  const v = validateFen(fen.trim());
  return v.ok ? null : (v.error ?? "Not a valid FEN.");
}

/** An engine score (side to move's view) from White's view, in pawns, with mates as ±100+. */
export function whiteScore(score: { cp?: number; mate?: number }, sideToMove: "w" | "b"): number | null {
  const sign = sideToMove === "w" ? 1 : -1;
  if (score.mate !== undefined) return sign * (score.mate > 0 ? 1 : -1) * (100 + 1 / Math.max(1, Math.abs(score.mate)));
  if (score.cp !== undefined) return (sign * score.cp) / 100;
  return null;
}

/** "+0.35", "−1.20", "#3", "#−2" (White's view). */
export function formatScore(score: { cp?: number; mate?: number }, sideToMove: "w" | "b"): string {
  const sign = sideToMove === "w" ? 1 : -1;
  if (score.mate !== undefined) {
    const m = sign * score.mate;
    return m > 0 ? `#${m}` : `#−${Math.abs(m)}`;
  }
  if (score.cp === undefined) return "—";
  const p = (sign * score.cp) / 100;
  return `${p > 0 ? "+" : p < 0 ? "−" : ""}${Math.abs(p).toFixed(2)}`;
}

/** The FEN of a position given as `position startpos moves …` or `position fen … moves …`. */
export function positionToChess(cmd: string): Chess | null {
  const m = cmd.match(/position\s+(startpos|fen\s+(.+?))(?:\s+moves\s+(.*))?$/);
  if (!m) return null;
  let c: Chess;
  try {
    c = new Chess(m[1] === "startpos" ? DEFAULT_POSITION : m[2]!.trim());
  } catch {
    return null;
  }
  for (const uci of (m[3] ?? "").split(/\s+/).filter(Boolean)) if (!playUci(c, uci)) break;
  return c;
}
