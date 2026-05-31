# **แผนการพัฒนาฟีเจอร์ "Cyber-Thai Command Center" (Isometric Animation UI) สำหรับ Nexus-Agent**

**Concept:** เปลี่ยนระบบ Monitor แบบข้อความธรรมดา ให้กลายเป็น **"ห้องปฏิบัติการ 2.5D (Isometric Trading Office)"** สไตล์ Pixel-Art / Cyber-Thai โดยใช้ตัวละครที่มีอนิเมชั่นตามสถานะการทำงานจริง (Real-time State) เพื่อสร้างประสบการณ์ Gamification อย่างเต็มรูปแบบ

เอกสารนี้แบ่งการพัฒนาออกเป็น 5 เฟส พร้อม Prompt สำหรับนำไปสั่งให้ AI (เช่น Cursor, GitHub Copilot, ChatGPT) ช่วยเขียนโค้ดในแต่ละส่วน

## **Phase 1: ปรับปรุง Backend State Management และ Observability**

**เป้าหมาย:** เพิ่มความละเอียดของ State (Micro-states) เพื่อให้ Frontend นำไปเปลี่ยนท่าทาง (Animation Frame) ของตัวละครได้

**Prompt สำหรับ AI:**

Role: Python Backend Developer  
Project Context: ระบบ Nexus-Agent (Multi-AI Agent System)

