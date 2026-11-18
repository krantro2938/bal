# Design brief: «Звёздная одиссея · Репетиции»

A rehearsal site for the 14th Traditional Ball of РТУ МИРЭА. The main job: someone opens a link on a phone, finds a dance, and loops a difficult figure. Every decision below serves that job.

## 1. What the official materials say

I sampled pixels from the channel's own images (preview images from `t.me/s/bal_rtumirea`, full-resolution copies from Telegram). The recurring system:

| Element | What the organizers do | Posts |
|---|---|---|
| Ground | Deep midnight-navy starfield, dominant pixel `#081028` (also `#081030`, `#000820`). Ultramarine nebula glows, never a flat gradient. | [1983](https://t.me/bal_rtumirea/1983), [2000](https://t.me/bal_rtumirea/2000), [2061](https://t.me/bal_rtumirea/2061) |
| Ink | Warm ivory or moon-silver type, never pure white. | 2000, [2079](https://t.me/bal_rtumirea/2079) |
| Display type | Calligraphic script for titles («Звёздная Одиссея», «Вальс-гавот», «Глоссарий»), set in quotes with flourish swashes. | 2000, 2079, [2214](https://t.me/bal_rtumirea/2214) (video title card) |
| Text type | High-contrast transitional serif with old-style figures («14-й Традиционный бал»), very close to Playfair Display. | 2000, 2061, [2211](https://t.me/bal_rtumirea/2211) |
| Structure | 1px hairline frames inset from the edge. Four-point star sparkles sit on corners and line intersections. Table rules on the schemes: «Счёт │ Движения». | 1983, 2000, 2211, [2219](https://t.me/bal_rtumirea/2219) |
| Image treatment | Real ball photos in a circular crop with a thin orbit ring. Photographic moon and planets at the edges. | 1983, 2000, [2041](https://t.me/bal_rtumirea/2041) |
| Theme device | Constellations: words or footprints joined by thin lines and dots. The waltz cards draw footwork as numbered steps on a curved path. | [2014](https://t.me/bal_rtumirea/2014), [2068](https://t.me/bal_rtumirea/2068) |
| Video | Tutorials open on a script title card over the starfield, then cut to a bright white rehearsal hall with dancers in 60s dress and an «РТУ МИРЭА» watermark. | 2214, 2096, 2220, [2082](https://t.me/bal_rtumirea/2082) |
| Signature | «Д.А.» monogram in a lace ring (the dance masters) on every scheme. | 2079, 2211 |

How the theme comes through: the 60s space age (Gagarin's anniversary) shown as night sky, moon and constellations, combined with a ball's formality (script, serif, hairlines). It is restrained: one dark hue, one light ink, no saturated colour.

## 2. Interaction references

- **YouTube mobile player.** Thumbnail previews while scrubbing, chapters drawn as segmented timeline, `?t=` share links, and a speed sheet. *Borrow:* preview-on-scrub, a segmented timeline for the glossary chapters, `?t=` links.
- **STEEZY Studio, a dance-learning app.** Speed is one tap (0.5× / 0.75× / 1×), loop is a first-class control beside play, and the video is split into named sections. *Borrow:* speed and loop live in the main bar, not a settings menu.
- **Practice tools like Anytune or Transcribe!** A and B markers set from the current position, visible on the timeline, nudgeable. *Borrow:* set A, then B, from the playhead; show the loop as a band on the timeline; one tap clears it.

## 3. Direction: "the scheme card, lit at night"

The site should feel like the official scheme cards made usable. The video carries the colour and the UI stays typographic. There is no hero and no decorative copy. The first thing on screen is a dance.

- **Moon ivory is the only accent.** In the dark theme it is the warm ivory `#E8DDC2`. In the light theme the accent becomes the poster's own navy `#1C2B6E`. Both come straight from the posters. The A–B loop band, active speed, focus rings and the primary button use it; nothing else does.
- **Hairlines, not boxes.** Content sits on 1px rules (as on 2211), not in shadowed cards. One four-point star glyph ✦ is the only ornament. It marks loop points A/B and section heads, and is never scattered as decoration.
- **Real frames.** Each cover is a frame from the tutorial with the full couple visible, feet included, chosen by hand per dance and recorded in the catalog. No title cards, no blur, no stock imagery.
- **Numbers matter.** Timecodes, counts («Счёт 9–10») and durations use tabular figures so they align as on the scheme tables.

### Palettes

Each theme is designed separately, not inverted from the other.

| Token | Light | Dark |
|---|---|---|
| `--bg` page | `#FFFFFF` | `#070C1F` (deeper than poster navy so frames glow) |
| `--surface` panels, sheets | `#F7F7F4` | `#0D1430` |
| `--surface-2` inputs, chips | `#EFEFEA` | `#141C3D` |
| `--line` hairlines | `#E2E1DA` | `#232D57` |
| `--line-strong` | `#C9C8BF` | `#34407A` |
| `--ink` text | `#0B1230` (poster navy, darkened) | `#ECE6D6` (ivory) |
| `--ink-2` secondary | `#4A5172` | `#A7AECB` |
| `--ink-3` meta | `#62677E` | `#8A91B3` |
| `--accent` | `#1C2B6E` | `#E8DDC2` |
| `--accent-ink` (on accent) | `#FFFFFF` | `#0A1028` |
| `--accent-soft` (loop band, selection) | `#1C2B6E1F` | `#E8DDC233` |
| `--danger` | `#A8322D` | `#F0938A` |
| `--player-bg` (always) | `#05091A` | `#05091A` |

Measured contrast: ink on bg 18.4:1 (light) and 15.6:1 (dark); the meta colour stays ≥ 4.6:1 on every surface in both themes. The theme follows `prefers-color-scheme` on the first visit. A manual choice (Светлая / Тёмная / Как в системе) is stored in `localStorage` and applied before first paint to avoid a flash.

### Type, all with Cyrillic support and self-hosted (no Google CDN at runtime)

- **Playfair Display** (display serif, the poster's text face). Used for dance titles, page titles and the wordmark (italic, for the script's swash), at 600 weight. It replaces the poster script, which would be illegible on phones.
- **Onest** (UI and body; a Cyrillic-first grotesque from a Russian foundry, open licence). Weights 400/500/600. Tabular figures for every number.
- Scale (px, mobile → desktop): title 28→40 · h2 20→24 · body 16 · small 14 · meta 13. Line height 1.5 body, 1.15 titles. Max line length 68ch.

### Components

1. **DanceCard.** 16:9 cover frame, duration chip (bottom-right, tabular), program number «01», title in Playfair, and a one-line meta: «Парный · схема · музыка». Hairline under each card on mobile.
2. **GlossaryCard.** Same footprint, text-led: «Словарь движений · 20 движений · 7:01», plus the first few movement chips.
3. **Rehearsal bar.** A row under the player: `−5` · play · `+5` · speed chip `0.75×` · `A` / `B` loop · share. 44px targets, labels in Russian.
4. **Timeline.** Vidstack slider with VTT thumbnails, chapter segments, loop band and note ticks.
5. **Sheet.** Bottom sheet on mobile, popover on desktop. Used for speed, the note editor and theme.
6. **Note row.** Timecode button, text and edit/delete actions.
7. **State block.** Icon-free message, one sentence and one action, for empty, unavailable and error states.
8. **Segmented tabs.** «Видео / Схема / Музыка / Заметки» on mobile.

Spacing: 4px base, rhythm 8/12/16/24/40. Radius: 6 on cover frames and inputs, 999 on chips, 12 on sheets. No shadows on cards; sheets get one soft shadow in light theme only.

## 4. Layouts

**Catalog (`/`).**
- *Phone:* a 52px header with the wordmark «Звёздная одиссея», the theme toggle and «Войти» (or an avatar linking to «Мои репетиции»). A sticky search field «Найти танец или движение» comes next. Then the list: the GlossaryCard first, then the 11 dances in program order, one column. Above the fold you see the search field and the first full cover.
- *Desktop (≥1024px):* max width 1200px. Header row, then search and a count «11 танцев · словарь». A 3-column grid with 24px gutters.

**Dance (`/dance/:slug`, `?t=42`).**
- *Phone:* the player is full-bleed 16:9 and sticky at the top while scrolling. Below it are the rehearsal bar and the title. Then the segmented tabs: «Фрагменты» (chapters, glossary only), «Заметки», «Схема», «Музыка», «Источник». A floating action «✦ Заметка на 1:23» appears when the playhead is paused.
- *Desktop:* two columns. Left (8/12): the player, the bar and the description. Right (4/12, sticky): notes, then the scheme thumbnails, then audio and the original-post link. The scheme opens in a full-screen viewer with pinch/zoom.

**Sign-in (`/login`).**
- *Phone:* a single centred column. «Войдите, чтобы заметки и прогресс были на всех устройствах», the Telegram Login button, and a line saying what is stored (Telegram name and id only), plus «Продолжить без входа».
- *Desktop:* the same column, 420px wide, centred under the header.

**«Мои репетиции» (`/me`).**
- *Phone:* sections in this order: «Продолжить» (a row of covers with progress lines and resume times), «Заметки» (grouped by dance, with timecodes as links), «Избранное», «Выучено» (a compact checklist of all 11 with ticks).
- *Desktop:* two columns, with «Продолжить» and «Заметки» on the left and «Избранное» and «Выучено» on the right.

## 5. Flows

1. **Shared link, as a guest.** Open `/dance/vals-gavot?t=42`. The page renders with the poster immediately and the player seeks to 0:42 on first play. No sign-in prompt appears before playback. The bar is usable at once. Tapping a note action shows a sheet: «Войдите через Telegram, чтобы сохранить заметку на 0:42». After sign-in the user returns to the same URL and time.
2. **Find and loop a figure.** In the catalog, type «гав» and «Вальс-гавот» filters in. Open it, scrub the timeline (thumbnails show the turn), tap `0.75×`, tap `A` at the start of the turn and `B` at its end. The band appears and playback loops. `±5` nudges, and holding `A`/`B` resets each point to the playhead. On the glossary, tap the chapter «Дамский тур» and «Повторять фрагмент» loops that chapter in one tap.
3. **Sign in, save a note, reopen on another device.** At the paused moment, tap «✦ Заметка на 1:23», type «на 3 — поворот под рукой» and save. The note is stored with the dance slug, the tutorial version and seconds. On a laptop, sign in with the same Telegram account and open «Мои репетиции»: the note is listed under «Вальс-гавот · 1:23». Tapping it opens `/dance/vals-gavot?t=83` paused at that frame.

## 6. States that matter

- **Loading.** Cover-ratio skeleton blocks with no shimmer, and a hairline title placeholder. The player shows the WebP poster at once because posters are served as static files. The video is requested only after the dance page mounts.
- **Video unavailable.** When a tutorial isn't prepared on this server, the cover is shown dimmed with the text «Видео ещё не загружено на сайт» and a button «Открыть пост в Telegram». No play button, never a fake player.
- **Network trouble mid-playback.** «Видео прервалось. Проверьте соединение» with «Повторить». The current time is kept.
- **Empty notes (signed in).** «Поставьте видео на паузу в нужном месте и нажмите «Заметка»». Guest: «Заметки сохраняются после входа через Telegram».
- **Empty «Мои репетиции».** «Здесь появятся танцы, которые вы начали смотреть», followed by the catalog list.
- **Search without results.** «Ничего не нашлось по «…»» with a link to the glossary, which often holds the movement name.
- **Note from an older tutorial version.** The note shows «к прошлой версии видео» and the timecode is still clickable.
- **Sign-in unavailable** (bot not configured, or widget blocked). The login page says so plainly and the rest of the site works.

## 7. First screen

On a phone, the first screen is the catalog itself: the wordmark, the search field and the first dance cover with its name and duration, so a tap is the first action. The second action is search. The empty top region of a typical landing page is spent on the glossary and the first dance instead.

## 8. Not in v1

Public reactions, comments and the AI companion. Follow-up idea: a companion that answers only from the official schemes, the verified chapter timestamps and the notes a user explicitly shares, and that always answers with a timestamp link back into the player.
