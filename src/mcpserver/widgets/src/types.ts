export interface ProbationerSummary {
  id: string;
  fullName: string;
  email: string;
  managerEmail: string;
  jobTitle: string;
  department: string;
  startDate: string;
  endDate: string;
  status: string;
  notes: string;
  imageUrl: string;
  derivedStatus: string;
  statusLabel: string;
  statusColor: string;
  timelineProgress: number;
  daysRemaining: number;
  currentMonth: number;
  completedCheckIns: number;
  totalCheckIns: number;
  objectivesCompleted: number;
  totalObjectives: number;
}

export interface DashboardData {
  stats: {
    active: number;
    atRisk: number;
    reviewsDueSoon: number;
    completed: number;
  };
  probationers: ProbationerSummary[];
  allDepartments: string[];
  allStatuses: string[];
}

export interface Objective {
  id: string;
  probationerId: string;
  objective: string;
  description: string;
  targetDate: string;
  status: string;
  progress: number;
}

export interface CheckIn {
  id: string;
  probationerId: string;
  checkInName: string;
  checkInNumber: number;
  scheduledDate: string;
  completedDate: string;
  status: string;
  overallRating: string;
  notes: string;
}

export interface DetailData {
  probationer: ProbationerSummary;
  objectives: Objective[];
  checkIns: CheckIn[];
}

export interface ReportsData {
  stats: {
    totalProbationers: number;
    totalObjectives: number;
    checkInRate: number;
    successRate: number;
  };
  statusDistribution: Array<{ label: string; count: number; color: string }>;
  departmentBreakdown: Array<{ department: string; total: number; active: number }>;
  objectiveStats: {
    total: number;
    completed: number;
    inProgress: number;
    notStarted: number;
  };
  checkInStats: {
    total: number;
    completed: number;
    missed: number;
    scheduled: number;
  };
  upcomingReviews: Array<{
    id: string;
    fullName: string;
    department: string;
    endDate: string;
    daysRemaining: number;
  }>;
}
