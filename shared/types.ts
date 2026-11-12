/**
 * Wire types shared by the server, the sign and the control panel.
 *
 * What is *here* is the part of the contract nothing can be built without:
 * slides, playlists, signs, media and settings. Anything that belongs to one
 * feature lives with that feature under `plugins/`, and reaches this file
 * through the registry in `plugins/index.ts` — see the note there for how a
 * plugin is put together.
 *
 * The dependency runs one way, core → registry → plugin, so a plugin can be
 * read on its own and removing one is a matter of deleting its folder and its
 * four registry lines.
 */

import {
  PLUGIN_SLIDE_SPECS,
  PLUGIN_SLIDE_TYPES,
  type PluginSignData,
  type PluginSlideConfigMap,
  type SlideTypeSpec,
} from '../plugins';

export type { PluginSignData, SlideTypeSpec };

/**
 * Light or dark, chosen per slide.
 *
 * It used to be one setting for the whole sign, which was wrong the moment a
 * loop mixed a dark Jira board with light artwork: the choice belongs to the
 * thing being drawn, not to the screen drawing it.
 */
export type SignTheme = 'dark' | 'light';

/** How a still or video fills the 16:9 (or whatever) sign panel. */
export type MediaFit = 'cover' | 'contain';

export interface ImageSlideConfig {
  mediaId: string | null;
  fit: MediaFit;
  caption: string;
}

export interface VideoSlideConfig {
  mediaId: string | null;
  fit: MediaFit;
  /** Advance when the video ends rather than after duration_seconds. */
  useVideoDuration: boolean;
  loop: boolean;
  muted: boolean;
}

/**
 * The two slide types that are not a plugin. Both are the media library put on
 * screen, which is core to what the box is for, and neither has anything of
 * its own to configure, store or fetch.
 */
export interface CoreSlideConfigMap {
  image: ImageSlideConfig;
  video: VideoSlideConfig;
}

const CORE_SLIDE_SPECS = {
  // Neither takes a theme: the picture is the slide, edge to edge.
  image: { label: 'Image', defaultDurationSeconds: 12 },
  video: { label: 'Video', defaultDurationSeconds: 30 },
} satisfies Record<keyof CoreSlideConfigMap, SlideTypeSpec>;

export type SlideConfigMap = CoreSlideConfigMap & PluginSlideConfigMap;
export type SlideType = keyof SlideConfigMap;
export type SlideConfig = SlideConfigMap[SlideType];

export const SLIDE_SPECS: Record<SlideType, SlideTypeSpec> = {
  ...CORE_SLIDE_SPECS,
  ...PLUGIN_SLIDE_SPECS,
};

/** Core first, then plugins in registry order. The panel follows this. */
export const SLIDE_TYPES: SlideType[] = ['image', 'video', ...PLUGIN_SLIDE_TYPES];

export function isSlideType(value: unknown): value is SlideType {
  return typeof value === 'string' && value in SLIDE_SPECS;
}

/** The label for a type this build may not know — an older player, say. */
export function slideTypeLabel(type: string): string {
  return isSlideType(type) ? SLIDE_SPECS[type].label : type;
}

export interface Slide<T extends SlideType = SlideType> {
  id: string;
  playlistId: string;
  type: T;
  title: string;
  position: number;
  durationSeconds: number;
  enabled: boolean;
  /** Ignored by types whose spec has no `usesTheme`. */
  theme: SignTheme;
  /** Optional scheduling window; null on either side means unbounded. */
  startsAt: string | null;
  endsAt: string | null;
  config: SlideConfigMap[T];
  createdAt: string;
  updatedAt: string;
}

export type AnySlide = { [T in SlideType]: Slide<T> }[SlideType];

export interface Playlist {
  id: string;
  name: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  slideCount?: number;
}

/**
 * A registered screen.
 *
 * `token` is the address — a player loads `/s/<token>` and nothing else. It is
 * a bearer credential, so it is generated server-side and never derived from
 * anything else about the sign; deleting the row revokes it.
 */
