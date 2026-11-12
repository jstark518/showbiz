interface Props {
  heading: string;
  detail: string;
}

/**
 * Shown when a slide is configured but not usable yet. A sign should say what
 * is wrong in plain language rather than showing a blank panel to the office.
 */
export function SlidePlaceholder({ heading, detail }: Props) {
  return (
    <div className="slide slide--placeholder">
      <div className="placeholder">
        <h1 className="placeholder__heading">{heading}</h1>
        <p className="placeholder__detail">{detail}</p>
      </div>
    </div>
  );
}
