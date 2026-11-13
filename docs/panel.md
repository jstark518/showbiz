# Using the panel

## Keeping a table

The **Tables** tab holds small grids you maintain by hand — who is on call,
this week's lunch rota, a league ladder. Press **New table**, name it, and type
into the grid: headings across the top with an alignment each, rows below with
arrows to reorder them and an ✕ to remove one. Up to 8 columns and 100 rows,
which is far more than a wall panel can show legibly.

Nothing is saved until you press **Save** — the whole grid goes in one write,
so adding a column and filling it in is a single change rather than thirty.

Then add a **Data table** slide, point it at the table and set how many rows to
show; anything past that is counted underneath ("+ 3 more") rather than
silently dropped. The slide follows the table, so correcting a name on the
Tables tab reaches every sign showing it within about a second — no slide to
re-edit. Deleting a table leaves any slide using it saying so in plain language
instead of going blank.

## Making an image without a designer

Seven templates ship with the app. Change the words, and the panel turns one
into an image on your media library — no image editor, and nothing to install.

**Media → Make one from a template**, or the same button on any image slide, in
which case the result lands on that slide as well.

| Template | For |
| --- | --- |
| Statement | Artwork and one big sentence |
| Event notice | A date block beside a headline |
| Two facts | Guest Wi-Fi, a door code, a number and an extension |
| Please do this | A house rule, said without nagging |
| Three numbers | A stats board |
| Welcome | A lobby or reception greeting |
| Portrait poster | The same, for a panel hung the other way up |

Text that runs long wraps across the lines the artwork allows and then shrinks
to fit; press Enter to break a line yourself. Click any text in the preview to
jump to the field that draws it. If something still will not fit, the field
says so rather than quietly rendering it microscopic.

The rendering happens in your browser and uploads an ordinary JPEG, so the
server needs no image toolchain and the templates stay
[out of the media library](security.md), where an SVG would be a liability.

### Changing one later

What you typed is stored with the image, so **Edit wording** reopens it with
last time's text already in the boxes — on the Media tab, or on any slide
showing it. Next quarter's all-hands is a date change, not a retype.

There are two ways to save the result:

| | |
| --- | --- |
| **Update this image** | Keeps the same entry, so every slide already showing it picks up the new version by itself |
| **Save as a separate image** | Leaves the original where it is |

Updating swaps in a new file rather than overwriting the old path, because
`/media` is served immutable and cached for a month — reusing the address would
leave players showing last quarter's date until something evicted it.

What is stored is the wording, not the drawing: a few hundred bytes of text
against a template id. Edit a template's artwork and every image made from it
picks up the new look the next time it is regenerated.
