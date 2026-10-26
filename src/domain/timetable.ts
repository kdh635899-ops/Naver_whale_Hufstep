// 월~금 시간표 배치 계산. 화면과 무관한 순수 함수 (수업 시간은 학생이 입력한 ClassTime만 쓴다).
import type { ClassTime } from './types';

export const DAY_LABEL = ['월', '화', '수', '목', '금'] as const;

/** 'HH:mm' → 자정부터의 분 */
export const toMinutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

export interface TimetableBlock extends ClassTime {
  /** 같은 요일에 겹치는 수업끼리 나란히 놓을 칸 번호 / 칸 수 */
  lane: number;
  lanes: number;
}

/**
 * 요일별로 시작 순 정렬 → 겹치는 수업 묶음마다 칸을 나눈다.
 * 표시 범위는 기본 9~18시, 그보다 이르거나 늦은 수업이 있으면 넓힌다.
 */
export function layoutWeek(times: ClassTime[]): { blocks: TimetableBlock[]; fromHour: number; toHour: number } {
  const blocks: TimetableBlock[] = [];
  for (let day = 0; day < 5; day++) {
    const list = times.filter((t) => t.day === day)
      .sort((a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end));
    let group: TimetableBlock[] = [];
    let laneEnds: string[] = []; // 칸마다 마지막 수업의 종료 시각
    const flush = () => { group.forEach((b) => { b.lanes = laneEnds.length; }); blocks.push(...group); group = []; laneEnds = []; };
    for (const t of list) {
      if (group.length && laneEnds.every((end) => end <= t.start)) flush(); // 앞 묶음과 안 겹치면 새 묶음
      let lane = laneEnds.findIndex((end) => end <= t.start);
      if (lane < 0) lane = laneEnds.push(t.end) - 1;
      else laneEnds[lane] = t.end;
      group.push({ ...t, lane, lanes: 1 });
    }
    flush();
  }
  const starts = blocks.map((b) => Math.floor(toMinutes(b.start) / 60));
  const ends = blocks.map((b) => Math.ceil(toMinutes(b.end) / 60));
  return { blocks, fromHour: Math.min(9, ...starts), toHour: Math.max(18, ...ends) };
}

/** '월 09:00~10:15' */
export const classTimeText = (t: ClassTime) => `${DAY_LABEL[t.day]} ${t.start}~${t.end}`;
