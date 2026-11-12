import { PLUGIN_SLIDE_EDITORS, type SlideEditorProps } from '../../../../plugins/web/admin';
import type { ImageSlideConfig, SlideType, VideoSlideConfig } from '../../../../shared/types';
import { Toggle } from '../components';
import { MediaStage } from './MediaStage';

interface Props extends SlideEditorProps {
  /** Called after the editor uploads media of its own, to refresh the list. */
  onMediaAdded?: () => void;
}

/**
 * The form under a slide's title and duration.
 *
 * Image and video are here; every other slide type's editor comes from the
 * plugin that owns it. A type with no editor still saves — title, duration and
 * scheduling are core — it simply has nothing of its own to configure.
 */
export function SlideConfigEditor({ type, ...props }: Props & { type: SlideType }) {
  switch (type) {
    case 'image':
      return <ImageEditor {...props} />;
    case 'video':
      return <VideoEditor {...props} />;
    default: {
      const Editor = PLUGIN_SLIDE_EDITORS[type];
      return Editor ? <Editor {...props} /> : null;
    }
  }
}

function ImageEditor({ config, onChange, media, onMediaAdded }: Props) {
  const value = config as unknown as ImageSlideConfig;
  return (
    <MediaStage
      kind="image"
      media={media}
      mediaId={value.mediaId}
      fit={value.fit}
      caption={value.caption}
      onChange={onChange}
      onMediaAdded={onMediaAdded}
    />
  );
}

function VideoEditor({ config, onChange, media, onMediaAdded }: Props) {
  const value = config as unknown as VideoSlideConfig;
  return (
    <>
      <MediaStage
        kind="video"
        media={media}
        mediaId={value.mediaId}
        fit={value.fit}
        video={{ loop: value.loop }}
        onChange={onChange}
        onMediaAdded={onMediaAdded}
      />
      <Toggle
        label="Play the whole video before moving on"
        checked={value.useVideoDuration}
        onChange={(useVideoDuration) => onChange({ useVideoDuration })}
        hint="When off, the slide duration above decides when to advance."
      />
      <Toggle
        label="Loop"
        checked={value.loop}
        onChange={(loop) => onChange({ loop })}
        hint="Looping ignores the setting above; the slide duration controls the advance."
      />
      <Toggle
        label="Muted"
        checked={value.muted}
        onChange={(muted) => onChange({ muted })}
        hint="Players block autoplay with sound. Leave this on unless the sign has speakers and you have tested it. The preview above is always silent either way."
      />
    </>
  );
}
