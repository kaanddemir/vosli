import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { FoxArt, FoxButton, useFox } from './FoxMascot';

/** An original Berlin roofline, drawn only from tokens so it follows the theme. Paths are static and hand-tuned around the center house. */
const NEAR = 'M-68 240V160H-4V134H6.25V123H16.5V112H26.75V101H47.25V112H57.5V123H67.75V134H78V148L114 114L150 148V124L159 104H227L236 124V164L273 130L310 164V136H321.25V125H332.5V114H343.75V103H366.25V114H377.5V125H388.75V136H400V156H464V128L473 108H547L556 128V162L591 128L626 162V142H635.75V131H645.5V120H655.25V109H674.75V120H684.5V131H694.25V142H704V150L720 149H880L896 150V138L938 104L980 138V168H1052V126H1064V115H1076V104H1088V93H1112V104H1124V115H1136V126H1148V158L1157 138H1205L1214 158V142L1260 108L1306 142V120L1315 100H1367L1376 120V160H1387V149H1398V138H1409V127H1431V138H1442V149H1453V160H1464V134L1502 100L1540 134V150H1624V126L1654 92L1684 126V240Z';
const FAR = 'M0 240V150V118H70V96H160V128H220V104H330V88H410V122H480V110H580V92H670V126H730V106H850V94H930V116H1030V100H1090V124H1180V90H1250V112H1360V120H1440V98H1500V110H1600V240ZM1178 240V58h-3V44a18 18 0 0 1-8-13 16 16 0 0 1 14-16V0h3v15a16 16 0 0 1 14 16 18 18 0 0 1-8 13v14h-3V240z';
const WINDOWS = 'M-53 172h9v14h-9zM-28 172h9v14h-9zM-53 199h9v14h-9zM-28 199h9v14h-9zM10 146h9v14h-9zM32 146h9v14h-9zM55 146h9v14h-9zM10 173h9v14h-9zM32 173h9v14h-9zM55 173h9v14h-9zM10 200h9v14h-9zM32 200h9v14h-9zM55 200h9v14h-9zM96 160h9v14h-9zM123 160h9v14h-9zM96 187h9v14h-9zM165 136h9v14h-9zM188 136h9v14h-9zM212 136h9v14h-9zM165 163h9v14h-9zM188 163h9v14h-9zM212 163h9v14h-9zM165 190h9v14h-9zM188 190h9v14h-9zM212 190h9v14h-9zM255 176h9v14h-9zM282 176h9v14h-9zM255 203h9v14h-9zM282 203h9v14h-9zM326 148h9v14h-9zM350 148h9v14h-9zM375 148h9v14h-9zM326 175h9v14h-9zM350 175h9v14h-9zM375 175h9v14h-9zM326 202h9v14h-9zM350 202h9v14h-9zM375 202h9v14h-9zM415 168h9v14h-9zM440 168h9v14h-9zM415 195h9v14h-9zM440 195h9v14h-9zM480 140h9v14h-9zM506 140h9v14h-9zM480 167h9v14h-9zM506 167h9v14h-9zM531 167h9v14h-9zM480 194h9v14h-9zM506 194h9v14h-9zM531 194h9v14h-9zM573 174h9v14h-9zM600 174h9v14h-9zM573 201h9v14h-9zM600 201h9v14h-9zM646 154h9v14h-9zM675 154h9v14h-9zM646 181h9v14h-9zM675 181h9v14h-9zM646 208h9v14h-9zM675 208h9v14h-9zM717 162h9v14h-9zM740 162h9v14h-9zM762 162h9v14h-9zM784 162h9v14h-9zM807 162h9v14h-9zM829 162h9v14h-9zM851 162h9v14h-9zM874 162h9v14h-9zM717 189h9v14h-9zM740 189h9v14h-9zM762 189h9v14h-9zM784 189h9v14h-9zM829 189h9v14h-9zM851 189h9v14h-9zM874 189h9v14h-9zM910 150h9v14h-9zM934 150h9v14h-9zM957 150h9v14h-9zM910 177h9v14h-9zM934 177h9v14h-9zM957 177h9v14h-9zM910 204h9v14h-9zM934 204h9v14h-9zM957 204h9v14h-9zM998 180h9v14h-9zM1025 180h9v14h-9zM998 207h9v14h-9zM1025 207h9v14h-9zM1069 138h9v14h-9zM1096 138h9v14h-9zM1122 138h9v14h-9zM1069 165h9v14h-9zM1096 165h9v14h-9zM1122 165h9v14h-9zM1069 192h9v14h-9zM1096 192h9v14h-9zM1122 192h9v14h-9zM1164 170h9v14h-9zM1189 170h9v14h-9zM1164 197h9v14h-9zM1230 154h9v14h-9zM1256 154h9v14h-9zM1281 154h9v14h-9zM1230 181h9v14h-9zM1256 181h9v14h-9zM1281 181h9v14h-9zM1230 208h9v14h-9zM1256 208h9v14h-9zM1281 208h9v14h-9zM1323 132h9v14h-9zM1350 132h9v14h-9zM1323 159h9v14h-9zM1350 159h9v14h-9zM1323 186h9v14h-9zM1350 186h9v14h-9zM1391 172h9v14h-9zM1416 172h9v14h-9zM1440 172h9v14h-9zM1391 199h9v14h-9zM1416 199h9v14h-9zM1440 199h9v14h-9zM1483 146h9v14h-9zM1512 146h9v14h-9zM1483 173h9v14h-9zM1512 173h9v14h-9zM1483 200h9v14h-9zM1512 200h9v14h-9zM1554 162h9v14h-9zM1601 162h9v14h-9zM1554 189h9v14h-9zM1578 189h9v14h-9zM1601 189h9v14h-9zM1638 138h9v14h-9zM1661 138h9v14h-9zM1638 165h9v14h-9zM1661 165h9v14h-9zM1638 192h9v14h-9zM1661 192h9v14h-9z';
const LIT = 'M123 187h9v14h-9zM531 140h9v14h-9zM807 189h9v14h-9zM1189 197h9v14h-9zM1578 162h9v14h-9z';

