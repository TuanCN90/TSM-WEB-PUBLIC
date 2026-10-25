import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
export const DATA_DIR = process.env.DATA_DIR ? resolve(process.env.DATA_DIR) : join(ROOT, "data");
export const SCRIPTS_DIR = join(DATA_DIR, "scripts");
/** Script tự tạo (nháp): chỉ hiện ở tab "Tạo kịch bản" cho đến khi được duyệt vào danh mục chính thức. */
export const CUSTOM_SCRIPTS_DIR = join(DATA_DIR, "custom_scripts");
