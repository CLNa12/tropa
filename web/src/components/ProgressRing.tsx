// Колечко прогресса рядом со строкой этапа — как на референсе.
interface Props {
  done: number;
  total: number;
  size?: number;
  color?: string;
}

export function ProgressRing({ done, total, size = 13, color = '#7c6cf0' }: Props) {
  const share = total === 0 ? 0 : done / total;
  const r = (size - 2) / 2;
  const circumference = 2 * Math.PI * r;
  const full = total > 0 && done === total;

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ flex: 'none', display: 'block' }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#272a33" strokeWidth="1.6" />
      {share > 0 && (
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={full ? '#22c55e' : color}
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeDasharray={`${circumference * share} ${circumference}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      )}
      {full && (
        <path
          d={`M${size * 0.3} ${size * 0.52} L${size * 0.44} ${size * 0.66} L${size * 0.71} ${size * 0.36}`}
          fill="none"
          stroke="#22c55e"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
    </svg>
  );
}
