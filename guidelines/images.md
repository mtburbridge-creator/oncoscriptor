# Image guideline: the 12 generated illustrations

Read by the `prompts` and `reprompt` skills. Twelve images are generated per project. The owner approves any subset for the deck, so each image must stand on its own and all twelve must look like one set.

## Style rules

- Calm, warm, non-clinical illustration. Think editorial illustration or soft painted scene, not stock photography, not a medical textbook, not a hospital brochure.
- No text, letters, numbers, labels, logos, or signage anywhere in the image. Say "no text" in every prompt.
- No identifiable people. Faces are turned away, softened, distant, or implied. No celebrities, no real patients, no likeness of anyone.
- No gore, no blood, no wounds, no surgery, no needle or syringe close-ups, no IV lines in focus, no scanner tunnels looming over a person. Medical settings may appear only as soft, distant context.
- No fear imagery: no dark storms, skulls, cracks, countdowns, or shadowy figures.
- Consistent palette across all twelve: warm neutrals (cream, sand, soft terracotta) with one calm accent (sage green or dusty teal) and gentle sky blue. Low contrast, soft light, no neon. Name the palette in every prompt so the set matches.
- Aspect ratio 16:9, landscape. Generation size `1792x1024`. Keep the main subject in the central two thirds and leave quiet space on one side so slide text can sit over it.
- Diversity of subjects. Across the twelve, vary age, body type, skin tone, and setting (home, garden, kitchen, park, clinic waiting area, car, walking outside). No more than three images in a medical setting. Include at least two images with no person at all (objects, places, nature metaphors).
- Metaphors are welcome when they are gentle and clear: a path with rest stops, a garden being tended, a kettle and two cups, a calendar page in soft light. Avoid metaphors that imply winning or losing.

## Tying prompts to the script

- Each prompt illustrates one H2 section of `script/final.md`. The `section` field holds a short slug of that heading, like `cold-open`, `what-it-is`, `why-fatigue`, `recap`, `talk-to-your-oncologist`.
- Cover every section at least once. Longer body sections get two images. Spread the remaining images so the deck can follow the script in order.
- The `purpose` field is one sentence saying what the slide behind this image is for, such as "Set a calm tone while the presenter names the question".
- Never put a medical claim into an image. The image sets mood and place; the script carries the facts.

## Prompt format

One paragraph, under 100 words, in this order: subject, then style, then mood, then composition. End with the constraints.

```
<Subject: who or what, where, doing what, no faces or faces turned away>. <Style: soft editorial illustration, painted texture, warm cream and sand palette with sage green accent and gentle sky blue>. <Mood: calm, unhurried, hopeful>. <Composition: 16:9 landscape, subject in the center-left, quiet open space on the right, soft natural light>. No text, no logos, no identifiable faces, no needles, no blood.
```

Example:

> An older adult in a cardigan resting in a sunlit armchair by a window, a mug on the side table, face turned toward the garden outside. Soft editorial illustration with painted texture, warm cream and sand palette with a sage green accent and gentle sky blue. Calm, unhurried, quietly hopeful. 16:9 landscape, figure center-left, open wall space on the right, soft morning light. No text, no logos, no identifiable faces, no medical equipment.

## Quality bar

- 12 prompts, ids `01` to `12`, each under 100 words, each naming the palette, each ending with the constraint line.
- Every prompt maps to a real H2 in `script/final.md`.
- Subjects and settings vary across the set; at most three medical settings; at least two with no people.
- Nothing that could read as a specific person, a specific hospital, or a specific product.