export interface Sign {
  id: string;
  name: string;
  token: string;
  /** Null means it follows whichever playlist is on air. */
  playlistId: string | null;
  /** Resolved for display; null when the sign follows the playlist on air. */
  playlistName: string | null;
  /** Path only. The panel prefixes the origin it is being viewed on. */
  path: string;
  /** A live event stream is open from this sign right now. */
  connected: boolean;
  /** Last contact of any kind, including a plain poll. Null if never seen. */
  lastSeenAt: string | null;
  lastSeenIp: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * A starting-point graphic shipped with the app. The panel parses the SVG for
 * `data-field` text, lets you rewrite it, and rasterizes the result to a JPEG
 * it uploads like any other image — the SVG itself is never stored.
 */
export interface ImageTemplate {
  /** The filename without its extension. */
  id: string;
  svg: string;
}

export type MediaKind = 'image' | 'video';

/**
 * How a panel-generated image was made, so it can be remade.
 *
 * The recipe is stored rather than the SVG: it is small, it carries no markup
 * that could be served back from this origin, and reopening a template with
 * last quarter's wording already in the boxes is the thing you actually want.
 */
export interface MediaTemplateSource {
  kind: 'template';
  templateId: string;
  /** Field id → what was typed into it. */
  values: Record<string, string>;
}

export type MediaSource = MediaTemplateSource;

export interface MediaAsset {
  id: string;
  /** Path to fetch the bytes from, e.g. /media/<file>. */
  url: string;
  originalName: string;
  mimeType: string;
  kind: MediaKind;
  sizeBytes: number;
  createdAt: string;
  /** Null for anything uploaded from a file, which is most of them. */
  source: MediaSource | null;
}

/** What the sign polls for. Everything it needs to render, in one document. */
export interface SignPlaylist {
  playlistId: string | null;
  playlistName: string;
  /** Changes whenever any slide, plugin row or setting affecting the sign changes. */
  revision: string;
  /** Server clock, so the sign can correct a skewed local clock. */
  serverNow: string;
  slides: AnySlide[];
  media: Record<string, MediaAsset>;
  /** Rows the installed plugins contribute — dates, tables and so on. */
  plugins: PluginSignData;
  settings: SignSettings;
  /** Whether the blackout schedule says this screen should be dark right now. */
  sleep: SignSleepState;
}

/**
 * The blackout verdict, worked out server-side so a player never has to reason
 * about timezones — see `shared/blackout.ts`, which both sides call.
 */
export interface SignSleepState {
  asleep: boolean;
  /**
   * When the current stretch of awake or asleep ends, or null when nothing is
   * scheduled to change. A hint, not the mechanism: the sign re-asks on its
   * ordinary 60s poll, so a boundary lands within a minute even if this is
   * wrong — which it can be by an hour on the two days a year a zone shifts.
   */
  nextChangeAt: string | null;
}

/** One weekday's awake window. Times are `HH:MM` in the schedule's timezone. */
export interface BlackoutDay {
  /** False means dark all day. */
  on: boolean;
  from: string;
  /**
   * Earlier than `from` wraps past midnight, which is how an evening event
   * runs to 2am. Equal to `from` means all day.
   */
  until: string;
}

export interface BlackoutSchedule {
  enabled: boolean;
  /**
   * IANA zone the times are read in. Empty falls back to wherever this is
   * running, which in a container is almost always UTC — so the panel offers
   * the browser's own zone rather than leaving it blank.
   */
  timeZone: string;
  /** Seven entries, Sunday first, matching `Date#getDay`. */
  days: BlackoutDay[];
}

const OFFICE_HOURS: BlackoutDay = { on: true, from: '07:00', until: '19:00' };
const DARK: BlackoutDay = { on: false, from: '07:00', until: '19:00' };

export const DEFAULT_BLACKOUT: BlackoutSchedule = {
  enabled: false,
  timeZone: '',
  // Sunday first. Weekends off, because that is the schedule anyone turning
  // this on is most likely to want, and it is inert until they do.
  days: [DARK, OFFICE_HOURS, OFFICE_HOURS, OFFICE_HOURS, OFFICE_HOURS, OFFICE_HOURS, DARK],
};

export interface SignSettings {
  transition: 'fade' | 'slide' | 'none';
  transitionMs: number;
  /** Seconds of no touch input before autoplay resumes. */
  resumeAfterIdleSeconds: number;
  showClock: boolean;
  /** Corner ribbon naming the sign; useful when you run more than one. */
  signName: string;
  /** When the screen should be dark. Off by default. */
  blackout: BlackoutSchedule;
}

export const DEFAULT_SIGN_SETTINGS: SignSettings = {
  transition: 'fade',
  transitionMs: 600,
  resumeAfterIdleSeconds: 45,
  showClock: true,
  signName: '',
  blackout: DEFAULT_BLACKOUT,
};
