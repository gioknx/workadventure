/**
 * Declarative catalog of the "special roles" of the house.
 *
 * A role is nothing more than a tag the admin API already sends along the user (see
 * `/api/room/access` -> `tags`). This file is the ONLY place that decides how a tag is displayed:
 * add an entry here and the badge shows up under the Woka name, remove it and the badge disappears.
 *
 * Order matters: a user carrying several role tags is displayed with the FIRST entry of this list
 * that matches, so the most authoritative role wins.
 *
 * Colors are the INK of the label, not a filled background: the badge borrows the same translucent
 * dark pill the Woka name uses, so a role reads as a discreet caption above the name instead of a
 * colored block competing with it. Each tone is picked light enough to stay legible on that pill.
 */
export interface RoleDefinition {
    /** The tag, exactly as it travels in `SpaceUser.tags` / `RoomConnection.getAllTags()`. */
    readonly tag: string;
    /** Short label drawn in the badge. Kept uppercase and short so it fits above the name. */
    readonly label: string;
    /** Label ink, as a CSS color. Light tone, drawn on the shared translucent dark pill. */
    readonly color: string;
}

export const ROLE_CATALOG: readonly RoleDefinition[] = [
    { tag: "admin", label: "ADMIN", color: "#ff9a90" },
    { tag: "diretoria", label: "DIRETORIA", color: "#d3aef5" },
    { tag: "vip", label: "VIP", color: "#ffd27a" },
    { tag: "vendedor", label: "VENDEDOR", color: "#7fe3ad" },
];

/**
 * Returns the role to display for a set of tags, or undefined when none of the tags is a known
 * role. Undefined means "no badge at all": the Woka keeps exactly the display it has today.
 */
export function findRole(tags: readonly string[] | undefined): RoleDefinition | undefined {
    if (!tags || tags.length === 0) {
        return undefined;
    }
    return ROLE_CATALOG.find((role) => tags.includes(role.tag));
}
