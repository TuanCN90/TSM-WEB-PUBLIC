# 😈 TSM-WEB-PUBLIC — Hướng Dẫn Cài Đặt & Khắc Phục Lỗi Từ A-Z (Dành cho VPS Windows & PC)

> **TSM-WEB-PUBLIC** là phiên bản Web Bot điều khiển TS Online đa nền tảng (Node.js + React), chạy ngầm siêu nhẹ (~45MB RAM), kết nối TCP trực tiếp tới máy chủ game, an toàn 100% không qua server trung gian hay driver can thiệp kernel.

---

## 📋 Mục Lục
1. [Yêu Cầu Chuẩn Bị Trước Khi Cài](#1-yêu-cầu-chuẩn-bị-trước-khi-cài)
2. [Hướng Dẫn Cài Đặt Từng Bước Trên VPS Windows](#2-hướng-dẫn-cài-đặt-từng-bước-trên-vps-windows)
3. [Tổng Hợp Các Lỗi Thường Gặp & Cách Khắc Phục](#3-tổng-hợp-các-lỗi-thường-gặp--cách-khắc-phục)
4. [Cách Cập Nhật Khi Có Phiên Bản Mới](#4-cách-cập-nhật-khi-có-phiên-bản-mới)
5. [Các Lệnh PM2 Cần Nhớ](#5-các-lệnh-pm2-cần-nhớ)

---

## 1. Yêu Cầu Chuẩn Bị Trước Khi Cài
Trước khi gõ lệnh, hãy tải và cài đặt 2 phần mềm sau trên VPS (nếu chưa có):

1. **Node.js (Bản 20 LTS)**: 
   - Tải tại: [https://nodejs.org/](https://nodejs.org/) (Chọn ô màu xanh **LTS**).
   - Cài đặt: Mở file `.msi` vừa tải về, bấm **Next** liên tục đến khi hoàn tất.
2. **Git for Windows**:
   - Tải tại: [https://git-scm.com/download/win](https://git-scm.com/download/win) (Bản 64-bit Setup).
   - Cài đặt: Bấm **Next** liên tục đến khi hoàn tất.

> ⚠️ **LƯU Ý CỰC KỲ QUAN TRỌNG:** Sau khi cài đặt Node.js và Git xong, bạn **phải tắt hẳn cửa sổ Command Prompt (CMD) cũ đi và mở lại cửa sổ mới** thì máy tính mới nhận lệnh `node`, `npm` và `git`!

---

## 2. Hướng Dẫn Cài Đặt Từng Bước Trên VPS Windows

### Bước 1: Mở Command Prompt (CMD) với quyền Admin
- Bấm phím `Windows` trên bàn phím, gõ **cmd**.
- Chuột phải vào **Command Prompt** ➔ Chọn **Run as administrator**.

### Bước 2: Tạo thư mục chứa Bot trên ổ `C:\`
Dán lệnh sau vào CMD và bấm `Enter`:
```cmd
cd C:\
mkdir TS-Bot
cd C:\TS-Bot
```

### Bước 3: Tải mã nguồn về
Chạy lệnh sau (chú ý có **dấu cách và dấu chấm `.`** ở cuối câu):
```cmd
git clone https://github.com/TuanCN90/TSM-WEB-PUBLIC.git .
```

### Bước 4: Cài đặt thư viện & Đóng gói bản Production
```cmd
npm install
npm run build
```
*(Chờ khoảng 1-2 phút cho đến khi thấy dòng chữ xanh lá cây `✓ built in ...` là xong)*.

### Bước 5: Cài PM2 để Bot chạy ngầm vĩnh viễn 24/7
PM2 giúp bot tự chạy ngầm, kể cả khi bạn tắt cửa sổ Remote Desktop (RDP) đi ngủ hoặc VPS bị khởi động lại:
```cmd
npm install -g pm2
npm install -g pm2-windows-startup
pm2-startup install
```

### Bước 6: Khởi chạy Bot với PM2
```cmd
pm2 start start.js --name "tsm-web"
pm2 save
```
*(Bảng trạng thái hiện ra với cột `status` báo **`online`** màu xanh và RAM chiếm chỉ ~`45MB` là hoàn thành 100%)*.

### Bước 7: Mở tường lửa (Firewall) Windows để điện thoại truy cập được
- Bấm phím `Windows`, tìm **PowerShell** ➔ Chuột phải chọn **Run as administrator**.
- Dán lệnh sau vào:
```powershell
New-NetFirewallRule -DisplayName "TSM-Web" -Direction Inbound -LocalPort 8787 -Protocol TCP -Action Allow
```

---

## 🌐 Cách Truy Cập & Sử Dụng

- **Truy cập ngay trên VPS**: Mở Chrome / Edge trên VPS gõ `http://localhost:8787`
- **Truy cập từ điện thoại / Máy tính ở nhà**: Mở Safari / Chrome gõ `http://<IP_VPS_CUA_BAN>:8787`
  *(Ví dụ VPS của bạn có IP là `103.123.45.67` thì truy cập: `http://103.123.45.67:8787`)*.

---

## 3. Tổng Hợp Các Lỗi Thường Gặp & Cách Khắc Phục

### ❌ Lỗi 1: `'git' is not recognized as an internal or external command`
* **Nguyên nhân**: VPS chưa cài Git, hoặc mới cài Git xong nhưng chưa tắt cửa sổ CMD mở lại.
* **Cách khắc phục**:
  1. Tải và cài đặt Git tại: [https://git-scm.com/download/win](https://git-scm.com/download/win).
  2. Tắt cửa sổ CMD đi và mở lại cửa sổ CMD mới (Run as administrator).
  3. Hoặc nếu không muốn cài Git, bạn có thể vào GitHub bấm nút **`Code` ➔ `Download ZIP`**, sau đó giải nén toàn bộ vào `C:\TS-Bot`.

---

### ❌ Lỗi 2: `'npm' is not recognized as an internal or external command`
* **Nguyên nhân**: VPS chưa cài Node.js (công cụ `npm` nằm trong bộ cài của Node.js).
* **Cách khắc phục**:
  1. Tải và cài đặt Node.js bản **LTS** tại: [https://nodejs.org/](https://nodejs.org/).
  2. Tắt cửa sổ CMD đi và mở lại cửa sổ CMD mới (Run as administrator).
  3. Gõ `node -v` và `npm -v` thấy hiện số phiên bản là đã thành công.

---

### ❌ Lỗi 3: `npm error enoent Could not read package.json`
* **Nguyên nhân**: Bạn đang đứng ở thư mục trống chưa có code, hoặc khi gõ lệnh `git clone` quên gõ dấu chấm `.` ở cuối khiến code bị nằm trong thư mục con `TSM-WEB-PUBLIC`.
* **Cách khắc phục**:
  - Gõ `dir` xem trong thư mục đang có gì.
  - Nếu thấy thư mục `TSM-WEB-PUBLIC`, hãy gõ:
    ```cmd
    cd TSM-WEB-PUBLIC
    ```
  - Rồi mới chạy tiếp: `npm install` và `npm run build`.

---

### ❌ Lỗi 4: Tưởng `npm run build` bị đứng hoặc bị ngắt
* **Hiện tượng**: Chạy `npm run build` xong thấy hiện dòng `built in 1m` rồi nhả lại dấu nhắc `C:\...>` tưởng bị lỗi dừng.
* **Giải thích**: Đây **không phải là lỗi**! `npm run build` là lệnh đóng gói web, khi hiện chữ `built in ...` là đã đóng gói thành công 100%. Bạn chỉ việc gõ tiếp lệnh kế tiếp.

---

### ❌ Lỗi 5: PM2 báo `[ERROR] Script not found` hoặc `spawn EINVAL`
* **Nguyên nhân**: Trên Windows, PM2 không hỗ trợ chạy trực tiếp chuỗi lệnh trong ngoặc kép hoặc file `.bat` thô nếu không qua shell.
* **Cách khắc phục**:
  - Luôn khởi chạy bot thông qua file **`start.js`** được thiết kế riêng cho Windows:
    ```cmd
    pm2 delete tsm-web
    pm2 start start.js --name "tsm-web"
    pm2 save
    ```

---

### ❌ Lỗi 6: Không truy cập được web từ điện thoại hoặc máy tính ở nhà
* **Nguyên nhân**: Tường lửa (Firewall) của Windows hoặc nhà cung cấp VPS đang chặn cổng `8787`.
* **Cách khắc phục**:
  1. Mở PowerShell (Admin) chạy lệnh mở cổng:
     ```powershell
     New-NetFirewallRule -DisplayName "TSM-Web" -Direction Inbound -LocalPort 8787 -Protocol TCP -Action Allow
     ```
  2. Nếu dùng VPS của các bên như AWS, Azure, Google Cloud, Oracle Cloud, hãy vào trang quản trị web của họ (Security Group / Inbound Rules) mở thêm cổng TCP `8787`.

---

## 4. Cách Cập Nhật Khi Có Phiên Bản Mới

Khi repo có tính năng mới cập nhật, bạn không cần cài lại từ đầu, chỉ cần mở CMD tại thư mục bot và chạy:
```cmd
cd C:\TS-Bot\TSM-WEB-PUBLIC
git pull
npm run build
pm2 restart tsm-web
```

---

## 5. Các Lệnh PM2 Cần Nhớ

- **Xem trạng thái bot**: `pm2 status`
- **Xem nhật ký hoạt động / log lỗi thời gian thực**: `pm2 logs tsm-web`
- **Khởi động lại bot**: `pm2 restart tsm-web`
- **Tạm dừng bot**: `pm2 stop tsm-web`
- **Xóa bot khỏi danh sách PM2**: `pm2 delete tsm-web`
