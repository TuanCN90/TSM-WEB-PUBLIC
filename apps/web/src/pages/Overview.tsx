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
    summary: "Tự mở, tự hợp, phân giải, đóng góp, vứt và bán vật phẩm theo danh sách riêng biệt của từng tài khoản.",
    logic: [
      "Mỗi tài khoản có các danh sách riêng: tự mở, tự bán, tự hợp, phân giải, đóng góp, vứt bỏ, ngoại lệ.",
      "Khi túi đồ thay đổi, bot quét và xử lý các vật phẩm khớp danh sách theo thứ tự an toàn.",
      "Tự mở dùng đúng gói dùng vật phẩm của game (tương tự dùng tay).",
      "Tự hợp sử dụng gói 17/0e (25 bytes) chuẩn wire protocol theo capture thực tế: hỗ trợ hợp 1x1 cùng ô, cùng loại khác ô, hoặc ghép cặp danh sách; nhận kết quả qua gói 17/0d.",
      "Khi BẬT tự hợp: Hợp liên tục các vật phẩm trong danh sách đến khi hết nguyên liệu, full thùng đồ hoặc lỗi tối đa 3 lần.",
      "Khi TẮT tự hợp: Nếu không đủ item trong danh sách thì không xử lý gì cả; nếu vẫn còn item trong thùng đồ thì mỗi ngày tự động hợp đúng 1 lần duy nhất để hoàn tất nhiệm vụ hàng ngày (Checklist Daily).",
      "Ghi nhớ cờ đã hợp trong ngày (lastCombinedDate) theo múi giờ Đài Loan (UTC+8); khi relogin hoặc khởi động lại không bị làm mới hay hợp tiếp.",
    ],
    rules: [
      "Vật phẩm trong danh sách ngoại lệ không bao giờ bị vứt/bán.",
      "Danh sách và cờ hợp hàng ngày lưu độc lập theo từng tài khoản (canonicalKey), tuyệt đối không chia sẻ chéo.",
      "Mỗi lượt ghép chỉ tiêu tốn đúng số lượng vật phẩm yêu cầu và tự động đồng bộ số lượng túi đồ.",
    ],
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
    summary: "Theo dõi và tự điều khiển trận đấu theo lượt, tự chọn mục tiêu F1 thông minh và log chi tiết.",
    logic: [
      "Hiển thị đội hình hai bên, HP/SP và log lượt theo thời gian thực.",
      "Phân tích toàn bộ action blocks và đa mục tiêu trong gói 32/01, ghi nhận chính xác 100% combo (kể cả kết hợp đòn đơn Đấu Vật và AOE Loạn Kích/Hỏa Tiễn) mà không bị xé nhỏ log do sát thương lan.",
      "Ghi nhận chính xác 100% dòng thông báo EXP chính thức từ máy chủ (gói 02/0a) và cập nhật thuộc tính EXP tích luỹ (08/02, 08/0e) theo thời gian thực.",
      "Cơ chế F1 thông minh: tính toán tâm chấn để kỹ năng lan quét trúng tối đa quái còn sống (tâm cụm quái), đồng thời đồng bộ mục tiêu giữa toàn đội để đảm bảo tỷ lệ hợp kích cao nhất.",
      "Bộ kỹ năng võ tướng hiển thị đầy đủ cả 5 skill (3 gốc, 1 Mê, 1 VKCD); tự động khóa các skill chưa đủ điều kiện (chưa học Mê hoặc chưa đeo VKCD).",
      "Cơ chế phân lập vị trí tổ đội: mỗi thành viên chỉ ra lệnh cho nhân vật và võ tướng ở đúng cột (col = pCol) của mình trên lưới trận; loại bỏ hoàn toàn gói tin 41/01 thừa lúc vào trận (0b/fa); loại bỏ hoàn toàn lỗi ngắt kết nối máy chủ (kick mã 42) do thao tác nhầm.",
      "Tự động khôi phục cấu hình trận đấu: khi mất kết nối mạng hoặc server ngắt kết nối và bot tự reconnect thành công, toàn bộ cài đặt skill Char/Pet, 21 turn và danh sách auto vật phẩm được tự động nạp lại vào phiên mới, chống triệt để tình trạng rơi về Đấu Vật sau thời gian dài treo máy.",
      "Tự đánh theo kỹ năng đã chọn, có chế độ tự bỏ chạy và giới hạn số lượt.",
    ],
    rules: [
      "Chỉ ra lệnh cho đơn vị của chính tài khoản mình (không điều khiển thú của người khác hay vị trí cột 2 của chủ PT).",
      "Nếu thành viên không có võ tướng xuất chiến trong trận thì tuyệt đối không gửi lệnh võ tướng lên máy chủ.",
      "Gom và hiển thị đầy đủ tất cả thành viên tham gia combo và toàn bộ quái trúng chiêu lan.",
      "Cơ chế hợp nhất thông minh (smart merge): cập nhật tính năng phụ (như bật/tắt tự bỏ chạy) không làm mất hoặc reset kỹ năng nhân vật và võ tướng về mặc định.",
      "Tự động chuyển về Đấu Vật nếu kỹ năng võ tướng chọn chưa khả dụng hoặc thiếu SP.",
      "Trận đấu là tab cố định, không phải popup.",
    ],
  },
  {
    id: "general",
    icon: "🐎",
    name: "Võ tướng & Pet",
    tone: "green",
    summary: "Quản lý võ tướng, thú cưng xuất chiến và hệ thống 5 kỹ năng toàn diện (Gốc, Mê, VKCD).",
    logic: [
      "Xem danh sách võ tướng mang theo, chọn pet xuất chiến và theo dõi HP, SP, Exp, chỉ số thuộc tính thời gian thực.",
      "Hệ thống bộ kỹ năng toàn diện (lên tới 5 skill): 3 kỹ năng gốc từ Npc_C.dat, 1 kỹ năng học thêm từ Mê võ tướng/Reborn, và 1 kỹ năng đặc thù từ Vũ Khí Chuyên Dụng (VKCD).",
      "Tự động nhận diện trang bị VKCD và trạng thái học Mê từ gói 0f/08 để bật/tắt (enabled/disabled) kỹ năng tương ứng trong giao diện điều khiển trận đấu.",
    ],
    rules: [
      "Chỉ kích hoạt kỹ năng VKCD khi võ tướng đang thực sự trang bị Vũ Khí Chuyên Dụng tương ứng.",
      "Kỹ năng chưa học hoặc chưa đủ điều kiện sẽ hiển thị mờ kèm lý do và bị vô hiệu hóa chọn lệnh trong trận.",
      "Chỉ thao tác trên pet/võ tướng của tài khoản đang chọn.",
    ],
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
      "Nút Bật/Tắt Tự Động Di Chuyển: tách biệt hoàn toàn với truy kích, tự động neo tọa độ ban đầu, tuần tra bước 30px theo 8 hướng và luôn giới hạn trong phạm vi bán kính 150px quanh vị trí ban đầu.",
    ],
    rules: [
      "Khi bấm “Đến Chỗ An Toàn”: Nếu là Chủ PT (đội đang có người) thì tất cả thành viên không rời đội và tự động đi theo chủ PT đến cổng.",
      "Nếu Thành viên trong đội bấm “Đến Chỗ An Toàn”: Hệ thống sẽ chặn lại và báo lỗi “Ní đang trong tổ đội, không được phép chạy lung tung!!!”.",
      "Map thường chưa chắc warp trực tiếp được; bot dùng đường cổng thành khi cần.",
      "Có độ trễ an toàn sau khi đến map để tránh rớt kết nối.",
      "Tự động dừng di chuyển khi đang trong trận đấu hoặc khi là thành viên trong tổ đội.",
    ],
  },
  {
    id: "channel",
    icon: "📡",
    name: "Xem & Đổi Kênh Map",
    tone: "cyan",
    summary: "Tích hợp 1 nút Kênh duy nhất trực quan gọn gàng trên thanh công cụ map: hiển thị kênh hiện tại, bấm vào để mở/đóng danh sách và đổi kênh nhanh.",
    logic: [
      "Hiển thị kênh hiện tại của nhân vật được bóc tách chuẩn xác từ gói đồng bộ map (0c/00 byte 25..26) từ máy chủ.",
      "Truy vấn danh sách kênh trực tiếp từ máy chủ qua gói 07/01 00 kèm số lượng người chơi thời gian thực (cur/max).",
      "Tự động tính toán trạng thái 3 mức tải: Còn Trống (<60%, Xanh lá), Đang đông (60-89%, Vàng), Đầy (≥90%, Đỏ).",
      "Chuyển kênh bằng gói chuẩn 07/02 00 <wireCh_u16> (11 bytes) kèm đồng bộ vị trí 0c/01 00; thông báo lỗi nếu server từ chối hoặc kênh đầy.",
      "Tích hợp gộp nút Kênh: loại bỏ nhãn thừa, hợp nhất nhãn kênh hiện tại và nút đổi kênh thành 1 nút tương tác tiện lợi.",
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
      "Chặn hoàn toàn thành viên tự gửi gói di chuyển (06/01) hoặc tự nhấp đúp quái (14/01) khi đang trong tổ đội, máy chủ sẽ tự kéo thành viên theo chủ PT; ngăn chặn triệt để lỗi server ngắt kết nối đồng loạt (mã 42).",
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
    name: "Phó bản đơn (1-2 lượt & Mua lượt)",
    tone: "green",
    summary: "Tự động hoàn thành cả 3 loại phó bản đơn hàng ngày (1-2 lượt/ngày), hỗ trợ mua thêm lượt bằng Vàng/Xu và chạy 2 lần liên tục.",
    logic: [
      "Hỗ trợ đầy đủ cả 3 loại phó bản đơn với 4 mốc cấp độ (15-80, 81-150, 151-200, 201-400), tự động nhận diện theo cấp nhân vật.",
      "Chế độ chạy chuỗi cả 3 loại (Daily Runner): Tự động đi tuần tự Khiêu chiến Ba Đậu Yêu ➜ Săn Kho Báu ➜ Tìm Đậu Đậu.",
      "Hỗ trợ tùy chọn 1 lượt (mặc định) hoặc 2 lượt (chạy 2 lần 3 phó bản đơn); tự động tiếp tục vòng 2 sau khi hoàn thành vòng 1.",
      "Cơ chế tự động mua thêm lượt: khi hết lượt miễn phí (mã lỗi 4) hoặc chọn opt chạy 2 lượt, bot tự động gửi lệnh mua thêm lượt (gói 54/01 hỏi giá + 54/02 mua ưu đãi 0x000d với 10 Vàng/lượt) đúng theo mã phó bản và cấp nhân vật, sau đó tạo phòng đi tiếp.",
      "Tích hợp nút Mua Lượt phó bản 1-click thông minh trên giao diện: tự động mua đúng phó bản hoặc mua cả 3 phó bản đơn theo cấp nhân vật.",
      "Tự động rời đội trước khi vào, warp về map an toàn (Trác Quận 12001), tạo phòng, đồng bộ gói sẵn sàng (41/01), xử lý kết thúc trận (0b/00) và thực thi trọn vẹn kịch bản mở rương / khiêu chiến Đậu Đậu / đánh boss.",
    ],
    rules: [
      "Phó bản đơn chỉ áp dụng cho cá nhân, tự động rời đội trước khi tạo phòng.",
      "Tùy chọn 2 lượt sẽ chạy hết chuỗi 3 phó bản của vòng 1 rồi tự động lặp lại vòng 2.",
      "Tự động mua lượt yêu cầu nhân vật có đủ Vàng/Xu trong tài khoản.",
      "Tự động thống kê lượng EXP thưởng và thời gian vượt ải cho cả nhân vật và võ tướng xuất chiến.",
      "Có nút Thoát phó bản để rời map về an toàn bất cứ lúc nào.",
    ],
  },
  {
    id: "world_boss",
    icon: "🐉",
    name: "Săn Boss Thế Giới",
    tone: "amber",
    summary: "Tự động săn Boss Thế Giới (1-7 lượt): tự rời đội & bỏ qua tính năng đội ngũ, chuẩn hóa gói khiêu chiến NPC 45, tự ăn vé lượt 6-7, tự hồi sinh Quỷ Môn Quan (12007) và quay lại bãi train.",
    logic: [
      "Tự động rời đội nếu đang trong tổ đội (leave_party) và bỏ qua toàn bộ lời mời/lời xin/chốt chặn đội ngũ (Party) trong suốt quá trình săn Boss.",
      "Dịch chuyển về Thành Trác Quận (12001), đi bộ đến vị trí Boss (1910, 1190).",
      "Quét ăn HP/SP theo mốc cấu hình tự dùng HP/SP ngoài trận đấu.",
      "Chuẩn hóa chuỗi tương tác khiêu chiến Boss NPC 45 theo pcap: 20/02 (chuẩn bị) -> 14/01 (NPC 45) -> 14/09 (menu 30 / 0x1e) -> 14/06 (ready).",
      "Hỗ trợ cấu hình 1 đến 7 lượt đánh; tự động sử dụng Vé Khiêu Chiến Boss (Item 46629) cho lượt 6 và 7 nếu được bật.",
      "Nếu tử vong trong trận: tự động hồi sinh tại Quỷ Môn Quan (12007) qua NPC 1 Đại Phu và quay lại Thành Trác Quận tiếp tục.",
      "Sau khi hoàn tất: tự đổi lại võ tướng chính ban đầu, quay về bãi train cũ và cập nhật tiến độ Checklist Daily.",
    ],
    rules: [
      "Phân lập cấu hình 100% độc lập cho từng tài khoản (Rule 2).",
      "Tự động ngắt đồng bộ đội ngũ (mirrorWarp/gather) và bỏ qua rào cản tổ đội của thành viên/chủ PT khi đang săn Boss.",
      "Tự động bỏ qua nếu nhân vật đang bận hoặc đang trong trận đấu khác.",
    ],
  },
  {
    id: "daily_checklist",
    icon: "📋",
    name: "Checklist Daily (Nhiệm vụ ngày)",
    tone: "amber",
    summary: "Bảng theo dõi và đánh dấu 16 nhiệm vụ hàng ngày: Điểm danh, Quà online, Vận tiêu (3 sao), Phó bản đơn (2 sao), Phó bản đội, Boss Thế Giới... Tự động reset lúc 00:00 TW (UTC+8).",
    logic: [
      "Tự động reset toàn bộ 16 tiêu chí khi qua mốc thời gian 00:00:00 theo đồng hồ múi giờ Đài Loan (UTC+8).",
      "Tự động cập nhật tiến độ (sáng sao / đánh dấu hoàn tất) khi bot thực hiện: Điểm danh ngày, Quà Online, Phó bản đơn các vòng, Phó bản đội, Săn Boss Thế Giới.",
      "Hiển thị số sao sáng tương ứng với số lần hoàn thành (Vận tiêu 3 sao, 3 Phó bản đơn mỗi loại 2 sao).",
      "Người dùng có thể bấm trực tiếp vào từng mục để tick / chuyển đổi trạng thái thủ công bất cứ lúc nào.",
      "Lưu trữ dữ liệu độc lập theo từng tài khoản (canonicalKey) và nạp lại chính xác khi đăng nhập lại.",
    ],
    rules: [
      "Múi giờ reset chuẩn là giờ Đài Loan (UTC+8), khớp với mốc làm mới hàng ngày của server game.",
      "Phân lập 100% dữ liệu giữa các tài khoản, không chia sẻ hay ghi đè trạng thái của nhau (Rule 2).",
    ],
  },
  {
    id: "friend_gift",
    icon: "🎁",
    name: "Tặng & Nhận quà bạn bè",
    tone: "rose",
    summary: "Tặng quà thể lực cho tất cả bạn bè trong danh sách và nhận toàn bộ quà gửi lại (chuẩn gói 0e/12 & 0e/13). Tích hợp vào Checklist Daily.",
    logic: [
      "Tự động tải danh sách bạn bè và trạng thái quà từ máy chủ (gói 0e/05).",
      "Gửi tặng quà thể lực cho tất cả bạn bè bằng 1 thao tác duy nhất (gói 0e/12).",
      "Lắng nghe cập nhật trạng thái quà (gói 0e/0c) và tự động nhận tất cả quà bạn bè đã gửi (gói 0e/13).",
      "Tự động chạy sau khi đăng nhập (autoCheckin) hoặc bấm nút 1-click '🎁 Tặng & Nhận' trực tiếp trong bảng Checklist Daily.",
      "Tự động đánh dấu hoàn tất mục 'Tặng quà bạn' trong Checklist Daily của tài khoản.",
    ],
    rules: [
      "Quà tặng bạn bè là tính năng tương tác thể lực miễn phí, không tiêu tốn Vàng hay Xu của tài khoản.",
      "Phân lập danh sách bạn bè và tiến độ hoàn thành theo từng tài khoản độc lập (Rule 2).",
    ],
  },
  {
    id: "pull_hero",
    icon: "✨",
    name: "Rút Bí Cấp & Thẻ Tướng",
    tone: "violet",
    summary: "Rút 1 bí cấp võ tướng (item 45659, 9.000 Xu) và rút 1 thẻ tướng chiêu mộ (item 45660, 9.000 Xu). Tích hợp vào Checklist Daily.",
    logic: [
      "Gửi gói tin chuẩn 42/01 để rút bí cấp tướng (tiêu tốn 9.000 Xu, nhận bí cấp vào túi đồ).",
      "Gửi gói tin chuẩn 42/01 để rút thẻ tướng (tiêu tốn 9.000 Xu, chiêu mộ võ tướng).",
      "Có thể kích hoạt riêng lẻ từng loại hoặc kích hoạt combo cả 2 loại (tiêu tổng cộng 18.000 Xu).",
      "Sau khi rút thành công, tự động cập nhật tiến độ (đánh dấu hoàn tất) mục 'Rút 1 bí cấp tướng' và 'Rút 1 thẻ tướng' trong Checklist Daily.",
      "Hỗ trợ nút bấm 1-click trực tiếp trong thanh Thao tác nhanh (tab Thông tin Chung) và trong popup Checklist Daily.",
    ],
    rules: [
      "Mỗi lần rút tiêu tốn đúng 9.000 Xu theo cơ chế máy chủ game, tuyệt đối không tiêu tốn Vàng.",
      "Phân lập tiến độ và tài chính độc lập theo từng tài khoản (Rule 2).",
    ],
  },
  {
    id: "escort",
    icon: "🐎",
    name: "Nhà Trọ & Vận Tiêu",
    tone: "green",
    summary: "Quản lý võ tướng trong Nhà Trọ Trác Quận (12007), tự động nhận quà khi hoàn tất và cử pet chỉ định đi Vận Tiêu tiếp tục (tối đa 3 lượt/ngày, 4h/lượt, quét 30 phút/lần). Tích hợp Checklist Daily.",
    logic: [
      "Tab 'Nhà Trọ & Vận Tiêu' trong mục Võ Tướng cho phép di chuyển đến Khách Sạn Trác Quận (map 12007), tương tác NPC mở Nhà Trọ và đồng bộ danh sách võ tướng (gói 1f/06).",
      "Giao diện hiển thị dropdownlist danh sách pet trong Nhà Trọ để người dùng chỉ định đúng pet cần vận tiêu.",
      "Tự động quét mỗi 30 phút & kiểm tra timer hoàn tất: khi chuyến vận tiêu kết thúc (sau 4h), hệ thống tự động gửi gói 56/05 nhận thưởng (vàng, exp, quà) và giải phóng võ tướng.",
      "Sau khi nhận thưởng, nếu vẫn còn lượt (<3 lượt/ngày), hệ thống tự động cử đúng pet đã chọn tiếp tục đi vận tiêu lượt tiếp theo (gói 56/02) theo chu kỳ loop.",
      "Nếu đã hoàn tất đủ 3/3 lượt trong ngày, hệ thống báo lỗi / dừng tiến trình và đánh dấu hoàn thành mục 'Vận tiêu' trong Checklist Daily.",
      "Theo dõi tiến độ 3 sao (★★★) hàng ngày theo counter máy chủ (id 8) và đếm ngược thời gian thực (4 tiếng/lượt).",
    ],
    rules: [
      "RÀNG BUỘC NGHIÊM NGẶT: Chỉ được phép cử DUY NHẤT võ tướng đã được chọn trong dropdownlist đi vận tiêu. Tuyệt đối không cho phép bất kỳ võ tướng nào khác đi vận tiêu.",
      "Mỗi ngày tối đa 3 lần vận tiêu, mỗi lần kéo dài đúng 4 giờ.",
      "Sau khi chuyến vận tiêu hoàn tất, bắt buộc phải nhận thưởng (56/05) thì võ tướng mới được giải phóng để tham gia lượt tiếp theo.",
      "Cấu hình pet chỉ định và trạng thái bật/tắt phân lập 100% giữa các tài khoản qua data/escort-configs.json (Rule 2).",
    ],
  },
  {
    id: "spin_lap_ba",
    icon: "🎰",
    name: "Quay Xu Lạp Bá",
    tone: "amber",
    summary: "Quay Xu Lạp Bá nhận EXP cho võ tướng slot 1 (tự động điều phối ngưng xuất chiến, nhận exp và xuất chiến lại). Tích hợp Checklist Daily.",
    logic: [
      "Kiểm tra trạng thái của võ tướng ở slot 1 (tướng đầu tiên mang theo):",
      "- Nếu võ tướng slot 1 đang xuất chiến: gửi gói 13/02 00 ngưng xuất chiến (server xác nhận 13/02 00) -> mở/quay Lạp Bá (4c/05, 54/01, 54/02) nhận exp -> sau khi quay xong gửi gói 13/01 xuất chiến lại.",
      "- Nếu võ tướng slot 1 đang nghỉ: gửi trực tiếp chuỗi mở/quay Lạp Bá (4c/05, 54/01, 54/02) nhận exp (không cần cho nghỉ và không xuất chiến lại).",
      "Gói quay 54/02 được chuẩn hóa chính xác theo wire protocol từ file capture thật (offer 0x0025, count 01, targetType 04, slot thực tế của pet, model võ tướng).",
      "Tự động kiểm tra túi đồ xem có vật phẩm 'Xu Lạp Bá' (ID 31207 / 32939) hay không trước khi thực hiện.",
      "Lắng nghe phản hồi 54/02 và 08/02 từ máy chủ: nếu thành công sẽ hiển thị chính xác lượng EXP nhận được: ✨ [Xu Lạp Bá] Võ tướng ... nhận được +... exp!",
      "Nếu máy chủ từ chối: hiển thị thông báo chi tiết lỗi sự kiện (Võ tướng Reborn 2 hoặc đạt giới hạn cấp độ).",
      "Sau khi hoàn tất quay (nhận được exp), tự động tích hoàn thành mục 'Xu lạp Bá' trong Checklist Daily.",
      "Hỗ trợ nút bấm 1-click '🎰 Quay Lạp Bá (Slot 1)' trực tiếp tại tab Võ Tướng và trong popup Checklist Daily.",
    ],
    rules: [
      "Hiện tại áp dụng cho slot võ tướng đầu tiên (slot 1), các slot khác coming soon.",
      "RÀNG BUỘC VÕ TƯỚNG: Võ tướng Tái sinh / Trùng sinh (Reborn 2) hoặc võ tướng đã đạt giới hạn đẳng cấp không thể quay Xu Lạp Bá (máy chủ sẽ từ chối giao dịch với mã lỗi).",
      "Nếu võ tướng slot 1 đang xuất chiến, bắt buộc phải cho về trạng thái nghỉ trước khi quay để máy chủ cộng exp hợp lệ, sau đó bot tự động xuất chiến lại 100% tự động.",
      "Phân lập tiến độ và trạng thái độc lập 100% theo từng tài khoản (Rule 2).",
    ],
  },
  {
    id: "daily_quest_reward",
    icon: "📜",
    name: "Quà Nhiệm Vụ Hàng Ngày",
    tone: "violet",
    summary: "Nhận full quà 9 nhiệm vụ ngày (gói 5b/02) và 4 rương điểm năng động tích luỹ (gói 5b/03). Tích hợp Checklist Daily.",
    logic: [
      "Gửi gói tin chuẩn 5b/02 (59 bytes) đồng bộ nhận toàn bộ 9 nhiệm vụ hàng ngày theo capture thật nhan qua nv hang ngay.pcap.",
      "Gửi các gói tin 5b/03 lần lượt mở 4 rương mốc tích luỹ điểm năng động ngày (mốc 2, 4, 6, 8 tương ứng 30, 60, 90, 120 điểm).",
      "Vật phẩm thưởng được máy chủ chuyển thẳng vào túi đồ (gói 17/08) kèm thông báo log game thời gian thực.",
      "Sau khi nhận hoàn tất, tự động đánh dấu hoàn thành mục 'Quà nhiệm vụ ngày' trong Checklist Daily.",
      "Hỗ trợ nút bấm 1-click '🎁 Nhận quà NV ngày' trực tiếp trong popup Checklist Daily.",
    ],
    rules: [
      "Chỉ mở được các rương mốc khi đã tích luỹ đủ điểm năng động từ các nhiệm vụ trong ngày.",
      "Phân lập tiến độ nhận quà 100% độc lập giữa các tài khoản (Rule 2).",
    ],
  },
  {
    id: "battle_pass_reward",
    icon: "🎫",
    name: "Quà Sổ Thông Hành",
    tone: "rose",
    summary: "Mở Sổ Thông Hành (Battle Pass), tự động nhận tất cả các mốc quà đã mở khóa theo điểm ngày và tự thu thập quà thư. Tích hợp Checklist Daily.",
    logic: [
      "Gửi gói 4d/0b 00 80 00 mở Sổ Thông Hành, máy chủ trả về tổng điểm tích luỹ và mốc quà tiếp theo có thể nhận.",
      "Tự động gửi chuỗi gói 4d/0b 00 81 <mã mốc LE> quét và nhận toàn bộ các mốc quà đã đạt điểm yêu cầu.",
      "Gửi tiếp gói 4d/0b 00 80 01 mở tab Thông Hành mở rộng.",
      "Tự động kích hoạt nhận thư (gói 53/01) thu thập toàn bộ vật phẩm đính kèm gửi về túi đồ.",
      "Sau khi nhận hoàn tất, tự động đánh dấu hoàn thành mục 'Quà Thông Hành' trong Checklist Daily.",
      "Hỗ trợ nút bấm 1-click '🎫 Nhận Thông Hành' trực tiếp trong popup Checklist Daily.",
    ],
    rules: [
      "Mỗi mốc quà chỉ nhận được khi tổng điểm tích luỹ thông hành trong ngày đạt điều kiện của mốc đó.",
      "Quà từ Thông Hành gửi về Hộp Thư sẽ được hệ thống gom tự động về túi đồ của tài khoản.",
      "Phân lập tiến độ độc lập 100% giữa các tài khoản (Rule 2).",
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
    summary: "Quy trình Bán trước Mua sau tại NPC Hương Dũng và tự dùng HP/SP.",
    logic: [
      "Quy trình 'Bán xong rồi mua' tự dịch chuyển đến NPC Thương nhân Hương Dũng (12701), đồng bộ danh sách bán tức thời và bán vật phẩm trong túi đồ trước khi mua HP/SP.",
      "Tự động dùng vật phẩm HP/SP trong túi đồ khi máu/SP nhân vật hoặc võ tướng xuống dưới ngưỡng đã đặt.",
      "Tự động về Tương Dương khi có slot gục ngã: khi có bất kỳ slot nào trong tổ đội (char hoặc pet) bị NPC đánh gục ngã trong trận, hết trận nếu Chủ PT bật tính năng thì teleport đưa cả team về Cửa thành Tương Dương (21001); nếu Chủ PT không bật mà Thành viên bật thì thành viên lập tức rời đội và teleport về Cửa thành Tương Dương để treo máy an toàn.",
      "Tự động Hồi Sinh đồng đội tử trận: trong trận đấu, nếu nhân vật đã lĩnh hội kỹ năng Hồi Sinh (11013) hệ Thủy và có bất kỳ slot đồng đội nào (char hoặc pet) bị NPC đánh gục ngã, lượt tiếp theo nhân vật sẽ ưu tiên dùng Hồi Sinh vào đúng vị trí đó bất kể thiết lập kỹ năng của lượt đó là gì; nếu chưa học skill hệ thống sẽ tự động vô hiệu hóa tính năng và cảnh báo 'Ní chưa lĩnh hội thần thông hồi sinh rồi'.",
    ],
    rules: [
      "Ngưỡng, số lượng, cờ tự động về Tương Dương và cờ Hồi Sinh cấu hình riêng biệt 100% cho từng tài khoản (canonicalKey).",
      "Nếu túi đồ không có vật phẩm khớp danh sách bán (hoặc chưa chọn món), bot thông báo rõ ràng ra bảng Sự kiện và chuyển sang bước mua HP/SP an toàn.",
      "Ở chế độ tổ đội: Chủ PT bật sẽ kéo cả đội về Tương Dương; Thành viên bật (khi Chủ PT không bật) sẽ tự động rời đội rồi teleport về Tương Dương.",
      "Tính năng Hồi Sinh yêu cầu nhân vật học skill Hồi Sinh (11013) hệ Thủy và còn đủ 40 SP; khi hết trận hoặc đồng đội đã sống lại (HP > 0), bot tự quay lại chu kỳ chiến thuật bình thường.",
    ],
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
      { icon: "📋", name: "Thông tin Chung", ids: ["login", "daily", "daily_checklist", "friend_gift", "pull_hero", "channel", "warp", "dijie", "rewards", "party", "events"] },
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
      { icon: "⚔️", name: "Phó bản đơn & Boss TG", ids: ["dungeon_solo", "world_boss"], scriptsSub: "dungeon-solo" },
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
