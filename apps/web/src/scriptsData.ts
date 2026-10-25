import type { ScriptMeta } from "@tsbot/protocol";
import { useEffect, useState } from "react";
import { api, type CustomScriptMeta } from "./api";
import { useLive } from "./live";

export const CUSTOM_PREFIX = "custom:";
export const displayScriptName = (id: string) => (id.startsWith(CUSTOM_PREFIX) ? id.slice(CUSTOM_PREFIX.length) : id);

/** Nội dung script theo id chạy được (id tự tạo có tiền tố "custom:"). */
export const fetchRunnableContent = (id: string) =>
  id.startsWith(CUSTOM_PREFIX) ? api.customScript(id.slice(CUSTOM_PREFIX.length)) : api.script(id);

/** Tự nạp lại khi backend báo `scripts.changed` (không cần reload trang). */
function useRemoteList<T>(load: () => Promise<T[]>) {
  const { scriptsVersion } = useLive();
  const [list, setList] = useState<T[]>([]);
  useEffect(() => { load().then(setList).catch(() => {}); }, [scriptsVersion]); // eslint-disable-line react-hooks/exhaustive-deps
  return list;
}
export const useRunnableScripts = () => useRemoteList<ScriptMeta>(api.runnableScripts);
export const useBaseScripts = () => useRemoteList<ScriptMeta>(api.scripts);
export const useCustomScripts = () => useRemoteList<CustomScriptMeta>(api.customScripts);
