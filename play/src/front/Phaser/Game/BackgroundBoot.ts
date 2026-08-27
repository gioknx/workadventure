/**
 * Keeps the boot moving when the renderer stops getting frames.
 *
 * Phaser's loop is rAF-driven and Chromium schedules no frame for a hidden renderer, so a world
 * that starts loading in a background window freezes: no scene switch, no `connect()`, no room.
 * Measured on a real world, window never shown: nothing after 150s; clocked by hand, the room is
 * joined in seconds, after ~250 ticks.
 *
 * Those ticks cannot come from a page timer. Throughput while hidden:
 *
 *      requestAnimationFrame      0    /s
 *      setInterval (page)         1    /s   — 0.05/s past Chromium's five-minute cliff
 *      setInterval (in a Worker)  62.5 /s   — visible, hidden, or hidden for hours
 *
 * Hence a worker as the clock, built from a blob URL that `worker-src 'self' blob:` already allows.
 * Do not "simplify" it back to setInterval: 250 ticks would take four minutes.
 *
 * The trigger is frame staleness, NOT `document.hidden`: in Electron a child WebContentsView
 * reports `document.hidden === true` while rendering at 120fps, until a first hide/show cycle.
 */

// The worker's period. It only has to out-pace the boot, not the display.
const CLOCK_INTERVAL_MS = 16;

// How stale the last frame must be before we consider the renderer starved. Roughly six missed
// frames at 60fps — long enough never to fight a visible renderer, short enough to react at once.
const FRAMES_MISSING_AFTER_MS = 100;

// Rather than enumerate the scenes that legitimately wait for the user — a list to keep in sync
// forever — give the boot a ceiling and stop. It needs about four seconds' worth of ticks.
const GIVE_UP_AFTER_MS = 60_000;

const CLOCK_SOURCE = `setInterval(() => postMessage(0), ${CLOCK_INTERVAL_MS});`;

/**
 * Starts clocking `tick` whenever frames stop arriving. Returns the function that stops it, which
 * must be called once the world is reached, and on teardown.
 */
export function pumpBootWhileFramesAreMissing(tick: () => void): () => void {
    let lastFrameAt = performance.now();
    let stopped = false;

    function watchFrames(): void {
        lastFrameAt = performance.now();
        if (!stopped) {
            requestAnimationFrame(watchFrames);
        }
    }

    let clock: Worker;
    let clockUrl: string;
    try {
        clockUrl = URL.createObjectURL(new Blob([CLOCK_SOURCE], { type: "text/javascript" }));
        clock = new Worker(clockUrl);
    } catch (error) {
        // No worker, no hand-driven clock: a hidden boot simply waits for the window, as it did
        // before. Never let this break the boot of a window that is perfectly visible.
        console.warn("Could not start the background boot clock; a hidden boot will wait.", error);
        return () => {};
    }

    function stop(): void {
        if (stopped) {
            return;
        }
        stopped = true;
        clearTimeout(ceiling);
        clock.terminate();
        URL.revokeObjectURL(clockUrl);
    }

    clock.onmessage = () => {
        if (performance.now() - lastFrameAt > FRAMES_MISSING_AFTER_MS) {
            tick();
        }
    };

    const ceiling = setTimeout(stop, GIVE_UP_AFTER_MS);

    requestAnimationFrame(watchFrames);

    return stop;
}
