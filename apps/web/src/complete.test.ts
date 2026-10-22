import { describe, expect, it } from "vitest";
import { CompletionContext } from "@codemirror/autocomplete";
import { EditorState } from "@codemirror/state";
import { rust } from "@codemirror/lang-rust";
import { cfsCompletions } from "./complete";

function complete(text: string, params: { name: string; type: string }[] = []): string[] {
  const state = EditorState.create({ doc: text, extensions: [rust()] });
  const r = cfsCompletions(() => params)(new CompletionContext(state, text.length, true));
  return r && "options" in r ? r.options.map((o) => o.label) : [];
}

describe("cfsCompletions", () => {
  it("knows the board's methods", () => {
    expect(complete("if board.")).toEqual(expect.arrayContaining(["checkers", "side_to_move", "pieces", "colors", "king"]));
  });
  it("follows method chains", () => {
    expect(complete("pos.board().checkers().")).toEqual(expect.arrayContaining(["len", "is_empty", "has"]));
    expect(complete("let k = board.king(stm).")).toEqual(expect.arrayContaining(["file", "rank", "bitboard"]));
  });
  it("lists enum variants and constants after ::", () => {
    expect(complete("board.pieces(Piece::")).toEqual(expect.arrayContaining(["Pawn", "Queen", "King"]));
    expect(complete("Square::")).toContain("E4");
    expect(complete("BitBoard::")).toContain("EMPTY");
  });
  it("knows moves, the position and the searcher", () => {
    expect(complete("mv.")).toEqual(["from", "promotion", "to"]);
    expect(complete("pos.")).toEqual(expect.arrayContaining(["board", "is_draw", "make_move"]));
    expect(complete("self.")).toEqual(expect.arrayContaining(["nodes", "stopped"]));
  });
  it("offers skeleton values, parameters and functions for a word", () => {
    const words = complete("    if de", [{ name: "MY_MARGIN", type: "i32" }]);
    expect(words).toEqual(expect.arrayContaining(["depth", "static_eval", "MY_MARGIN", "get_knight_moves", "Board"]));
  });
  it("stays quiet in comments", () => {
    expect(complete("// board.")).toEqual([]);
  });
});
