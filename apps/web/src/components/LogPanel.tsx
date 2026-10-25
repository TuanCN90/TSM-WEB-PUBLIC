import { useState } from "react";
import { useLive } from "../live";
import { GameLog } from "./GameLog";
import { LogView } from "./LogView";

/** Khung log dùng chung (Home + tab Kịch bản): tab "Sự kiện" / "Log" của một tài khoản. Đặt trong `.homelog`. */
export function LogPanel({ accountId, empty = "Đăng nhập để xem log." }: { accountId: string | null; empty?: string }) {
  const { logs, clearLogs } = useLive();
  const [tab, setTab] = useState<"game" | "raw">("game");
  return (
    <>
      <div className="logtabs" role="tablist">
        <button role="tab" aria-selected={tab === "game"} className={tab === "game" ? "on" : ""} onClick={() => setTab("game")}>Sự kiện</button>
        <button role="tab" aria-selected={tab === "raw"} className={tab === "raw" ? "on" : ""} onClick={() => setTab("raw")}>Log</button>
      </div>
      {!accountId ? <div className="muted">{empty}</div>
        : tab === "game" ? <GameLog logs={logs[accountId] ?? []} onClear={() => clearLogs(accountId)} />
        : <LogView logs={logs[accountId] ?? []} onClear={() => clearLogs(accountId)} />}
    </>
  );
}
