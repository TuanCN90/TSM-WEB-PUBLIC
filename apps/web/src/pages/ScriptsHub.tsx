import { useState } from "react";
import { DungeonSolo } from "./DungeonSolo";
import { DungeonTeam } from "./DungeonTeam";
import { Runner } from "./Runner";
import { Scripts } from "./Scripts";

type ScriptSubTab = "runner" | "builder" | "dungeon" | "dungeon-solo";

/** Tab Lớn "Kịch bản": gom nhóm 4 tab con (Kịch bản để thực thi + Tạo kịch bản + Phó bản đội + Phó bản đơn). */
export function ScriptsHub() {
  const [subTab, setSubTab] = useState<ScriptSubTab>(() => {
    try {
      const saved = localStorage.getItem("scripts.activeSubTab");
      if (saved === "builder" || saved === "runner" || saved === "dungeon" || saved === "dungeon-solo") return saved;
    } catch {}
    return "runner";
  });

  const selectTab = (t: ScriptSubTab) => {
    setSubTab(t);
    try {
      localStorage.setItem("scripts.activeSubTab", t);
    } catch {}
  };

  return (
    <div className="home-wrapper" style={{ height: "100%" }}>
      <div className="home-tabbar">
        <button
          type="button"
          className={`home-tab ${subTab === "runner" ? "on" : ""}`}
          onClick={() => selectTab("runner")}
        >
          <span>📜</span> Kịch bản
        </button>
        <button
          type="button"
          className={`home-tab ${subTab === "builder" ? "on" : ""}`}
          onClick={() => selectTab("builder")}
        >
          <span>✏️</span> Tạo kịch bản
        </button>
        <button
          type="button"
          className={`home-tab ${subTab === "dungeon" ? "on" : ""}`}
          onClick={() => selectTab("dungeon")}
        >
          <span>🏰</span> Phó bản đội
        </button>
        <button
          type="button"
          className={`home-tab ${subTab === "dungeon-solo" ? "on" : ""}`}
          onClick={() => selectTab("dungeon-solo")}
        >
          <span>⚔️</span> Phó bản đơn & Boss TG
        </button>
      </div>
      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
        {subTab === "runner" && <Runner onSwitchToBuilder={() => selectTab("builder")} />}
        {subTab === "builder" && <Scripts />}
        {subTab === "dungeon" && <DungeonTeam />}
        {subTab === "dungeon-solo" && <DungeonSolo />}
      </div>
    </div>
  );
}
