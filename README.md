# Smart Inventory — Refactored v2

## โครงสร้างไฟล์ (File Structure)

```
smart-inventory/
├── index.html          # Frontend (เดิม — ยังไม่ได้ refactor)
├── package.json
├── README.md
├── smartinventory.json  # สร้างเมื่อรัน server
├── image/               # ภาพที่อัพโหลด
├── backup/              # backup JSON ทุกชั่วโมง
└── src/
    ├── constants.js    # ค่าคงที่ เช่น PORT, ชื่อไฟล์, ID
    ├── utils.js         # pure functions ทั่วไป (format, sanitize, ฯลฯ)
    ├── store.js         # in-memory store + persistence + versioning
    ├── sessions.js      # user sessions, device profiles, presence
    ├── alerts.js        # review locks, alerts, user logs, rename flow
    ├── records.js       # record CRUD, image save
    ├── dashboard.js    # dashboard matching, import/export, Excel builder
    ├── export.js        # CSV/XLSX parsing, multipart form
    ├── routes.js        # ทุก HTTP handler (API routes)
    └── server.js        # entry point — สร้าง HTTP server + startup
```

## วิธีรัน (How to Run)

```bash
cd smart-inventory
npm install
npm start
```

เปิด browser ไปที่ `http://localhost:3000/receiver`

## API Endpoints (same as before)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/ping` | Health check |
| GET/POST | `/api/*` | ดูใน routes.js |

## Roles

- **Sender** — ส่งภาพ/สแกนเข้ามา
- **Receiver** — ตรวจสอบ เลือก OCR, ปิดงาน
- **Admin** — จัดการ users, export, clean database
- **Dashboard** — ดู summary + import Excel + match

## เปลี่ยนจาก monolithic อะไรบ้าง

- ไฟล์ 4111 บรรทัด → แบ่งเป็น 9 modules
- state (store, sessions, alerts) อยู่ใน module ละตัว
- routes.js import function ที่ต้องการเท่านั้น
- server.js สะอาดมาก — มีแค่ startup + listen
