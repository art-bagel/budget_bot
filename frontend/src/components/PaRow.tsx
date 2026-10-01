import type { ReactNode } from 'react';

export const PA_COLORS = ['g', 'o', 'b', 'p', 'r', 'v'] as const;

/** Analytics list row in the dashboard analytics style: icon, name, amount, share bar, foot line. */
export default function PaRow({ icon, color, title, amount, amountTone, share, foot, footRight, onClick }: {
  icon: ReactNode;
  color: string;
  title: string;
  amount: ReactNode;
  amountTone?: 'pos' | 'neg' | 'mute';
  share?: number;
  foot?: ReactNode;
  footRight?: ReactNode;
  onClick?: () => void;
}) {
  const body = (
    <>
      <div className={`ana-cat__ico ana-cat__ico--${color}`}>{icon}</div>
      <div className="ana-cat__body">
        <div className="ana-cat__top">
          <span className="ana-cat__name">{title}</span>
          <span className={`ana-cat__amt${amountTone ? ` pa-amt--${amountTone}` : ''}`}>{amount}</span>
        </div>
        {share !== undefined && (
          <div className="ana-cat__bar-wrap">
            <div className={`ana-cat__fill ana-cat__fill--${color}`} style={{ width: `${Math.max(share * 100, share > 0 ? 2 : 0)}%` }} />
          </div>
        )}
        {(foot || footRight) && (
          <div className="ana-cat__foot">
            <span className="pa-row__foot">{foot}</span>
            {footRight && <span className="pa-row__foot-r">{footRight}</span>}
          </div>
        )}
      </div>
    </>
  );
  return onClick
    ? <button type="button" className="ana-cat pa-row" onClick={onClick}>{body}</button>
    : <div className="ana-cat pa-row">{body}</div>;
}
