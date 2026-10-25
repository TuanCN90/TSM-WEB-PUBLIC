import { useEffect, useState } from "react";

/**
 * Trang chủ: lưới nút các tính năng ĐÃ HOÀN THIỆN và dùng được trên web bot.
 * Bấm nút → popup mô tả logic + ràng buộc. Chỉ liệt kê tính năng chính; ràng buộc nhỏ nằm trong popup.
 * Quy tắc (AGENTS.md #1): thêm/sửa tính năng ⇒ thêm/sửa mục trong FEATURES bên dưới.
 */
type Tone = "cyan" | "green" | "amber" | "violet" | "rose" | "blue";

interface Feature {
  id: string;
  icon: string;
  name: string;
  tone: Tone;
  summary: string;
  logic: string[];
  rules: string[];
}

const FEATURES: Feature[] = [
  {
    id: "login",
    icon: "🔐",
    name: "Đăng nhập đa tài khoản",
    tone: "cyan",
    summary: "Quản lý và treo nhiều tài khoản cùng lúc, hỗ trợ kéo thả đổi thứ tự tab, Login Tất Cả và Logout Tất Cả 1-click.",
    logic: [
      "Thêm tài khoản, đăng nhập từng phiên hoặc 'Login Tất Cả'; mỗi phiên là một tab riêng với trạng thái, log và cấu hình độc lập.",
      "Hỗ trợ nút 'Logout Tất Cả': ngắt kết nối an toàn cho toàn bộ tài khoản đang online chỉ với 1 click, tự động cam kết đóng kho và lưu dữ liệu túi đồ (commit Database) chống rollback trước khi rời mạng.",
      "Kéo thả (drag & drop) các tab tài khoản trên menu dọc để di chuyển và sắp xếp lại thứ tự theo ý muốn; thứ tự mới được tự động lưu lại vào trình duyệt.",
      "Giữ kết nối bằng heartbeat; tự đăng nhập lại khi rớt mạng nếu bật trong Cài đặt.",
      "Đăng nhập thành công sẽ tự điểm danh ngày (nếu bật).",
    ],
    rules: [
      "Bấm 'Logout Tất Cả' sẽ hiển thị hộp thoại xác nhận trước khi thực hiện nhằm tránh thao tác bấm nhầm làm gián đoạn bãi train.",
      "Kéo thả tab chỉ thay đổi thứ tự hiển thị, không làm ngắt kết nối hay xáo trộn trạng thái của các tài khoản đang online.",
      "Mỗi tài khoản phân lập 100% cấu hình và dữ liệu — tài khoản này không thấy hay ghi đè tài khoản khác.",
      "Đăng nhập liên tục quá dày có thể bị server khoá: hệ thống giãn cách giữa các lần login.",
      "Khởi động lại backend sẽ làm mất các phiên đang online.",
    ],
  },
  {
    id: "daily",
    icon: "📅",
    name: "Điểm danh ngày tự động",
    tone: "amber",
    summary: "Tự điểm danh mỗi ngày ngay sau khi đăng nhập thành công.",
    logic: [
      "Sau khi login, chờ vài giây để server gửi bộ đếm điểm danh rồi thực hiện điểm danh.",
      "Nếu chưa đọc được bộ đếm sẽ thử lại tối đa vài lần, sau đó ghi log một lần.",
    ],
    rules: ["Bật/tắt trong Cài đặt (mặc định bật).", "Đã điểm danh trong ngày thì không làm lại."],
  },
  {
    id: "bag",
    icon: "🎒",
    name: "Thùng đồ",
    tone: "blue",
    summary: "Xem túi đồ theo thời gian thực, dùng/vứt/bán vật phẩm bằng menu chuột phải.",
    logic: [
      "Hiển thị túi đồ dưới dạng tab cố định (không popup che màn hình), cập nhật qua WebSocket khi server đổi túi.",
      "Menu chuột phải trên ô vật phẩm: dùng, vứt, bán, gửi kho… tuỳ loại vật phẩm.",
    ],
    rules: ["Thao tác không hoàn tác (vứt, bán) cần xác nhận trước khi gửi.", "Tên vật phẩm lấy từ bảng dữ liệu của game."],
  },
  {
    id: "autorules",
    icon: "🧰",
    name: "Quy tắc đồ tự động",
    tone: "violet",
    summary: "Tự mở, tự hợp, phân giải, đóng góp, vứt và bán vật phẩm theo danh sách của từng tài khoản.",
    logic: [
      "Mỗi tài khoản có các danh sách riêng: tự mở, tự bán, tự hợp, phân giải, đóng góp, vứt bỏ, ngoại lệ.",
      "Khi túi đồ thay đổi, bot quét và xử lý các vật phẩm khớp danh sách theo thứ tự an toàn.",
      "Tự mở dùng đúng gói dùng vật phẩm của game (tương tự dùng tay).",
    ],
    rules: ["Vật phẩm trong danh sách ngoại lệ không bao giờ bị vứt/bán.", "Danh sách lưu theo từng tài khoản, không chia sẻ chéo."],
  },
  {
    id: "bank",
    icon: "🏦",
    name: "Tiền Trang",
    tone: "amber",
    summary: "Xem kho Tiền Trang, gửi/rút vật phẩm và tiền.",
    logic: [
      "Nút “Vào Tiền Trang Vật Phẩm” sẽ warp/mở kho; tab Kho chỉ xem dữ liệu đã nhận.",
      "Gửi/rút thực hiện qua gói kho chuyên dụng sau khi kho đã mở.",
    ],
    rules: ["Kho chưa mở thì chặn gửi/rút để tránh bị server từ chối.", "Túi đồ thường và Tiền Trang là hai nguồn dữ liệu tách biệt."],
  },
  {
    id: "battle",
    icon: "⚔️",
    name: "Trận đấu tự động",
    tone: "rose",
    summary: "Theo dõi và tự điều khiển trận đấu theo lượt ngay trên web.",
    logic: [
      "Hiển thị đội hình hai bên, HP/SP và log lượt theo thời gian thực.",
      "Phân tích toàn bộ action blocks trong gói 32/01, ghi nhận chính xác 100% combo nhiều thành viên/pet cùng lúc kèm toạ độ và sát thương chi tiết.",
      "Tự đánh theo kỹ năng đã chọn, có chế độ tự bỏ chạy và giới hạn số lượt.",
    ],
    rules: [
      "Chỉ ra lệnh cho đơn vị của chính tài khoản mình (không điều khiển thú của người khác).",
      "Gom và hiển thị đầy đủ tất cả thành viên tham gia combo theo đúng mục tiêu.",
      "Trận đấu là tab cố định, không phải popup.",
    ],
  },
  {
    id: "general",
    icon: "🐎",
    name: "Võ tướng & Pet",
    tone: "green",
    summary: "Quản lý võ tướng, thú cưng xuất chiến.",
    logic: ["Xem danh sách võ tướng/pet, chọn pet xuất chiến và theo dõi trạng thái.", "Tích hợp vào tab cố định cùng Thùng đồ và Trận đấu."],
    rules: ["Chỉ thao tác trên pet/võ tướng của tài khoản đang chọn."],
  },
  {
    id: "warp",
    icon: "🗺️",
    name: "Warp Map & Đến Chỗ An Toàn",
    tone: "cyan",
    summary: "Chuyển nhanh giữa các map, 41 cổng thành, di chuyển đến chỗ an toàn gần cổng để lập đội và bật/tắt tự động di chuyển.",
    logic: [
      "Chọn map đích để bot đi tới bằng gói chuyển map phù hợp, chờ xác nhận tới nơi rồi mới làm bước tiếp.",
      "Truyền tống cổng thành dùng để về thành nhanh trước khi tạo phòng, mở kho…",
      "Nút “Đến Chỗ An Toàn”: Tự động tìm cổng vào của map hiện tại và di chuyển đến vị trí cách cổng 55px (không dẫm qua cổng) để đứng chờ/lập đội không bị quái quấy nhiễu kéo vào trận.",
      "Nút Bật/Tắt Tự Động Di Chuyển: tự động neo tọa độ gốc, tuần tra jiggle walk 35px kích hoạt va chạm và truy kích quái.",
    ],
    rules: [
      "Khi bấm “Đến Chỗ An Toàn”: Nếu là Chủ PT (đội đang có người) thì tất cả thành viên không rời đội và tự động đi theo chủ PT đến cổng.",
      "Nếu Thành viên trong đội bấm “Đến Chỗ An Toàn”: Hệ thống sẽ chặn lại và báo lỗi “Ní đang trong tổ đội, không được phép chạy lung tung!!!”.",
      "Map thường chưa chắc warp trực tiếp được; bot dùng đường cổng thành khi cần.",
      "Có độ trễ an toàn sau khi đến map để tránh rớt kết nối.",
      "Tự động dừng di chuyển khi đang trong trận đấu.",
    ],
  },
  {
    id: "channel",
    icon: "📡",
    name: "Xem & Đổi Kênh Map",
    tone: "cyan",
    summary: "Hiển thị kênh nhân vật đang đứng, danh sách kênh của map và trạng thái (trống, đông, đầy), cho phép đổi kênh nhanh.",
    logic: [
      "Hiển thị kênh hiện tại của nhân vật được bóc tách chuẩn xác từ gói đồng bộ map (0c/00 byte 25..26) từ máy chủ.",
      "Truy vấn danh sách kênh trực tiếp từ máy chủ qua gói 07/01 00 kèm số lượng người chơi thời gian thực (cur/max).",
      "Tự động tính toán trạng thái 3 mức tải: Còn Trống (<60%, Xanh lá), Đang đông (60-89%, Vàng), Đầy (≥90%, Đỏ).",
      "Chuyển kênh bằng gói chuẩn 07/02 00 <wireCh_u16> (11 bytes) kèm đồng bộ vị trí 0c/01 00; thông báo lỗi nếu server từ chối hoặc kênh đầy.",
    ],
    rules: [
      "Không thể chuyển sang chính kênh nhân vật đang đứng.",
      "Kênh báo đầy sẽ bị khoá và cảnh báo nếu người chơi bấm lại.",
      "Có nút Làm Mới 🔄 để cập nhật danh sách và tải kênh tức thì từ máy chủ.",
      "Map phó bản không hỗ trợ đổi kênh.",
    ],
  },
  {
    id: "train",
    icon: "🎯",
    name: "Bãi train & Truy kích NPC",
    tone: "rose",
    summary: "Treo cày tại bãi train và đuổi theo NPC để vào trận.",
    logic: [
      "Cấu hình điểm train hoặc kích hoạt nhanh bằng nút Tự động di chuyển ở trang Thông tin chung.",
      "Truy kích NPC: đi tới gần và double-click đúng NPC mục tiêu; tuần tra có xử lý va chạm.",
      "Tự động quay về tâm bãi train (Auto-return) sau khi kết thúc trận đấu.",
    ],
    rules: ["Cấu hình riêng cho từng tài khoản (Multi-account isolation).", "Đứng yên/kẹt sẽ được phát hiện và thử lại."],
  },
  {
    id: "dijie",
    icon: "🌀",
    name: "Dị giới",
    tone: "violet",
    summary: "Vào và xử lý nội dung Dị giới theo lựa chọn.",
    logic: ["Chọn cấp/loại Dị giới trong popup rồi bot tự vào.", "Theo dõi trạng thái ngay trên thẻ Hành động."],
    rules: ["Tuân theo giới hạn lượt/ngày của server."],
  },
  {
    id: "rewards",
    icon: "🎁",
    name: "Quà online, Thư & Exp offline",
    tone: "green",
    summary: "Nhận quà online, đọc thư và nhận exp offline.",
    logic: ["Tự nhận quà online khi đủ điều kiện.", "Đọc/nhận đính kèm trong thư và nhận Exp offline bằng gói chính thức của game."],
    rules: ["Một số phần (Xu/Vàng, nghỉ pet) tuỳ thuộc dữ liệu server cung cấp."],
  },
  {
    id: "party",
    icon: "👥",
    name: "Đội ngũ (Party)",
    tone: "blue",
    summary: "Lập đội giữa các tài khoản trên web: mời, nhận, rời đội.",
    logic: [
      "Chủ đội mời thành viên bằng tên; thành viên tự chấp nhận lời mời.",
      "Khi warp/di chuyển, các tài khoản trong đội đồng bộ theo chủ đội.",
      "Tự động bỏ chạy khi chưa đủ đội ngũ (Cấu hình chung / Tính năng khác): nếu chủ PT còn thiếu thành viên hoặc thành viên chưa join vào team mà vào trận, cả nhân vật và võ tướng tự động bỏ chạy (Ưu tiên Bậc 2); chỉ khi đủ 100% thành viên có nhập tên mới đánh bình thường.",
    ],
    rules: ["Chỉ ghép các tài khoản của bạn đang online.", "Rời đội sẽ rời cả phó bản đang chạy.", "Ô thành viên để trống không tính vào danh sách cần chờ."],
  },
  {
    id: "dungeon",
    icon: "🏰",
    name: "Phó bản đội",
    tone: "rose",
    summary: "Chủ PT tự chạy phó bản đội; thành viên chỉ cần Tìm Đội.",
    logic: [
      "Chủ PT có 3 nút: Tạo (warp về cổng thành rồi tạo phòng), Bắt Đầu, Hủy. Thành viên bấm “Tìm Đội” để tự vào đúng phòng theo tên chủ PT và tự sẵn sàng.",
      "Sau khi vào phó bản, chỉ chủ PT di chuyển, nói chuyện NPC và đánh; thành viên đi theo cùng đội và vẫn được tính hoàn thành.",
      "Hỗ trợ Thảo phạt Thiên Sứ (khăn vàng) và Ngày Tàn Hoạn Quan, chạy tuần tự theo từng chặng đến boss cuối.",
    ],
    rules: [
      "Nếu nhập tên thành viên thì chờ đủ người mới cho Bắt Đầu; ô nào để trống thì cho phép đi solo.",
      "Thành viên rớt kết nối thì chủ PT tạm dừng chờ.",
      "Hết lượt trong ngày thì báo “đã hoàn tất hôm nay, mai quay lại”.",
      "Có nút Thoát phó bản để rời bất cứ lúc nào.",
    ],
  },
  {
    id: "dungeon_solo",
    icon: "⚔️",
    name: "Phó bản đơn",
    tone: "green",
    summary: "Tự động hoàn thành cả 3 loại phó bản đơn hàng ngày: Khiêu chiến Ba Đậu Yêu, Săn Kho Báu, Tìm Đậu Đậu.",
    logic: [
      "Hỗ trợ đầy đủ cả 3 loại phó bản đơn với 4 mốc cấp độ (15-80, 81-150, 151-200, 201-400), tự động nhận diện theo cấp nhân vật.",
      "Chế độ chạy chuỗi cả 3 loại (Daily Runner): Tự động đi tuần tự Khiêu chiến Ba Đậu Yêu ➜ Săn Kho Báu ➜ Tìm Đậu Đậu.",
      "Tự động rời đội trước khi vào, warp về map an toàn (Trác Quận 12001), tạo phòng, đồng bộ gói sẵn sàng (41/01), xử lý kết thúc trận (0b/00) và thực thi trọn vẹn kịch bản mở rương / khiêu chiến Đậu Đậu / đánh boss.",
    ],
    rules: [
      "Phó bản đơn chỉ áp dụng cho cá nhân, tự động rời đội trước khi tạo phòng.",
      "Mỗi loại phó bản chỉ đi được 1 lần/ngày; nếu đã hoàn thành hoặc hết lượt bot sẽ thông báo và tự động bỏ qua để chuyển sang loại kế tiếp trong chuỗi.",
      "Tự động thống kê lượng EXP thưởng và thời gian vượt ải cho cả nhân vật và võ tướng xuất chiến.",
      "Có nút Thoát phó bản để rời map về an toàn bất cứ lúc nào.",
    ],
  },
  {
    id: "scripts",
    icon: "📜",
    name: "Kịch bản",
    tone: "amber",
    summary: "Chạy và tự soạn kịch bản tự động bằng lệnh DSL.",
    logic: ["Chọn kịch bản có sẵn hoặc soạn mới trong trình dựng, chạy theo từng bước với log chi tiết.", "Hỗ trợ lệnh di chuyển, click NPC, warp, đánh, chờ…"],
    rules: ["Kịch bản chạy trên tài khoản đang chọn và dừng khi mất kết nối."],
  },
  {
    id: "hpsp",
    icon: "💊",
    name: "Mua/Bán & Tự dùng HP/SP",
    tone: "green",
    summary: "Mua bán thuốc HP/SP và tự dùng khi thấp.",
    logic: ["Mua/bán vật phẩm HP/SP tại NPC theo số lượng chọn.", "Tự dùng khi HP/SP xuống dưới ngưỡng đã đặt."],
    rules: ["Ngưỡng và số lượng cấu hình riêng cho từng tài khoản."],
  },
  {
    id: "events",
    icon: "📋",
    name: "Sự kiện & Nhật ký",
    tone: "cyan",
    summary: "Log game theo thời gian thực, đồng hồ giờ Đài Loan.",
    logic: ["Tab Sự kiện hiển thị log có tô màu theo loại (sát thương, kỹ năng, hệ thống…).", "Đồng hồ theo giờ server Đài Loan để canh sự kiện."],
    rules: ["Log chỉ giữ một lượng gần nhất để giao diện luôn mượt."],
  },
];

