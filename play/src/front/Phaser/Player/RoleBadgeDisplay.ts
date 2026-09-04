import * as Phaser from "phaser";
import type { GameScene } from "../Game/GameScene";
import { waScaleManager, WaScaleManagerEvent } from "../Services/WaScaleManager";
import type { RoleDefinition } from "./RoleCatalog";

// Same zoom compensation as UsernameDisplay: below CORRECTION_RATE the badge stops shrinking so it
// stays readable when the camera is zoomed out.
const CORRECTION_RATE = 0.65;
const BADGE_FONT_FAMILY = "Roboto";
const BADGE_FONT_SIZE = 5;
const BADGE_FONT_WEIGHT = 500;
const BADGE_LETTER_SPACING = 0.4;
const BADGE_HEIGHT = 7;
const BADGE_PADDING = 3;
const BADGE_RADIUS = 3.5;
// Vertical space between the top of the name pill and the bottom of the badge, in game pixels.
const BADGE_GAP = 1;
// Mirrors PLAYER_NAME_HEIGHT in UsernameDisplay: the name pill is centered on the anchor point, so
// its top edge sits half a pill above it and the badge has to clear that before the gap applies.
const NAME_PILL_HEIGHT = 14;
// The very pill the name uses (PLAYER_NAME_BACKGROUND_COLOR), so the badge reads as one caption
// stacked on the name rather than a second, louder object.
const BADGE_PILL_BACKGROUND = "rgba(27, 42, 65, 0.5)";
// Lighter halo than the name's: the ink is already a light tone on a dark pill.
const BADGE_TEXT_SHADOW = "0 1px 1px rgba(0, 0, 0, 0.55)";

/**
 * The role badge drawn right under the Woka name.
 *
 * It lives in the very same DOM layer as the name (`GameScene.usernameDomLayer`), so it inherits the
 * layer's transform: it follows the Woka, it is clipped by nothing, and it can never end up behind
 * the map or above the UI. Its z-index is the character depth, exactly like the name.
 *
 * `x`/`y` are the position of the BOTTOM of the name pill, i.e. `character.y + playerNameY`. The
 * badge derives its own offset from there so the gap stays constant in game pixels at every zoom.
 */
export class RoleBadgeDisplay {
    private readonly element: HTMLDivElement;
    private displayScale: number;

    private readonly onZoomChanged = (zoomModifier: number): void => {
        this.displayScale = Math.max(zoomModifier > 0 ? CORRECTION_RATE / zoomModifier : 1, 1);
        // Measured at render time only: before Phaser applies the layer transform for the new zoom,
        // getAncestorScale() would still report the previous frame's value.
        this.scene.usernameDomLayer.invalidateAncestorScale();
        this.scene.events.once(Phaser.Scenes.Events.RENDER, () => {
            this.applyStyles();
        });
    };

    constructor(
        private scene: GameScene,
        private x: number,
        private y: number,
        role: RoleDefinition,
    ) {
        const zoomModifier = waScaleManager.zoomModifier;
        this.displayScale = Math.max(zoomModifier > 0 ? CORRECTION_RATE / zoomModifier : 1, 1);

        this.element = document.createElement("div");
        this.element.ariaHidden = "true";
        this.element.className = "role-badge-display";
        this.element.textContent = role.label;
        this.element.style.position = "absolute";
        this.element.style.top = "0";
        this.element.style.left = "0";
        this.element.style.display = "flex";
        this.element.style.alignItems = "center";
        this.element.style.justifyContent = "center";
        this.element.style.willChange = "transform";
        this.element.style.background = BADGE_PILL_BACKGROUND;
        this.element.style.boxSizing = "border-box";
        this.element.style.color = role.color;
        this.element.style.textShadow = BADGE_TEXT_SHADOW;
        this.element.style.fontFamily = BADGE_FONT_FAMILY;
        this.element.style.fontWeight = `${BADGE_FONT_WEIGHT}`;
        this.element.style.whiteSpace = "nowrap";
        this.element.style.pointerEvents = "none";

        this.applyStyles();

        this.scene.usernameDomLayer.addUsername(this.element);

        this.scene.usernameDomLayer.invalidateAncestorScale();
        this.scene.events.once(Phaser.Scenes.Events.RENDER, () => {
            this.applyStyles();
        });

        this.scene.game.events.on(WaScaleManagerEvent.ZoomChanged, this.onZoomChanged);
    }

    public setPosition(x: number, y: number): this {
        if (x === this.x && y === this.y) {
            return this;
        }
        this.x = x;
        this.y = y;
        this.scene.events.once(Phaser.Scenes.Events.RENDER, () => {
            this.applyTransform();
        });
        return this;
    }

    public setPlayerDepth(depth: number): void {
        this.element.style.zIndex = `${Math.round(depth)}`;
    }

    public destroy(): void {
        this.element.remove();
        this.scene.game.events.off(WaScaleManagerEvent.ZoomChanged, this.onZoomChanged);
    }

    private applyTransform(): void {
        // Cancel the DOM layer's on-screen scale, for the same Safari rasterization reason detailed
        // in UsernameDisplay.getTransformScale(): keep this element's own transform a minification.
        const scale = Math.min(1 / this.scene.usernameDomLayer.getAncestorScale(), 1);
        // The offset has to be expressed with the SAME scale that sizes the element, otherwise the
        // badge lands inside the name. applyStyles() lays the badge out at `domScale`
        // (= displayScale / transformScale), so the name's 14 units are 14 * domScale on screen;
        // using displayScale alone moved the badge only ~9px against the ~20px it needed, which is
        // how it ended up overlapping the name twice in a row.
        const domScale = this.displayScale / scale;
        const y = this.y - (NAME_PILL_HEIGHT / 2 + BADGE_GAP + BADGE_HEIGHT / 2) * domScale;
        this.element.style.transform = `translate3d(${this.x}px, ${y}px, 0) translate(-50%, -50%) scale(${scale})`;
    }

    private applyStyles(): void {
        // Dividing by the transform scale lays the badge out at full resolution; the parent layer
        // re-applies the ancestor scale, so the on-screen size is unchanged by the split.
        const transformScale = Math.min(1 / this.scene.usernameDomLayer.getAncestorScale(), 1);
        const domScale = this.displayScale / transformScale;
        this.element.style.height = `${BADGE_HEIGHT * domScale}px`;
        this.element.style.padding = `0 ${BADGE_PADDING * domScale}px`;
        this.element.style.borderRadius = `${BADGE_RADIUS * domScale}px`;
        this.element.style.fontSize = `${BADGE_FONT_SIZE * domScale}px`;
        this.element.style.letterSpacing = `${BADGE_LETTER_SPACING * domScale}px`;
        this.applyTransform();
    }
}
