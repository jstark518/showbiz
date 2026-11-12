import { PLUGIN_SLIDE_RENDERERS, type SlideRenderContext } from '../../../../plugins/web/sign';
import type { AnySlide, ImageSlideConfig, VideoSlideConfig } from '../../../../shared/types';
import { ImageSlide } from './ImageSlide';
import { SlidePlaceholder } from './SlidePlaceholder';
import { VideoSlide } from './VideoSlide';

/**
 * Maps a slide row to its renderer.
 *
 * Image and video are here because they are the media library on screen and
 * have nothing of their own to fetch; everything else comes from the plugin
 * that owns the slide type. A type with no renderer — an older player against
 * a newer database, or a plugin someone removed — falls through to a
 * placeholder rather than crashing the whole loop.
 */
export function SlideRenderer(context: SlideRenderContext) {
  const { slide, media, onFinished } = context;

  switch (slide.type) {
    case 'image': {
      const config = slide.config as ImageSlideConfig;
      return (
        <ImageSlide
          config={config}
          media={config.mediaId ? media[config.mediaId] : undefined}
          title={slide.title}
        />
      );
    }
    case 'video': {
      const config = slide.config as VideoSlideConfig;
      return (
        <VideoSlide
          config={config}
          media={config.mediaId ? media[config.mediaId] : undefined}
          title={slide.title}
          slideId={slide.id}
          onFinished={onFinished}
        />
      );
    }
    default: {
      const renderer = PLUGIN_SLIDE_RENDERERS[slide.type];
      if (renderer) return <>{renderer.render(context)}</>;
      return (
        <SlidePlaceholder
          heading={slide.title || 'Unsupported slide'}
          detail={`This player does not know how to show a "${slide.type}" slide.`}
        />
      );
    }
  }
}

/** What the panel's preview needs to know to fetch a draft slide's payload. */
export function slidePreviewLoader(type: string) {
  return PLUGIN_SLIDE_RENDERERS[type]?.loadPreview;
}

/**
 * Asks a slide type to warm its data before the loop arrives at it.
 *
 * A no-op for every type that draws from the playlist document, which is most
 * of them. Anything thrown is swallowed here as well as in the plugin: a
 * prefetch is an optimization, and one that could break the slideshow would be
 * a bad trade.
 */
export function prefetchSlide(slide: AnySlide): void {
  try {
    PLUGIN_SLIDE_RENDERERS[slide.type]?.prefetch?.(slide);
  } catch {
    // The slide will fetch for itself when it is shown.
  }
}
