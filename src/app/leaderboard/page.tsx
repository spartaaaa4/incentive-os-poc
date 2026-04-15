import { AppShell } from "@/components/layout/app-shell";
import { LeaderboardView } from "@/components/leaderboard/leaderboard-view";

export default function LeaderboardPage() {
  return (
    <AppShell title="Leaderboard">
      <LeaderboardView />
    </AppShell>
  );
}
