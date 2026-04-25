# แผนการพัฒนาระบบ Multi-AI Agent (Nexus-Agent System) แบบละเอียด

โครงการนี้ครอบคลุมระยะเวลา 12 สัปดาห์ แบ่งเป็นการพัฒนา 4 ระยะ (Phase) ตามสถาปัตยกรรมระบบที่ระบุไว้ในเอกสาร

## User Review Required
> [!IMPORTANT]
> โปรดตรวจสอบแผนการพัฒนาและลำดับความสำคัญของแต่ละสัปดาห์ หากแน่ใจแล้วเราสามารถเริ่มพัฒนาระบบทีละขั้นตอนไปด้วยกันได้

## Proposed Changes

### Phase 1: Foundation & Inference Layer (Week 1-3)
การวางรากฐานระบบประมวลผล Local-First AI และสร้างเกตเวย์เชื่อมต่อ

#### 1. Local Hardware Acceleration (vLLM)
- ติดตั้งและตั้งค่าเอนจิน **vLLM** ขับเคลื่อนบนเซิร์ฟเวอร์ภายใน (Local GPU)
- พัฒนา OpenAI-compatible API Endpoint เพื่อให้ Agent แลกเปลี่ยนข้อมูลภายในระบบได้อย่างอิสระ
- สร้างส่วนของ Cloud API Fallback รอล่วงหน้า เพื่อสลับไปใช้คลาวด์ (OpenAI/Anthropic) อัตโนมัติเมื่องานเกินขีดความสามารถของ Local GPU

#### 2. Multi-Channel Gateway
- พัฒนาเกตเวย์รับส่งข้อมูล (Communication Node) สำหรับ WhatsApp, Slack และ Discord
- สร้างระบบจัดการคิวเข้าสู่ระบบแบบ Lane-based queue เพื่อการรองรับงานปริมาณมากโดยไม่เกิดคอขวด

#### 3. Orchestrator Agent (The Gateway Layer)
- สร้างโครงสร้างหลักของ Agent "ผู้จัดการ" (Technical Architect / Master Orchestrator Agent)
- พัฒนา 'Intent Parsing' เพื่อประมวลผลเจตนาผู้ใช้และแปลงเป็นโครงสร้างงานย่อยแบบ JSON Plan
- พัฒนา 'Cost & Complexity Analyzer' เป็นโมดูลประเมินความซับซ้อนว่าคำสั่งควรไปใช้ Local หรือ Cloud

---

### Phase 2: Memory & Communication (Week 4-6)
การจัดการข้อมูลสถานะ (State Plane) และความทรงจำร่วมระหว่าง Agent (Unified Memory Architecture)

#### 1. Episodic & Semantic Memory
- ออกแบบและติดตั้งฐานข้อมูล **SQLite + FTS5** สำหรับ Episodic Memory ทำให้ค้นหาประวัติการโต้ตอบรวดเร็วระดับ Sub-millisecond
- ติดตั้งและเชื่อมต่อ Vector Database (อาทิ pgvector/Pinecone) สำหรับ Semantic Memory ทำให้ Agent ค้นหาและดึงความเข้าใจจาก Embedding Data ได้
- วางโครงสร้างระบบ Procedural Memory เป็นช่องทางโหลดแพทเทิร์นชุดคำสั่ง (อ่าน/เขียน ผ่านไฟล์ `SKILL.md`)

#### 2. A2A Protocol Standardization
- สร้างโครงสร้างเอกสาร `/.well-known/agent-card.json` ตามมาตรฐานให้ Agent ทุกตัวที่ลงทะเบียนไว้ในระบบ
- วางโปรโตคอลการแลกเปลี่ยน Service/Role/Capabilities เพื่อให้ Orchestrator ค้นหา Worker Agent ที่ต้องการได้อย่างอัตโนมัติ
- เปิดการทำงาน 'Dynamic Agent Assignment' จ่ายงานให้ Worker Agent ที่เหมาะสมตามประเภทงานและคิว

---

### Phase 3: Execution Sandbox & UI-Weaver (Week 7-9)
การพัฒนา Agent ระดับสูง (Action Plane) ให้เขียนสคริปต์ รันโค้ด และแสดงผลได้จริงอย่างปลอดภัย

