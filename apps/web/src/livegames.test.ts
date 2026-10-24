import { describe, expect, it } from "vitest";
import { LiveGamesModel } from "./livegames";

const L = (thread: string, name: string, dir: "<---" | "--->", msg: string) => `[Engine] [22:22:08.221391] <     ${thread}>  ${name} ${dir} ${msg}`;

describe("live games from the fastchess engine log", () => {
  it("follows each thread's game: players, moves and clocks", () => {
    const m = new LiveGamesModel();
    m.feed([
      L("111", "new", "<---", "position startpos moves e2e4 e7e5"),
      L("111", "new", "<---", "go wtime 9000 btime 8500 winc 100 binc 100"),
      L("222", "base", "<---", "position startpos moves d2d4"),
    ]);
    expect(m.games.size).toBe(2);
    const g = m.games.get("111")!;
    expect(g.white).toBe("new");
    expect([g.wtime, g.btime]).toEqual([9000, 8500]);
    m.feed([L("111", "new", "--->", "bestmove g1f3"), L("111", "base", "<---", "position startpos moves e2e4 e7e5 g1f3")]);
    expect(g.lastMove).toBe("g1f3");
    expect(m.games.get("111")!.black).toBe("base");
    expect(m.games.get("111")!.plies).toBe(3);
    expect(m.games.get("222")!.black).toBe("base");
  });

  it("sees a new game start on the same thread", () => {
    const m = new LiveGamesModel();
    m.feed([L("111", "new", "<---", "position startpos moves e2e4 e7e5 g1f3")]);
    m.feed([L("111", "base", "<---", "position startpos moves d2d4")]);
    const g = m.games.get("111")!;
    expect(g.games).toBe(2);
    expect(g.black).toBe("base");
    expect(g.white).toBe("");
  });
});
