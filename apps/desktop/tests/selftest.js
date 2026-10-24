// Drives the real desktop app (debug build): CFS_SELFTEST=tests/selftest.js.
// Builds the starter engine with cargo, talks UCI, opens the terminal, then
// reports to the selftest_done command, which prints the report and exits.
(async () => {
  const log = [];
  const report = (ok) => window.__TAURI_INTERNALS__.invoke("selftest_done", { ok, report: log.join("\n") });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const waitFor = async (what, fn, seconds) => {
    for (let i = 0; i < seconds * 4; i++) {
      const v = fn();
      if (v) return v;
      await sleep(250);
    }
    throw new Error(`timed out waiting for ${what}`);
  };
  const outputHas = (text) => [...document.querySelectorAll("#dock .dock-output div")].some((d) => d.textContent.includes(text));
  try {
    await waitFor("the editor", () => document.querySelector(".blocklyToolboxCategory"), 30);
    document.querySelector("#template-toggle").click();
    document.querySelector('#menu [data-template="starter"]').click();
    await sleep(800);
    document.querySelector("#run-btn").click();
    await waitFor("uciok (build and start)", () => outputHas("uciok") || outputHas("build failed"), 600);
    if (!outputHas("uciok")) throw new Error("the build failed");
    log.push("built and started; uciok");
    [...document.querySelectorAll("#dock .dock-chip")].find((b) => b.textContent === "go depth").click();
    await waitFor("bestmove", () => outputHas("bestmove"), 60);
    log.push("go depth 6 -> bestmove");
    [...document.querySelectorAll("#dock .dock-chip")].find((b) => b.textContent === "bench").click();
    await waitFor("bench nodes", () => outputHas("nodes"), 120);
    log.push("bench prints nodes");
    document.querySelector("#terminal-btn").click();
    await waitFor("terminal prompt", () => (document.querySelector("#dock .xterm-rows")?.textContent ?? "").trim().length > 0, 30);
    log.push(`terminal: ${document.querySelector("#dock .xterm-rows").textContent.trim().slice(0, 80)}`);
    // Saving files: bytes in, the same bytes out.
    const inv = window.__TAURI_INTERNALS__.invoke;
    const dir = await inv("default_project_dir", { name: "selftest-files" });
    const path = `${dir}/t.cfs`;
    await inv("write_file", { path, data: [1, 2, 3, 250] });
    const back = new Uint8Array(await inv("read_file", { path }));
    if (back.join(",") !== "1,2,3,250") throw new Error(`read_file gave ${back.join(",")}`);
    log.push("write_file/read_file round trip");
    // A real test: fastchess and a book are downloaded, both branches built, a few games played.
    localStorage.setItem("cfs.test.watch", "1");
    localStorage.setItem("cfs.test.options", JSON.stringify({ tc: "1+0.01", concurrency: 1, maxGames: 4, book: { kind: "builtin", id: "8moves_v3" } }));
    document.querySelector("#branch-btn").click();
    await sleep(300);
    document.querySelector(".br-new input").value = "selftest";
    document.querySelector(".br-new button").click();
    await sleep(500);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    document.querySelector("#tests-btn").click();
    await waitFor("the test form", () => document.querySelector(".ts-start"), 10);
    document.querySelector(".ts-start").click();
    await waitFor("the test to finish", () => document.querySelector(".ts-run .ts-badge:not(.ts-running)"), 900);
    const runText = document.querySelector(".ts-run").textContent;
    const badge = document.querySelector(".ts-run .ts-badge").textContent;
    log.push(`test: ${badge}; ${runText.replace(/\s+/g, " ").slice(0, 160)}`);
    if (!/4\s*games/.test(runText)) throw new Error(`the test did not play 4 games: ${document.querySelector(".ts-out")?.textContent.slice(-600)}`);
    const boards = document.querySelectorAll(".lg-card").length;
    if (!boards) throw new Error("watching the test showed no boards");
    log.push(`live boards: ${boards}`);
    // Play: two branches against each other, a few moves at depth 2.
    localStorage.setItem("cfs.play.setup", JSON.stringify({ mode: "engines", time: { kind: "depth", depth: 2 }, fen: "" }));
    document.querySelector("#play-btn").click();
    await waitFor("the play form", () => document.querySelector(".pl-start"), 10);
    document.querySelector(".pl-start").click();
    await waitFor("six moves on the board", () => document.querySelectorAll(".pl-san").length >= 6 || document.querySelector(".pl-status.pl-over"), 300);
    log.push(`play: ${document.querySelector(".pl-moves").textContent.replace(/\s+/g, " ").slice(0, 80)}`);
    log.push(`engine info: ${document.querySelector(".pl-info")?.textContent.replace(/\s+/g, " ").slice(0, 80)}`);
    document.querySelector(".pl-resign")?.click();
    log.push("--- engine output ---", ...[...document.querySelectorAll("#dock .dock-output div")].slice(-12).map((d) => d.textContent));
    await report(true);
  } catch (err) {
    log.push(`FAILED: ${err.message}`, "--- output ---", ...[...document.querySelectorAll("#dock .dock-output div")].slice(-30).map((d) => d.textContent));
    await report(false);
  }
})();
