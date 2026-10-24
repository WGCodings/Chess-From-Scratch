import { describe, expect, it } from "vitest";
import { Chess, fenProblem, formatScore, gameEnd, legalDests, positionToChess, pvToSan, whiteScore } from "./chessutil";
import { parseInfo } from "./uci";

describe("chess helpers", () => {
  it("lists legal moves for the board and replays engine positions", () => {
    const c = new Chess();
    expect(legalDests(c).get("e2")).toEqual(["e3", "e4"]);
    const p = positionToChess("position startpos moves e2e4 e7e5 g1f3")!;
    expect(p.turn()).toBe("b");
    expect(p.history()).toEqual(["e4", "e5", "Nf3"]);
    const f = positionToChess("position fen 8/8/8/8/8/8/4K3/k7 w - - 0 1 moves e2d3")!;
    expect(f.fen().startsWith("8/8/8/8/8/3K4/8/k7 b")).toBe(true);
  });

  it("knows how games end", () => {
    const mate = new Chess();
    for (const m of ["f3", "e5", "g4", "Qh4#"]) mate.move(m);
    expect(gameEnd(mate)).toEqual({ result: "0-1", reason: "checkmate" });
    expect(gameEnd(new Chess("8/8/8/8/8/8/4K3/k7 w - - 0 1"))).toEqual({ result: "1/2-1/2", reason: "insufficient material" });
    expect(gameEnd(new Chess())).toBeNull();
    expect(fenProblem("not a fen")).not.toBeNull();
    expect(fenProblem("8/8/8/8/8/8/4K3/k7 w - - 0 1")).toBeNull();
  });

  it("shows engine output to people", () => {
    const info = parseInfo("info depth 6 seldepth 9 score cp -35 nodes 5072 nps 72626 time 70 pv e7e5 g1f3 b8c6")!;
    expect(info).toMatchObject({ depth: 6, seldepth: 9, cp: -35, nodes: 5072, pv: ["e7e5", "g1f3", "b8c6"] });
    expect(parseInfo("info string hello")).toBeNull();
    expect(formatScore({ cp: -35 }, "b")).toBe("+0.35");
    expect(formatScore({ mate: 2 }, "b")).toBe("#−2");
    expect(whiteScore({ cp: 50 }, "w")).toBe(0.5);
    const start = new Chess().fen();
    expect(pvToSan(start, ["e2e4", "e7e5", "g1f3"])).toBe("1. e4 e5 2. Nf3");
    const afterE4 = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1";
    expect(pvToSan(afterE4, ["e7e5", "g1f3"])).toBe("1… e5 2. Nf3");
  });
});
