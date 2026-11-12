import { useEffect, useRef } from 'react';
import type { MediaAsset, VideoSlideConfig } from '../../../../shared/types';
import { SlidePlaceholder } from './SlidePlaceholder';

interface Props {
  config: VideoSlideConfig;
  media: MediaAsset | undefined;
  title: string;
  slideId: string;
  onFinished: (slideId: string) => void;
}

export function VideoSlide({ config, media, title, slideId, onFinished }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    // Restart from the top each time this slide comes round, and recover if
    // autoplay was blocked (an unmuted video will be, on most players).
    video.currentTime = 0;
    const attempt = video.play();
    if (attempt && typeof attempt.catch === 'function') {
      attempt.catch(() => {
        video.muted = true;
        void video.play().catch(() => {
          // Still refused: let the slide's timer move things along.
        });
      });
    }
  }, [media?.url, slideId]);

  if (!media) {
    return (
      <SlidePlaceholder
        heading={title || 'Video slide'}
        detail="No video selected. Pick one in the control panel."
      />
    );
  }

  return (
    <div className="slide slide--video">
      <video
        ref={videoRef}
        className={`slide__media slide__media--${config.fit}`}
        src={media.url}
        muted={config.muted}
        loop={config.loop}
        autoPlay
        playsInline
        // A stalled or unplayable file must not freeze the loop; treating an
        // error like a normal end hands control back to the slideshow.
        onEnded={() => onFinished(slideId)}
        onError={() => onFinished(slideId)}
      />
    </div>
  );
}
