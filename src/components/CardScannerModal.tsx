import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CatalogCard } from '../types';
import { cardThumbProps } from '../lib/supabase';
import { useBodyScrollLock } from '../lib/scrollLock';
import { detectCardBounds, type CardBounds } from '../lib/cardDetect';
import {
  computeSignature,
  matchArt,
  parseArtIndex,
  type ArtIndexEntry,
  type ArtIndexFile,
} from '../lib/cardArtMatch';
import { useLanguage } from '../lib/i18n';

interface CardScannerModalProps {
  isOpen: boolean;
  onClose: () => void;
  cards: CatalogCard[];
  game: string;
  /** Changes a card's owned count by a signed amount; the catalog owns the actual storage. */
  onChangeCount: (card: CatalogCard, isFoil: boolean, delta: number) => void;
}

interface ScannedEntry {
  card: CatalogCard;
  isFoil: boolean;
  count: number;
}

/** How often a frame is examined. Detect + signature + match is a few milliseconds. */
const FRAME_INTERVAL_MS = 120;
/** Frames that must agree before a card is taken, so a blurred in-between frame can't add a card. */
const FRAMES_TO_CONFIRM = 3;
/** Below this the card is named but not taken automatically. */
const AUTO_ACCEPT_CONFIDENCE = 0.62;
/** Frames without a card before the scanner will accept the same card again. */
const FRAMES_TO_CLEAR = 4;
/** Frames are examined at this width; enough for both locating and the signature. */
const WORKING_WIDTH = 640;
/** Most printings listed in a which-one prompt. */
const MAX_CHOICES = 6;

const isPromo = (card: CatalogCard) => /-P(-|$)/i.test(card.card_number || '') || /promo/i.test(card.name || '');

/**
 * Identifies what is under the lens as a set of cards rather than as whichever one ranked first.
 * Printings of the same artwork trade places at the top from frame to frame; the group they form
 * doesn't change.
 */
const groupKey = (cards: CatalogCard[]) => cards.map((c) => c.id).sort().join('|');

/**
 * A fixed order for cards that share artwork: regular printings first, promos last, then by number.
 *
 * Their match distances differ by a bit or two of camera noise, so ranking by distance reshuffles
 * them on every frame and the button under the user's thumb moves as they tap it.
 */
function stableOrder(cards: CatalogCard[]): CatalogCard[] {
  return [...cards].sort(
    (a, b) => Number(isPromo(a)) - Number(isPromo(b)) || (a.card_number || '').localeCompare(b.card_number || '')
  );
}

