# แผนการปรับปรุงและพัฒนา Nexus-Agent (Implementation Plan)

เป้าหมายของแผนนี้คือการจัดการปัญหาทั้ง 17 จุดที่พบในรายงานการวิเคราะห์ระบบ โดยเรียงลำดับความสำคัญตามหลัก Best Practice Software Engineering เพื่อให้ระบบกลับมาทำงานได้สมบูรณ์ ปลอดภัย และยั่งยืน

## User Review Required

> [!IMPORTANT]
> **กรุณาตรวจสอบแผนการทำงานนี้และกดยืนยัน (Approve) หากคุณเห็นด้วยกับลำดับขั้นตอน** 
> หากมีการปรับเปลี่ยนลำดับความสำคัญหรือต้องการให้มุ่งเน้นเฟสไหนเป็นพิเศษ สามารถแจ้งได้เลยครับ

## Open Questions

> [!WARNING]
> 1. ใน Phase 2 การจัดการ RCE ใน `system_tools.py` ต้องการให้นำเครื่องมือนี้ไปผูกกับ **SecureCodeSandbox** (ที่ทำไว้แล้ว) หรือแค่จำกัดให้รันได้เฉพาะคำสั่งใน Allowlist ครับ? (ค่าเริ่มต้นผมจะปรับให้อยู่ใน Allowlist และปิด `shell=True` ก่อน)
> 2. ใน Phase 4 ส่วนที่ Gateway ซ่อน Error ไว้นั้น ต้องการให้ระบบเพิ่มตารางใน Database (เช่น Dead-letter queue) เพื่อเก็บข้อความที่ประมวลผลล้มเหลวไว้รีทรายในภายหลังไหมครับ? หรือแค่ Log เป็น Error ระดับสูงส่งเข้า Sentry ก็พอ?

---

## 📅 Phases of Implementation

### Phase 1: Deployment Unblocking & Critical Fixes (เร่งด่วนที่สุด)
**เป้าหมาย:** ทำให้ Container กลับมา Healthy บน Portainer และป้องกัน Runtime Crash

#### [MODIFY] [docker-compose.yml](file:///c:/Users/supachai.nil/Documents/GitHub/Nexus-Agent/docker-compose.yml)
- แก้ไขการสร้าง `REDIS_URL` ให้ดึงรหัสผ่านไปใช้ด้วย: `REDIS_URL=redis://:${REDIS_PASSWORD:-nexus_redis_secret}@nexus-redis:6379/0`
- เพิ่ม Healthcheck ให้กับ service `nexus-dashboard`

#### [MODIFY] [nexus_agent/core/observability.py](file:///c:/Users/supachai.nil/Documents/GitHub/Nexus-Agent/nexus_agent/core/observability.py)
#### [MODIFY] [nexus_agent/core/cost.py](file:///c:/Users/supachai.nil/Documents/GitHub/Nexus-Agent/nexus_agent/core/cost.py)
- นำฟังก์ชัน `estimate_cost` ใน `observability.py` ออก แล้วให้ Import จาก `cost.py` เป็นหลัก ป้องกันการชนกันของ Signature

#### [MODIFY] [nexus_agent/entrypoint.py](file:///c:/Users/supachai.nil/Documents/GitHub/Nexus-Agent/nexus_agent/entrypoint.py)
- เปลี่ยน `@app.on_event("startup")` และ `"shutdown"` เป็น `lifespan` context manager ของ FastAPI เพื่อไม่ให้ Code พังในอนาคต

---

### Phase 2: Security Hardening (ความปลอดภัย)
**เป้าหมาย:** อุดช่องโหว่และป้องกันข้อมูลรั่วไหล

#### [MODIFY] [nexus_agent/tools/system_tools.py](file:///c:/Users/supachai.nil/Documents/GitHub/Nexus-Agent/nexus_agent/tools/system_tools.py)
- ลบการใช้ `shell=True` และเพิ่มกระบวนการ Sanitization หรือ Allowlist ให้กับคำสั่ง Shell (ป้องกัน Remote Code Execution)

#### [NEW] [Stack.env.example](file:///c:/Users/supachai.nil/Documents/GitHub/Nexus-Agent/Stack.env.example)
#### [MODIFY] [.gitignore](file:///c:/Users/supachai.nil/Documents/GitHub/Nexus-Agent/.gitignore)
- เปลี่ยน `Stack.env` ให้เป็น `Stack.env.example` เพื่อใช้เป็นเทมเพลต และเอา `Stack.env` ของจริงใส่ไว้ใน `.gitignore` ไม่ให้หลุดขึ้น Git

#### [MODIFY] [nexus_agent/core/settings.py](file:///c:/Users/supachai.nil/Documents/GitHub/Nexus-Agent/nexus_agent/core/settings.py)
- เพิ่มเงื่อนไข Log Error ทันทีถ้าเปิด `NEXUS_AUTH_REQUIRED=true` แต่ไม่ได้ตั้งค่า API Key ไว้

