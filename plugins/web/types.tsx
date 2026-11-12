/**
 * What a plugin may contribute to the browser — both bundles.
 *
 * Kept apart from the two registries so a plugin can import the contract
 * without importing its siblings, and so neither registry has to be loaded to
 * type one file.
 *
 * The `.tsx` extension is doing real work here: the server tsconfig picks up
 * `plugins/**\/*.ts` and stops at the extension, which is what keeps React out
 * of the server project.
 */

import type { ComponentType, ReactNode } from 'react';
import type { AnySlide, MediaAsset } from '../../shared/types';
import type { PluginSignData, PluginSlideType } from '../index';

// --- sign -------------------------------------------------------------------

/**
 * One level of the drill-in stack. Tapping something on a slide pushes a
 * target; back pops it.
 *
 * Deliberately open rather than a closed union: a plugin declares its own
 * target shapes and registers a view per `kind`, so adding one is a change
 * inside that plugin. A kind this build has no view for draws a message —
 * the same reasoning as an unknown slide type.
 */
export interface DrillTarget {
  kind: string;
}

/**
 * Generic so a plugin can push its own concrete target shape without the
 * literal being rejected for having properties `DrillTarget` never declared —
 * which is the price of leaving the union open.
 */
export type DrillPush = <T extends DrillTarget>(target: T) => void;

export interface DrillContext {
  onPush: DrillPush;
  clockOffsetMs: number;
}

export interface DrillView {
  /** The crumb for this level. */
  title: (target: DrillTarget) => string;
  render: (target: DrillTarget, context: DrillContext) => ReactNode;
}

/**
 * Declares a drill view for one target shape.
 *
 * The cast is the whole point of the helper: the registry is keyed by `kind`,
 * so a view only ever receives targets of its own kind, but no type system
 * here can see that. Doing it once, in one line, beats a cast in every view.
 */
export function drillView<T extends DrillTarget>(view: {
  title: (target: T) => string;
  render: (target: T, context: DrillContext) => ReactNode;
}): DrillView {
  return view as DrillView;
}

export interface SlideRenderContext {
  slide: AnySlide;
  media: Record<string, MediaAsset>;
  /** Whatever the installed plugins sent with the playlist. */
  data: PluginSignData;
  /** serverNow minus the local clock, so a drifted player still counts down right. */
  clockOffsetMs: number;
  /** Video slides call this to advance early; everything else ignores it. */
  onFinished: (slideId: string) => void;
  /** Absent on a sign with no touchscreen, which disables every drill target. */
  onDrill?: DrillPush;
  /**
   * Set only by the panel's preview, where the payload is supplied rather than
   * fetched: `null` means "supplied, still loading". Absent means the slide
   * fetches for itself, which is the sign's path. A failed fetch never reaches
   * here — the preview draws a placeholder instead.
   */
  preview?: { data: unknown | null };
}

/**
 * Shared by every nav-chip icon so they line up and inherit the chip's color.
 * A plugin draws inside a 24×24 box and leaves the rest to the sign.
 */
export const NAV_ICON_PROPS = {
  viewBox: '0 0 24 24',
  className: 'sign-nav__icon',
  'aria-hidden': true,
  focusable: false,
} as const;

export interface SignSlide {
  render: (context: SlideRenderContext) => ReactNode;
  /**
   * Warm whatever this slide needs before the slideshow reaches it.
   *
   * Called for the slides coming up, not the one on screen, so a type that
   * fetches its own payload can have it in hand by the time it is rendered
   * rather than showing a loading state to the room. Fire and forget: it
   * returns nothing, and a failure must never reach the loop.
   */
  prefetch?: (slide: AnySlide) => void;
  /**
   * How this type appears on the bottom nav bar. Optional: without it a chip
   * still works, it just shows the slide's title and no icon.
   */
  nav?: { label: string; icon: ReactNode };
  /**
   * Loads the payload for a slide the panel is still editing, so the preview
   * can draw a config that has never been saved. Only slides that fetch
   * something of their own need it.
   */
  loadPreview?: (slide: AnySlide, signal: AbortSignal) => Promise<unknown>;
}

export interface SignPlugin {
  id: string;
  slides: Partial<Record<PluginSlideType, SignSlide>>;
  /** Drill-in views, keyed by the `kind` of the targets this plugin pushes. */
  drill?: Record<string, DrillView>;
}

// --- control panel ----------------------------------------------------------

export interface SlideEditorProps {
  /** The config as the form holds it: mid-edit, normalized by the server on save. */
  config: Record<string, unknown>;
  onChange: (patch: Record<string, unknown>) => void;
  /**
   * The slide as it stands in the form, unsaved edits included. Editors that
   * show a live preview render this rather than the saved row.
   */
  slide: AnySlide;
  media: MediaAsset[];
}

/**
 * An offer to turn one kind of slide into another, in place.
 *
 * The alternative was teaching the core image editor what a template slide is,
 * which is exactly the coupling the plugin split exists to avoid. This way the
 * knowledge stays with the type being converted *to*, and a plugin that has no
 * such offer says nothing.
 */
export interface SlideConversion {
  /** The slide type produced. */
  to: PluginSlideType;
  /** On the button. Says what it becomes, not what it is. */
  label: string;
  /** Explains the trade under the button. */
  hint?: string;
  /**
   * The config for the converted slide, or null when this slide cannot become
   * one — which is what decides whether the button is offered at all.
   */
  from: (slide: AnySlide, media: MediaAsset[]) => Record<string, unknown> | null;
}

export interface AdminTab {
  /** Also the hash route: `#/dates`. */
  id: string;
  label: string;
  page: ComponentType;
}

export interface AdminPlugin {
  id: string;
  slides: Partial<Record<PluginSlideType, ComponentType<SlideEditorProps>>>;
  /** Top-bar tabs, inserted after Media and before Signs. */
  tabs?: AdminTab[];
  /** Cards on the Settings tab, e.g. a set of credentials. */
  settings?: ComponentType[];
  /** Offers to convert another kind of slide into one of this plugin's. */
  conversions?: SlideConversion[];
}
