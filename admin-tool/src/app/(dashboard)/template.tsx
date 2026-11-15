// Template statt Layout: wird bei jedem Seitenwechsel neu gemountet, damit die Einblendung jedes Mal läuft.
export default function DashboardTemplate({ children }: { children: React.ReactNode }) {
  return <div className="page-enter">{children}</div>;
}
