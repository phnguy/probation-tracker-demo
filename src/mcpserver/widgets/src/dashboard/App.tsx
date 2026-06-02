import React, { useMemo, useState } from "react";
import {
  Avatar,
  Badge,
  Button,
  Card,
  Dropdown,
  Field,
  FluentProvider,
  Input,
  Option,
  ProgressBar,
  Text,
  Title2,
  makeStyles,
  tokens,
  webDarkTheme,
  webLightTheme,
} from "@fluentui/react-components";
import type { DashboardData, ProbationerSummary } from "../types";
import { useStructuredContent } from "../hooks/useStructuredContent";

const DEBUG_DATA: DashboardData = {
  stats: { active: 2, atRisk: 1, reviewsDueSoon: 2, completed: 1 },
  probationers: [],
  allDepartments: ["Engineering", "Sales"],
  allStatuses: ["In Progress", "At Risk", "Completed"],
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
  filters: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: tokens.spacingHorizontalM, alignItems: "end" },
  cardGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: tokens.spacingHorizontalM },
  statCard: { display: "grid", gap: tokens.spacingVerticalXS, padding: tokens.spacingVerticalL },
  probationerCard: { display: "grid", gap: tokens.spacingVerticalS, padding: tokens.spacingVerticalL },
  row: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: tokens.spacingHorizontalS },
  muted: { color: tokens.colorNeutralForeground3 },
});

function getTheme() {
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? webDarkTheme : webLightTheme;
}

function StatCard({ label, value }: { label: string; value: number }) {
  const styles = useStyles();
  return <Card className={styles.statCard}><Text className={styles.muted}>{label}</Text><Title2>{value}</Title2></Card>;
}

function ProbationerCard({ person, onOpenDetails }: { person: ProbationerSummary; onOpenDetails: (name: string) => void }) {
  const styles = useStyles();
  return (
    <Card className={styles.probationerCard}>
      <div className={styles.row}>
        <div className={styles.row}>
          <Avatar name={person.fullName} image={{ src: person.imageUrl }} />
          <div>
            <Text weight="semibold">{person.fullName}</Text>
            <div><Text className={styles.muted}>{person.jobTitle}</Text></div>
          </div>
        </div>
        <Badge appearance="filled" color="informative" style={{ backgroundColor: person.statusColor, color: "white" }}>{person.statusLabel}</Badge>
      </div>
      <div className={styles.row}><Text>{person.department}</Text><Text className={styles.muted}>{person.daysRemaining} days left</Text></div>
      <div><Text className={styles.muted}>Timeline progress</Text><ProgressBar value={person.timelineProgress / 100} thickness="large" /></div>
      <div className={styles.row}><Text>Objectives</Text><Text>{person.objectivesCompleted}/{person.totalObjectives}</Text></div>
      <div className={styles.row}><Text>Check-ins</Text><Text>{person.completedCheckIns}/{person.totalCheckIns}</Text></div>
      <Button appearance="primary" onClick={() => onOpenDetails(person.fullName)}>Open details</Button>
    </Card>
  );
}

export function App() {
  const styles = useStyles();
  const { data: structured, sendChatMessage } = useStructuredContent<DashboardData>();
  const data = structured ?? DEBUG_DATA;
  const [query, setQuery] = useState("");
  const [department, setDepartment] = useState<string | undefined>();
  const [status, setStatus] = useState<string | undefined>();

  const probationers = useMemo(() => (data.probationers ?? []).filter((person) => {
    const matchesQuery = !query || `${person.fullName} ${person.jobTitle}`.toLowerCase().includes(query.toLowerCase());
    const matchesDepartment = !department || person.department === department;
    const matchesStatus = !status || person.status === status;
    return matchesQuery && matchesDepartment && matchesStatus;
  }), [data.probationers, query, department, status]);

  return (
    <FluentProvider theme={getTheme()}>
      <div className={styles.root}>
        <div><Title2>Probation Dashboard</Title2><Text className={styles.muted}>Track active probationers, risks, and upcoming reviews.</Text></div>
        <div className={styles.statsGrid}>
          <StatCard label="Active" value={data.stats.active} />
          <StatCard label="Needs attention" value={data.stats.atRisk} />
          <StatCard label="Reviews due soon" value={data.stats.reviewsDueSoon} />
          <StatCard label="Completed" value={data.stats.completed} />
        </div>
        <Card>
          <div className={styles.filters} style={{ padding: tokens.spacingVerticalL }}>
            <Field label="Search"><Input value={query} onChange={(_, value) => setQuery(value.value)} placeholder="Search name or role" /></Field>
            <Field label="Department"><Dropdown placeholder="All departments" selectedOptions={department ? [department] : []} onOptionSelect={(_, option) => setDepartment(option.optionValue || undefined)}>{data.allDepartments.map((item) => <Option key={item} value={item}>{item}</Option>)}</Dropdown></Field>
            <Field label="Status"><Dropdown placeholder="All statuses" selectedOptions={status ? [status] : []} onOptionSelect={(_, option) => setStatus(option.optionValue || undefined)}>{data.allStatuses.map((item) => <Option key={item} value={item}>{item}</Option>)}</Dropdown></Field>
            <Button appearance="secondary" onClick={() => { setQuery(""); setDepartment(undefined); setStatus(undefined); }}>Clear filters</Button>
          </div>
        </Card>
        <div className={styles.cardGrid}>
          {probationers.map((person) => <ProbationerCard key={person.id} person={person} onOpenDetails={(name) => sendChatMessage(`Show details for ${name}`)} />)}
          {probationers.length === 0 && <Card className={styles.probationerCard}><Text>No probationers match the current filters.</Text></Card>}
        </div>
      </div>
    </FluentProvider>
  );
}
