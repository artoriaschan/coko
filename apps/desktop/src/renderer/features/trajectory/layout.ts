import type { TrajectoryCellProps } from './trajectory-record.ts'
export interface TrajectoryTurnModel {
  turn: number | null
  groups: { title: string; cells: TrajectoryCellProps[] }[]
}
