import { GameErrorBoundary } from '@/components/game/GameErrorBoundary';

export default function GameLayout({ children }: { children: React.ReactNode }) {
  return <GameErrorBoundary>{children}</GameErrorBoundary>;
}