#### 1. Secure Execution Layer (Sandbox)
- บูรณาการระบบ MicroVMs (เช่น **E2B/Firecracker**) เป็น Secure Code Sandbox สำหรับบรรจุและเทสต์โค้ดที่ Agent เขียน เพื่อแยกส่วนความจำ Kernel ออกจากโฮสต์หลักโดยเด็ดขาด ภายในเวลาที่จำกัดไม่เกิน 150ms
- พัฒนาโมดูลของ Developer Agent เข้ากับ Sandbox เพื่อส่งโค้ดไปทดสอบ รัน Unit test พร้อมคืนผลลัพธ์ผ่าน Shell command สู่ Agent

#### 2. QA Engineer Agent
- Implement QA Agent อัจฉริยะที่สามารถวิเคราะห์โค้ดของ Developer เพื่อจำลองสร้าง Test steps ควบคุมทั้ง Happy path, Negative และ Edge cases
- สร้างระบบ Automated testing script เพื่อการรันการทดสอบใน Sandbox ต่อเนื่องและสรุปผลรายงาน 

#### 3. Visual IDE Bridge / UI-Weaver Agent
- พัฒนา Agent "ทีมหน้าบ้าน" มีหน้าที่แปลง Design เป็นโค้ด Frontend ทันทีด้วย HTML5 & Tailwind CSS
- บูรณาการแพลตฟอร์ม Real-time HTML Rendering และ Interactive Component Sync เพื่อให้มี Live Preview เปลี่ยนแปลงการแสดงผลหน้าเว็บไซต์ทันทีที่ Agent ปรับโค้ดและ Prompt 

---

### Phase 4: Observability & Auto-Learning (Week 10-12)
การติดตามสถานะระบบและการสร้างวงจรเรียนรู้ใหม่อัตโนมัติในสภาวะการใช้งานจริง

#### 1. Observability & Operations Dashboard
- สร้างตัวเชื่อมต่อเพื่อติดตั้ง **Langfuse** สำหรับเก็บรวบรวมข้อมูล Tracing กระบวนการแลกเปลี่ยนระหว่าง Agent แบบลำดับชั้น (Hierarchical DAG)
- ตั้งค่าระบบ Metrics **Prometheus** ควบคู่กับ **DCGM Exporter** เพื่อดึงค่าการรันงานของ GPU, RAM, VRAM ออกมามอนิเตอร์
- พัฒนา Dashboard ศูนย์กลางรวบรวมข้อมูลโชว์สถานะ Agent ทั้งระบบครบ จบในจอเดียว (Idle, Busy, Error) 

#### 2. Auto-Learning (GEPA & RL)
- เปิดระบบการซิงก์ข้อมูล **Genetic-Pareto Prompt Evolution (GEPA)** เพื่อให้ Autonomous Optimizer Agent วิเคราะห์ Error Logs เสนอทางเลือกพร้อมอัปเดตไฟล์ Prompt ชุดใหม่ที่ดึขึ้น 
- สร้างวงจรพัฒนาตนเอง (Self-Correction) เมื่อแก้ Error ได้สำเร็จ ความรู้ทั้งหมดจะสกัดและ Materialize กลับมาจัดเก็บเป็นเอกสารประเภท SKILL ทันที
- ติดตั้ง **OpenClaw-RL** นำระบบการเรียนรู้เสริมจากความผิดพลาดมารันในรูปแบบ Background Async Loop เพื่อให้เรียนรู้ทิศทางจากการกระทำของผู้ใช้ได้เอง 

## Verification Plan

### Automated Tests
- สร้างชุดจำลองข้อความเข้าผ่าน Multi-channel Gateway และสังเกตการแตกย่อยเป้าหมาย (Breakdown task) ว่า Orchestrator สามารถแบ่งงานเป็น JSON ได้เรียบร้อยดี
- ตรวจสอบ Sandbox Execution Tests ยืนยันว่า Developer Agent รวมถึงการรันโค้ดนอกเหนือที่กำหนด ถูกจำกัดสิทธิ์ใน MicroVMs และไม่สามารถดัดแปลงไฟล์บนโฮสต์หลัก (Server) ได้

### Manual Verification
- ประเมินผลความรวดเร็วโดยวัด Delay ของการแลกเปลี่ยนผ่าน A2A Protocol ว่าอยู่ในระดับที่ประมวลผลได้พริ้วไหวหรือไม่ (Throughput ของระบบ)
- ให้ผู้ใช้จำลองการอัปเดต Prompt หรือ UI ผ่านทาง Interactive Component Sync เพื่อสังเกตการณ์ว่า Live Preview ฝั่ง UI-Weaver แสดงผลโค้ดที่แก้ใหม่ได้อย่าง Real-time ตรงตามสเปคหรือไม่