type TabKey = "console" | "scripts" | "train" | "settings";

/** Cây điều hướng: tab lớn → tab con → tính năng (id trong FEATURES). Khớp với App.tsx / Home.tsx / ScriptsHub.tsx. */
const TREE: { tab: TabKey; icon: string; name: string; subs: { icon: string; name: string; ids: string[]; scriptsSub?: string }[] }[] = [
  {
    tab: "console", icon: "🎮", name: "Điều khiển",
    subs: [
      { icon: "📋", name: "Thông tin Chung", ids: ["login", "daily", "channel", "warp", "dijie", "rewards", "party", "events"] },
      { icon: "⚙️", name: "Cấu hình Chung", ids: ["autorules", "hpsp"] },
      { icon: "🎒", name: "Thùng Đồ", ids: ["bag", "bank"] },
      { icon: "🐾", name: "Võ Tướng", ids: ["general"] },
      { icon: "⚔️", name: "Trận Đấu", ids: ["battle"] },
    ],
  },
  {
    tab: "scripts", icon: "📜", name: "Kịch bản",
    subs: [
      { icon: "📜", name: "Kịch bản / Tạo kịch bản", ids: ["scripts"], scriptsSub: "runner" },
      { icon: "🏰", name: "Phó bản đội", ids: ["dungeon"], scriptsSub: "dungeon" },
    ],
  },
  { tab: "train", icon: "🎯", name: "Bãi Train", subs: [{ icon: "🎯", name: "Bãi train & Truy kích", ids: ["train"] }] },
];

