import React from "react";
import {
  Badge,
  Card,
  FluentProvider,
  Text,
  Title2,
  Title3,
  makeStyles,
  tokens,
  webDarkTheme,
  webLightTheme,
} from "@fluentui/react-components";
import type { ReportsData } from "../types";
import { useStructuredContent } from "../hooks/useStructuredContent";

const DEBUG_DATA: ReportsData = {
  stats: { totalProbationers: 5, totalObjectives: 12, checkInRate: 48, successRate: 50 },
  statusDistribution: [
    { label: "On Track", count: 2, color: "#4caf50" },
    { label: "Attention Needed", count: 1, color: "#ff9800" },
  ],
  departmentBreakdown: [
    { department: "Engineering", total: 2, active: 2 },
    { department: "Sales", total: 1, active: 1 },
  ],
  objectiveStats: { total: 12, completed: 5, inProgress: 4, notStarted: 3 },
  checkInStats: { total: 30, completed: 14, missed: 1, scheduled: 15 },
  upcomingReviews: [],
};

const useStyles = makeStyles({
  root: {
    padding: tokens.spacingVerticalXL,
    backgroundColor: tokens.colorNeutralBackground2,
    display: "grid",
    gap: tokens.spacingVerticalL,
    minHeight: "100vh",
    boxSizing: "border-box",
    "@media (prefers-color-scheme: dark)": { backgroundColor: "#111827" },
  },
  statsGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: tokens.spacingHorizontalM },
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: tokens.spacingHorizontalM },
  card: { display: "grid", gap: tokens.spacingVerticalS, padding: tokens.spacingVerticalL },
  barRow: { display: "grid", gap: tokens.spacingVerticalXS },
  barTrack: { height: "10px", width: "100%", borderRadius: tokens.borderRadiusMedium, backgroundColor: tokens.colorNeutralBackground4, overflow: "hidden" },
  muted: { color: tokens.colorNeutralForeground3 },
});

function getTheme() {
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? webDarkTheme : webLightTheme;
}

function MetricCard({ label, value }: { label: string; value: string | number }) {
  const styles = useStyles();
  return <Card className={styles.card}><Text className={styles.muted}>{label}</Text><Title2>{value}</Title2></Card>;
}

export function App() {
  const styles = useStyles();
  const { data } = useStructuredContent<ReportsData>();
  const resolved = data ?? DEBUG_DATA;

  return (
    <FluentProvider theme={getTheme()}>
      <div className={styles.root}>
        <div><Title2>Probation Reports</Title2><Text className={styles.muted}>A quick view of completion, risk, and upcoming review activity.</Text></div>
        <div className={styles.statsGrid}>
          <MetricCard label="Probationers" value={resolved.stats.totalProbationers} />
          <MetricCard label="Objectives" value={resolved.stats.totalObjectives} />
          <MetricCard label="Check-in rate" value={`${resolved.stats.checkInRate}%`} />
          <MetricCard label="Success rate" value={`${resolved.stats.successRate}%`} />
        </div>
        <div className={styles.grid}>
          <Card className={styles.card}>
            <Title3>Status distribution</Title3>
            {resolved.statusDistribution.map((item) => (
              <div key={item.label} className={styles.barRow}>
                <div style={{ display: "flex", justifyContent: "space-between" }}><Text>{item.label}</Text><Badge>{item.count}</Badge></div>
                <div className={styles.barTrack}><div style={{ width: `${Math.max(10, item.count * 20)}%`, height: "100%", backgroundColor: item.color }} /></div>
              </div>
            ))}
          </Card>
          <Card className={styles.card}>
            <Title3>Department breakdown</Title3>
            {resolved.departmentBreakdown.map((item) => (
              <div key={item.department} className={styles.barRow}>
                <Text weight="semibold">{item.department}</Text>
                <Text className={styles.muted}>{item.active} active of {item.total}</Text>
                <div className={styles.barTrack}><div style={{ width: `${item.total === 0 ? 0 : (item.active / item.total) * 100}%`, height: "100%", backgroundColor: tokens.colorBrandBackground }} /></div>
              </div>
            ))}
          </Card>
          <Card className={styles.card}>
            <Title3>Objective progress</Title3>
            <Text>Completed: {resolved.objectiveStats.completed}</Text>
            <Text>In Progress: {resolved.objectiveStats.inProgress}</Text>
            <Text>Not Started: {resolved.objectiveStats.notStarted}</Text>
          </Card>
          <Card className={styles.card}>
            <Title3>Check-in health</Title3>
            <Text>Completed: {resolved.checkInStats.completed}</Text>
            <Text>Missed: {resolved.checkInStats.missed}</Text>
            <Text>Scheduled: {resolved.checkInStats.scheduled}</Text>
          </Card>
        </div>
        <Card className={styles.card}>
          <Title3>Upcoming reviews</Title3>
          {resolved.upcomingReviews.map((review) => (
            <div key={review.id} style={{ display: "flex", justifyContent: "space-between", gap: tokens.spacingHorizontalM, flexWrap: "wrap" }}>
              <Text>{review.fullName} · {review.department}</Text>
              <Text className={styles.muted}>{review.endDate} ({review.daysRemaining} days)</Text>
            </div>
          ))}
          {resolved.upcomingReviews.length === 0 && <Text>No upcoming reviews in the next 60 days.</Text>}
        </Card>
      </div>
    </FluentProvider>
  );
}
