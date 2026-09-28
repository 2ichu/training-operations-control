// detection_rule 마스터 시드. RULE_01~06 + MANUAL (RULE_07 은 D-12 공식 출결 연동 확정 전이라 제외 — baseline 3-6·7절).
// initial_status 는 전 규칙 NEEDS_CHECK(D-11 확정: 규칙별 PRIORITY_CHECK 미지정, decisions.md 참고).
export interface DetectionRuleSeed {
  ruleCode: string;
  ruleName: string;
  params: Record<string, number>;
  description: string;
}

export const DETECTION_RULES: DetectionRuleSeed[] = [
  { ruleCode: 'RULE_01', ruleName: '동일 환경 복수 출결', params: { min_trainees: 3, window_minutes: 10 }, description: '같은 회차에서 같은 device_id로 서로 다른 훈련생 min_trainees명 이상이 window_minutes분 이내 출결' },
  { ruleCode: 'RULE_02', ruleName: '짧은 시간 내 복수 계정 출결', params: { min_events: 5, window_minutes: 5 }, description: '같은 출결 채널에서 min_events건 이상이 window_minutes분 이내 연속 발생' },
  { ruleCode: 'RULE_03', ruleName: '회차 운영기록 지연', params: { delay_hours: 3 }, description: '회차 종료 시각 + delay_hours 경과 후에도 operation_log 행이 없음' },
  { ruleCode: 'RULE_04', ruleName: '퇴실정보 누락', params: { delay_hours: 2 }, description: 'PRESENT/LATE 이고 check_out_time NULL 이며 회차 종료 시각 + delay_hours 경과' },
  { ruleCode: 'RULE_05', ruleName: '반복적인 출결 수정', params: { window_days: 30, min_changes: 3 }, description: '동일 훈련생의 사람(USER) 수정 건수가 window_days일 내 min_changes회 이상' },
  { ruleCode: 'RULE_06', ruleName: '출결상태 반복 변경', params: { window_days: 30, min_flips: 2 }, description: '동일 훈련생의 상태 조합 반복 변경(사람 수정)이 window_days일 내 min_flips회 이상' },
  { ruleCode: 'MANUAL', ruleName: '수동 확인 필요 전환', params: {}, description: '특이사항(S18) 등에서 담당자가 수동으로 확인 필요를 생성할 때 사용하는 고정 레코드' },
];
