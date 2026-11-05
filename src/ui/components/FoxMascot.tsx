import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { moodAt, nightOf, type FoxMood } from '../../core/foxMood';
import { t } from '../../i18n/strings';

/** Kept outside the component: these last for the whole visit, through moving between screens, and are never saved. */
let wokenNight: string | null = null;
let winked = false;

/** A quick tap still has to be seen. */
const PET_MIN_MS = 600;
/** Pets closer together than this count as one petting, which varies the tilt. */
const PET_RUN_MS = 2500;
const LEAVE_MS = 400;
const WINK_AFTER_MS = 7000;
const WINK_RETRY_MS = 4000;
const WINK_MS = 180;
const CLOCK_CHECK_MS = 60_000;

type Face = 'wink' | 'open' | 'happy' | 'asleep';
type Pose = 'rest' | 'raised' | 'asleep';

const FACE_OF: Record<FoxMood, Face> = { mischievous: 'wink', curious: 'open', sleepy: 'asleep' };

export function useFox() {
  const [mood, setMood] = useState(() => moodAt(new Date(), wokenNight));
  const [pressed, setPressed] = useState(false);
  const [tilt, setTilt] = useState<-1 | 0 | 1>(0);
  const [noticed, setNoticed] = useState<-1 | 0 | 1>(0);
  const [winkFace, setWinkFace] = useState<Face | null>(null);
  const pet = useRef({ at: -PET_RUN_MS, run: 0, release: 0, byPointer: false });
  const leave = useRef(0);
  const busy = useRef(false);
  busy.current = pressed || noticed !== 0;

  const checkClock = () => setMood(moodAt(new Date(), wokenNight));

  // Crossing into the night, or coming back to a tab left open overnight.
  useEffect(() => {
    const clock = window.setInterval(checkClock, CLOCK_CHECK_MS);
    const onVisible = () => {
      if (!document.hidden) checkClock();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(clock);
      document.removeEventListener('visibilitychange', onVisible);
      clearTimeout(pet.current.release);
      clearTimeout(leave.current);
    };
  }, []);

  // One small sign of life per visit, and none while asleep. It waits rather than interrupting anything.
  useEffect(() => {
    if (mood === 'sleepy' || winked || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let timer = 0;
    const attempt = () => {
      if (document.hidden || busy.current) {
        timer = window.setTimeout(attempt, WINK_RETRY_MS);
        return;
      }
      winked = true;
      setWinkFace(mood === 'curious' ? 'wink' : 'open');
      timer = window.setTimeout(() => setWinkFace(null), WINK_MS);
    };
    timer = window.setTimeout(attempt, WINK_AFTER_MS);
    return () => {
      clearTimeout(timer);
      setWinkFace(null);
    };
  }, [mood]);

  const startPet = () => {
    const now = performance.now();
    const state = pet.current;
    clearTimeout(state.release);
    state.run = now - state.at < PET_RUN_MS ? state.run + 1 : 0;
    state.at = now;
    // The first pet is straight; after that the head leans one way and then the other, and goes no further.
    setTilt(state.run === 0 ? 0 : state.run % 2 ? -1 : 1);
    setPressed(true);
    if (mood === 'sleepy') {
      wokenNight = nightOf(new Date());
      checkClock();
    }
  };

  const endPet = () => {
    const state = pet.current;
    clearTimeout(state.release);
    state.release = window.setTimeout(() => {
      state.at = performance.now();
      setPressed(false);
      setTilt(0);
    }, Math.max(0, PET_MIN_MS - (performance.now() - state.at)));
  };

  const face: Face = pressed ? 'happy' : (winkFace ?? (noticed !== 0 && mood !== 'sleepy' ? 'open' : FACE_OF[mood]));
  const pose: Pose = pressed ? 'raised' : mood === 'sleepy' ? 'asleep' : 'rest';

  return {
    art: { face, pose, tilt, noticed },
    button: {
      onPointerDown(event: PointerEvent) {
        if (event.button !== 0) return;
        pet.current.byPointer = true;
        (event.currentTarget as Element).setPointerCapture(event.pointerId);
        startPet();
      },
      onPointerUp: endPet,
      onPointerCancel: endPet,
      // Keyboards and screen readers arrive here without a press, and get the same pet as a quick tap.
      onClick() {
        if (pet.current.byPointer) {
          pet.current.byPointer = false;
          return;
        }
        startPet();
        endPet();
      },
      // A mouse is noticed once, from the side it came. The fox does not follow it around.
      onPointerEnter(event: PointerEvent) {
        if (event.pointerType !== 'mouse') return;
        clearTimeout(leave.current);
        const box = (event.currentTarget as Element).getBoundingClientRect();
        setNoticed(event.clientX < box.left + box.width / 2 ? -1 : 1);
      },
      onPointerLeave(event: PointerEvent) {
        if (event.pointerType !== 'mouse') return;
        clearTimeout(leave.current);
        leave.current = window.setTimeout(() => setNoticed(0), LEAVE_MS);
      },
    },
  };
}

const EAR_LEFT = 'M78 200V96c0-16 18-24 30-14l92 78v40z';
const EAR_RIGHT = 'M434 200V96c0-16-18-24-30-14l-92 78v40z';
const HEAD = 'M256 424 92 262c-10-10-14-20-14-34v-40l122-28h112l122 28v40c0 14-4 24-14 34z';
const MASK = 'M256 400 106 252c56 0 114 26 150 84 36-58 94-84 150-84z';
const NOSE = 'M226 366c-8-8-3-20 8-20h44c11 0 16 12 8 20l-22 21c-5 4-11 4-16 0z';
const INK = '#272727';

const Dot = ({ x }: { x: number }) => <circle cx={x} cy="214" r="23" fill={INK} />;
const Arc = ({ d }: { d: string }) => <path d={d} fill="none" stroke={INK} stroke-width="17" stroke-linecap="round" />;
const WINK_RIGHT = 'M314 220c12-16 40-16 52 0';
const HAPPY_LEFT = 'M148 220c12-16 40-16 52 0';
const ASLEEP_LEFT = 'M148 208c12 16 40 16 52 0';
const ASLEEP_RIGHT = 'M314 208c12 16 40 16 52 0';

const EYES: Record<Face, ComponentChildren> = {
  wink: <><Dot x={174} /><Arc d={WINK_RIGHT} /></>,
  open: <><Dot x={174} /><Dot x={340} /></>,
  happy: <><Arc d={HAPPY_LEFT} /><Arc d={WINK_RIGHT} /></>,
  asleep: <><Arc d={ASLEEP_LEFT} /><Arc d={ASLEEP_RIGHT} /></>,
};

/**
 * The logo, in parts that can move. At rest it draws exactly vosli-mark.svg, and a test holds it to that.
 * The eyes change at once rather than fading: two faces overlapping reads as a glitch at this size.
 */
export function FoxArt({ face, pose, tilt, noticed }: ReturnType<typeof useFox>['art']) {
  return (
    <svg class="fox" x="725" y="30" width="150" height="150" viewBox="0 0 512 512" overflow="visible" data-face={face} data-pose={pose} data-tilt={tilt} data-noticed={noticed}>
      <g class="fox-body">
        <path class="fox-ear fox-ear-left" d={EAR_LEFT} fill="#B7473A" />
        <path class="fox-ear fox-ear-right" d={EAR_RIGHT} fill="#B7473A" />
        <path d={HEAD} fill="#B7473A" />
        <path d={MASK} fill="#FFFFFF" />
        <g class="fox-face">
          <path d={NOSE} fill={INK} />
          {EYES[face]}
        </g>
      </g>
    </svg>
  );
}

export const FoxButton = (handlers: ReturnType<typeof useFox>['button']) => <button type="button" class="today-fox" aria-label={t.home.petFox} {...handlers} />;
