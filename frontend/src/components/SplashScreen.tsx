import { useEffect, useState } from 'react';
import logo from '../assets/logo.png';

const PHRASES = [
  'Анализируем расходы',
  'Фиксируем доходы',
  'Считаем бюджет',
  'Следим за балансом',
  'Сводим концы с концами',
  'Копим на мечту',
];

export default function SplashScreen() {
  const [phraseIdx, setPhraseIdx] = useState(0);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const id = setInterval(() => {
      setVisible(false);
      setTimeout(() => {
        setPhraseIdx((i) => (i + 1) % PHRASES.length);
        setVisible(true);
      }, 300);
    }, 2200);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="splash">
      <div className="splash__logo">
        <img src={logo} alt="Budget Bot" className="splash__img" />
      </div>
      <div className="splash__name">Budget Bot</div>
      <div className="splash__phrase-wrap">
        <span className={`splash__phrase${visible ? ' splash__phrase--in' : ' splash__phrase--out'}`}>
          {PHRASES[phraseIdx]}
        </span>
        <span className="splash__dots" aria-hidden>
          <span /><span /><span />
        </span>
      </div>
    </div>
  );
}
