import React from "react";
import {
  Avatar,
  Badge,
  Card,
  FluentProvider,
  ProgressBar,
  Text,
  Title2,
  Title3,
  makeStyles,
  tokens,
  webDarkTheme,
  webLightTheme,
} from "@fluentui/react-components";
import type { DetailData } from "../types";
import { useStructuredContent } from "../hooks/useStructuredContent";

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
  hero: { display: "grid", gap: tokens.spacingVerticalS, padding: tokens.spacingVerticalL },
  row: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: tokens.spacingHorizontalM, flexWrap: "wrap" },
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: tokens.spacingHorizontalM },
  listCard: { display: "grid", gap: tokens.spacingVerticalS, padding: tokens.spacingVerticalL },
  muted: { color: tokens.colorNeutralForeground3 },
});

const DEBUG_DATA: DetailData = {
  probationer: {
    id: "PR001", fullName: "Sarah Martinez", email: "sarah.martinez@contoso.com", jobTitle: "Software Engineer", department: "Engineering", startDate: "2026-01-15", endDate: "2026-07-15", status: "In Progress", notes: "Strong onboarding progress with solid peer feedback.", imageUrl: "https://i.pravatar.cc/150?img=32", derivedStatus: "on-track", statusLabel: "On Track", statusColor: "#4caf50", timelineProgress: 68, daysRemaining: 43, currentMonth: 5, completedCheckIns: 4, totalCheckIns: 6, objectivesCompleted: 1, totalObjectives: 3,
  },
  objectives: [],
  checkIns: [],
};

function getTheme() {
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? webDarkTheme : webLightTheme;
}

export function App() {
  const styles = useStyles();
  const { data } = useStructuredContent<DetailData>();
  const resolved = data ?? DEBUG_DATA;
  const { probationer, objectives, checkIns } = resolved;

  return (
    <FluentProvider theme={getTheme()}>
      <div className={styles.root}>
        <Card className={styles.hero}>
          <div className={styles.row}>
            <div className={styles.row}>
              <Avatar name={probationer.fullName} image={{ src: probationer.imageUrl }} size={48} />
              <div>
                <Title2>{probationer.fullName}</Title2>
                <Text className={styles.muted}>{probationer.jobTitle} · {probationer.department}</Text>
              </div>
            </div>
            <Badge appearance="filled" color="informative" style={{ backgroundColor: probationer.statusColor, color: "white" }}>{probationer.statusLabel}</Badge>
          </div>
          <Text>{probationer.notes}</Text>
          <div><Text className={styles.muted}>Probation timeline</Text><ProgressBar value={probationer.timelineProgress / 100} thickness="large" /></div>
          <div className={styles.row}><Text>Month {probationer.currentMonth} of 6</Text><Text>{probationer.daysRemaining} days remaining</Text></div>
        </Card>
        <div className={styles.grid}>
          <Card className={styles.listCard}>
            <Title3>Objectives</Title3>
            {objectives.map((objective) => (
              <Card key={objective.id} className={styles.listCard}>
                <div className={styles.row}><Text weight="semibold">{objective.objective}</Text><Badge>{objective.status}</Badge></div>
                <Text>{objective.description}</Text>
                <Text className={styles.muted}>Target: {objective.targetDate}</Text>
                <ProgressBar value={objective.progress / 100} />
              </Card>
            ))}
            {objectives.length === 0 && <Text>No objectives available.</Text>}
          </Card>
          <Card className={styles.listCard}>
            <Title3>Monthly check-ins</Title3>
            {checkIns.map((checkIn) => (
              <Card key={checkIn.id} className={styles.listCard}>
                <div className={styles.row}><Text weight="semibold">{checkIn.checkInName}</Text><Badge>{checkIn.status}</Badge></div>
                <Text className={styles.muted}>Scheduled: {checkIn.scheduledDate}</Text>
                <Text>Rating: {checkIn.overallRating || "Pending"}</Text>
                <Text>{checkIn.notes || "No notes recorded."}</Text>
              </Card>
            ))}
            {checkIns.length === 0 && <Text>No check-ins available.</Text>}
          </Card>
        </div>
      </div>
    </FluentProvider>
  );
}
