import * as Phaser from "phaser";
import type { Unsubscriber } from "svelte/store";
import type { SpaceInterface } from "../../Space/SpaceInterface";
import type { GameScene } from "../Game/GameScene";

// The world space every player of the room joins. Its users carry the `tags` the admin API returned
// for them in `/api/room/access`, which is where a role tag such as "diretoria" comes from.
const WORLD_SPACE_NAME = "allWorldUser";
// The space is joined asynchronously, well after the first Wokas are built. Poll until it shows up.
const SPACE_POLL_INTERVAL_MS = 1000;
const SPACE_POLL_MAX_ATTEMPTS = 60;

type TagsListener = (tags: string[]) => void;

/**
 * Resolves the tags of a Woka from its player name.
 *
 * The tags of a REMOTE player never reach `Character` through its constructor: `AddPlayerInterface`
 * does not carry them. They do reach the front through the world space, whose `SpaceUser` payload is
 * forwarded whole by the back. So we look the player up there, by name, and hand its tags over.
 *
 * One resolver per scene, shared by every character: a single subscription to `usersStore` instead of
 * one per Woka.
 */
class RoleTagsResolver {
    private readonly listenersByName = new Map<string, Set<TagsListener>>();
    private readonly tagsByName = new Map<string, string>();
    private spaceUnsubscriber: Unsubscriber | undefined;
    private pollTimeout: number | undefined;
    private pollAttempts = 0;
    private destroyed = false;

    constructor(private readonly scene: GameScene) {
        this.pollForWorldSpace();
    }

    public subscribe(playerName: string, listener: TagsListener): Unsubscriber {
        let listeners = this.listenersByName.get(playerName);
        if (!listeners) {
            listeners = new Set();
            this.listenersByName.set(playerName, listeners);
        }
        listeners.add(listener);

        const known = this.tagsByName.get(playerName);
        if (known !== undefined) {
            listener(JSON.parse(known) as string[]);
        }

        return () => {
            const current = this.listenersByName.get(playerName);
            if (!current) {
                return;
            }
            current.delete(listener);
            if (current.size === 0) {
                this.listenersByName.delete(playerName);
            }
        };
    }

    public destroy(): void {
        this.destroyed = true;
        if (this.pollTimeout !== undefined) {
            window.clearTimeout(this.pollTimeout);
            this.pollTimeout = undefined;
        }
        this.spaceUnsubscriber?.();
        this.spaceUnsubscriber = undefined;
        this.listenersByName.clear();
        this.tagsByName.clear();
    }

    private pollForWorldSpace(): void {
        if (this.destroyed || this.spaceUnsubscriber) {
            return;
        }

        let space: SpaceInterface | undefined;
        try {
            const registry = this.scene.spaceRegistry;
            space = registry.exist(WORLD_SPACE_NAME) ? registry.get(WORLD_SPACE_NAME) : undefined;
        } catch {
            // The registry is created after the room connection; before that its getter throws.
            space = undefined;
        }

        if (!space) {
            this.pollAttempts++;
            if (this.pollAttempts >= SPACE_POLL_MAX_ATTEMPTS) {
                // The world space never came up (no admin API, or the join failed). No badge, and the
                // Woka keeps exactly the display it has today.
                return;
            }
            this.pollTimeout = window.setTimeout(() => {
                this.pollTimeout = undefined;
                this.pollForWorldSpace();
            }, SPACE_POLL_INTERVAL_MS);
            return;
        }

        this.spaceUnsubscriber = space.usersStore.subscribe((users) => {
            for (const user of users.values()) {
                // The store fires on every property update (availability, camera, …); comparing the
                // serialized tags keeps the notification down to actual tag changes.
                const serialized = JSON.stringify(user.tags ?? []);
                if (this.tagsByName.get(user.name) === serialized) {
                    continue;
                }
                this.tagsByName.set(user.name, serialized);
                const listeners = this.listenersByName.get(user.name);
                if (!listeners) {
                    continue;
                }
                for (const listener of listeners) {
                    listener(user.tags ?? []);
                }
            }
        });
    }
}

const resolversByScene = new WeakMap<GameScene, RoleTagsResolver>();

/**
 * Subscribes to the tags of `playerName` in `scene`. The listener is called every time the tags of
 * that player change, and never called at all when the world space is unavailable.
 */
export function subscribeToRoleTags(scene: GameScene, playerName: string, listener: TagsListener): Unsubscriber {
    let resolver = resolversByScene.get(scene);
    if (!resolver) {
        resolver = new RoleTagsResolver(scene);
        resolversByScene.set(scene, resolver);
        scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
            resolversByScene.get(scene)?.destroy();
            resolversByScene.delete(scene);
        });
    }
    return resolver.subscribe(playerName, listener);
}
