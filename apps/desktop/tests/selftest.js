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
    const select = document.querySelector("#template");
    select.value = "starter";
    select.dispatchEvent(new Event("change"));
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
    log.push("--- engine output ---", ...[...document.querySelectorAll("#dock .dock-output div")].slice(-12).map((d) => d.textContent));
    await report(true);
  } catch (err) {
    log.push(`FAILED: ${err.message}`, "--- output ---", ...[...document.querySelectorAll("#dock .dock-output div")].slice(-30).map((d) => d.textContent));
    await report(false);
  }
})();
