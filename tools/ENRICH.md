# Word enrichment contract

You turn one input chunk `data/chunks/in-NN.json` into one output chunk `data/chunks/out-NN.json`.
The app is a Korean learner's spoken-English vocabulary app. Learners are Korean adults studying everyday conversation.

## Fences

- Write only your own `data/chunks/out-NN.json`. Never edit `in-*.json`, other chunks, `tools/`, or app files.
- Write every word yourself from your own knowledge. Never copy definitions verbatim from a published dictionary.
- Keep the input order and every `id` and `word` exactly as given. One output entry per input entry.

## Output shape

The file is a JSON array. Each element:

```json
{
  "id": 51,
  "word": "back",
  "pos": [
    {"p": "noun", "senses": [
      {"ko": "등, 허리", "en": "the part of the body between the neck and the hips, on the opposite side from the chest"},
      {"ko": "뒤쪽, 뒷면", "en": "the side or part of something that is farthest from the front"}
    ]},
    {"p": "adverb", "senses": [
      {"ko": "다시, 원래 자리로", "en": "to the place or state where someone or something was before"},
      {"ko": "뒤로", "en": "in or toward the rear"}
    ]},
    {"p": "verb", "senses": [
      {"ko": "지지하다, 후원하다", "en": "to give support or help to someone or something"}
    ]}
  ],
  "phrases": [
    {"t": "be right back", "ko": "금방 돌아올게"},
    {"t": "back up", "ko": "뒷받침하다; 후진하다; 백업하다"},
    {"t": "behind someone's back", "ko": "~ 몰래, 뒤에서"}
  ],
  "ex": {"en": "Hang on, I'll be right back.", "ko": "잠깐만, 금방 올게."}
}
```

### `pos`

- 1 to 3 groups. Include only parts of speech a learner meets in everyday speech. Most words have 1 or 2.
- **The first group's first sense must match the meaning that the input `def` describes.** The app shows that as the headline meaning and uses it in quizzes.
- `p` is one of: `noun`, `verb`, `adjective`, `adverb`, `pronoun`, `preposition`, `conjunction`, `determiner`, `article`, `modal`, `interjection`, `number`.
  Use `modal` for can/could/may/might/must/shall/should/will/would/ought. Use `article` for a/the. Use `number` for cardinal numbers.
- 1 to 3 senses per group, most common first.
- `ko`: natural Korean glosses a dictionary would print, comma separated, at most about 18 characters. No trailing period. For function words, give the usage gloss (e.g. `of` → `~의, ~ 중의`).
- `en`: a short, plain learner-dictionary definition in your own words, 4 to 20 words, lowercase start, no trailing period.

### `phrases`

- 0 to 3 common spoken phrases, idioms, phrasal verbs, or collocations that contain the word, most useful first.
- `t` is the phrase in English. `ko` is its Korean meaning, at most about 24 characters.
- Prefer things people actually say: `no way`, `come on`, `figure out`, `I bet`. Skip phrases for plain numbers unless one is truly common (`a couple of`, `in two minds` is too rare).

### `ex`

- One natural spoken sentence that uses the word in its headline meaning, at most 12 words.
- `ko` is a natural Korean translation, casual spoken register (반말 or 해요체), not stiff textbook Korean.

## Self-check

Run this until it prints `OK` for your chunk, then stop:

```bash
python3 tools/build_words.py --check NN
```
