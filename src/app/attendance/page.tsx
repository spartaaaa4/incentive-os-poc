import { AppShell } from "@/components/layout/app-shell";
import { AttendanceView } from "@/components/attendance/attendance-view";

export default function AttendancePage() {
  return (
    <AppShell
      title="Attendance"
      description="Upload daily attendance for F&L employees. F&L weekly pool incentives cannot be calculated without attendance data."
    >
      <AttendanceView />
    </AppShell>
  );
}
