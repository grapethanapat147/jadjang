# จัดแจง — Incremental Quality Plan

เว็บไซต์นี้ใช้แนวทาง local-first: ไฟล์ PDF, JPG และ PNG ถูกอ่านและประมวลผลใน browser โดยไม่ส่งไฟล์ขึ้น server

## กลุ่มผู้ใช้หลัก

- นักเรียนและนักศึกษาที่ต้องรวม บีบอัด หรือจัดเอกสารก่อนส่ง
- ครูและบุคลากรการศึกษาที่จัดชุดเอกสารและไฟล์สแกน
- ทีมธุรการและ SME ที่ต้องเตรียมเอกสารทั่วไปโดยไม่ต้องอัปโหลดข้อมูลไปบริการภายนอก

## Weekly increments

### Week 1 — Upload & Guardrails

- รองรับ PDF, JPG และ PNG
- จำกัด 24 ไฟล์, 150 MB และ 250 หน้าต่อครั้ง
- ทดสอบไฟล์ผิดชนิด ไฟล์เสีย PDF เข้ารหัส และการยกเลิกระหว่างอ่านไฟล์
- Quality gate: error message ระบุวิธีแก้และไม่มี partial output หลุดออกมา

### Week 2 — Core PDF

- รวมไฟล์ เรียงหน้า หมุน ลบ และแยกหน้า
- ตรวจจำนวนหน้าและลำดับด้วยการเปิดไฟล์ผลลัพธ์ซ้ำ
- Quality gate: จำนวนหน้า ลำดับ ขนาดกระดาษ และ rotation ตรงกับ Preview

### Week 3 — Compression, Conversion & Mobile

- บีบอัดแบบ raster 3 ระดับ พร้อมคำเตือนว่า text layer จะถูก flatten
- PDF เป็น JPG/PNG และรูปเป็น PDF
- ทดสอบ touch target, viewport 360–430 px, memory pressure และการเปลี่ยน orientation
- Quality gate: อ่านตัวอักษรได้ครบ ภาพไม่ถูกตัด และผลลัพธ์ดาวน์โหลดได้บน iOS/Android

### Week 4 — Security, Scale & Recovery

- ทดสอบ 80–250 หน้าและไฟล์รวม 40–150 MB
- ตรวจการ revoke object URL, ล้าง workspace และไม่บันทึกชื่อ/เนื้อหาไฟล์
- ทดสอบไฟล์ malformed และทรัพยากรไม่พอโดยไม่ทำให้หน้าเว็บค้างถาวร
- Quality gate: ไม่มีไฟล์ถูกส่งออกนอกอุปกรณ์และผู้ใช้เริ่มใหม่ได้หลัง error

## Definition of Done ต่อ Increment

1. Build และ automated tests ผ่าน
2. Output PDF เปิดอ่านได้และจำนวนหน้าถูกต้อง
3. Error state มี recovery path
4. Keyboard และ touch ใช้งาน flow หลักได้
5. ไม่เพิ่ม server-side file persistence โดยไม่แสดง consent และ retention policy