function FeatureModal({ f, path, onGo, onClose }: { f: Feature; path: string; onGo: () => void; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="modal-back" onClick={onClose}>
      <div className={`card modal wide ov-modal tone-${f.tone}`} role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="mhead">
          <h2>
            <span className="ov-ico">{f.icon}</span> {f.name}
          </h2>
          <span className="sp" />
          <button onClick={onClose} aria-label="Đóng">✕</button>
        </div>
        <div className="ov-modal-body">
          <p className="ov-sum"><span className="chip">{path}</span> {f.summary}</p>
          <h3>Logic hoạt động</h3>
          <ul>{f.logic.map((t, i) => <li key={i}>{t}</li>)}</ul>
          <h3>Ràng buộc</h3>
          <ul>{f.rules.map((t, i) => <li key={i}>{t}</li>)}</ul>
          <div><button className="primary" onClick={onGo}>Mở tab này →</button></div>
        </div>
      </div>
    </div>
  );
}

export function Overview({ onStart, onGo }: { onStart: () => void; onGo?: (tab: TabKey) => void }) {
  const [open, setOpen] = useState<{ f: Feature; path: string; tab: TabKey; scriptsSub?: string } | null>(null);
  const byId = new Map(FEATURES.map((f) => [f.id, f]));
  const go = (tab: TabKey, scriptsSub?: string) => {
    if (scriptsSub) { try { localStorage.setItem("scripts.activeSubTab", scriptsSub); } catch { /* bỏ qua */ } }
    if (onGo) onGo(tab); else onStart();
  };
  return (
    <div className="overview">
      <section className="hero card">
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <img src="/badau-demon.png" alt="Ba Đậu Yêu Ác Ma" style={{ width: 56, height: 56, objectFit: "contain", filter: "drop-shadow(0 4px 10px rgba(0,0,0,.35))" }} />
          <div>
            <h1 style={{ margin: 0 }}>TS Bot Web</h1>
            <p style={{ margin: "4px 0 0" }}>Bot web đa tài khoản cho TS Online. Tính năng được nhóm theo tab; chọn một tính năng để xem cách hoạt động và các ràng buộc.</p>
          </div>
        </div>
        <button className="primary cta" onClick={onStart} style={{ marginTop: 14 }}>Vào bảng Điều khiển →</button>
      </section>
      <section className="ov-tree">
        {TREE.map((g) => (
          <div key={g.tab} className="ov-group card">
            <button className="ov-ghead" onClick={() => go(g.tab)} title="Mở tab này">
              <span className="ov-ico">{g.icon}</span> {g.name} <span className="ov-go">Mở tab →</span>
            </button>
            {g.subs.map((sub) => (
              <div key={sub.name} className="ov-sub">
                <div className="ov-slabel"><span>{sub.icon}</span> {sub.name}</div>
                <div className="ov-feats">
                  {sub.ids.map((id) => {
                    const f = byId.get(id);
                    if (!f) return null;
                    return (
                      <button key={id} className={`ov-btn tone-${f.tone}`} title={f.summary}
                        onClick={() => setOpen({ f, path: `${g.name} › ${sub.name}`, tab: g.tab, scriptsSub: sub.scriptsSub })}>
                        <span className="ov-ico">{f.icon}</span>
                        <span className="ov-name">{f.name}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        ))}
      </section>
      {open && (
        <FeatureModal f={open.f} path={open.path} onClose={() => setOpen(null)}
          onGo={() => { const o = open; setOpen(null); go(o.tab, o.scriptsSub); }} />
      )}
    </div>
  );
}
