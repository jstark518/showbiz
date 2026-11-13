# Writing a template

This section is meant to be enough on its own. The sources are annotated SVGs in
[server/templates/](../server/templates/). **Drop a new `.svg` in that directory and
it appears** — the filename without its extension is the id, and there is nothing
to register. They are read once per process, so restart the server (`npm run dev`
does it on save) or rebuild the image to pick up a new one.

Everything is declared in `data-` attributes, parsed by
[web/src/lib/template.ts](../web/src/lib/template.ts). Copy an existing file rather
than starting blank: `celebration.svg` shows a scatter with motion,
`heads-up.svg` a plain left-aligned layout, `holiday-hours.svg` two date fields.

## The shell

```xml
<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080"
     viewBox="0 0 1920 1080" data-category="Holidays">
  <title>Holiday hours</title>
  <desc>One line describing when to reach for this. Shown in the gallery.</desc>
```

1920×1080 throughout. `<title>` is the gallery name, `<desc>` its description.
`data-category` sections both pickers and defaults to `Everyday`; a new value
sorts after the known ones until it is added to `CATEGORY_ORDER` in
`web/src/lib/template.ts`.

**A template must be entirely self-contained.** The panel rasterizes it by
drawing the SVG into a canvas and calling `toBlob`. A reference to an external
font, image or stylesheet taints the canvas and `toBlob` throws instead of
producing a JPEG. Everything is drawn, and text uses the system font stack the
other templates use.

Ids are namespaced per template when parsed, so every file calling its gradient
`bg` and its blur `soft` is fine.

## Text fields

```xml
<text data-field="headline" data-label="Headline"
      data-hint="It wraps across two lines." data-fit="1150"
      x="146" y="450" font-size="140" font-weight="700" fill="#f8fafc">Quarterly</text>
<text data-field="headline" data-fit="1150"
      x="146" y="590" font-size="140" font-weight="700" fill="#f8fafc">all-hands</text>
```

- `data-field` is the id, and **two elements sharing one are two *lines* of a
  single thing to type into**, in document order. What you type wraps across
  them; pressing Enter wins over auto-wrap, so the artwork's own line break
  survives a round trip.
- `data-label` (on the first element of the group) is what the panel calls it,
  `data-hint` is an optional note under the input.
- `data-fit` is how wide the text may get, in the SVG's own units. Text past it
  shrinks to 45% and then spills — visibly, on purpose, because a caption that
  quietly became microscopic is worse than one that tells you to cut words.
- **Every `data-field` element needs its own `font-size` attribute.** Fitting
  reads it to reset before measuring; inherit it from a parent `<g>` and the
  shrink-to-fit maths has nothing to work with.

## Dates

One value drives several elements, each drawing a piece, so a date block is a
date picker rather than three boxes that can disagree about what day it is:

```xml
<text data-field="when" data-type="date" data-part="weekday" data-case="upper" …>THURSDAY</text>
<text data-field="when" data-part="day" …>18</text>
<text data-field="when" data-part="month" …>September</text>
```

`data-part` is `weekday`, `day`, `month`, `year` or `date` (the whole thing).
`data-case="upper"` matches artwork set in capitals. `data-value="2026-09-18"`
sets what it opens on; without it, today. Dates are formatted `en-US` regardless
of the editing machine's locale, so an image made at one desk reads the same as
one made at another.

## Colors

A color paints attributes instead of writing text, so it has its own attribute —
an element often needs to be a line of text *and* take its color from a swatch:

```xml
<circle data-paint-field="accent" data-paint="fill" data-paint-label="Accent color"
        data-paint-swatch="#f59e0b #ef4444 #38bdf8 #4ade80 #a78bfa #f472b6" fill="#f59e0b" …/>
<rect data-paint-field="accent" data-paint="fill stroke" …/>
```

`data-paint` names the attributes to set, defaulting to `fill`; it takes several,
space-separated. **The first element with a given `data-paint-field` in document
order sets the field's opening value** (read from its first painted attribute)
and should be the one carrying `data-paint-label`. `data-paint-swatch` is the
presets offered before the full picker — usually the palette the artwork was
drawn against.

Only paint *some* of a scatter. Wiring every confetti piece to one picker turns
confetti into a monochrome pattern.

## Motion

Optional. A template that declares any motion also becomes available as a **live
template slide**, which the sign renders and animates; one without stays a
media-library template that rasterizes to a flat JPEG. Both come from the same
file — `rasterize.ts` serializes the markup without the page's stylesheet, so an
animated element moves on the sign and sits still in the export.

```xml
<g transform="translate(300 230)">
  <path data-animate="draw" data-animate-delay="2" pathLength="1" d="…"/>
</g>
```

Motions are defined in
[plugins/template/web/sign.css](../plugins/template/web/sign.css):
`rise` · `pop` · `fade` · `sweep` · `draw` · `drift` · `breathe` · `pulse`.
`data-animate-delay` is 1–6, in 120ms steps, for staggering a group.

Three rules that are easy to get wrong and awkward to notice:

- **Never put a `transform` attribute on an element carrying `data-animate`.**
  The motions animate the `transform` property, and a CSS animation overrides a
  presentation attribute outright rather than composing with it — so the
  attribute is discarded for the life of the animation. A confetti piece written
  as `<rect transform="rotate(-18 …)" data-animate="drift">` sits tilted in the
  panel and snaps upright on the sign. Put placement on a wrapper `<g>` and
  motion on the child.
- **`draw` needs `pathLength="1"`, and only on a `<path>`.** The normalization
  is what makes a short arc and a long one take the same time. `pathLength` on a
  `<rect>` or `<circle>` is SVG2 and lands well after the Chromium a BrightSign
  runs; ignored, `stroke-dasharray: 1` measures against the real perimeter and
  the line renders as dots. Write rounded rectangles and circles as paths.
- **Nothing may set a resting opacity or transform.** An element's rest state
  has to be its normal one, so a player with reduced motion — or one too old to
  run the animation — shows finished artwork rather than a page of invisible
  text.

Entry motions are one-shot; `drift`, `breathe` and `pulse` loop. Use the looping
ones sparingly: a slide is on the wall for twenty seconds next to people trying
to work.

## Check it

Open the panel, pick the template from **Media → Make one from a template**, and
type into every field. The editor flags any field whose text still spills at
minimum size. For motion, put it on a template slide and use **Play again** in
the slide editor, which runs the real thing.

Two things worth checking that are easy to miss: that decoration does not land on
top of the text (measure, don't eyeball — a corner ornament sitting on the kicker
is invisible in a thumbnail), and that the stock wording you shipped in the file
actually fits its own boxes.

Write sample text in American English — it ends up on a wall.

To rasterize every template with its stock wording, for seeding a fresh install
or eyeballing a change across all of them at once:

```bash
./samples/render.sh
```

That needs Chrome on the machine doing the rendering. You do not need it to use
the templates; the panel does its own.
