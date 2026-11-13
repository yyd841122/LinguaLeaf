// One-shot generator for the ticket-10 bookmark human verification: a
// LONGER book (8 chapters, 7 paragraphs each) so in-chapter scrolling
// produces non-zero block anchors and cross-chapter jumps have distance.
// Original simple prose, common vocabulary (better offline-IPA hit rate).
// Uncommitted scratch — regenerate freely (builder pins zip timestamps).
import { writeFileSync } from "node:fs";
import { buildEpub } from "@lingualeaf/import-core/testing";

const P = (...sentences) => `<p>${sentences.join(" ")}</p>`;

const chapters = [
  {
    title: "1. The Boat Arrives",
    paras: [
      P(
        "The small boat crossed the gray water all morning.",
        "Mira sat at the front with her bag between her feet.",
        "The bag held a thick coat, two notebooks, and a photo of her family.",
        "She counted the waves to keep her stomach quiet."
      ),
      P(
        "The island grew slowly out of the sea.",
        "First it was a dark line.",
        "Then it became rocks, grass, and one white tower.",
        "The tower stood on the north end like a tall quiet man.",
        "Mira looked at it and took a long breath."
      ),
      P(
        "The boatman was old and did not say much.",
        "He pointed at the tower with one finger.",
        "\"That is yours now,\" he said.",
        "\"Keep it burning, and the ships will love you.\"",
        "Then he laughed, but not in an unkind way."
      ),
      P(
        "The water was too shallow near the shore.",
        "The boat stopped on a bed of small stones.",
        "Mira took off her shoes and jumped into the cold water.",
        "She carried her bag above her head.",
        "Her feet knew the shape of island stones at once."
      ),
      P(
        "The keeper's house sat below the tower.",
        "It was small, with one door and four windows.",
        "Inside there was a table, a stove, a shelf of books, and a bed.",
        "Dust lay on everything like light snow.",
        "Mira opened every window and let the sea air in."
      ),
      P(
        "A narrow stair ran up inside the tower.",
        "Mira counted the steps.",
        "There were one hundred and twelve.",
        "At the top, the great lamp waited under a cloth.",
        "Its glass was clean, but the room smelled of old oil."
      ),
      P(
        "On the table by the lamp lay a notebook.",
        "The last keeper had written in it every day for nine years.",
        "The last line said: \"Sea calm.",
        "Light clean.",
        "Handing over with a glad heart.\"",
        "Mira read it twice and then wrote the date and her own first line."
      ),
    ],
  },
  {
    title: "2. The First Night",
    paras: [
      P(
        "The sun went down into the water like a hot coin.",
        "Mira watched it from the top of the tower.",
        "The sky turned orange, then purple, then a deep blue.",
        "The first star came out over the sea.",
        "She decided it was her star now."
      ),
      P(
        "The lamp was simpler than she had feared.",
        "There was oil to check, a wick to cut, and glass to shine.",
        "A heavy clock inside the tower turned the light around and around.",
        "Mira followed the old notebook's words step by step.",
        "Her hands were slow, but they were careful."
      ),
      P(
        "At last she lit the wick.",
        "The flame stood up straight and small.",
        "Then the clock began to turn, and the light swung out over the water.",
        "Mira ran to the window and watched her light touch the waves.",
        "It went around every seven seconds, exactly as the book promised."
      ),
      P(
        "The house felt very quiet after dark.",
        "Mira made tea on the stove and sat with her notebook.",
        "The pencil sound seemed loud.",
        "Outside, the sea moved against the stones without stopping.",
        "She wrote: \"Night one.",
        "The light turns.",
        "I am not afraid.\""
      ),
      P(
        "But at two in the morning she woke up in the dark.",
        "She could not remember where she was.",
        "Then she heard the sea, and she knew.",
        "She climbed the tower in her coat to check the lamp.",
        "It burned on, calm and bright, asking nothing of her."
      ),
      P(
        "From the top she saw the world in a new way.",
        "The water was black, and her light walked across it.",
        "Far away, a small boat carried a small light of its own.",
        "The two lights found each other across the miles.",
        "The far boat turned, slow and safe, and went on up the coast."
      ),
      P(
        "Mira went back to bed with a warm chest.",
        "The light had spoken to that boat.",
        "It had said the one word a lighthouse knows.",
        "That word is here.",
        "She slept until the birds began."
      ),
    ],
  },
  {
    title: "3. A Storm Comes",
    paras: [
      P(
        "On the ninth day the wind changed.",
        "The old notebook had a rule for this: watch the sky at noon.",
        "At noon the sky was green at the edge of the sea.",
        "Mira read that green sky means go check everything twice.",
        "She checked everything twice."
      ),
      P(
        "The barometer in the tower fell all afternoon.",
        "The needle moved the way a nervous finger taps a table.",
        "Mira filled the oil tank to the top.",
        "She carried water into the house and put the window boards on.",
        "The boards were heavy, and the wind helped her by pushing them shut."
      ),
      P(
        "The storm arrived after dark, all at once.",
        "The rain did not fall; it flew.",
        "The tower shook in long slow sighs.",
        "Mira stood at the lamp with both hands on the table.",
        "The light turned and turned and did not stop."
      ),
      P(
        "Thunder came down the stairway like a dropped chair.",
        "Mira counted seconds between the flash and the sound.",
        "The gap grew shorter.",
        "She filled the stove in the house and left the door open to the tower.",
        "Then she went back up into the noise."
      ),
      P(
        "Near midnight she found a problem.",
        "Rain had found a thin path under the lamp room glass.",
        "A slow drop hung above the works, ready to fall.",
        "Mira pressed her last clean cloth into the gap and held it there.",
        "She held it for two hours, singing to herself to stay awake."
      ),
      P(
        "The storm walked off toward the north near morning.",
        "The wind dropped from a shout to a talk, then to a whisper.",
        "Mira, wet and gray, checked the lamp one more time.",
        "It turned, it burned, it asked for oil.",
        "She gave it oil, and then she finally slept in her coat."
      ),
      P(
        "The next day the beach was a new country.",
        "The sea had carried in wood, rope, a blue shoe, and a strange round seed.",
        "Mira walked the shore and picked up the seed.",
        "She put it in a cup on her window sill.",
        "In the notebook she wrote: \"Storm one.",
        "Light one.\""
      ),
    ],
  },
  {
    title: "4. The Lost Bird",
    paras: [
      P(
        "After the storm, Mira found a bird on the steps.",
        "It was a young gull, gray as the morning.",
        "One wing hung wrong, and its eyes were half closed.",
        "It did not run away when she came near.",
        "That silence worried her more than the wing."
      ),
      P(
        "Mira carried the bird inside in her hat.",
        "She made a nest of dry grass in a wooden box.",
        "She set the box near the stove, out of the light.",
        "The bird sat in the middle of the nest like a stone.",
        "Mira gave it water in a shallow dish and named it Ash."
      ),
      P(
        "The notebook said nothing about birds.",
        "So Mira wrote a new page and titled it Ash.",
        "Day one: ate nothing.",
        "Day two: ate half a fish and stood up.",
        "Day three: bit my finger and knocked the water over.",
        "She underlined the last line twice, because it felt like good news."
      ),
      P(
        "The wing was the slow part.",
        "Mira made a small paper splint and taped it gently.",
        "Ash walked around the house like an old man with a stick.",
        "He watched Mira cut vegetables from the corner of his eye.",
        "He had opinions about everything and said so at dawn."
      ),
      P(
        "Two weeks later, Mira opened the door and put the box outside.",
        "Ash stepped onto the grass and stopped.",
        "The wind moved over his feathers, and something in him remembered.",
        "He opened both wings wide, the bad one and the good one.",
        "They looked, for the first time, like a pair."
      ),
      P(
        "He flew straight up, shouting.",
        "Two other gulls answered from the water.",
        "Ash went around the tower twice, as if to read it.",
        "Then he flew north and became a small gray dot.",
        "Mira waved until there was nothing left to wave at."
      ),
      P(
        "All that summer, a gray gull sat on the tower rail in the evening.",
        "Mira never knew if it was Ash.",
        "She decided it was, because the decision cost nothing and paid daily.",
        "The notebook's Ash page got one more line.",
        "\"Day forty: he comes back most nights.",
        "Good bird.",
        "Good island.\""
      ),
    ],
  },
  {
    title: "5. Letters from Home",
    paras: [
      P(
        "Once a month, a supply boat came around the south point.",
        "It brought oil, flour, tea, candles, and news.",
        "The boat's name was Jenny, and her captain had a red beard.",
        "He shouted hello before the anchor hit the water.",
        "Mira shouted hello back and did not stop smiling for an hour."
      ),
      P(
        "The best cargo was paper.",
        "Mira's mother wrote long letters about the garden.",
        "Her brother sent drawings of city trains.",
        "The woman at the book shop sent thin novels with kind notes inside.",
        "Each letter had been read, folded, and carried across sixty miles of water just for her."
      ),
      P(
        "That month her mother's letter was short.",
        "Her father's cough had come back, the letter said.",
        "It was not bad yet, but it was back.",
        "Mira read the letter four times under the lamp.",
        "The sea between her and home felt wider than any map could draw."
      ),
      P(
        "She wrote back that same night.",
        "She wrote about the lamp, the birds, and the green winter light.",
        "She did not write that she was lonely, because it would cost her mother sleep.",
        "At the bottom she drew the tower and a small waving person at the top.",
        "Her mother would know who it was."
      ),
      P(
        "The reply came four weeks later.",
        "Her father was up and walking to the village again, slowly.",
        "He had bought a hat.",
        "He said the hat was mostly to make people stop asking about the cough.",
        "Mira laughed alone in the kitchen until the windows shook."
      ),
      P(
        "The captain of the Jenny watched all this paper come and go.",
        "\"You keep two fires burning,\" he said once.",
        "\"The one up there, and the one in those letters.\"",
        "He pointed at the tower, then at her box of paper.",
        "Mira thought that was about right, and said so."
      ),
      P(
        "She kept every letter in the drawer under the books.",
        "On hard nights, she read old ones instead of new ones.",
        "Old letters were warm bread; new letters were seed.",
        "Both fed her.",
        "The drawer was never locked, because a keeper's door opens to anyone who crosses the water."
      ),
    ],
  },
  {
    title: "6. The Quiet Weeks",
    paras: [
      P(
        "June came, and the island went soft.",
        "Grass grew in the cracks of the stone steps.",
        "The nights shrank until the light of the lamp was almost shy.",
        "Mira woke with the sun and worked with the sun.",
        "The world smelled of salt and warm rock."
      ),
      P(
        "She planted a garden in a sheltered corner.",
        "It was a ridiculous garden, six steps by four.",
        "She grew hardy things: potatoes, onions, one brave row of peas.",
        "The wind edited her plans daily.",
        "What survived, survived, and she ate it with pride."
      ),
      P(
        "There were repairs, always.",
        "A step that rang hollow.",
        "A window that drank rain.",
        "The clock in the tower that wanted oil and patience.",
        "Mira learned each repair twice: once wrong, once right."
      ),
      P(
        "She read the shelf of books from left to right.",
        "The old keeper had loved sea stories, so she now loved them too.",
        "In the evenings she read aloud to the empty room.",
        "Her voice made the room not empty.",
        "Even the tower seemed to lean in through the open door."
      ),
      P(
        "Some days the quiet had teeth.",
        "The sky was white, the sea was white, and the hours went by without one sound worth naming.",
        "On those days Mira cleaned things that were already clean.",
        "She swept the tower steps one hundred and twelve, and then again.",
        "Order was her rope, and she held it until the color came back into the world."
      ),
      P(
        "Then the gray gull would land on the rail, or a fishing boat would toot twice, or a letter-shaped wave would break just so.",
        "The island would speak its one or two words.",
        "And the day would turn over and become warm again.",
        "Mira learned that quiet is not one thing.",
        "Some quiet is a wall, and some is a door."
      ),
      P(
        "In the notebook, the quiet weeks filled half a page.",
        "\"Garden up.",
        "Steps fixed.",
        "Peas contested by birds; final count pending.\"",
        "Underneath, smaller: \"I am learning the island's language.",
        "It is mostly verbs.\""
      ),
    ],
  },
  {
    title: "7. A Ship in Trouble",
    paras: [
      P(
        "The fog came on a Tuesday, without asking.",
        "It did not roll in; it simply arrived, as if the world had been erased with a wet cloth.",
        "Mira could not see the water from the tower window.",
        "She could see three feet of rail and her own breath.",
        "The light turned in the white like a thought in an empty head."
      ),
      P(
        "Fog is the lighthouse's true customer.",
        "Any light can shine on a clear night.",
        "Mira wound the clock twice and wiped the glass every hour.",
        "She kept the lamp at its loudest, brightest best.",
        "Then she listened, because in fog the ears do half the work."
      ),
      P(
        "Near ten o'clock she heard an engine.",
        "It was not the passing kind.",
        "It came and stopped, came and stopped, like a man feeling for a wall in the dark.",
        "Mira's stomach went cold.",
        "That engine was circling, and circling in fog means lost."
      ),
      P(
        "There was a horn in the tower, an old brass thing.",
        "Mira had oiled it once out of boredom, with no idea why.",
        "Now she knew why.",
        "She carried it to the rail and gave it three long calls.",
        "The sound went out into the white and died without an echo."
      ),
      P(
        "The engine stopped for a long minute.",
        "Then it turned, slow and sure, toward the tower's voice.",
        "Mira blew the horn again every minute, and the light walked its circle.",
        "Between her calls, she heard the engine grow closer and steadier.",
        "A boat that trusts a sound will follow it anywhere."
      ),
      P(
        "The fishing boat came out of the fog so close that Mira could read its name.",
        "It was called Petrel, and its young captain's face was white as the fog.",
        "He looked up at the tower and put his hand flat on his chest.",
        "Mira put her hand flat on the rail.",
        "No words crossed the gap, and none were needed."
      ),
      P(
        "The Petrel found the harbor path and went home.",
        "The fog burned off by noon, like a fever breaking.",
        "Mira slept that afternoon with her boots on.",
        "In the notebook she wrote one line and then a second.",
        "\"Fog.",
        "Horn used, three calls.",
        "Petrel home.\"", "\"Note to self: oil the horn every month, forever.\""
      ),
    ],
  },
  {
    title: "8. The Long Summer",
    paras: [
      P(
        "August was the island at its kindest.",
        "The sea went flat and blue in the mornings.",
        "The rocks held the day's heat like bread holds butter.",
        "Mira swam off the south steps and screamed at the cold, every day, happily.",
        "The season turned without asking her, but she had made her peace with it."
      ),
      P(
        "The Jenny came with August's oil and August's letters.",
        "The captain brought a crate of plums as a gift.",
        "\"From my wife,\" he said.",
        "\"She says keepers need fruit.",
        "I say keepers need everything.\"",
        "Mira ate plums on the tower steps and let the juice dry on her hands."
      ),
      P(
        "Her brother came on the Jenny, for one week.",
        "He was city-shaped and island-curious.",
        "He counted the tower steps wrong three times and fell asleep at nine every night.",
        "He called the generator \"the snoring dragon\" and the gull \"your staff.\"",
        "The week went fast, the way good weeks do."
      ),
      P(
        "On his last night they climbed the tower together.",
        "The lamp turned above them like a slow planet.",
        "\"Do you like it here?\" he asked.",
        "Mira thought about the storm, the bird, the fog, the quiet with teeth.",
        "\"I am needed here,\" she said, \"and I need to be needed.",
        "The rest is weather.\""
      ),
      P(
        "He left on the morning boat and waved from the back rail until the island was a line.",
        "Mira waved until her arm was tired.",
        "Then she turned and looked at her white tower, her small garden, her ridiculous brave peas.",
        "The chest feeling came back, the warm one.",
        "The island spoke its one or two words, and she understood them."
      ),
      P(
        "Summer closed its hand in September.",
        "The light stretched long again, and the lamp found its old work.",
        "Mira wrote the season's last lines in the notebook by lamplight.",
        "\"Summer done.",
        "Garden: six pots of peas, victory.",
        "Bird: promoted.",
        "Tower: mine, and I am its.\""
      ),
      P(
        "The last page of her first year had one more line waiting.",
        "She wrote it slowly, in her best hand, the way you write a promise.",
        "\"The light turns.",
        "The boats come home.",
        "I keep the fire, and the fire keeps me.\"",
        "Then she wound the clock, trimmed the wick, and shone the glass.",
        "The light went around, seven seconds, seven seconds, all night long."
      ),
    ],
  },
];

const docs = chapters.map((chapter, i) => ({
  href: `text/ch${i + 1}.xhtml`,
  body: `<h1>${chapter.title}</h1>${chapter.paras.join("")}`,
}));

const bytes = await buildEpub({ title: "The Lighthouse Diary", docs });
const out = new URL("./The-Lighthouse-Diary.epub", import.meta.url);
writeFileSync(out, bytes);
const blocks = chapters.reduce(
  (n, c) =>
    n +
    c.paras.join(" ").split(". ").filter((s) => s.trim().length > 0).length,
  0
);
console.log(
  `The-Lighthouse-Diary.epub: ${bytes.length} bytes, ${chapters.length} chapters, ~${blocks} sentences`
);
