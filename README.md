# จัดแจง

เว็บไซต์จัดการ PDF ภาษาไทยแบบ Privacy-first สำหรับรวมไฟล์ แยกหน้า บีบอัด แปลงไฟล์ และเรียงหรือลบหน้า พร้อม Quick Preview ก่อนดาวน์โหลด

ไฟล์ของผู้ใช้ถูกประมวลผลใน Browser ด้วย `pdf-lib`, `pdfjs-dist` และ `JSZip` โดยไม่มีการอัปโหลดเอกสารไปยัง Server

## เริ่มพัฒนา

ต้องใช้ Node.js `>=22.13.0`

```bash
npm install
npm run dev
```

จากนั้นเปิด URL ที่แสดงใน Terminal โดยปกติคือ `http://localhost:3000`

## ตรวจสอบก่อนส่งงาน

```bash
npm run lint
npx tsc --noEmit
npm test
```

`npm test` จะ Build เว็บไซต์และทดสอบ PDF engine รวมถึง HTML และ Social Metadata

## โครงสร้างสำคัญ

- `app/page.tsx` — หน้าหลักและ Workflow ของ Tools/Quick Preview
- `app/globals.css` — Design system, Responsive layout และ Motion
- `app/lib/pdf-engine.ts` — ฟังก์ชันจัดการ PDF ที่แยกทดสอบได้
- `app/layout.tsx` — Font และ Metadata
- `public/tool-icons/` — Icon ของแต่ละเครื่องมือ
- `tests/` — ชุดทดสอบคุณภาพและผลลัพธ์
- `QUALITY_PLAN.md` — แผนพัฒนาคุณภาพแบบ Increment
- `CLAUDE.md` — บริบทและข้อกำหนดสำหรับ Claude Code

## หลักการที่ต้องรักษา

- เอกสารต้องไม่ออกจากอุปกรณ์ของผู้ใช้
- ต้องใช้งานได้ทั้ง Keyboard, Touch และ Mobile
- ต้องจัดการ Error และไฟล์ขนาดใหญ่อย่างชัดเจน
- ต้องตรวจจำนวนหน้าและความถูกต้องของผลลัพธ์ก่อนดาวน์โหลด
- ต้องรองรับ `prefers-reduced-motion`
- รักษาภาษาไทย ฟอนต์ Anuphan และบุคลิกของแบรนด์ “จัดแจง”

## Deployment

Deploy ขึ้น Cloudflare Workers ด้วย Wrangler

```bash
npx wrangler login
npm run deploy
```

`npx wrangler login` ทำครั้งเดียวต่อเครื่อง จากนั้น `npm run deploy` จะ Build ใหม่แล้วส่งขึ้นตาม Config ที่
`@cloudflare/vite-plugin` สร้างไว้ที่ `dist/server/wrangler.json` — Worker ชื่อ `jadjang` เสิร์ฟ Static asset
จาก `dist/client` ไม่ต้องผูก D1, R2 หรือ KV เพราะไฟล์ของผู้ใช้ไม่เคยออกจากเบราว์เซอร์

ตรวจ Artifact ก่อนส่งขึ้นจริงได้ด้วย

```bash
npm run build
npx wrangler deploy --config dist/server/wrangler.json --dry-run
npx wrangler dev --config dist/server/wrangler.json
```

`--dry-run` รายงานขนาดที่จะอัปโหลดโดยไม่ส่งจริงและไม่ต้อง Login ส่วน `wrangler dev` รัน Artifact ตัวเดียวกับที่จะ Deploy

`.openai/hosting.json` เหลือไว้จากตอน Deploy ผ่าน OpenAI Sites ตอนนี้ไม่มีผลกับ Build แล้ว
เก็บไว้เผื่อต้องกลับไปจัดการ Site เดิม และลบได้เมื่อไม่ต้องใช้

