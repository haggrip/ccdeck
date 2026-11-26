// The brief's summary as bullets, each led by its subject in bold
// (status-brief.ts pointLead). Mission and the phone's Status sheet draw it.
import { pointLead } from "../status-brief";

export default function BriefPoints({ points, className }: { points: readonly string[]; className: string }) {
  return (
    <ul className={className}>
      {points.map((p, i) => {
        const { lead, rest } = pointLead(p);
        return <li key={i}>{lead && <><strong>{lead}</strong>{": "}</>}{rest}</li>;
      })}
    </ul>
  );
}