export function CardScannerModal({ isOpen, onClose, cards, game, onChangeCount }: CardScannerModalProps) {
  const { t, lang } = useLanguage();
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const workCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const indexRef = useRef<ArtIndexEntry[] | null>(null);
  const busyRef = useRef(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const aliveRef = useRef(false);

  /** Which card the recent frames have been agreeing on, for how many, and the best look so far. */
  const streakRef = useRef<{ id: string | null; frames: number; confidence: number }>({ id: null, frames: 0, confidence: 0 });
  /** Blocks re-adding the card still sitting under the lens; cleared once it leaves. */
  const heldIdRef = useRef<string | null>(null);
  /** The printing group in view on the latest frame, so dismissing/choosing can mark exactly it as handled. */
  const currentGroupRef = useRef<string | null>(null);
  const emptyFramesRef = useRef(0);

  const [status, setStatus] = useState<'idle' | 'starting' | 'scanning' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [choices, setChoices] = useState<CatalogCard[]>([]);
  const [seeing, setSeeing] = useState<CardBounds | null>(null);
  const [addFoil, setAddFoil] = useState(false);
  const [session, setSession] = useState<ScannedEntry[]>([]);
  /** The most recent add, kept so a wrong one can be undone in a tap. */
  const [lastAdded, setLastAdded] = useState<{ card: CatalogCard; isFoil: boolean } | null>(null);
  const [listOpen, setListOpen] = useState(true);
  const [torchOn, setTorchOn] = useState(false);
  const [hasTorch, setHasTorch] = useState(false);
  const [readingPhoto, setReadingPhoto] = useState(false);

  // Rebuilt only when the catalog changes, not on every scanned frame's re-render.
  const cardsById = useMemo(() => new Map(cards.map((c) => [c.id, c])), [cards]);
  const cardsByIdRef = useRef(cardsById);
  cardsByIdRef.current = cardsById;

  const addFoilRef = useRef(addFoil);
  addFoilRef.current = addFoil;

  // The catalog hands over a new callback on every render; reading it through a ref keeps the scan
  // loop's identity stable so adding a card never restarts the camera.
  const onChangeCountRef = useRef(onChangeCount);
  onChangeCountRef.current = onChangeCount;
  const sessionRef = useRef<ScannedEntry[]>([]);
  sessionRef.current = session;

  useEffect(() => {
    aliveRef.current = isOpen;
    return () => { aliveRef.current = false; };
  }, [isOpen]);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  /** Loads the artwork index once per session; it's a ~150KB static file. */
  const ensureIndex = useCallback(async () => {
    if (indexRef.current) return indexRef.current;
    const res = await fetch('/card-art-index.json');
    if (!res.ok) throw new Error('index unavailable');
    const file: ArtIndexFile = await res.json();
    indexRef.current = parseArtIndex(file, game);
    return indexRef.current;
  }, [game]);

  const addToSession = useCallback(
    (card: CatalogCard) => {
      const isFoil = addFoilRef.current;
      onChangeCountRef.current(card, isFoil, 1);
      setSession((prev) => {
        const same = (e: ScannedEntry) => e.card.id === card.id && e.isFoil === isFoil;
        if (prev.some(same)) return prev.map((e) => (same(e) ? { ...e, count: e.count + 1 } : e));
        return [{ card, isFoil, count: 1 }, ...prev];
      });
      setLastAdded({ card, isFoil });
      setChoices([]);
    },
    []
  );

  /** Adjusts one row of the scanned list, in the collection and in the list together. */
  const changeEntry = useCallback((entry: ScannedEntry, delta: number) => {
    onChangeCountRef.current(entry.card, entry.isFoil, delta);
    setSession((prev) =>
      prev.flatMap((e) => {
        if (e.card.id !== entry.card.id || e.isFoil !== entry.isFoil) return [e];
        const count = e.count + delta;
        return count > 0 ? [{ ...e, count }] : [];
      })
    );
    setLastAdded((last) => (last && last.card.id === entry.card.id && last.isFoil === entry.isFoil ? null : last));
  }, []);

  const removeEntry = useCallback((entry: ScannedEntry) => changeEntry(entry, -entry.count), [changeEntry]);

  /**
   * Takes back the card that was just added. The card is usually still under the lens, so it stays
   * "held" and won't be scanned straight back in; it has to leave view first.
   */
  const undoLast = useCallback(() => {
    if (!lastAdded) return;
    const entry = sessionRef.current.find((e) => e.card.id === lastAdded.card.id && e.isFoil === lastAdded.isFoil);
    if (entry) changeEntry(entry, -1);
    setLastAdded(null);
  }, [lastAdded, changeEntry]);

  /**
   * Shows a which-printing prompt, leaving it untouched if it already lists the same cards so the
   * options stay put under the user's finger for as long as the card stays in view.
   */
  const showChoices = useCallback((next: CatalogCard[]) => {
    // Order first, then cap, so which printings make the cut can't vary with the frame's noise.
    const ordered = stableOrder(next).slice(0, MAX_CHOICES);
    setChoices((prev) =>
      prev.length === ordered.length && prev.every((c, i) => c.id === ordered[i].id) ? prev : ordered
    );
  }, []);

  /** Dismisses an unanswered prompt without letting the same card re-open it while still in view. */
  const dismissChoices = useCallback(() => {
    if (currentGroupRef.current) heldIdRef.current = currentGroupRef.current;
    setChoices([]);
  }, [choices]);

  /**
   * Locates the card in one image and ranks the catalog against its artwork.
   *
   * Prints that share a picture come back together, so the caller can tell "this is the card" from
   * "this is the card, but which printing".
   */
  const identify = useCallback(
    async (source: CanvasImageSource, width: number, height: number) => {
      const index = await ensureIndex();
      const bounds = detectCardBounds(source, width, height);
      if (!bounds) return { bounds: null, matches: [] as CatalogCard[], confidence: 0 };

      const crop = document.createElement('canvas');
      crop.width = Math.max(1, Math.round(bounds.width));
      crop.height = Math.max(1, Math.round(bounds.height));
      crop
        .getContext('2d', { willReadFrequently: true })!
        .drawImage(source, bounds.x, bounds.y, bounds.width, bounds.height, 0, 0, crop.width, crop.height);

      const ranked = matchArt(computeSignature(crop, crop.width, crop.height), index);
      const matches = ranked
        .map((m) => cardsByIdRef.current.get(m.id))
        .filter((c): c is CatalogCard => Boolean(c));
      return { bounds, matches, confidence: ranked[0]?.confidence ?? 0 };
    },
    [ensureIndex]
  );

  /**
   * Draws what the screen is showing into the reusable working canvas.
   *
   * The video fills the stage with object-cover, which crops whichever axis overflows. The frame is
   * cropped the same way here, so a card the user can see is a card that gets read, and positions
   * found in it map straight back onto the screen.
   */
  const grabFrame = useCallback(() => {
    const video = videoRef.current;
    const stage = stageRef.current;
    if (!video?.videoWidth || !stage?.clientWidth || !stage.clientHeight) return null;

    const stageAspect = stage.clientWidth / stage.clientHeight;
    const videoAspect = video.videoWidth / video.videoHeight;
    let sx = 0;
    let sy = 0;
    let sw = video.videoWidth;
    let sh = video.videoHeight;
    if (videoAspect > stageAspect) {
      sw = video.videoHeight * stageAspect;
      sx = (video.videoWidth - sw) / 2;
    } else {
      sh = video.videoWidth / stageAspect;
      sy = (video.videoHeight - sh) / 2;
    }

    const canvas = (workCanvasRef.current ||= document.createElement('canvas'));
    const scale = Math.min(1, WORKING_WIDTH / sw);
    canvas.width = Math.round(sw * scale);
    canvas.height = Math.round(sh * scale);
    canvas.getContext('2d', { willReadFrequently: true })!.drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    return canvas;
  }, []);

  const scanTick = useCallback(async () => {
    if (!aliveRef.current || busyRef.current) return;
    busyRef.current = true;
    try {
      const frame = grabFrame();
      if (!frame) return;

      const { bounds, matches, confidence } = await identify(frame, frame.width, frame.height);
      if (!aliveRef.current) return;

      setSeeing(
        bounds
          ? { x: bounds.x / frame.width, y: bounds.y / frame.height, width: bounds.width / frame.width, height: bounds.height / frame.height }
          : null
      );

      if (!matches.length) {
        // Once the card is out of view the same one may be scanned again.
        if (++emptyFramesRef.current >= FRAMES_TO_CLEAR) {
          heldIdRef.current = null;
          currentGroupRef.current = null;
          streakRef.current = { id: null, frames: 0, confidence: 0 };
          setChoices([]);
        }
        return;
      }
      emptyFramesRef.current = 0;

      const topId = groupKey(matches);
      currentGroupRef.current = topId;
      const streak = streakRef.current;
      // A card is judged over a run of frames, not one: any single frame can be caught mid-blur,
      // so the run has to agree on the card and only its clearest look has to be convincing.
      streakRef.current = streak.id === topId
        ? { id: topId, frames: streak.frames + 1, confidence: Math.max(streak.confidence, confidence) }
        : { id: topId, frames: 1, confidence };

      if (streakRef.current.frames < FRAMES_TO_CONFIRM) return;
      if (heldIdRef.current === topId) return;

      if (matches.length > 1) {
        // Several printings share this artwork, so it isn't ours to choose.
        showChoices(matches);
        return;
      }
      if (streakRef.current.confidence < AUTO_ACCEPT_CONFIDENCE) {
        showChoices(matches);
        return;
      }

      heldIdRef.current = topId;
      addToSession(matches[0]);
    } catch (e) {
      // One bad frame doesn't matter; the next tick tries again.
    } finally {
      busyRef.current = false;
    }
  }, [grabFrame, identify, addToSession, showChoices]);

  /**
   * The scan loop is reached through a ref so the camera effect can depend on nothing but isOpen.
   *
   * Adding a card re-renders the catalog above us, which hands us a fresh onAddCard; if that
   * reached the effect's dependencies it would tear the camera down and stop the track, and the
   * scanner would die after the very first card it recognised.
   */
  const scanTickRef = useRef(scanTick);
  scanTickRef.current = scanTick;

  // Camera lifecycle
  useEffect(() => {
    if (!isOpen) return;
    aliveRef.current = true;
    setStatus('starting');
    setErrorMsg(null);

    let interval: number | undefined;
    (async () => {
      try {
        await ensureIndex();
        // Ask for frames shaped like the screen. The view crops to fill, so a landscape stream on a
        // portrait screen would zoom in and cut the card off at the sides.
        const stage = stageRef.current;
        const portrait = !stage || stage.clientHeight >= stage.clientWidth;
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: portrait ? 1080 : 1920 },
            height: { ideal: portrait ? 1920 : 1080 },
          },
        });
        if (!aliveRef.current) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }

        const track = stream.getVideoTracks()[0];
        const caps: any = track?.getCapabilities?.() ?? {};
        setHasTorch(Boolean(caps.torch));
        // Cards are held close, so keep the lens hunting rather than locked on the room.
        if (caps.focusMode?.includes('continuous')) {
          await track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] } as any).catch(() => {});
        }

        setStatus('scanning');
        interval = window.setInterval(() => scanTickRef.current(), FRAME_INTERVAL_MS);
      } catch (e: any) {
        if (!aliveRef.current) return;
        setStatus('error');
        setErrorMsg(
          e?.message === 'index unavailable'
            ? t('The card index is missing. Run scripts/build_card_art_index.mjs.', 'A kártyaindex hiányzik. Futtasd a scripts/build_card_art_index.mjs parancsot.')
            : e?.name === 'NotAllowedError'
              ? t('Camera access was blocked. Allow it for this site, or use "Scan a photo" below.', 'A kamera hozzáférés le van tiltva. Engedélyezd az oldal számára, vagy használd a lenti „Fotó beolvasása” lehetőséget.')
              : t('No camera available here. Use "Scan a photo" below instead.', 'Nem található használható kamera. Használd a lenti „Fotó beolvasása” lehetőséget helyette.')
        );
      }
    })();

    return () => {
      aliveRef.current = false;
      if (interval) window.clearInterval(interval);
      stopCamera();
    };
  }, [isOpen, ensureIndex, stopCamera]);

  useEffect(() => {
    if (isOpen) return;
    setChoices([]);
    setSession([]);
    setLastAdded(null);
    setSeeing(null);
    streakRef.current = { id: null, frames: 0, confidence: 0 };
    heldIdRef.current = null;
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  useBodyScrollLock(isOpen);

  const toggleTorch = async () => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    const next = !torchOn;
    try {
      await track.applyConstraints({ advanced: [{ torch: next }] } as any);
      setTorchOn(next);
    } catch (e) {
      setHasTorch(false);
    }
  };

  const handlePhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setErrorMsg(null);
    setReadingPhoto(true);
    try {
      const bitmap = await createImageBitmap(file);
      const { matches } = await identify(bitmap, bitmap.width, bitmap.height);
      if (!matches.length) {
        setErrorMsg(t("Couldn't find a card in that photo. Try a plainer background.", 'Nem található kártya a fotón. Próbáld egyszerűbb háttér előtt.'));
        return;
      }
      showChoices(matches);
    } catch (err) {
      setErrorMsg(t("Couldn't read that image.", 'Nem sikerült beolvasni a képet.'));
    } finally {
      setReadingPhoto(false);
    }
  };

  if (!isOpen) return null;

  const live = status === 'scanning';
  const sessionTotal = session.reduce((sum, e) => sum + e.count, 0);
  const foundCard = live && Boolean(seeing);

  return (
    <div
      className="fixed inset-0 z-[120] bg-black text-white select-none overflow-hidden"
      style={{ height: '100dvh' }}
      role="dialog"
      aria-label={t('Scan cards', 'Kártyák beolvasása')}
    >
      {/* The camera fills the screen. Frames are cropped to exactly this view before they're read, so
          what's on screen is what's being scanned and the outline sits on the card it found. */}
      <div ref={stageRef} className="absolute inset-0 overflow-hidden">
        <video ref={videoRef} playsInline muted className="w-full h-full object-cover" />

        {foundCard && seeing && (
          <div
            className="absolute rounded-xl pointer-events-none"
            style={{
              left: `${seeing.x * 100}%`,
              top: `${seeing.y * 100}%`,
              width: `${seeing.width * 100}%`,
              height: `${seeing.height * 100}%`,
              border: `2px solid ${lastAdded ? '#10b981' : 'rgba(255,255,255,0.9)'}`,
              boxShadow: '0 0 0 1px rgba(0,0,0,0.35)',
              transition: 'all 0.12s linear',
            }}
          />
        )}

        {status === 'starting' && (
          <div className="absolute inset-0 flex items-center justify-center text-sm font-bold text-white/80">
            {t('Starting camera…', 'Kamera indítása…')}
          </div>
        )}
      </div>

      {/* Top bar */}
      <div
        className="absolute top-0 inset-x-0 z-10 flex items-center gap-2 px-3 pb-8"
        style={{
          paddingTop: 'max(12px, env(safe-area-inset-top))',
          background: 'linear-gradient(to bottom, rgba(0,0,0,0.75), transparent)',
        }}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label={t('Close scanner', 'Szkenner bezárása')}
          className="w-10 h-10 shrink-0 flex items-center justify-center rounded-full bg-black/55 border border-white/15 text-white cursor-pointer active:scale-95"
        >
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
        </button>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-black leading-tight">{t('Scan cards', 'Kártyák beolvasása')}</div>
          <div className="text-[11px] text-white/70 leading-tight truncate">{t('Each card is added as it\'s recognised', 'Minden kártya automatikusan rögzül a felismeréskor')}</div>
        </div>

        <button
          type="button"
          onClick={() => setAddFoil((v) => !v)}
          aria-pressed={addFoil}
          className="h-10 px-3.5 rounded-full text-xs font-black border cursor-pointer active:scale-95"
          style={{
            background: addFoil ? 'var(--accent)' : 'rgba(0,0,0,0.55)',
            borderColor: addFoil ? 'var(--accent)' : 'rgba(255,255,255,0.15)',
            color: addFoil ? 'var(--text-on-accent, #000)' : '#fff',
          }}
        >
          Foil
        </button>
        {hasTorch && live && (
          <button
            type="button"
            onClick={toggleTorch}
            aria-pressed={torchOn}
            aria-label={t('Toggle light', 'Lámpa ki/be')}
            className="w-10 h-10 shrink-0 flex items-center justify-center rounded-full border cursor-pointer active:scale-95"
            style={{
              background: torchOn ? 'var(--accent)' : 'rgba(0,0,0,0.55)',
              borderColor: torchOn ? 'var(--accent)' : 'rgba(255,255,255,0.15)',
              color: torchOn ? 'var(--text-on-accent, #000)' : '#fff',
            }}
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill={torchOn ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={2} strokeLinejoin="round"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" /></svg>
          </button>
        )}
      </div>

      {/* Everything below sits on top of the camera, so nothing needs scrolling to see. */}
      <div
        className="absolute bottom-0 inset-x-0 z-10 flex flex-col gap-2 px-3 pt-16 pointer-events-none"
        style={{
          paddingBottom: 'max(12px, env(safe-area-inset-bottom))',
          background: 'linear-gradient(to top, rgba(0,0,0,0.85) 50%, transparent)',
        }}
      >
        {errorMsg && (
          <div className="pointer-events-auto p-2.5 rounded-xl bg-amber-500/20 border border-amber-400/50 text-amber-100 text-xs font-semibold backdrop-blur-sm">
            {errorMsg}
          </div>
        )}

        {choices.length > 0 ? (
          <div className="pointer-events-auto rounded-2xl border border-amber-400/50 bg-black/70 backdrop-blur-md p-2.5">
            <div className="flex items-start justify-between gap-2 mb-2 px-0.5">
              <div className="text-[11px] font-black uppercase tracking-wider text-amber-300 leading-snug">
                {choices.length > 1
                  ? t('Same artwork on several printings — which one?', 'Ugyanaz az illusztráció több kiadáson — melyik?')
                  : t('Is this the card?', 'Ez a kártya?')}
              </div>
              <button
                type="button"
                onClick={dismissChoices}
                aria-label={t('Dismiss', 'Elvetés')}
                className="w-6 h-6 shrink-0 flex items-center justify-center rounded-full text-white/70 hover:text-white cursor-pointer"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
              </button>
            </div>
            <div className="flex flex-col gap-1.5">
              {choices.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => { heldIdRef.current = currentGroupRef.current; addToSession(c); }}
                  className="flex items-center gap-3 p-1.5 rounded-xl text-left cursor-pointer bg-white/10 border border-white/10 active:bg-white/20"
                >
                  <div className="w-9 h-[50px] rounded-md overflow-hidden bg-zinc-900 shrink-0">
                    {c.image_path && <img {...cardThumbProps(c.image_path, 'avatar')} alt="" className="w-full h-full object-cover" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-bold truncate">{c.name}</div>
                    <div className="text-[11px] font-mono text-white/60">{c.card_number} · {c.set_name || c.sets?.name}</div>
                  </div>
                  <span className="px-3 py-1.5 rounded-lg text-xs font-black shrink-0" style={{ background: 'var(--accent-strong)', color: 'var(--text-on-accent, #000)' }}>{t('Add', 'Hozzáadás')}</span>
                </button>
              ))}
            </div>
          </div>
        ) : lastAdded ? (
          <div className="pointer-events-auto flex items-center gap-3 rounded-2xl border border-emerald-400/50 bg-black/70 backdrop-blur-md p-2">
            <div className="w-9 h-[50px] rounded-md overflow-hidden bg-zinc-900 shrink-0">
              {lastAdded.card.image_path && <img {...cardThumbProps(lastAdded.card.image_path, 'avatar')} alt="" className="w-full h-full object-cover" />}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[10px] font-black uppercase tracking-wider text-[var(--positive)]">{lang === 'hu' ? `Hozzáadva${lastAdded.isFoil ? ' (foil)' : ''}` : `Added${lastAdded.isFoil ? ' (foil)' : ''}`}</div>
              <div className="text-sm font-bold truncate">{lastAdded.card.name}</div>
              <div className="text-[11px] font-mono text-white/60">{lastAdded.card.card_number}</div>
            </div>
            <button
              type="button"
              onClick={undoLast}
              className="h-9 px-3.5 rounded-full text-xs font-black border border-white/25 bg-white/10 cursor-pointer shrink-0 active:bg-white/25"
            >
              {t('Wrong card', 'Nem ez a kártya')}
            </button>
          </div>
        ) : (
          live && (
            <div className="self-center px-3.5 py-1.5 rounded-full bg-black/55 border border-white/10 text-xs font-semibold text-white/80">
              {foundCard ? t('Looking…', 'Keresés…') : t('Hold a card in view', 'Tarts egy kártyát a kamera elé')}
            </div>
          )
        )}

        {/* What's been scanned this session, with a way to fix mistakes */}
        <div className="pointer-events-auto rounded-2xl border border-white/10 bg-black/60 backdrop-blur-md overflow-hidden">
          <div className="flex items-center justify-between gap-2 pl-3 pr-1.5 py-1.5">
            <button
              type="button"
              onClick={() => setListOpen((v) => !v)}
              aria-expanded={listOpen}
              className="flex items-center gap-1.5 py-1 text-[11px] font-black uppercase tracking-wider text-white/80 cursor-pointer"
            >
              <svg className={`w-3.5 h-3.5 transition-transform ${listOpen ? '' : '-rotate-90'}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9" /></svg>
              {lang === 'hu' ? `Beolvasva (${sessionTotal})` : `Scanned (${sessionTotal})`}
            </button>
            <input ref={fileRef} type="file" accept="image/*" onChange={handlePhoto} className="hidden" />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={readingPhoto}
              className="h-8 px-3 rounded-full text-[11px] font-bold border border-white/15 bg-white/10 cursor-pointer disabled:opacity-50 active:bg-white/25"
            >
              {readingPhoto ? t('Reading…', 'Beolvasás…') : t('Scan a photo', 'Fotó beolvasása')}
            </button>
          </div>

          {listOpen && (
            session.length === 0 ? (
              <div className="px-3 pb-3 pt-0.5 text-xs text-white/50">{t('Cards you scan will appear here.', 'A beolvasott kártyák itt fognak megjelenni.')}</div>
            ) : (
              <ul className={`${choices.length > 0 ? 'max-h-[16dvh]' : 'max-h-[30dvh]'} overflow-y-auto custom-scrollbar divide-y divide-white/10 border-t border-white/10`}>
                {session.map((e) => (
                  <li key={`${e.card.id}-${e.isFoil}`} className="flex items-center gap-2.5 pl-2.5 pr-1.5 py-1.5">
                    <div className="w-7 h-10 rounded overflow-hidden bg-zinc-900 shrink-0">
                      {e.card.image_path && <img {...cardThumbProps(e.card.image_path, 'avatar')} alt="" className="w-full h-full object-cover" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] font-bold truncate">{e.card.name}{e.isFoil ? ' (foil)' : ''}</div>
                      <div className="text-[10px] font-mono text-white/50">{e.card.card_number}</div>
                    </div>
                    <div className="flex items-center gap-0.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => changeEntry(e, -1)}
                        aria-label={lang === 'hu' ? `Egy levonása: ${e.card.name}` : `Remove one ${e.card.name}`}
                        className="w-8 h-8 flex items-center justify-center rounded-full bg-white/10 cursor-pointer active:bg-white/25"
                      >
                        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round"><line x1="5" y1="12" x2="19" y2="12" /></svg>
                      </button>
                      <span className="w-6 text-center text-sm font-black tabular-nums">{e.count}</span>
                      <button
                        type="button"
                        onClick={() => changeEntry(e, 1)}
                        aria-label={lang === 'hu' ? `Még egy hozzáadása: ${e.card.name}` : `Add one more ${e.card.name}`}
                        className="w-8 h-8 flex items-center justify-center rounded-full bg-white/10 cursor-pointer active:bg-white/25"
                      >
                        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
                      </button>
                      <button
                        type="button"
                        onClick={() => removeEntry(e)}
                        aria-label={lang === 'hu' ? `${e.card.name} törlése a beolvasásból` : `Remove ${e.card.name} from this scan`}
                        className="w-8 h-8 ml-0.5 flex items-center justify-center rounded-full text-red-300 bg-red-500/15 cursor-pointer active:bg-red-500/35"
                      >
                        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6M14 11v6" /><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" /></svg>
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )
          )}
        </div>
      </div>
    </div>
  );
}
