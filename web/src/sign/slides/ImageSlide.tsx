import type { ImageSlideConfig, MediaAsset } from '../../../../shared/types';
import { SlidePlaceholder } from './SlidePlaceholder';

interface Props {
  config: ImageSlideConfig;
  media: MediaAsset | undefined;
  title: string;
}

export function ImageSlide({ config, media, title }: Props) {
  if (!media) {
    return (
      <SlidePlaceholder
        heading={title || 'Image slide'}
        detail="No image selected. Pick one in the control panel."
      />
    );
  }

  return (
    <div className="slide slide--image">
      <img
        className={`slide__media slide__media--${config.fit}`}
        src={media.url}
        alt={config.caption || title || ''}
        draggable={false}
      />
      {config.caption ? <div className="slide__caption">{config.caption}</div> : null}
    </div>
  );
}
