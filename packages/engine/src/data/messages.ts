/**
 * Thông báo hiển thị ở tab "Sự kiện" — giọng vui vui, gọi người chơi là "Ní".
 * Để một chỗ cho thống nhất; `apps/web/src/components/GameLog.tsx` tô màu dựa trên các mẫu câu ở đây, sửa câu thì xem lại `kind()` ở đó.
 */
const nf = (n: number) => n.toLocaleString("vi-VN");
const s = (ms: number) => Math.round(ms / 100) / 10;

export const MSG = {
  // --- kết nối ---
  loggedIn: "Đăng nhập thành công rồi Ní ơi !!!",
  reconnected: "Kết nối lại được rồi Ní ơi, vào game tiếp nào !!!",
  loginFailed: (why: string) => `Đăng nhập không được rồi Ní ơi :(( (${why})`,
  cooldown: (sec: number) => `Ní chờ xíu nha, ${sec}s nữa mới đăng nhập lại được (server còn giữ phiên cũ)`,
  retryLogin: (n: number, total: number, sec: number) => `Server chưa cho Ní vào :(( thử lại lần ${n}/${total} sau ${sec}s nha`,
  dropped: (why: string) => `Ní bị ngắt kết nối rồi :(( (${why})`,
  reconnecting: (n: number, max: number, ms: number) => `Đang kéo Ní vào lại... lần ${n}/${max}, đợi ${s(ms)}s nha`,
  reconnectFailed: (n: number, why: string) => `Kéo Ní vào lại lần ${n} không được :(( (${why})`,
  gaveUp: (max: number) => `Kéo Ní vào lại ${max} lần vẫn không được, thôi dừng nha :((`,
  loggedOut: "Ní đã đăng xuất rồi, hẹn gặp lại nha !",
  // --- nhân vật ---
  exp: (who: string, gain: number | null, pct: number, cur?: number, max?: number) =>
    `${who} ${gain == null ? `đang ở ${pct.toFixed(2)}% exp` : `vừa nhận +${nf(gain)} exp ✨, giờ ở ${pct.toFixed(2)}%`}${cur != null && max != null ? ` (${nf(cur)}/${nf(max)})` : ""}`,
  levelUp: (who: string, lv: number) => `${who} lên cấp rồi Ní ơi !!! 🎉 Lv ${lv}`,
  xuUp: (d: number, total: number) => `Ní vừa nhận +${nf(d)} Xu 🪙 (giờ có ${nf(total)})`,
  xuDown: (d: number, total: number) => `Ní vừa tiêu ${nf(d)} Xu 🪙 (còn ${nf(total)})`,
  goldUp: (d: number, total: number) => `Ní vừa nhận +${nf(d)} Vàng 🥇 (giờ có ${nf(total)})`,
  goldDown: (d: number, total: number) => `Ní vừa tiêu ${nf(d)} Vàng 🥇 (còn ${nf(total)})`,
  mapChanged: (from: number, to: number) => `Ní đã sang map ${to} rồi (từ map ${from})`,
  // --- teleport ---
  teleported: (city: string, id: number) => `Ní đã dịch chuyển đến Cổng thành ${city} (${id}) rồi!`,
  teleportFailed: (code: number) => `Dịch chuyển không được rồi Ní ơi :(( (server từ chối, mã ${code})`,
  // --- Dị giới ---
  dijieAsking: (lv: string) => `Ní đang xin vào Dị giới ${lv}...`,
  /** Mã 2 = hết thời gian Dị giới hôm nay (đã xác nhận); mã khác chưa rõ nghĩa. */
  dijieRefused: (code: number) => code === 2
    ? "Ní bị Dị giới đuổi cổ rồi, mua thêm Dị giới phù để tiếp tục hoặc chờ ngày mai nha ní !!"
    : `Server không cho Ní vào Dị giới (mã ${code}) :(( Chưa rõ lý do, thử vào bằng client thật xem game báo gì`,
  dijieAlready: "Ní đang ở Dị giới rồi, chọn mốc thôi",
  /** Đang trong đội thì game không cho vào Dị giới ("Trong tổ đội, không thể vào!" — TextData). Chặn từ bot, không gửi gói. */
  dijieInParty: "Không thể kéo cả bầy zô Dị Giới được Ní ơi, giải tán đội đi !!!",
  dijieIn: (lv: string, old?: string) => `Ní đã vào Dị giới ${lv} rồi !!!${old ? ` (trước đó ${old})` : ""}`,
  // --- điểm danh ---
  checkinSending: (day: number) => `Ní đang điểm danh ngày ${day}...`,
  checkinOk: (day?: number, rewardText?: string) =>
    day != null && rewardText
      ? `Ní vừa điểm danh ngày ${day} thành công !!! Phần thưởng: ${rewardText} 🎉`
      : "Ní vừa điểm danh thành công !!! 🎉",
  checkinAlready: "Hôm nay Ní điểm danh rồi nha, mai quay lại điểm danh tiếp :)",
  checkinFailed: (code: number) => `Điểm danh không được rồi Ní ơi :(( (server từ chối, mã ${code})`,
  checkinStatus: (d: number, dMax: number, st: number, stMax: number) => `Ní đã điểm danh ${d}/${dMax} ngày, liên tiếp ${st}/${stMax} ngày`,
  checkinDay: (from: number, to: number, max: number) => `Số ngày điểm danh của Ní: ${from} → ${to}/${max} 📅`,
  checkinStreak: (from: number, to: number, max: number) => `Chuỗi điểm danh liên tiếp của Ní: ${from} → ${to}/${max} ngày 🔥`,
  // --- túi đồ ---
  gotItem: (name: string, qty: number, delta: number | null) =>
    delta == null ? `Ní nhận được ${name} 🎁 (trong túi có ${nf(qty)} cái)` : delta > 0 ? `Ní nhận được ${nf(delta)} cái ${name} 🎁 (trong túi có ${nf(qty)})` : `Ní vừa dùng ${nf(-delta)} cái ${name} (còn ${nf(qty)})`,
  // --- võ tướng xuất chiến ---
  petOut: (name: string) => `Võ tướng ${name} đã xuất chiến rồi Ní ơi ⚔️`,
  // --- Exp Offline ---
  offlineExpOk: (gain: number | null) => `Ní vừa nhận Exp Offline miễn phí${gain != null ? ` +${nf(gain)} exp` : ""} 🎁`,
  offlineExpFailed: (code: number) => `Nhận Exp Offline không được rồi Ní ơi :(( (server từ chối, mã ${code})`,
  offlineExpNoReply: "Nhận Exp Offline chưa thấy server trả lời Ní ơi :(( kiểm tra lại trong game xem sao nha",
  // --- quà online (57/02 loại 03) ---
  onlineRewardStart: (n: number) => `Ní đang nhận ${n} mốc quà Online đủ điều kiện... 🎁`,
  onlineRewardSending: (min: number) => `Ní đang nhận quà Online mốc ${min} phút... 🎁`,
  onlineRewardOk: (min: number) => `Ní vừa nhận thành công quà Online mốc ${min} phút !!! 🎉`,
  onlineRewardAlready: (min: number) => `Mốc ${min} phút: Ní đã nhận rồi nha !`,
  onlineRewardNotYet: (min: number, curMin: number) => `Mốc ${min} phút: Chưa đủ thời gian online (hiện có ${curMin}/${min} phút) nha Ní !`,
  onlineRewardFailed: (min: number, code: number) => `Nhận quà Online mốc ${min} phút không được rồi Ní ơi :(( (server từ chối, mã ${code})`,
  onlineRewardDone: (ok: number, total: number) => `Nhận quà Online xong rồi Ní: ${ok}/${total} mốc 🎁`,
  onlineRewardNone: "Chưa có mốc quà Online nào mới để nhận (đã nhận hết hoặc chưa đủ thời gian) nha Ní !",
  // --- Thư ---
  mailStart: (n: number) => `Ní đang nhận quà từ ${n} thư... 📬`,
  mailDone: (ok: number, total: number, failed: number) => `Nhận quà thư xong rồi Ní: ${ok}/${total} thư 📬${failed ? `, còn ${failed} thư chưa nhận được` : ""}`,
  mailBagFull: "Túi đồ đầy rồi Ní ơi, dọn bớt ô trống rồi nhận thư lại nha :((",
  mailNoReply: (title: string) => `Thư "${title}" chưa nhận được (túi đồ đầy hoặc server không trả lời) :((`,
  mailStopped: (why: string) => `Dừng nhận quà thư (${why})`,
  // --- Phó bản đội & Phó bản đơn ---
  /** Server từ chối tạo phòng mã 4 = hết lượt phó bản trong ngày (log thật: `2f/02 00 04`). */
  dungeonDailyDone: (name: string) => `Phó bản đội [${name}] Ní đã hoàn tất hôm nay rồi, mai quay lại nha Ní ơi.`,
  /** Server từ chối tạo phòng mã 4 = hết lượt phó bản đơn trong ngày. */
  dungeonSoloDailyDone: (name: string) => `Ní đã hoàn thành phó bản [${name}] này rồi, mua thêm lượt hoặc chờ ngày mai nha ní ơi!!!`,
};
