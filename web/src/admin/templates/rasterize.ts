/**
 * SVG → JPEG, in the browser.
 *
 * The panel is the only renderer in the stack: it already has the fonts, the
 * gradient and filter support, and the pixels on screen. Doing it here rather
 * than on the server keeps a headless Chrome out of the runtime image and
 * keeps SVG out of the media directory, which is served from this same origin
 * and has no authentication in front of it.
 */

/** Above this the JPEG gets big without a wall panel ever showing the detail. */
const MAX_EDGE = 2560;
const QUALITY = 0.9;

export async function rasterize(
  source: SVGSVGElement,
  width: number,
  height: number,
): Promise<Blob> {
  const clone = source.cloneNode(true) as SVGSVGElement;

  // The editing scaffolding is meaningless in an exported file, and
  // `data-base-size` in particular would be actively confusing to find later.
  for (const node of clone.querySelectorAll('[data-field]')) {
    for (const name of ['data-field', 'data-label', 'data-hint', 'data-fit', 'data-base-size']) {
      node.removeAttribute(name);
    }
  }
  // A <text> left empty still serializes; harmless, but drop them so the
  // output is what someone would have drawn by hand.
  for (const node of clone.querySelectorAll('text')) {
    if (!node.textContent?.trim()) node.remove();
  }

  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('width', String(width));
  clone.setAttribute('height', String(height));

  const markup = new XMLSerializer().serializeToString(clone);
  const url = URL.createObjectURL(new Blob([markup], { type: 'image/svg+xml' }));

  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('The template could not be drawn.'));
      image.src = url;
    });

    const factor = Math.min(1, MAX_EDGE / Math.max(width, height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(width * factor);
    canvas.height = Math.round(height * factor);

    const context = canvas.getContext('2d');
    if (!context) throw new Error('This browser would not give us a canvas to draw on.');
    // JPEG has no alpha, so anything not painted would come out white. These
    // templates are dark edge to edge, but a future one might not be.
    context.fillStyle = '#000';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', QUALITY),
    );
    if (!blob) throw new Error('The image could not be encoded.');
    return blob;
  } finally {
    URL.revokeObjectURL(url);
  }
}
