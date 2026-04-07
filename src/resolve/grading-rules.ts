export type Outcome = 'won' | 'lost' | 'push' | 'void'

export function gradeMoneyline(args: {
  side: 'home' | 'away'
  homeScore: number
  awayScore: number
}): Outcome {
  if (args.homeScore === args.awayScore) return 'push'
  const homeWon = args.homeScore > args.awayScore
  const pickedHome = args.side === 'home'
  return homeWon === pickedHome ? 'won' : 'lost'
}

export function gradeTotal(args: {
  side: 'over' | 'under'
  line: number
  homeScore: number
  awayScore: number
}): Outcome {
  const total = args.homeScore + args.awayScore
  if (total === args.line) return 'push'
  const wentOver = total > args.line
  const pickedOver = args.side === 'over'
  return wentOver === pickedOver ? 'won' : 'lost'
}

export function gradeSpread(args: {
  side: 'home' | 'away'
  line: number // signed from the picked side's perspective: -3.5 = picked side favored by 3.5
  homeScore: number
  awayScore: number
}): Outcome {
  // The line is always relative to the side being picked. Add line to picked
  // side's score and compare to opponent's score.
  const pickedScore = args.side === 'home' ? args.homeScore : args.awayScore
  const oppScore = args.side === 'home' ? args.awayScore : args.homeScore
  const adjusted = pickedScore + args.line - oppScore
  if (adjusted === 0) return 'push'
  return adjusted > 0 ? 'won' : 'lost'
}