#### [MODIFY] [nexus_agent/core/security.py](file:///c:/Users/supachai.nil/Documents/GitHub/Nexus-Agent/nexus_agent/core/security.py)
- แก้บั๊กการ throw `HTTPException` ในระหว่างการเชื่อมต่อ WebSocket ให้ใช้ `WebSocketDisconnect` อย่างถูกต้อง

---

### Phase 3: Reliability & Performance (ความน่าเชื่อถือและประสิทธิภาพ)
**เป้าหมาย:** ลดคอขวดและป้องกัน Bug ที่เกิดจาก Asynchronous I/O 

#### [MODIFY] [nexus_agent/core/redis_client.py](file:///c:/Users/supachai.nil/Documents/GitHub/Nexus-Agent/nexus_agent/core/redis_client.py)
- เปลี่ยนคำสั่ง `ping()` ที่เป็น Synchronous ให้ทำงานแบบ Async อย่างแท้จริง (ใช้ `redis.asyncio` หรือ `asyncio.to_thread`) ป้องกันการบล็อก Event Loop

#### [MODIFY] [nexus_agent/core/resilience.py](file:///c:/Users/supachai.nil/Documents/GitHub/Nexus-Agent/nexus_agent/core/resilience.py)
- แก้ไขตรรกะการ Retry ให้จับ Exception ตามประเภท (Type) ที่ชัดเจน แทนการตรวจหาข้อความในชื่อ Exception ที่อาจจะเกิด False Positive ได้

#### [MODIFY] [nexus_agent/core/orchestrator.py](file:///c:/Users/supachai.nil/Documents/GitHub/Nexus-Agent/nexus_agent/core/orchestrator.py)
- เพิ่ม `max_iterations` ให้กับ Loop ของ Agent State ป้องกันการวนซ้ำแบบไม่รู้จบ (Infinite Loop)

#### [MODIFY] [nexus_agent/core/cost.py](file:///c:/Users/supachai.nil/Documents/GitHub/Nexus-Agent/nexus_agent/core/cost.py)
- ปรับตรรกะการคิดราคา Model ให้สามารถรองรับ Prefix Matching (เช่น โมเดลชื่อยาวๆ ก็จะจับคู่กับชื่อ Prefix สั้นๆ ได้)

#### [MODIFY] [nexus_agent/core/database.py](file:///c:/Users/supachai.nil/Documents/GitHub/Nexus-Agent/nexus_agent/core/database.py)
- ย้ายการสร้าง Database Engine ไปไว้ในฟังก์ชัน (Lazy Initialization) แทนการสร้างทันทีตั้งแต่เปิดไฟล์ เพื่อไม่ให้เกิดไฟล์ `nexus_local.db` รกเวลาทำ Unit Test หรือ Import Modules

---

### Phase 4: Code Quality & Maintainability (คุณภาพโค้ด)
**เป้าหมาย:** เพื่อการทำ Logging ที่เป็นระบบและการดูแลรักษาระยะยาว

#### [MODIFY] [nexus_agent/core/orchestrator.py](file:///c:/Users/supachai.nil/Documents/GitHub/Nexus-Agent/nexus_agent/core/orchestrator.py)
- แทนที่คำสั่ง `print()` ทั้งหมดด้วย Logger ที่จัดรูปแบบเป็น JSON แล้ว เพื่อให้ส่งข้อมูลขึ้น Sentry หรือ Portainer log ได้ครบถ้วน

#### [MODIFY] [nexus_agent/core/observability.py](file:///c:/Users/supachai.nil/Documents/GitHub/Nexus-Agent/nexus_agent/core/observability.py)
- ปรับ Metrics ของ GPU ไม่ให้คืนค่าคงที่หลอก (Hardcoded 58°C) โดยใช้ fallback สั้นๆ หรือใช้ไลบรารีวัดผลจริงๆ ถ้ามี

#### [MODIFY] [nexus_agent/entrypoint.py](file:///c:/Users/supachai.nil/Documents/GitHub/Nexus-Agent/nexus_agent/entrypoint.py)
- ย้าย `import warnings` ที่ถูกซ่อนอยู่ใน if condition ให้ขึ้นไปอยู่บนสุดของไฟล์ (Clean Code)

#### [MODIFY] [nexus_agent/core/gateway.py](file:///c:/Users/supachai.nil/Documents/GitHub/Nexus-Agent/nexus_agent/core/gateway.py)
- เพิ่มระบบดักจับและส่ง Error Alert สำหรับ Event ที่ตายระหว่างการ Process เพื่อไม่ให้ข้อความหายวับไปเงียบๆ

---

## Verification Plan
1. **Automated Tests:** รัน `uv run pytest tests/` ให้ผ่าน 100% หลังจบการแก้ปัญหาแต่ละเฟส
2. **Linter:** รัน `uv run ruff check nexus_agent/` เพื่อยืนยันว่าไม่มี Error และ Warning สะสม
3. **Local Deployment Verification:** สั่ง `docker compose build && docker compose up -d` และเช็คผ่าน Portainer หรือ Command line ว่า Container ทำงานได้อย่างถูกต้อง (Status: Healthy) และสามารถเชื่อมต่อ Redis / Postgres ได้สำเร็จ
