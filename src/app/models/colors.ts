// ─────────────────────────────────────────────────────────────────────────────
// Color constants & node styling maps
// Extracted from graph.component.ts for reuse across components.
// ─────────────────────────────────────────────────────────────────────────────

import { NodeType } from './graph.model';

// --- Palette ----------------------------------------------------------------

export const COLOR_PRIMARY = '#978B7F';
export const COLOR_ON_PRIMARY = '#DEDAD5';
export const COLOR_PRIMARY_CONTAINER = '#DEDAD5';
export const COLOR_ON_PRIMARY_CONTAINER = '#1F1205';

export const COLOR_SECONDARY_CONTAINER = '#E6E6E6';
export const COLOR_ON_SECONDARY_CONTAINER = '#1A1A1A';

export const COLOR_TERTIARY = '#2E2ECA';
export const COLOR_ON_TERTIARY = '#FFFFFF';
export const COLOR_TERTIARY_CONTAINER = '#EBEBF7';
export const COLOR_ON_TERTIARY_CONTAINER = '#101078';

export const COLOR_ELECTRIC = '#4B9BF5';
export const COLOR_ON_ELECTRIC = '#041A33';
export const COLOR_ELECTRIC_CONTAINER = '#F7FBFF';
export const COLOR_ON_ELECTRIC_CONTAINER = '#1C5494';

// --- Node styling maps ------------------------------------------------------

export const NODE_COLORS: Record<NodeType, string> = {
    SITE: COLOR_ELECTRIC_CONTAINER,       // "#F7FBFF"
    R1: COLOR_PRIMARY_CONTAINER,          // "#DEDAD5"
    R2: COLOR_PRIMARY_CONTAINER,          // "#DEDAD5"
};

export const NODE_STROKE_COLORS: Record<NodeType, string> = {
    SITE: COLOR_ELECTRIC,                 // "#4B9BF5"
    R1: COLOR_PRIMARY,                    // "#978B7F"
    R2: COLOR_ON_PRIMARY_CONTAINER,        // "#1F1205"
};

export const NODE_TEXT_COLORS: Record<NodeType, string> = {
    SITE: COLOR_ON_ELECTRIC_CONTAINER,    // "#1C5494"
    R1: COLOR_ON_PRIMARY_CONTAINER,       // "#1F1205"
    R2: COLOR_ON_PRIMARY_CONTAINER,       // "#1F1205"
};

export const NODE_LABEL_COLORS: Record<NodeType, string> = {
    SITE: COLOR_ON_ELECTRIC_CONTAINER,    // "#1C5494"
    R1: COLOR_ON_SECONDARY_CONTAINER,    // "#1A1A1A"
    R2: COLOR_ON_SECONDARY_CONTAINER,    // "#1A1A1A"
};

export const NODE_RADIUS: Record<NodeType, number> = {
    SITE: 30,
    R1: 22,
    R2: 22,
};

export const NODE_LABELS: Record<NodeType, string> = {
    SITE: 'R3',
    R1: 'R1',
    R2: 'R2',
};

// --- Link distances ---------------------------------------------------------

export const LINK_DISTANCE: Record<string, number> = {
    ANIMATION: 220,
    LOGISTICS: 280,
};
