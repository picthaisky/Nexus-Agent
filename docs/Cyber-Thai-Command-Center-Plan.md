# **แผนการพัฒนาฟีเจอร์ "Cyber-Thai Command Center" สำหรับ Nexus-Agent**

**Concept:** ระบบ Dashboard สำหรับติดตามการทำงานของ Multi-AI Agent ในรูปแบบ Trading Office ที่ใช้ตัวละคร Thai Sci-Fi/Cyberpunk เป็น Avatar ประจำแต่ละ Role เพื่อทำ Gamification ให้กับระบบ Observability

เอกสารนี้แบ่งการพัฒนาออกเป็น 5 เฟส พร้อม Prompt สำหรับนำไปสั่งให้ AI ช่วยเขียนโค้ดในแต่ละส่วน

## **Phase 1: ปรับปรุง Backend State Management และ Observability**

**เป้าหมาย:** เพิ่มความละเอียดของ State (Micro-states) เพื่อให้ Frontend นำไปใช้แสดง Animation ได้

**Prompt สำหรับ AI:**

Role: Python Backend Developer  
Project Context: ระบบ Nexus-Agent (Multi-AI Agent System)

Task:   
โปรดอัปเดตไฟล์ \`nexus\_agent/core/state.py\` และ \`nexus\_agent/core/observability.py\` เพื่อรองรับ Micro-states สำหรับฟีเจอร์ "Visualized Agent Avatars" ดังนี้:

1\. ใน \`state.py\`: สร้าง Enum \`AgentMicroState\` ประกอบด้วยสถานะ: IDLE, THINKING, PLANNING, CODING, DESIGNING, TESTING, EXECUTING, OPTIMIZING, WAITING\_FOR\_HUMAN, ERROR  
2\. เพิ่มฟิลด์ \`current\_micro\_state\` (AgentMicroState) และ \`status\_message\` (str) ลงใน State Model ของ Agent แต่ละตัว  
3\. ใน \`observability.py\`: เพิ่มฟังก์ชันสำหรับจับเวลา (Processing Time) และคำนวณ Token Cost แบบ Real-time ที่ผูกกับ Agent แต่ละตัว (Agent ID)  
4\. ขอโค้ดที่อัปเดตแล้ว พร้อม Type Hinting และ Docstring ที่ชัดเจน

## **Phase 2: สร้าง Event Emitter และ WebSocket Gateway**

**เป้าหมาย:** ส่งข้อมูล State และ Metrics จาก Orchestrator ไปยัง Frontend แบบ Real-time

**Prompt สำหรับ AI:**

Role: Python/FastAPI Developer  
Project Context: ระบบ Nexus-Agent

Task:  
เราต้องการเชื่อมต่อ Backend เข้ากับ React Frontend เพื่อแสดงสถานะ Agent แบบ Real-time โปรดอัปเดตระบบตามนี้:

1\. สร้างระบบ WebSocket ใน \`nexus\_agent/core/gateway.py\` (ใช้ FastAPI WebSockets)  
2\. กำหนด JSON Schema สำหรับส่ง Message (ต้องมี: \`agent\_id\`, \`role\`, \`micro\_state\`, \`status\_message\`, \`metrics\` เช่น cpu, memory, processing\_time)  
3\. อัปเดต \`nexus\_agent/core/orchestrator.py\`: เมื่อ Orchestrator มอบหมายงาน หรือ Agent มีการเปลี่ยน State ให้ทำการ Emit event ผ่าน WebSocket ไปยัง Client ที่เชื่อมต่ออยู่  
4\. ขอตัวอย่างการ Broadcast message ไปยังทุก Client ที่เชื่อมต่อ

## **Phase 3: วางโครงสร้าง Frontend (React 19 \+ Tailwind CSS)**

**เป้าหมาย:** สร้าง UI Shell ในรูปแบบ Trading Office Grid Layout ด้วยโทนสี Dark Theme

**Prompt สำหรับ AI:**

Role: Frontend React Developer  
Project Context: หน้า Dashboard สำหรับ Monitor ระบบ Multi-AI Agent

Task:  
สร้างโครงร่างโปรเจกต์ React (Vite) \+ Tailwind CSS สำหรับ "Cyber-Thai Command Center"

1\. สร้างหน้า Layout หลักแบบ "Trading Office" แบ่งเป็น Grid แบบ 2x3 หรือ 3x2 (สำหรับ Agent 6 ตัว)  
2\. Theme: ใช้โทนสี Dark Gradient (เช่น แบ็คกราวด์สีดำไล่ระดับไปเทาเข้ม)   
3\. สร้าง Component \`AgentMonitorCell\`: เป็นกรอบหน้าต่างของ Agent แต่ละตัว มี Header แสดงชื่อและ Role, ตรงกลางเว้นว่างไว้สำหรับ Avatar, ด้านล่างเป็นแถบวิ่ง (Ticker) แสดง Log/Status message  
4\. Color System: กำหนดตัวแปร Tailwind ให้รองรับสถานะ (Ocean Blue \= ปกติ/Standby, Orange-Brown \= กำลังทำงานหนัก/Processing, Red \= Error)  
5\. ขอโค้ด React Components (\`Dashboard.tsx\`, \`AgentMonitorCell.tsx\`)

## **Phase 4: สร้าง Avatar Components (Cyber-Thai Concept)**

**เป้าหมาย:** สร้าง UI Component สำหรับตัวละครแต่ละ Role ตามคอนเซปต์ความเป็นไทยล้ำยุค

**Prompt สำหรับ AI:**

Role: Frontend UI/UX Developer

Task:  
สร้าง React Components สำหรับ Agent Avatar ทั้ง 6 ตัว โดยใช้ CSS/Tailwind ในการทำ Placeholder/Styling แบบล้ำยุค (Sci-Fi/Cyberpunk) ควบคู่กับ CSS Animation ตาม State ของตัวละคร ดังนี้:

1\. \`PlannerAvatar\` (เสนาบดีไซเบอร์): ท่าทางกำลังเลื่อนจอโฮโลแกรม  
2\. \`ArchitectAvatar\` (พระวิศวกรรม): มีวงแหวนข้อมูลหมุนรอบตัว  
3\. \`DeveloperAvatar\` (วานรล้ำยุค): ท่าทางพิมพ์งานรวดเร็ว (มี Effect เส้นแสงวิ่ง)  
4\. \`UIWeaverAvatar\` (นางอัปสรทอแสง): มีพาร์ทิเคิลแสงลอยรอบๆ มือ  
5\. \`ValidatorAvatar\` (ยักษ์ทวารบาล): มีเกราะและเส้นสแกนเนอร์วิ่งขึ้นลง  
6\. \`OptimizerAvatar\` (ฤาษีดิจิทัล): ลอยตัว มีวงแหวนตัวเลข Metrics หมุนรอบฐาน

\*ให้แต่ละ Component รับ Props \`microState\` เพื่อเปลี่ยนความเร็วหรือรูปแบบของ Animation (เช่น ถ้า state=IDLE ให้เคลื่อนไหวช้าๆ สีฟ้า, ถ้า state=PROCESSING ให้เคลื่อนไหวเร็วขึ้น สีส้ม-น้ำตาล)  
\*หากยังไม่มีไฟล์ภาพกราฟิก ให้ใช้ CSS Shapes, Icons (Lucide-react), และ CSS Animations สร้างเป็นตัวแทนชั่วคราวให้ดูอลังการก่อน

## **Phase 5: ผสานระบบ State Integration & Gamification**

**เป้าหมาย:** เชื่อมต่อ WebSocket จาก Phase 2 เข้ากับ UI ใน Phase 3 และ 4

**Prompt สำหรับ AI:**

Role: Full-Stack React Developer

Task:  
เชื่อมต่อหน้า Dashboard เข้ากับ WebSocket Backend สำหรับระบบ Nexus-Agent:

1\. สร้าง Custom Hook \`useAgentSocket\` เพื่อเชื่อมต่อกับ \`ws://localhost:8000/ws/dashboard\`  
2\. จัดการ State ของ Agent ทั้งหมดใน \`Dashboard.tsx\` โดยอัปเดตข้อมูลแบบ Real-time เมื่อได้รับ Message จาก Backend  
3\. นำ Avatar Components (จากที่เคยทำไว้) มาใส่ใน \`AgentMonitorCell\` โดย Pass state ลงไปให้ถูกต้อง  
4\. เพิ่มกิมมิค Gamification:  
   \- หาก Agent ทำ Task สำเร็จ ให้แสดง Effect "EXP Gained" หรือแต้มพุ่งขึ้นเหนือหัว Avatar  
   \- แถบ Log Ticker ด้านล่างให้มี Effect แบบเครื่องพิมพ์ดีด (Typewriter) เวลามี Message ใหม่เข้ามา  
5\. ขอโค้ด Hook และการประกอบรวม Components ทั้งหมดให้ทำงานได้จริง  
