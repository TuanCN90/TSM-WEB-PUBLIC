import { useEffect, useState } from "react";

const TZ = "Asia/Taipei"; // máy chủ game chạy theo giờ Đài Loan (GMT+8, không có giờ mùa hè)
const hms = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
const full = new Intl.DateTimeFormat("vi-VN", { timeZone: TZ, hour12: false, dateStyle: "full" });
const TIP = "Giờ máy chủ Đài Loan (GMT+8) — Chênh lệch +1h so với giờ Việt Nam";

/** Cờ Đài Loan vẽ bằng SVG (emoji cờ không hiện trên Windows). Nền đỏ, góc xanh với mặt trời trắng 12 tia. */
function TaiwanFlag() {
  return (
    <svg className="twflag" viewBox="0 0 30 20" width="20" height="14" role="img" aria-label="Đài Loan">
      <rect width="30" height="20" fill="#FE0000" />
      <rect width="15" height="10" fill="#000095" />
      {Array.from({ length: 12 }, (_, i) => (
        <polygon key={i} points="7.5,0.9 8.35,3.1 6.65,3.1" fill="#fff" transform={`rotate(${i * 30} 7.5 5)`} />
      ))}
      <circle cx="7.5" cy="5" r="2.35" fill="#fff" />
      <circle cx="7.5" cy="5" r="2.0" fill="#000095" />
      <circle cx="7.5" cy="5" r="1.7" fill="#fff" />
    </svg>
  );
}

/** Đồng hồ giờ Đài Loan dạng pill: chấm "live" + cờ + giờ, tooltip khi rê chuột. Chỉ để xem, không ảnh hưởng dữ liệu game. */
export function TaiwanClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  const time = hms.format(now);
  return (
    <span className="twclock" tabIndex={0} role="timer" aria-label={`${TIP}. Bây giờ ${time}`}>
      <i className="twdot" aria-hidden="true" />
      <TaiwanFlag />
      <span className="twtime">{time}</span>
      <span className="twtip" role="tooltip">{TIP}<small>{full.format(now)}</small></span>
    </span>
  );
}
