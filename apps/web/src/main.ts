import * as Blockly from "blockly";
import { generateCargoToml, starterWorkspace } from "@cfs/codegen";
import "./style.css";

// Sprint 0: one root block proves Blockly, the codegen package and the
// preview pane are wired together. Real blocks arrive in Sprint 3.
Blockly.common.defineBlocksWithJsonArray([
  {
    type: "cfs_engine",
    message0: "Engine %1 by %2",
    args0: [
      { type: "field_input", name: "NAME", text: "My Engine" },
      { type: "field_input", name: "AUTHOR", text: "me" },
    ],
    colour: 150,
    tooltip: "The root of every engine.",
  },
]);

const workspace = Blockly.inject("workspace", {
  toolbox: {
    kind: "flyoutToolbox",
    contents: [{ kind: "block", type: "cfs_engine" }],
  },
  grid: { spacing: 24, length: 2, colour: "#e2e0da", snap: true },
  trashcan: true,
  media: "/blockly-media/",
});

const root = workspace.newBlock("cfs_engine");
root.initSvg();
root.render();
root.moveBy(40, 40);

const code = document.getElementById("code")!;

function refresh(): void {
  const engine = workspace.getBlocksByType("cfs_engine", false)[0];
  if (!engine) {
    code.textContent = "// Drag an Engine block onto the workspace.";
    return;
  }
  const ws = starterWorkspace();
  ws.engine.name = engine.getFieldValue("NAME");
  ws.engine.author = engine.getFieldValue("AUTHOR");
  code.textContent = generateCargoToml(ws);
}

workspace.addChangeListener(refresh);
refresh();