Task:   
โปรดอัปเดตไฟล์ \`nexus\_agent/core/state.py\` และ \`nexus\_agent/core/observability.py\` เพื่อรองรับ Micro-states สำหรับฟีเจอร์ "Isometric Agent Avatars" ดังนี้:

1\. ใน \`state.py\`: สร้าง Enum \`AgentMicroState\` ประกอบด้วยสถานะ: IDLE, THINKING, PLANNING, CODING, DESIGNING, TESTING, EXECUTING, OPTIMIZING, WAITING\_FOR\_HUMAN, ERROR  
2\. เพิ่มฟิลด์ \`current\_micro\_state\` (AgentMicroState) และ \`status\_message\` (str) ลงใน State Model ของ Agent แต่ละตัว  
3\. ใน \`observability.py\`: เพิ่มฟังก์ชันสำหรับจับเวลา (Processing Time) และคำนวณ Token Cost แบบ Real-time ที่ผูกกับ Agent แต่ละตัว (Agent ID)  
4\. ขอโค้ดที่อัปเดตแล้ว พร้อม Type Hinting และ Docstring ที่ชัดเจน

## **Phase 2: สร้าง Event Emitter และ WebSocket Gateway**

**เป้าหมาย:** ส่งข้อมูล State จาก Backend ไปกระตุ้น Animation บนหน้าเว็บแบบ Real-time

**Prompt สำหรับ AI:**

Role: Python/FastAPI Developer  
Project Context: ระบบ Nexus-Agent

Task:  
เราต้องการเชื่อมต่อ Backend เข้ากับ React Frontend เพื่อแสดงอนิเมชั่นของ Agent โปรดอัปเดตระบบตามนี้:

1\. สร้างระบบ WebSocket ใน \`nexus\_agent/core/gateway.py\` (ใช้ FastAPI WebSockets)  
2\. กำหนด JSON Schema สำหรับส่ง Message (ต้องมี: \`agent\_id\`, \`role\`, \`micro\_state\`, \`status\_message\`, \`metrics\` เช่น cpu, memory, processing\_time)  
3\. อัปเดต \`nexus\_agent/core/orchestrator.py\`: เมื่อ Orchestrator มอบหมายงาน หรือ Agent มีการเปลี่ยน State ให้ทำการ Emit event ผ่าน WebSocket ไปยัง Client ที่เชื่อมต่ออยู่  
4\. ขอตัวอย่างการ Broadcast message ไปยังทุก Client ที่เชื่อมต่ออย่างมีประสิทธิภาพ

## **Phase 3: สร้างโครงสร้างห้อง 2.5D Isometric (React \+ CSS Transforms)**

**เป้าหมาย:** สร้างสภาพแวดล้อมห้องทำงานมุมมองเฉียง (Isometric) สไตล์เกม Simulation เหมือนภาพ Reference

**Prompt สำหรับ AI:**

Role: Creative Frontend React Developer  
Project Context: หน้า Dashboard สำหรับ Monitor ระบบ Multi-AI Agent สไตล์ Isometric Pixel-Art

Task:  
สร้าง React Component สำหรับทำแผนผังห้องทำงานมุมมอง 2.5D (Isometric View) ด้วย React และ Tailwind CSS (หรือ CSS Module) โดยไม่ต้องใช้ Canvas Library:

1\. สร้าง \`IsometricRoom.tsx\` ใช้ CSS Transforms (เช่น \`transform: rotateX(60deg) rotateZ(-45deg)\`) เพื่อสร้างพื้นห้อง (Floor) ให้ดูเป็นมุมมองเฉียง  
2\. แบ่ง Grid บนพื้นห้องให้มี 6 ตำแหน่ง สำหรับวางโต๊ะทำงานของ Agent ทั้ง 6 ตัว  
3\. ออกแบบ \`DeskStation.tsx\` ให้เป็น Block 3 มิติ (ใช้ div ซ้อนกันทำมุมซ้ายขวาบน) พร้อมหน้าจอมอนิเตอร์  
4\. Theme: ห้องวิจัยล้ำยุคผสมผสานความเป็นไทย (Cyber-Thai) โทนสีเข้ม (Dark Neon / Cyberpunk)  
5\. ขอโค้ด CSS/Tailwind ที่ทำให้ Grid และ โต๊ะทำงานดูมีมิติสมจริงในมุมมอง Isometric

## **Phase 4: สร้าง Avatar Components และ Sprite Animations**

**เป้าหมาย:** นำตัวละคร Agent มานั่งที่โต๊ะ และทำ CSS Sprite Animation ให้ขยับตามการทำงาน

**Prompt สำหรับ AI:**

Role: Frontend Game UI / CSS Animator Developer

Task:  
สร้าง React Components สำหรับ Agent Avatars สไตล์ Pixel-Art/Retro ที่จะนำไปวางไว้บนโต๊ะใน Isometric Room:

1\. สร้าง \`AgentAvatar.tsx\` ที่สามารถรับ Props \`role\` และ \`microState\` ได้  
2\. เขียน CSS Animation โดยใช้เทคนิค \`steps()\` เพื่อจำลอง Sprite Sheet Animation (เช่น ท่า Idle, ท่า Typing รัวๆ, ท่า Thinking)  
3\. กำหนดคาแรคเตอร์ตาม Role (สไตล์ Cyber-Thai):  
   \- Planner: เสนาบดีไซเบอร์  
   \- Architect: พระวิศวกรรม  
   \- Developer: วานรล้ำยุค (หนุมานไซเบอร์)  
   \- UI Weaver: นางอัปสร  
   \- Validator: ยักษ์ทวารบาล  
   \- Optimizer: ฤาษีดิจิทัล  
4\. ใช้ CSS สร้าง Placeholder รูปแบบ 2.5D ลอยอยู่บนโต๊ะไปก่อน (หากยังไม่มีไฟล์ภาพ Sprite จริง)  
5\. เปลี่ยนความเร็วและรูปแบบ Animation ตาม \`microState\` (เช่น CODING \= มือขยับเร็วและหน้าจอเรืองแสง, IDLE \= หายใจช้าๆ)

## **Phase 5: ผสานระบบ WebSocket และเพิ่ม UI Gamification (Floating UI)**

**เป้าหมาย:** ทำให้ห้องมีชีวิต\! เมื่อมี Task เข้ามา ตัวละครจะขยับ และมี Speech Bubble เด้งขึ้นมา

**Prompt สำหรับ AI:**

Role: Full-Stack React / UI Gamification Developer

Task:  
ประกอบ UI Isometric Room เข้ากับ WebSocket Backend และเพิ่มเอฟเฟกต์สไตล์เกม (Gamification):

1\. สร้าง Custom Hook \`useAgentSocket\` เพื่อเชื่อมต่อ WebSocket และอัปเดต State   
2\. นำข้อมูล State ไปกระจายให้ \`AgentAvatar\` แต่ละตัวในห้อง  
3\. สร้าง Component \`FloatingSpeechBubble.tsx\`: เมื่อ Agent ได้รับ \`status\_message\` ใหม่ ให้แสดงบอลลูนคำพูดลอยขึ้นมาจากหัวตัวละคร (มีอนิเมชั่น Fade in/out และลอยขึ้น)  
4\. สร้าง Component \`FloatingDamageText.tsx\`: เมื่อ Agent ส่งมอบงานสำเร็จ (State \= DONE/SUCCESS) ให้มีตัวเลขสีเขียว "+100 EXP" หรือ "Task Completed" ลอยขึ้นมาแล้วจางหายไป  
5\. หาก Agent ใดมี State \= ERROR ให้โต๊ะทำงานและหน้าจอกระพริบเป็นแสงสีแดง (Red Alert)  
6\. ขอโค้ด Hook และ Components ทั้งหมดที่ทำให้ภาพรวมดูเหมือนเกม Simulation ห้องทำงานที่ตอบสนองข้อมูลได้แบบ Real-time  
