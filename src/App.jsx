import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useStore } from './store/useStore'
import Layout from './components/Layout'
import ParentLayout from './components/ParentLayout'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
// CRM + Admissions
import Leads from './pages/crm/Leads'
import LeadDetail from './pages/crm/LeadDetail'
import Applications from './pages/admissions/Applications'
import ApplicationDetail from './pages/admissions/ApplicationDetail'
// Students
import Students from './pages/students/Students'
import StudentDetail from './pages/students/StudentDetail'
import Attendance from './pages/students/Attendance'
import LeaveRequests from './pages/students/LeaveRequests'
import ClassesSections from './pages/students/ClassesSections'
// Fees
import FeeSetup from './pages/fees/FeeSetup'
import FeeHeads from './pages/fees/FeeHeads'
import StudentFees from './pages/fees/StudentFees'
import FeeSettings from './pages/fees/FeeSettings'
import Concessions from './pages/fees/Concessions'
import GenerateFees from './pages/fees/GenerateFees'
import Approvals from './pages/fees/Approvals'
import CollectFees from './pages/fees/CollectFees'
import PendingDues from './pages/fees/PendingDues'
import AdhocFees from './pages/fees/AdhocFees'
import Invoices from './pages/fees/Invoices'
import FeeReports from './pages/fees/FeeReports'
// Daily
import DiaryFeed from './pages/daily/DiaryFeed'
import DailyLogs from './pages/daily/DailyLogs'
import CheckInOut from './pages/daily/CheckInOut'
import Albums from './pages/daily/Albums'
import HomeworkPage from './pages/daily/HomeworkPage'
// Communications
import Announcements from './pages/comms/Announcements'
import Chat from './pages/comms/Chat'
import CalendarEvents from './pages/comms/CalendarEvents'
import Worksheets from './pages/comms/Worksheets'
// Settings
import Settings from './pages/settings/Settings'
// Setup / Administration
import SetupLayout from './pages/setup/SetupLayout'
import SetupOverview from './pages/setup/Overview'
import Sessions from './pages/setup/sessions/Sessions'
import ClassList from './pages/setup/classes/ClassList'
import ClassForm from './pages/setup/classes/ClassForm'
import TransferClass from './pages/setup/classes/TransferClass'
import BreakupReports from './pages/setup/classes/BreakupReports'
import AttendanceReports from './pages/setup/classes/AttendanceReports'
import StaffList from './pages/setup/staff/StaffList'
import StaffForm from './pages/setup/staff/StaffForm'
import StaffAccess from './pages/setup/staff/StaffAccess'
import StaffAttendance from './pages/setup/staff/StaffAttendance'
import DayCareLayout from './pages/setup/daycare/DayCareLayout'
import DayCareActivities from './pages/setup/daycare/DayCareActivities'
import DayCareMeals from './pages/setup/daycare/DayCareMeals'
import Groups from './pages/setup/groups/Groups'
import {
  TaskSetupLayout, TaskCategories, TaskPriorities, TaskTags, TaskTemplates,
} from './pages/setup/tasks/TaskSetup'
import DayEndForms from './pages/setup/tasks/DayEndForms'
import EscalationPolicies from './pages/setup/tasks/EscalationPolicies'
// Tasks
import TasksLayout from './pages/tasks/TasksLayout'
import MyTasks from './pages/tasks/MyTasks'
import AssignedByMe from './pages/tasks/AssignedByMe'
import TaskApprovals from './pages/tasks/Approvals'
import TaskReports from './pages/tasks/TaskReports'
import Blocked from './pages/tasks/Blocked'
import Behind from './pages/tasks/Behind'
import TaskForm from './pages/tasks/TaskForm'
import TaskDetail from './pages/tasks/TaskDetail'
import Today from './pages/tasks/Today'
import DayEnd, { DayEndReceived } from './pages/tasks/DayEnd'
// Organisation (org tree behind the Tasks module)
import OrgLayout from './pages/org/OrgLayout'
import OrgChart from './pages/org/OrgChart'
import Levels from './pages/org/Levels'
import Positions from './pages/org/Positions'
// Parent portal
import ParentHome from './pages/parent/ParentHome'
import ParentAttendance from './pages/parent/ParentAttendance'
import ParentFees from './pages/parent/ParentFees'
import ParentChat from './pages/parent/ParentChat'
import ParentNotices from './pages/parent/ParentNotices'
import ParentCalendar from './pages/parent/ParentCalendar'
import ParentLeave from './pages/parent/ParentLeave'
import ParentWorksheets from './pages/parent/ParentWorksheets'
import ParentProfile from './pages/parent/ParentProfile'