interface Art {
  viewBox: string;
  string: string;
  flags: string[];
}

const NARROW: Art = { viewBox: '0 0 320 76', string: 'M0 0Q160 104 320 0', flags: ['M124.7 49.6L139.6 51.3L131.0 69.4ZM236.4 40.3L250.6 35.4L246.8 56.8Z', 'M41.9 23.7L55.5 29.9L44.4 45.8ZM152.5 52.0L167.5 52.0L160.0 71.0ZM264.5 29.9L278.1 23.7L275.6 45.8Z', 'M69.4 35.4L83.6 40.3L73.2 56.8ZM180.4 51.3L195.3 49.6L189.0 69.4Z', 'M97.0 44.1L111.7 47.4L102.0 64.7ZM208.3 47.4L223.0 44.1L218.0 64.7Z'] };
const FLAG_CLASSES = ['flag-black', 'flag-red', 'flag-gold', 'flag-cream'];

/**
 * The wide garland is drawn for the measured width rather than scaled, so a wider window gets more flags
 * and a tauter string, never bigger flags. Sizes are the largest it reaches; CSS reserves that height.
 */
const FLAG = { width: 22, height: 30, spacing: 40 };
const MAX_SAG = 72;

function wideArt(width: number): Art {
  const scale = Math.min(1, Math.max(0.55, width / 1000));
  const sag = Math.min(MAX_SAG, width * 0.06);
  const count = Math.round(width / (FLAG.spacing * scale));
  const flags = ['', '', '', ''];
  for (let i = 0; i < count; i++) {
    const t = (i + 0.75) / (count + 0.5);
    const x = t * width;
    const y = 4 * sag * t * (1 - t);
    const slope = (4 * sag * (1 - 2 * t)) / width;
    const length = Math.hypot(1, slope);
    const [ux, uy] = [1 / length, slope / length];
    const half = (FLAG.width * scale) / 2;
    const drop = FLAG.height * scale;
    flags[i % 4] += `M${(x - ux * half).toFixed(1)} ${(y - uy * half).toFixed(1)}L${(x + ux * half).toFixed(1)} ${(y + uy * half).toFixed(1)}L${(x - uy * drop * 0.55).toFixed(1)} ${(y + drop).toFixed(1)}Z`;
  }
  return { viewBox: `0 0 ${width} ${Math.ceil(sag + FLAG.height * scale + 2)}`, string: `M0 0Q${width / 2} ${2 * sag} ${width} 0`, flags };
}

/** Black, red and gold, with cream between the repeats. Phones get a fixed drawing with fewer, larger flags. */
const Garland = ({ art, name }: { art: Art; name: string }) => (
  <svg class={`today-garland today-garland-${name}`} viewBox={art.viewBox}>
    <path class="flag-string" d={art.string} />
    {art.flags.map((d, i) => <path key={i} class={FLAG_CLASSES[i]} d={d} />)}
  </svg>
);

const SETTLE_MS = 120;

/**
 * The fox rises behind the rooftops like the sun, on the same axis as the actions above it. The drawing is
 * decorative, so only the button over it is exposed. It is its own component so petting never redraws the garland.
 */
function Rooftops() {
  const fox = useFox();
  return (
    <div class="today-scene">
      {/* One drawing, so the fox stays behind its ridge at any size. Slice crops the sides on narrow windows. */}
      <svg class="today-scene-art" viewBox="0 0 1600 240" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
        <path class="scene-far" d={FAR} />
        <FoxArt {...fox.art} />
        <path class="scene-near" d={NEAR} />
        <path class="scene-window" d={WINDOWS} />
        <path class="scene-lit" d={LIT} />
      </svg>
      <FoxButton {...fox.button} />
    </div>
  );
}

export function HomeScene() {
  const bunting = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  // Before paint, so the garland never shows at a wrong size.
  useLayoutEffect(() => {
    const el = bunting.current!;
    const measure = () => setWidth(Math.round(el.getBoundingClientRect().width));
    measure();
    // While the menu or the window is moving, the drawing just scales. Drawing every step would make flags pop in and out.
    let settle = 0;
    const observer = new ResizeObserver(() => {
      clearTimeout(settle);
      settle = window.setTimeout(measure, SETTLE_MS);
    });
    observer.observe(el);
    return () => {
      observer.disconnect();
      clearTimeout(settle);
    };
  }, []);

  return (
    <>
      <div class="today-bunting" aria-hidden="true" ref={bunting}>
        <Garland art={NARROW} name="narrow" />
        {width > 0 && <Garland key={width} art={wideArt(width)} name="wide" />}
      </div>
      <Rooftops />
    </>
  );
}
