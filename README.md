# ระบบยืม-คืนอุปกรณ์ — ฐานข้อมูลกลางบน Netlify + GitHub

หน้าเว็บ (`public/index.html`) คุยกับ Netlify Function (`netlify/functions/data.mjs`) ที่ `/api/data`
ฟังก์ชันอ่าน/เขียนไฟล์ `data/db.json` ใน GitHub repo ทุกครั้งที่บันทึกจะเกิด 1 commit จึงมีประวัติย้อนหลังให้ดูได้

## ขั้นตอนติดตั้ง

1. **สร้าง repo เก็บข้อมูล (Private)** เช่น `equipment-loan-data` ติ๊ก "Add a README" ให้มี branch `main` ก่อน
   ใช้คนละ repo กับโค้ดเว็บ ไม่เช่นนั้นทุกครั้งที่บันทึกข้อมูล Netlify จะ build ใหม่
2. **สร้าง Fine-grained token** ที่ GitHub → Settings → Developer settings → Fine-grained tokens
   เลือกเฉพาะ repo ข้อมูล และตั้ง Permissions → Contents: **Read and write**
3. **อัปโหลดโฟลเดอร์นี้ขึ้น GitHub** (repo โค้ด) แล้วที่ Netlify เลือก Add new site → Import from Git
   ไม่ต้องตั้งค่า build เพิ่ม เพราะ `netlify.toml` กำหนดไว้แล้ว
4. **ตั้ง Environment variables** ที่ Netlify → Site configuration → Environment variables

   | ตัวแปร | ค่า |
   |---|---|
   | `GITHUB_TOKEN` | token จากข้อ 2 |
   | `GITHUB_OWNER` | ชื่อบัญชีหรือองค์กร GitHub เจ้าของ repo ข้อมูล |
   | `GITHUB_REPO` | ชื่อ repo ข้อมูล |
   | `ACCESS_CODE` | รหัสผ่านที่ให้เจ้าหน้าที่ใช้เข้าเว็บ |
   | `GITHUB_BRANCH` | (ไม่บังคับ) ค่าเริ่มต้น `main` |
   | `GITHUB_PATH` | (ไม่บังคับ) ค่าเริ่มต้น `data/db.json` |

5. **Deploy ใหม่** (Deploys → Trigger deploy) แล้วเปิดเว็บ กรอกรหัสผ่าน
   ป้าย "ซิงก์แล้ว" มุมขวาบนแปลว่าเชื่อมต่อสำเร็จ

## ข้อมูลเดิม
ข้อมูลในไฟล์ `.html` เดิมไม่ได้ย้ายมาเอง ให้ Export JSON จากไฟล์เดิม แล้วกด Import บนเว็บใหม่หนึ่งครั้ง

## พฤติกรรมที่ควรรู้
- เปิดเว็บแล้วดึงข้อมูลล่าสุดทันที และเช็กใหม่ทุก 20 วินาที (และตอนกลับมาที่แท็บ)
- ถ้าสองคนบันทึกพร้อมกัน คนที่บันทึกทีหลังจะได้ข้อมูลล่าสุดและมีข้อความแจ้งให้ทำรายการซ้ำ
- ออฟไลน์ได้ ข้อมูลเก็บในเครื่องและส่งขึ้นเมื่อกลับมาออนไลน์ แต่ถ้าระหว่างนั้นมีคนอื่นบันทึกไปก่อน ข้อมูลฝั่งออฟไลน์จะถูกแทนที่ด้วยข้อมูลล่าสุด
- ข้อมูลมีชื่อผู้ป่วย/HN จึงควรใช้ repo แบบ Private และอย่าแจก `ACCESS_CODE` กว้างเกินจำเป็น
- ทดสอบในเครื่องได้ด้วย `npx netlify dev` (ใส่ตัวแปรในไฟล์ `.env`)
