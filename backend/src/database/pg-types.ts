import pg from 'pg';

// DATE 컬럼을 JS Date(서버 시간대 자정)가 아니라 'YYYY-MM-DD' 문자열 그대로 반환한다.
// 시간대에 따라 날짜가 하루 밀리는 문제를 막고, 감사로그·변경이력의 before/after 에도 같은 표기가 남는다.
pg.types.setTypeParser(1082, (value: string) => value);