function Protected({ children, parent = false }) {
  const { token, user } = useStore()
  if (!token || !user) return <Navigate to="/login" replace />
  if (parent && user.role !== 'parent') return <Navigate to="/" replace />
  if (!parent && user.role === 'parent') return <Navigate to="/parent" replace />
  return children
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />

        {/* Staff routes */}
        <Route
          path="/"
          element={
            <Protected>
              <Layout />
            </Protected>
          }
        >
          <Route index element={<Dashboard />} />
          {/* CRM */}
          <Route path="crm/leads" element={<Leads />} />
          <Route path="crm/leads/:id" element={<LeadDetail />} />
          {/* Admissions */}
          <Route path="admissions" element={<Applications />} />
          <Route path="admissions/:id" element={<ApplicationDetail />} />
          {/* Students */}
          <Route path="students" element={<Students />} />
          <Route path="students/:id" element={<StudentDetail />} />
          <Route path="attendance" element={<Attendance />} />
          <Route path="leave" element={<LeaveRequests />} />
          <Route path="classes" element={<ClassesSections />} />
          {/* Fees */}
          <Route path="fees/heads" element={<FeeHeads />} />
          <Route path="fees/setup" element={<FeeSetup />} />
          <Route path="fees/students" element={<StudentFees />} />
          <Route path="fees/settings" element={<FeeSettings />} />
          <Route path="fees/concessions" element={<Concessions />} />
          <Route path="fees/generate" element={<GenerateFees />} />
          <Route path="fees/approvals" element={<Approvals />} />
          <Route path="fees/collect" element={<CollectFees />} />
          <Route path="fees/pending" element={<PendingDues />} />
          <Route path="fees/adhoc" element={<AdhocFees />} />
          <Route path="fees/invoices" element={<Invoices />} />
          <Route path="fees/reports" element={<FeeReports />} />
          {/* Daily */}
          <Route path="daily/feed" element={<DiaryFeed />} />
          <Route path="daily/logs" element={<DailyLogs />} />
          <Route path="daily/checkin" element={<CheckInOut />} />
          <Route path="daily/albums" element={<Albums />} />
          <Route path="daily/homework" element={<HomeworkPage />} />
          {/* Communications */}
          <Route path="comms/announcements" element={<Announcements />} />
          <Route path="comms/chat" element={<Chat />} />
          <Route path="comms/calendar" element={<CalendarEvents />} />
          <Route path="comms/worksheets" element={<Worksheets />} />
          {/* Setup / Administration */}
          <Route path="setup" element={<SetupLayout />}>
            <Route index element={<SetupOverview />} />
            <Route path="sessions" element={<Sessions />} />
            <Route path="classes" element={<ClassList />} />
            <Route path="classes/transfer" element={<TransferClass />} />
            <Route path="classes/breakup" element={<BreakupReports />} />
            <Route path="classes/attendance" element={<AttendanceReports />} />
            <Route path="staff" element={<StaffList />} />
            <Route path="staff/new" element={<StaffForm />} />
            <Route path="staff/attendance" element={<StaffAttendance />} />
            <Route path="staff/:id/edit" element={<StaffForm />} />
            <Route path="staff/:id/access" element={<StaffAccess />} />
            <Route path="daycare" element={<DayCareLayout />}>
              <Route index element={<DayCareActivities />} />
              <Route path="activities" element={<DayCareActivities />} />
              <Route path="meals" element={<DayCareMeals />} />
            </Route>
            <Route path="groups" element={<Groups />} />
            <Route path="task-setup" element={<TaskSetupLayout />}>
              <Route index element={<TaskCategories />} />
              <Route path="priorities" element={<TaskPriorities />} />
              <Route path="tags" element={<TaskTags />} />
              <Route path="templates" element={<TaskTemplates />} />
              <Route path="day-end-forms" element={<DayEndForms />} />
              <Route path="escalation" element={<EscalationPolicies />} />
            </Route>
            <Route path="classes/new" element={<ClassForm />} />
            <Route path="classes/:id/edit" element={<ClassForm />} />
          </Route>
          {/* Tasks */}
          <Route path="tasks" element={<TasksLayout />}>
            {/* a login lands on Today, not on the full task list */}
            <Route index element={<Today />} />
            <Route path="mine" element={<MyTasks />} />
            <Route path="assigned" element={<AssignedByMe />} />
            <Route path="approvals" element={<TaskApprovals />} />
            <Route path="reports" element={<TaskReports />} />
            <Route path="behind" element={<Behind />} />
            <Route path="blocked" element={<Blocked />} />
            <Route path="day-end" element={<DayEnd />} />
            <Route path="day-end/received" element={<DayEndReceived />} />
          </Route>
          <Route path="tasks/new" element={<TaskForm />} />
          <Route path="tasks/:id/edit" element={<TaskForm />} />
          <Route path="tasks/instances/:id" element={<TaskDetail />} />
          {/* Organisation */}
          <Route path="org" element={<OrgLayout />}>
            <Route index element={<OrgChart />} />
            <Route path="levels" element={<Levels />} />
            <Route path="positions" element={<Positions />} />
          </Route>
          {/* Settings */}
          <Route path="settings" element={<Settings />} />
        </Route>

        {/* Parent portal */}
        <Route
          path="/parent"
          element={
            <Protected parent>
              <ParentLayout />
            </Protected>
          }
        >
          <Route index element={<ParentHome />} />
          <Route path="attendance" element={<ParentAttendance />} />
          <Route path="fees" element={<ParentFees />} />
          <Route path="chat" element={<ParentChat />} />
          <Route path="notices" element={<ParentNotices />} />
          <Route path="calendar" element={<ParentCalendar />} />
          <Route path="leave" element={<ParentLeave />} />
          <Route path="worksheets" element={<ParentWorksheets />} />
          <Route path="profile" element={<ParentProfile />} />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
