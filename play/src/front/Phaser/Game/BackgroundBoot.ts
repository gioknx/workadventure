/**
 * Keeps the boot moving when the renderer stops getting frames.
 *
 * Chromium schedules no `requestAnimationFrame` for a renderer it considers hidden, and Phaser's
 * loop is rAF-driven (`forceSetTimeOut: false`). A world that starts loading in a background window
 * or tab therefore freezes outright: the scene never switches, `GameScene.create()` is never
 * reached, `connect()` is never called and the room is never joined. Measured on Electron 42 /
 * macOS, in the desktop app's real architecture (a child WebContentsView, not a bare window):
 * 0 frames while hidden, and the room is never joined — while the same boot, visible, joins it.
 *
 * So when frames stop arriving we clock Phaser's loop by hand until the world is reached. Driving
 * a real world that way, window never shown, joins the room after ~250 ticks.
 *
 * The clock is a Worker rather than a timer, because the page's own timers cannot deliver those
 * ticks. Measured throughput while hidden:
 *
 *      requestAnimationFrame      0    /s
 *      setInterval (page)         1    /s   — and 0.05/s past Chromium's five-minute cliff
 *      setInterval (in a Worker)  62.5 /s   — unchanged whether visible, hidden, or hidden for hours
 *
 * A worker's timers escape the page's throttling entirely, so ~250 ticks take about four seconds
 * instead of the four minutes a page timer would need. (`MessageChannel` is unthrottled too, at
 * ~55 000/s, but that is a CPU spin, not a clock.) The worker is built from a blob URL — no extra
 * bundle entry — which `worker-src 'self' blob:` in index.html already allows.
 *
 * The trigger is "no frame has arrived recently", deliberately NOT `document.hidden`: in Electron a
 * child WebContentsView reports `document.hidden === true` while it is rendering at 120fps, and
 * only starts telling the truth after a first hide/show cycle (measured). Anything gated on the
 * visibility API would pump non-stop from launch.
 *
 * The cost is bounded on both ends: nothing is pumped while frames flow, and pumping stops for good
 * once the world is reached — or at the ceiling below, for a user parked on a name/woka screen that
 * no amount of ticking can get past.
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
