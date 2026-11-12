import { useEffect, useMemo, useRef } from 'react';
import { applyField, parseTemplate, type TemplateField } from '../../../web/src/lib/template';
import { SlidePlaceholder } from '../../../web/src/sign/slides/SlidePlaceholder';
import { NAV_ICON_PROPS, type SignPlugin } from '../../web/types';
import type { TemplateArt, TemplateSlideConfig } from '../shared';
import './sign.css';

interface Props {
  config: TemplateSlideConfig;
  art: TemplateArt | undefined;
  title: string;
  slideId: string;
}

function TemplateSlide({ config, art, title, slideId }: Props) {
  const holderRef = useRef<HTMLDivElement>(null);

  // Parsing is a DOMParser pass plus a walk of the tree, so it is kept off the
  // render path and redone only when the artwork or the wording changes.
  const parsed = useMemo(() => {
    if (!art) return null;
    // Namespaced per slide, not per template: a playlist can hold two slides
    // on the same artwork, and both are in the document at once during a
    // transition. Sharing a prefix would have one slide's gradient resolve to
    // the other's.
    const template = parseTemplate(art, `${art.id}-${slideId}`);
    if (!template) return null;
    const fields: TemplateField[] = template.fields.map((field) => ({
      ...field,
      ...(field.id in config.values ? { value: config.values[field.id]! } : {}),
    }));
    return { template, fields };
  }, [art, slideId, config.values]);

  useEffect(() => {
    const holder = holderRef.current;
    if (!holder || !parsed) return;

    const node = parsed.template.doc.cloneNode(true) as SVGSVGElement;
    // Sized by the stage rather than by the file, so the artwork fills the
    // panel the way an image slide's picture does.
    node.removeAttribute('width');
    node.removeAttribute('height');
    node.setAttribute('preserveAspectRatio', 'xMidYMid slice');
    node.classList.add('tplart__svg');
    holder.replaceChildren(node);

    // Fitting measures with getComputedTextLength, which needs the element
    // laid out — so the values go in after it is in the document, not before.
    for (const field of parsed.fields) applyField(node, field);

    return () => holder.replaceChildren();
  }, [parsed]);

  if (!config.templateId) {
    return (
      <SlidePlaceholder
        heading={title || 'Template'}
        detail="No artwork chosen yet. Pick one in the control panel."
      />
    );
  }
  if (!art || !parsed) {
    return (
      <SlidePlaceholder
        heading={title || 'Template'}
        detail="That artwork is no longer installed. Choose another in the control panel."
      />
    );
  }

  return (
    <div
      ref={holderRef}
      className={`slide slide--tplart tplart ${config.animate ? 'is-animated' : ''}`}
    />
  );
}

export const templateSignPlugin: SignPlugin = {
  id: 'template',
  slides: {
    template: {
      nav: {
        label: 'Artwork',
        icon: (
          <svg {...NAV_ICON_PROPS} fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="4" width="18" height="16" rx="2" />
            <path d="M7 15l3.5-4 2.5 3 2-2.5L18 15" strokeLinejoin="round" />
          </svg>
        ),
      },
      render: ({ slide, data }) => {
        const config = slide.config as TemplateSlideConfig;
        return (
          <TemplateSlide
            config={config}
            art={data.templates.find((template) => template.id === config.templateId)}
            title={slide.title}
            slideId={slide.id}
          />
        );
      },
    },
  },
};
