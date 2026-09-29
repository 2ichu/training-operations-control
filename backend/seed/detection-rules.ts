// detection_rule 마스터 시드. RULE_03~07 + MANUAL (RULE_01·02 는 2026-09-29 도입하지 않기로 결정해 제외 — decisions.md P7-01. RULE_07 은 D-12 확정으로 추가 — S29 공식 출결 대사가 호출한다).
// initial_status 는 전 규칙 NEEDS_CHECK(D-11 확정: 규칙별 PRIORITY_CHECK 미지정, decisions.md 참고).
export interface DetectionRuleSeed {
  ruleCode: string;
  ruleName: string;
  params: Record<string, number>;
  description: string;
}

export const DETECTION_RULES: DetectionRuleSeed[] = [
  { ruleCode: 'RULE_03', ruleName: '회차 운영기록 지연', params: { delay_hours: 3 }, description: '회차 종료 시각 + delay_hours 경과 후에도 operation_log 행이 없음' },
  { ruleCode: 'RULE_04', ruleName: '퇴실정보 누락', params: { delay_hours: 2 }, description: 'PRESENT/LATE 이고 check_out_time NULL 이며 회차 종료 시각 + delay_hours 경과' },
  { ruleCode: 'RULE_05', ruleName: '반복적인 출결 수정', params: { window_days: 30, min_changes: 3 }, description: '동일 훈련생의 사람(USER) 수정 건수가 window_days일 내 min_changes회 이상' },
  { ruleCode: 'RULE_06', ruleName: '출결상태 반복 변경', params: { window_days: 30, min_flips: 2 }, description: '동일 훈련생의 상태 조합 반복 변경(사람 수정)이 window_days일 내 min_flips회 이상' },
  { ruleCode: 'RULE_07', ruleName: '공식-내부 정보 불일치', params: { tolerance_minutes: 15 }, description: '공식 출결(S29 업로드)과 내부 기록의 상태가 다르거나 입·퇴실 시각 차이가 tolerance_minutes분을 넘음(내부 기록은 자동으로 바꾸지 않음)' },
  { ruleCode: 'MANUAL', ruleName: '수동 확인 필요 전환', params: {}, description: '특이사항(S18) 등에서 담당자가 수동으로 확인 필요를 생성할 때 사용하는 고정 레코드' },
];
