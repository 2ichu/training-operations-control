import { chromium } from 'playwright-core'
const OUT='./excuse-evidence/'
const doc = (title, rows, foot) => `<html><body style="margin:0;font-family:'WenQuanYi Zen Hei','Noto Sans KR',sans-serif;background:#fff"><div style="width:794px;height:560px;box-sizing:border-box;padding:40px 56px;border:2px solid #333;margin:10px">
<div style="text-align:center;font-size:30px;letter-spacing:8px;margin:8px 0 28px">${title}</div>
<table style="width:100%;border-collapse:collapse;font-size:17px">${rows.map(([a,b])=>`<tr><td style="border:1px solid #666;padding:9px 12px;width:150px;background:#f1f1f1">${a}</td><td style="border:1px solid #666;padding:9px 12px">${b}</td></tr>`).join('')}</table>
<p style="margin-top:26px;font-size:16px">${foot}</p>
<p style="text-align:center;margin-top:34px;font-size:19px">2026년 9월 16일</p>
<p style="text-align:center;font-size:20px">가상병원장 (인)</p>
<p style="position:absolute;right:30px;bottom:14px;font-size:12px;color:#888">※ 가상 데이터 — 시험용 (실제 서류 아님)</p></div></body></html>`
import { readFileSync } from 'node:fs'
const sc = JSON.parse(readFileSync('./beacon-scenario.json', 'utf8'))
const TEMPLATES = {
  'medical_certificate.png': (name, birth, date) => ['진 료 확 인 서', [['성 명', name], ['생년월일', birth], ['진 단 명', '급성 장염 (가상)'], ['진료일자', date], ['진료기관', '가상내과의원']], '위 사람은 상기 병명으로 진료를 받았음을 확인합니다. (시험용 가상 서류)'],
  'reserve_forces_notice.pdf': (name, birth, date) => ['예비군 훈련 통지서', [['성 명', name], ['생년월일', birth], ['훈련구분', '동원 훈련 (가상)'], ['훈련일자', date], ['훈련장소', '가상 예비군훈련장']], '위 사람은 예비군 훈련 대상자로 훈련에 참가하여야 합니다. (시험용 가상 서류)'],
  'interview_confirmation.png': (name, birth, date) => ['면 접 확 인 서', [['성 명', name], ['생년월일', birth], ['면접일시', date + ' 14:00'], ['면접기관', '가상소프트(주)'], ['직 무', '데이터 분석 (가상)']], '위 사람이 당사 채용 면접에 응하였음을 확인합니다. (시험용 가상 서류)'],
}
const docs = sc.excuses.map((e) => { const t = sc.trainees[e.ti]; const [title, rows, foot] = TEMPLATES[e.kind](t.name, t.birth, sc.dates[e.round - 1]); return [e.evidence.replace(/\.(png|pdf)$/, ''), title, rows, foot, e.evidence.endsWith('.pdf') ? 'pdf' : 'png'] })
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
const p = await (await b.newContext({ viewport: { width: 814, height: 580 } })).newPage()
for (const [name,title,rows,foot,fmt] of docs) {
  await p.setContent(doc(title,rows,foot))
  if (fmt==='png') await p.screenshot({ path: OUT+name+'.png', clip:{x:0,y:0,width:814,height:580} })
  else await p.pdf({ path: OUT+name+'.pdf', width:'814px', height:'580px', printBackground:true })
}
await b.close()
